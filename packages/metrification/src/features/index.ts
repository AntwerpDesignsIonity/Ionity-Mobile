/**
 * Feature extraction: turn a raw Capture into the FeatureVector consumed by
 * ranging, the localizer, and the ML pipeline. Pure function of real samples.
 */
import type { Capture, FeatureVector, RssiSample } from "../models/index.js";
import { aggregateCsi } from "../csi/index.js";

function meanRssi(samples: RssiSample[]): number {
  if (samples.length === 0) return Number.NaN;
  let s = 0;
  for (const r of samples) s += r.rssi;
  return s / samples.length;
}

function stdRssi(samples: RssiSample[], m: number): number {
  if (samples.length < 2) return 0;
  let s = 0;
  for (const r of samples) s += (r.rssi - m) * (r.rssi - m);
  return Math.sqrt(s / (samples.length - 1));
}

/**
 * Extract a FeatureVector from a capture. RSSI is taken from explicit RSSI
 * samples when present, otherwise from RSSI piggybacked on CSI frames (ESP32
 * reports RSSI per CSI frame). FTM distance is carried through when available.
 */
export function extractFeatures(capture: Capture): FeatureVector {
  const { measurement } = capture;

  // Prefer dedicated RSSI samples; fall back to per-CSI-frame RSSI.
  let rssiSamples = measurement.rssi;
  if (rssiSamples.length === 0 && measurement.csi.length > 0) {
    rssiSamples = measurement.csi
      .filter((f) => typeof f.rssi === "number")
      .map((f) => ({ rssi: f.rssi as number, ts: f.ts }));
  }

  const rssiMean = meanRssi(rssiSamples);
  const rssiStd = stdRssi(rssiSamples, rssiMean);

  const csi = aggregateCsi(measurement.csi);

  const fv: FeatureVector = {
    rssiMean,
    rssiStd,
    csiAmpMean: csi.ampMean,
    csiAmpStd: csi.ampStd,
    csiStability: csi.stability,
  };
  if (measurement.ftmDistanceMm !== undefined) {
    fv.ftmDistanceM = measurement.ftmDistanceMm / 1000;
  }
  return fv;
}

/**
 * Flatten a FeatureVector into a numeric array for kNN / ML. Layout:
 *   [rssiMean, rssiStd, csiStability, ...csiAmpMean]
 * CSI amplitudes are included only when `includeCsi` and present, so RSSI-only
 * (Android) and CSI-rich (ESP32) captures can share a model when desired.
 */
export function featureVectorToArray(fv: FeatureVector, includeCsi = true): number[] {
  const base = [fv.rssiMean, fv.rssiStd, fv.csiStability];
  if (includeCsi && fv.csiAmpMean.length > 0) {
    return base.concat(fv.csiAmpMean);
  }
  return base;
}
