/**
 * Geometry for the local ENU frame used by Ionity Metrification CSI.
 *
 * Frame: the chosen AP is the origin (0,0,0). x = East, y = North, z = Up,
 * all in metres. Calibration distance points are placed along a chosen compass
 * heading; height points along +z.
 */
import type { CompassDirection, Vec3 } from "../models/index.js";

/** Compass heading in degrees clockwise from North. */
const AZIMUTH_DEG: Record<CompassDirection, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Horizontal unit vector (East, North) for a compass heading; z = 0. */
export function directionToUnitVector(dir: CompassDirection): Vec3 {
  const az = AZIMUTH_DEG[dir] * DEG2RAD;
  return { x: Math.sin(az), y: Math.cos(az), z: 0 };
}

/**
 * Position of a calibration distance point: `meters` along `dir` from the AP.
 */
export function distancePointPosition(meters: number, dir: CompassDirection): Vec3 {
  const u = directionToUnitVector(dir);
  return { x: u.x * meters, y: u.y * meters, z: 0 };
}

/** Position of a calibration height point: `meters` straight up from the AP. */
export function heightPointPosition(meters: number): Vec3 {
  return { x: 0, y: 0, z: meters };
}

/** Convert a heading in degrees (cw from North) to the nearest 8-wind compass label. */
export function azimuthToCompass(deg: number): CompassDirection {
  const norm = ((deg % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  const order: CompassDirection[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return order[idx]!;
}

/** Heading in degrees (cw from North) of the horizontal projection of `v`. */
export function vectorToAzimuth(v: Vec3): number {
  // atan2(East, North) gives clockwise-from-north.
  const deg = Math.atan2(v.x, v.y) * RAD2DEG;
  return ((deg % 360) + 360) % 360;
}

/** Nearest compass label for the horizontal direction of `v` (from origin). */
export function vectorToCompass(v: Vec3): CompassDirection {
  return azimuthToCompass(vectorToAzimuth(v));
}

export function magnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function horizontalMagnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function distance(a: Vec3, b: Vec3): number {
  return magnitude(subtract(a, b));
}

/**
 * Weighted centroid of positions — used by the kNN fingerprint localizer.
 * `weights` default to uniform when omitted.
 */
export function weightedCentroid(points: Vec3[], weights?: number[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  let wx = 0;
  let wy = 0;
  let wz = 0;
  let wsum = 0;
  for (let i = 0; i < points.length; i++) {
    const w = weights?.[i] ?? 1;
    const p = points[i]!;
    wx += p.x * w;
    wy += p.y * w;
    wz += p.z * w;
    wsum += w;
  }
  if (wsum === 0) return { x: 0, y: 0, z: 0 };
  return { x: wx / wsum, y: wy / wsum, z: wz / wsum };
}

/** A ranging anchor: a known position and the measured distance to the target. */
export interface RangeAnchor {
  position: Vec3;
  /** Measured distance to the unknown target, metres. */
  range: number;
  /** Optional weight (e.g. inverse variance). Defaults to 1. */
  weight?: number;
}

/**
 * Multilateration via Gauss-Newton least squares on range residuals.
 *
 * Minimises Σ wᵢ (‖x − aᵢ‖ − rᵢ)². Requires ≥ 3 non-degenerate anchors for a
 * full 3D solve; with fewer, the z component is weakly constrained and the
 * caller should fix height separately. Returns the estimate and the RMS
 * residual (metres) so callers can derive a confidence.
 */
export function multilaterate(
  anchors: RangeAnchor[],
  options: { initial?: Vec3; iterations?: number; tolerance?: number } = {},
): { position: Vec3; rmsResidual: number; iterations: number } {
  const iterations = options.iterations ?? 50;
  const tol = options.tolerance ?? 1e-6;

  // Initial guess: weighted centroid of anchor positions.
  let x: Vec3 =
    options.initial ??
    weightedCentroid(
      anchors.map((a) => a.position),
      anchors.map((a) => a.weight ?? 1),
    );

  let iter = 0;
  for (; iter < iterations; iter++) {
    // Build normal equations Jᵀ W J · Δ = Jᵀ W r  (3x3 system).
    const H = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const g = [0, 0, 0];

    for (const a of anchors) {
      const w = a.weight ?? 1;
      const dx = x.x - a.position.x;
      const dy = x.y - a.position.y;
      const dz = x.z - a.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      // Jacobian row of ‖x−a‖ w.r.t. x is the unit vector (dx,dy,dz)/d.
      const j = [dx / d, dy / d, dz / d];
      const residual = d - a.range;
      for (let r = 0; r < 3; r++) {
        g[r]! += w * j[r]! * residual;
        for (let c = 0; c < 3; c++) {
          H[r]![c]! += w * j[r]! * j[c]!;
        }
      }
    }

    const delta = solve3x3(H, g);
    if (!delta) break; // singular — stop, return current estimate
    x = { x: x.x - delta[0]!, y: x.y - delta[1]!, z: x.z - delta[2]! };
    if (Math.abs(delta[0]!) + Math.abs(delta[1]!) + Math.abs(delta[2]!) < tol) {
      iter++;
      break;
    }
  }

  // RMS residual at the solution.
  let sse = 0;
  let wsum = 0;
  for (const a of anchors) {
    const w = a.weight ?? 1;
    const d = distance(x, a.position);
    const e = d - a.range;
    sse += w * e * e;
    wsum += w;
  }
  const rmsResidual = wsum > 0 ? Math.sqrt(sse / wsum) : 0;
  return { position: x, rmsResidual, iterations: iter };
}

/** Solve a 3x3 linear system Hδ = g via Cramer's rule. Returns null if singular. */
function solve3x3(H: number[][], g: number[]): [number, number, number] | null {
  const det = det3(H);
  if (Math.abs(det) < 1e-12) return null;
  const hx = [
    [g[0]!, H[0]![1]!, H[0]![2]!],
    [g[1]!, H[1]![1]!, H[1]![2]!],
    [g[2]!, H[2]![1]!, H[2]![2]!],
  ];
  const hy = [
    [H[0]![0]!, g[0]!, H[0]![2]!],
    [H[1]![0]!, g[1]!, H[1]![2]!],
    [H[2]![0]!, g[2]!, H[2]![2]!],
  ];
  const hz = [
    [H[0]![0]!, H[0]![1]!, g[0]!],
    [H[1]![0]!, H[1]![1]!, g[1]!],
    [H[2]![0]!, H[2]![1]!, g[2]!],
  ];
  return [det3(hx) / det, det3(hy) / det, det3(hz) / det];
}

function det3(m: number[][]): number {
  return (
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
  );
}
