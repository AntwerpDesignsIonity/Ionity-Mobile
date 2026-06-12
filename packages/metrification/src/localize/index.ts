/**
 * Localization: build a Metrification model from accepted calibration captures,
 * then estimate position / distance / direction / height for a new capture.
 *
 * Two estimators are fused:
 *   • Path-loss ranging (RSSI → distance), fused with FTM when present.
 *   • kNN fingerprinting over z-scored feature vectors → position.
 * The fingerprint gives heading + height; the range gives a robust radius. The
 * final position places the device at the fused radius along the fingerprint
 * heading, at the fingerprint height.
 */
import type {
  AccessPoint,
  Capture,
  CompassDirection,
  FeatureVector,
  LocalizationResult,
  Vec3,
} from "../models/index.js";
import type { AcceptedCapture } from "../calibration/index.js";
import { extractFeatures, featureVectorToArray } from "../features/index.js";
import {
  distancePointPosition,
  heightPointPosition,
  horizontalMagnitude,
  magnitude,
  vectorToCompass,
  weightedCentroid,
  scale,
} from "../geometry/index.js";
import {
  fitPathLoss,
  fuseRange,
  rssiToDistance,
  type PathLossModel,
  type RangeSample,
} from "../ranging/index.js";

/** A stored calibration fingerprint: feature vector ↔ known position. */
export interface Fingerprint {
  feature: number[];
  position: Vec3;
}

/** Serializable trained model. Persisted by the server, shippable to agents. */
export interface MetrificationModel {
  version: 1;
  ap: AccessPoint;
  /** Heading of the calibration distance axis. */
  direction: CompassDirection;
  pathLoss: PathLossModel;
  fingerprints: Fingerprint[];
  /** Whether CSI amplitudes are part of the feature vector. */
  includeCsi: boolean;
  /** Feature-vector length used (all fingerprints share this). */
  featureLength: number;
  /** Per-dimension mean for z-scoring. */
  mu: number[];
  /** Per-dimension std for z-scoring (0 replaced by 1). */
  sigma: number[];
  /** Neighbours used by the kNN estimator. */
  k: number;
  createdAt: number;
}

export interface BuildModelOptions {
  /** Use CSI amplitudes in the feature vector (auto: true if any capture has CSI). */
  includeCsi?: boolean;
  /** kNN neighbour count. Default 3. */
  k?: number;
}

function positionOfAccepted(a: AcceptedCapture): Vec3 {
  if (a.label.axis === "distance") {
    return distancePointPosition(a.label.valueMeters, a.label.direction!);
  }
  return heightPointPosition(a.label.valueMeters);
}

/** Build a trained model from the captures a CalibrationMachine accepted. */
export function buildModel(
  accepted: readonly AcceptedCapture[],
  direction: CompassDirection,
  ap: AccessPoint,
  options: BuildModelOptions = {},
): MetrificationModel {
  if (accepted.length === 0) {
    throw new Error("cannot build a model from zero accepted captures");
  }

  const includeCsi =
    options.includeCsi ?? accepted.some((a) => a.features.csiAmpMean.length > 0);

  // Feature arrays, truncated to the shortest common length so heterogeneous
  // captures still align dimension-for-dimension.
  const rawArrays = accepted.map((a) => featureVectorToArray(a.features, includeCsi));
  const featureLength = rawArrays.reduce((m, arr) => Math.min(m, arr.length), Infinity);
  const arrays = rawArrays.map((arr) => arr.slice(0, featureLength));

  // Per-dimension mean/std for z-scoring.
  const mu = new Array<number>(featureLength).fill(0);
  const sigma = new Array<number>(featureLength).fill(0);
  for (let d = 0; d < featureLength; d++) {
    let s = 0;
    for (const arr of arrays) s += arr[d]!;
    mu[d] = s / arrays.length;
  }
  for (let d = 0; d < featureLength; d++) {
    let s = 0;
    for (const arr of arrays) s += (arr[d]! - mu[d]!) ** 2;
    const variance = arrays.length > 1 ? s / (arrays.length - 1) : 0;
    sigma[d] = variance > 1e-12 ? Math.sqrt(variance) : 1;
  }

  const fingerprints: Fingerprint[] = accepted.map((a, i) => ({
    feature: arrays[i]!,
    position: positionOfAccepted(a),
  }));

  // Path-loss fit from the distance-axis captures (RSSI vs known distance).
  const rangeSamples: RangeSample[] = accepted
    .filter((a) => a.label.axis === "distance" && Number.isFinite(a.features.rssiMean))
    .map((a) => ({ distanceM: a.label.valueMeters, rssi: a.features.rssiMean }));
  const pathLoss = fitPathLoss(rangeSamples);

  return {
    version: 1,
    ap,
    direction,
    pathLoss,
    fingerprints,
    includeCsi,
    featureLength,
    mu,
    sigma,
    k: Math.max(1, Math.min(options.k ?? 3, fingerprints.length)),
    createdAt: Date.now(),
  };
}

