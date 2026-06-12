/**
 * The Ionity Metrification CSI calibration method, as a state machine.
 *
 * A session walks the operator through a fixed, ordered set of capture points:
 *   1. Distance axis: 0, 1, 2, 3 m along a chosen compass heading.
 *   2. Height axis:   0, 10, 20, 30 cm directly above the AP.
 * Each point is captured `repetitions` times ("hearts"), each a multi-second
 * dwell. A stability gate rejects a repetition if the room was not static
 * (CSI Hz-stability too low or RSSI too noisy), forcing a re-capture.
 *
 * The machine is transport-agnostic: feed it validated captures, ask it what to
 * do next. It holds no I/O.
 */
import type {
  CalibrationAxis,
  CalibrationLabel,
  Capture,
  CompassDirection,
  FeatureVector,
} from "../models/index.js";
import { extractFeatures } from "../features/index.js";

export interface CalibrationConfig {
  /** Distance points along the heading, metres. Default [0,1,2,3]. */
  distancePointsM: number[];
  /** Height points above the AP, metres. Default [0,0.1,0.2,0.3] (0–30 cm). */
  heightPointsM: number[];
  /** Compass heading of the distance axis. */
  direction: CompassDirection;
  /** Captures ("hearts") required per point. Default 3. */
  repetitions: number;
  /** Required dwell per capture, seconds. Default 4. Enforced against capture span. */
  dwellSeconds: number;
  /**
   * Minimum CSI Hz-stability [0,1] for a repetition to be accepted. RSSI-only
   * agents (Android) bypass the CSI gate and use the RSSI-noise gate instead.
   */
  minCsiStability: number;
  /** Maximum acceptable RSSI standard deviation over the dwell, dBm. */
  maxRssiStd: number;
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  distancePointsM: [0, 1, 2, 3],
  heightPointsM: [0, 0.1, 0.2, 0.3],
  direction: "N",
  repetitions: 3,
  dwellSeconds: 4,
  minCsiStability: 0.6,
  maxRssiStd: 4,
};

/** One required capture in the ordered plan. */
export interface CalibrationStep {
  index: number;
  axis: CalibrationAxis;
  valueMeters: number;
  direction?: CompassDirection;
  repetition: number;
}

/** Build the ordered list of steps (distance axis first, then height). */
export function buildPlan(config: CalibrationConfig): CalibrationStep[] {
  const steps: CalibrationStep[] = [];
  let index = 0;
  for (const d of config.distancePointsM) {
    for (let r = 0; r < config.repetitions; r++) {
      steps.push({ index: index++, axis: "distance", valueMeters: d, direction: config.direction, repetition: r });
    }
  }
  for (const h of config.heightPointsM) {
    for (let r = 0; r < config.repetitions; r++) {
      steps.push({ index: index++, axis: "height", valueMeters: h, repetition: r });
    }
  }
  return steps;
}

export type AcceptOutcome =
  | { status: "accepted"; step: CalibrationStep; features: FeatureVector; next: CalibrationStep | null }
  | { status: "rejected"; step: CalibrationStep; reason: string }
  | { status: "complete" }
  | { status: "error"; reason: string };

/** A capture accepted into the session, with its ground-truth label + features. */
export interface AcceptedCapture {
  step: CalibrationStep;
  label: CalibrationLabel;
  features: FeatureVector;
  capture: Capture;
}

export class CalibrationMachine {
  readonly sessionId: string;
  readonly config: CalibrationConfig;
  readonly plan: CalibrationStep[];
  private cursor = 0;
  private readonly accepted: AcceptedCapture[] = [];

  constructor(sessionId: string, config: Partial<CalibrationConfig> = {}) {
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CALIBRATION_CONFIG, ...config };
    this.plan = buildPlan(this.config);
  }

  /** The step the operator should capture next, or null when finished. */
  current(): CalibrationStep | null {
    return this.cursor < this.plan.length ? this.plan[this.cursor]! : null;
  }

  isComplete(): boolean {
    return this.cursor >= this.plan.length;
  }

  /** Fraction of the plan completed, [0,1]. */
  progress(): number {
    return this.plan.length === 0 ? 1 : this.cursor / this.plan.length;
  }

  /** All captures accepted so far (the training set for the model). */
  getAccepted(): readonly AcceptedCapture[] {
    return this.accepted;
  }

  /**
   * Offer a capture for the current step. Validates the label, enforces the
   * dwell and stability gates, and advances on acceptance.
   */
  accept(capture: Capture): AcceptOutcome {
    const step = this.current();
    if (!step) return { status: "complete" };

    const label = capture.label;
    if (!label) return { status: "error", reason: "capture has no calibration label" };

    // Label must match the expected step (axis + value, and direction for distance).
    if (label.axis !== step.axis) {
      return { status: "error", reason: `expected axis "${step.axis}", got "${label.axis}"` };
    }
    if (Math.abs(label.valueMeters - step.valueMeters) > 1e-6) {
      return {
        status: "error",
        reason: `expected ${step.valueMeters} m on ${step.axis} axis, got ${label.valueMeters} m`,
      };
    }
    if (step.axis === "distance" && label.direction !== step.direction) {
      return { status: "error", reason: `expected direction ${step.direction}, got ${label.direction}` };
    }

    // Dwell gate: the capture window must cover the configured dwell.
    const spanS = (capture.endTs - capture.startTs) / 1000;
    if (spanS + 1e-3 < this.config.dwellSeconds) {
      return {
        status: "rejected",
        step,
        reason: `dwell ${spanS.toFixed(1)}s < required ${this.config.dwellSeconds}s — hold the device steady longer`,
      };
    }

    const features = extractFeatures(capture);

    // Stability gate. CSI-capable captures must clear the CSI gate; all captures
    // with RSSI must clear the RSSI-noise gate.
    const hasCsi = features.csiAmpMean.length > 0;
    if (hasCsi && features.csiStability < this.config.minCsiStability) {
      return {
        status: "rejected",
        step,
        reason: `CSI stability ${features.csiStability.toFixed(2)} < ${this.config.minCsiStability} — room not static, recapture`,
      };
    }
    if (Number.isFinite(features.rssiStd) && features.rssiStd > this.config.maxRssiStd) {
      return {
        status: "rejected",
        step,
        reason: `RSSI std ${features.rssiStd.toFixed(1)} dBm > ${this.config.maxRssiStd} — too noisy, recapture`,
      };
    }

    this.accepted.push({ step, label, features, capture });
    this.cursor++;
    return { status: "accepted", step, features, next: this.current() };
  }
}
