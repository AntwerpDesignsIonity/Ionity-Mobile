/**
 * Calibration session manager: wraps the @ionity/metrification state machine,
 * persists each accepted capture, and builds + activates a model when a session
 * completes. Holds live machines in memory keyed by session id.
 */
import {
  CalibrationMachine,
  buildModel,
  extractFeatures,
  type AccessPoint,
  type Capture,
  type CompassDirection,
  type CalibrationConfig,
  type CalibrationStep,
  type MetrificationModel,
} from "@ionity/metrification";
import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";

export interface SessionView {
  sessionId: string;
  deviceId: string;
  apBssid: string;
  direction: CompassDirection;
  total: number;
  accepted: number;
  progress: number;
  current: CalibrationStep | null;
  complete: boolean;
}

export interface CaptureOutcome {
  status: "accepted" | "rejected" | "error" | "complete";
  reason?: string;
  next?: CalibrationStep | null;
  session: SessionView;
  /** Set when this capture completed the session. */
  model?: MetrificationModel;
}

export class SessionManager {
  private readonly machines = new Map<string, CalibrationMachine>();
  private readonly aps = new Map<string, AccessPoint>();

  constructor(private readonly db: Db) {}

  create(
    deviceId: string,
    ap: AccessPoint,
    direction: CompassDirection,
    config: Partial<CalibrationConfig> = {},
  ): SessionView {
    const sessionId = randomUUID();
    const machine = new CalibrationMachine(sessionId, { ...config, direction });
    this.machines.set(sessionId, machine);
    this.aps.set(sessionId, ap);
    this.db.createSession({
      id: sessionId,
      device_id: deviceId,
      ap_bssid: ap.bssid,
      direction,
      config_json: JSON.stringify(machine.config),
      created_at: Date.now(),
    });
    return this.view(sessionId, deviceId, ap.bssid, machine);
  }

  /** Feed a calibration capture (one tagged with a sessionId) into its machine. */
  handleCapture(capture: Capture): CaptureOutcome {
    const sessionId = capture.sessionId!;
    const machine = this.machines.get(sessionId);
    const session = this.db.getSession(sessionId);
    if (!machine || !session) {
      throw new Error(`unknown or inactive session ${sessionId}`);
    }

    const outcome = machine.accept(capture);
    const accepted = outcome.status === "accepted";
    const features = extractFeatures(capture);
    this.db.insertCapture(capture, features, accepted, Date.now());

    const view = this.view(sessionId, session.device_id, session.ap_bssid, machine);

    if (outcome.status === "error") {
      return { status: "error", reason: outcome.reason, session: view };
    }
    if (outcome.status === "rejected") {
      return { status: "rejected", reason: outcome.reason, session: view };
    }
    if (outcome.status === "complete") {
      return { status: "complete", session: view };
    }

    // accepted
    if (machine.isComplete()) {
      const ap = this.aps.get(sessionId) ?? capture.ap;
      const model = buildModel(machine.getAccepted(), machine.config.direction, ap);
      this.db.insertModel(model, "calibration", /* makeActive */ true);
      this.db.setSessionStatus(sessionId, "complete", Date.now());
      this.machines.delete(sessionId);
      return { status: "accepted", next: null, session: { ...view, complete: true }, model };
    }
    return { status: "accepted", next: outcome.next, session: view };
  }

  abort(sessionId: string): void {
    this.machines.delete(sessionId);
    this.aps.delete(sessionId);
    this.db.setSessionStatus(sessionId, "aborted", Date.now());
  }

  getView(sessionId: string): SessionView | undefined {
    const machine = this.machines.get(sessionId);
    const session = this.db.getSession(sessionId);
    if (!session) return undefined;
    if (!machine) {
      // Completed/aborted session — synthesize a terminal view from the DB.
      return {
        sessionId,
        deviceId: session.device_id,
        apBssid: session.ap_bssid,
        direction: session.direction as CompassDirection,
        total: 0,
        accepted: 0,
        progress: session.status === "complete" ? 1 : 0,
        current: null,
        complete: session.status === "complete",
      };
    }
    return this.view(sessionId, session.device_id, session.ap_bssid, machine);
  }

  private view(sessionId: string, deviceId: string, apBssid: string, machine: CalibrationMachine): SessionView {
    return {
      sessionId,
      deviceId,
      apBssid,
      direction: machine.config.direction,
      total: machine.plan.length,
      accepted: machine.getAccepted().length,
      progress: machine.progress(),
      current: machine.current(),
      complete: machine.isComplete(),
    };
  }
}