function zscore(arr: number[], mu: number[], sigma: number[]): number[] {
  const out = new Array<number>(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i]! - mu[i]!) / sigma[i]!;
  return out;
}

function euclidean(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(s);
}

/** Localize a single capture against a trained model. */
export function localize(model: MetrificationModel, capture: Capture): LocalizationResult {
  const features = extractFeatures(capture);
  return localizeFeatures(model, features, capture.deviceId, capture.endTs, capture.measurement.ftmDistanceMm);
}

/** Localize directly from a feature vector (used by the server hot path). */
export function localizeFeatures(
  model: MetrificationModel,
  features: FeatureVector,
  deviceId: string,
  ts: number,
  ftmDistanceMm?: number,
): LocalizationResult {
  const arr = featureVectorToArray(features, model.includeCsi).slice(0, model.featureLength);
  const zq = zscore(arr, model.mu, model.sigma);

  // kNN over z-scored features; inverse-distance weights.
  const scored = model.fingerprints
    .map((fp) => ({ fp, d: euclidean(zq, zscore(fp.feature, model.mu, model.sigma)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, model.k);

  const weights = scored.map((s) => 1 / (s.d + 1e-6));
  const fpPosition = weightedCentroid(
    scored.map((s) => s.fp.position),
    weights,
  );

  // Range from path-loss (RSSI), fused with FTM when available.
  const rssiDistance = rssiToDistance(features.rssiMean, model.pathLoss);
  const fusedDistance = fuseRange(rssiDistance, ftmDistanceMm);

  // Heading + height come from the fingerprint; radius from the fused range.
  const heading = vectorToCompass(fpPosition);
  const heightM = fpPosition.z;
  const horizFp = horizontalMagnitude(fpPosition);
  const horizTarget = Math.sqrt(Math.max(0, fusedDistance * fusedDistance - heightM * heightM));
  const horizUnit: Vec3 =
    horizFp > 1e-6
      ? { x: fpPosition.x / horizFp, y: fpPosition.y / horizFp, z: 0 }
      : { x: 0, y: 0, z: 0 };
  const position: Vec3 = {
    x: horizUnit.x * horizTarget,
    y: horizUnit.y * horizTarget,
    z: heightM,
  };
  const distanceM = magnitude(position);

  // Confidence: neighbour agreement × path-loss fit quality.
  const spread = neighbourSpread(scored.map((s) => s.fp.position), fpPosition);
  const agreement = 1 / (1 + spread);
  const fitQuality = 0.5 + 0.5 * Math.max(0, Math.min(1, model.pathLoss.r2));
  const confidence = Math.max(0, Math.min(1, agreement * fitQuality));

  return {
    deviceId,
    ts,
    position,
    distanceM,
    direction: heading,
    heightM,
    confidence,
    method: ftmDistanceMm !== undefined ? "fused" : model.fingerprints.length > 0 ? "fingerprint" : "pathloss",
  };
}

function neighbourSpread(positions: Vec3[], centroid: Vec3): number {
  if (positions.length === 0) return Infinity;
  let s = 0;
  for (const p of positions) s += magnitude({ x: p.x - centroid.x, y: p.y - centroid.y, z: p.z - centroid.z });
  return s / positions.length;
}

// Re-export so consumers can scale direction vectors if needed.
export { scale };
