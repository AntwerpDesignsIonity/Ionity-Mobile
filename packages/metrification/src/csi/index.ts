/**
 * CSI processing: derive amplitude/phase, sanitise phase, and compute the
 * "Hz stability" score that the Metrification method cross-references against
 * RSSI. All inputs are REAL CSI frames captured by ESP32 / Nexmon agents.
 */
import type { CsiFrame } from "../models/index.js";

/** Amplitude (linear magnitude) and phase (radians) from a complex sample. */
export function iqToAmplitudePhase(i: number, q: number): { amplitude: number; phase: number } {
  return { amplitude: Math.hypot(i, q), phase: Math.atan2(q, i) };
}

/** Convert an interleaved [i0,q0,i1,q1,...] buffer into amplitude/phase arrays. */
export function iqBufferToFrame(
  iq: number[],
  meta: Pick<CsiFrame, "ts" | "rssi" | "freqMhz" | "bandwidthMhz" | "nStreams"> = { ts: Date.now() },
): CsiFrame {
  const n = Math.floor(iq.length / 2);
  const amplitude = new Array<number>(n);
  const phase = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const ap = iqToAmplitudePhase(iq[2 * k]!, iq[2 * k + 1]!);
    amplitude[k] = ap.amplitude;
    phase[k] = ap.phase;
  }
  return { amplitude, phase, ...meta };
}

/** Unwrap a phase array so successive jumps exceeding ±π are made continuous. */
export function unwrapPhase(phase: number[]): number[] {
  const out = phase.slice();
  let offset = 0;
  for (let k = 1; k < out.length; k++) {
    let diff = phase[k]! - phase[k - 1]!;
    while (diff > Math.PI) {
      offset -= 2 * Math.PI;
      diff -= 2 * Math.PI;
    }
    while (diff < -Math.PI) {
      offset += 2 * Math.PI;
      diff += 2 * Math.PI;
    }
    out[k] = phase[k]! + offset;
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function std(xs: number[], m = mean(xs)): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export interface CsiAggregate {
  /** Number of subcarriers (0 if no frames). */
  nSubcarriers: number;
  /** Per-subcarrier mean amplitude across frames. */
  ampMean: number[];
  /** Per-subcarrier amplitude std across frames. */
  ampStd: number[];
  /**
   * Hz-stability score in [0,1]: 1 − mean coefficient of variation of amplitude
   * across the dwell, clamped. High score = the channel response held steady
   * (static room, strong direct path). Low score = volatile multipath.
   */
  stability: number;
}

/**
 * Aggregate a set of CSI frames captured during one dwell window. All frames
 * must share subcarrier count; frames with mismatched length are skipped.
 */
export function aggregateCsi(frames: CsiFrame[]): CsiAggregate {
  const valid = frames.filter((f) => f.amplitude.length > 0);
  if (valid.length === 0) {
    return { nSubcarriers: 0, ampMean: [], ampStd: [], stability: 0 };
  }
  const n = valid[0]!.amplitude.length;
  const usable = valid.filter((f) => f.amplitude.length === n);

  const ampMean = new Array<number>(n).fill(0);
  const ampStd = new Array<number>(n).fill(0);
  const cvs: number[] = [];

  for (let k = 0; k < n; k++) {
    const series = usable.map((f) => f.amplitude[k]!);
    const m = mean(series);
    const s = std(series, m);
    ampMean[k] = m;
    ampStd[k] = s;
    if (m > 1e-9) cvs.push(s / m); // coefficient of variation for this subcarrier
  }

  // Stability: 1 - mean(CV), clamped to [0,1]. CV near 0 → stability near 1.
  const meanCv = cvs.length > 0 ? mean(cvs) : 1;
  const stability = Math.max(0, Math.min(1, 1 - meanCv));

  return { nSubcarriers: n, ampMean, ampStd, stability };
}
