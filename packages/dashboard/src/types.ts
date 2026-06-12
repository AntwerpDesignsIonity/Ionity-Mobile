import type {
  AccessPoint,
  CompassDirection,
  LocalizationResult,
} from "@ionity/metrification";

export type { AccessPoint, CompassDirection, LocalizationResult };

export interface CalibrationStep {
  index: number;
  axis: "distance" | "height";
  valueMeters: number;
  direction?: CompassDirection;
  repetition: number;
}

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

export interface DeviceRow {
  device_id: string;
  agent: string;
  state: string;
  last_message: string | null;
  last_seen: number;
}

export interface ApRow {
  bssid: string;
  ssid: string;
  freq_mhz: number;
  bandwidth_mhz: number | null;
  last_seen: number;
}

export interface LocalizationRow {
  device_id: string;
  ap_bssid: string;
  ts: number;
  x: number;
  y: number;
  z: number;
  distance_m: number;
  direction: CompassDirection;
  height_m: number;
  confidence: number;
  method: string;
}

export type HubEvent =
  | { type: "status"; data: unknown }
  | { type: "calibration"; data: CalibrationEvent }
  | { type: "localization"; data: { apBssid: string; result: LocalizationResult } };

export interface CalibrationEvent {
  status: "started" | "accepted" | "rejected" | "error" | "complete";
  reason?: string;
  session: SessionView;
  next?: CalibrationStep | null;
}
