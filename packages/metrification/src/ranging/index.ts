/**
 * RSSI → distance ranging via the log-distance path-loss model, fit from the
 * real calibration distance points, plus fusion with 802.11mc FTM when present.
 *
 * Model:  RSSI(d) = A − 10·n·log10(d)
 *   A = RSSI at the 1 m reference distance (dBm)
 *   n = path-loss exponent (≈2 free space, 3–4 indoors)
 *
 * Inverted:  d = 10^((A − RSSI) / (10·n))
 */

export interface PathLossModel {
  /** RSSI at 1 m, dBm. */
  rssiAt1m: number;
  /** Path-loss exponent. */
  exponent: number;
  /** R² of the fit over the calibration points (quality indicator). */
  r2: number;
  /** Number of (distance, rssi) samples used in the fit. */
  samples: number;
}

/** One labelled ranging sample: known distance (m) and mean RSSI (dBm). */
export interface RangeSample {
  distanceM: number;
  rssi: number;
}

/**
 * Fit the path-loss model by ordinary least squares of RSSI against
 * log10(distance). Samples at distance ≤ 0 are dropped (log undefined); the
 * Metrification 0 m point is therefore used elsewhere as an RSSI ceiling, not
 * in the slope fit.
 */
export function fitPathLoss(samples: RangeSample[]): PathLossModel {
  const pts = samples.filter((s) => s.distanceM > 0 && Number.isFinite(s.rssi));
  if (pts.length < 2) {
    // Not enough points to fit a slope: fall back to free-space exponent and
    // anchor A on whatever single sample we have (or a typical -40 dBm @ 1 m).
    const anchor = pts[0];
    const rssiAt1m = anchor ? anchor.rssi + 10 * 2 * Math.log10(anchor.distanceM) : -40;
    return { rssiAt1m, exponent: 2, r2: 0, samples: pts.length };
  }

  // x = log10(d), y = rssi.  y = A + b·x  where b = -10n.
  const xs = pts.map((p) => Math.log10(p.distanceM));
  const ys = pts.map((p) => p.rssi);
  const n = xs.length;
  const xbar = xs.reduce((a, b) => a + b, 0) / n;
  const ybar = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - xbar;
    const dy = ys[i]! - ybar;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx > 0 ? sxy / sxx : 0; // = -10n
  const intercept = ybar - slope * xbar; // = A (RSSI at log10(1)=0 → 1 m)
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;

  const exponent = Math.max(0.5, -slope / 10);
  return { rssiAt1m: intercept, exponent, r2, samples: n };
}

/** Estimate distance (m) for a measured RSSI using a fitted path-loss model. */
export function rssiToDistance(rssi: number, model: PathLossModel): number {
  const d = Math.pow(10, (model.rssiAt1m - rssi) / (10 * model.exponent));
  return Number.isFinite(d) ? Math.max(0, d) : 0;
}

/**
 * Fuse an RSSI-derived distance with an FTM (802.11mc) distance by inverse-
 * variance weighting. FTM is usually far more accurate, so it dominates when
 * present. Variances are rough priors; callers may override.
 */
export function fuseRange(
  rssiDistanceM: number,
  ftmDistanceMm?: number,
  opts: { rssiVarM2?: number; ftmVarM2?: number } = {},
): number {
  if (ftmDistanceMm === undefined || !Number.isFinite(ftmDistanceMm)) {
    return rssiDistanceM;
  }
  const ftmM = ftmDistanceMm / 1000;
  const rssiVar = opts.rssiVarM2 ?? 1.0; // RSSI ranging ~±1 m sigma indoors
  const ftmVar = opts.ftmVarM2 ?? 0.25; // FTM ~±0.5 m sigma on good hardware
  const wR = 1 / rssiVar;
  const wF = 1 / ftmVar;
  return (rssiDistanceM * wR + ftmM * wF) / (wR + wF);
}
