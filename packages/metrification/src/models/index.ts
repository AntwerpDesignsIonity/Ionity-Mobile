/**
 * Core data models for Ionity Metrification CSI.
 *
 * These are plain TypeScript types shared by every component: capture agents,
 * the server, the dashboard, and the ML pipeline (mirrored in Python). They
 * describe REAL measurements only — there is no synthetic/mock variant.
 */

/** The eight calibration headings used to orient the local frame. */
export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export const COMPASS_DIRECTIONS: readonly CompassDirection[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
] as const;

/** A 3D vector in the local ENU frame: x=East (m), y=North (m), z=Up (m). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A single RSSI reading in dBm at a moment in time (epoch milliseconds). */
export interface RssiSample {
  /** Received signal strength indicator, dBm (negative; e.g. -47). */
  rssi: number;
  /** Capture timestamp, epoch milliseconds. */
  ts: number;
}

/**
 * One WiFi access point as seen during a scan.
 * `bssid` (MAC) is the stable identity; `ssid` is the human-readable name.
 */
export interface AccessPoint {
  bssid: string;
  ssid: string;
  /** Centre frequency in MHz (e.g. 2412, 5180). */
  freqMhz: number;
  /** Channel bandwidth in MHz (20/40/80/160) when known. */
  bandwidthMhz?: number;
  /** Most recent RSSI seen for this AP during the scan, dBm. */
  rssi?: number;
}

/**
 * One CSI frame: per-subcarrier channel response. CSI is complex; we carry both
 * amplitude (linear magnitude) and phase (radians) per subcarrier. Agents that
 * report raw I/Q convert to amplitude/phase before publishing (see csi/).
 */
export interface CsiFrame {
  ts: number;
  /** Per-subcarrier amplitude (linear). Length = number of subcarriers. */
  amplitude: number[];
  /** Per-subcarrier phase in radians, same length as `amplitude`. */
  phase: number[];
  /** RSSI reported alongside this CSI frame, dBm (if available). */
  rssi?: number;
  /** Centre frequency in MHz. */
  freqMhz?: number;
  /** Channel bandwidth in MHz. */
  bandwidthMhz?: number;
  /** Number of antennas / spatial streams folded into this frame (default 1). */
  nStreams?: number;
}

/** The radio source that produced a measurement. */
export type AgentKind = "esp32" | "android" | "linux-nexmon";

/**
 * What an agent can measure. ESP32/Nexmon provide CSI (+RSSI). Stock Android
 * provides RSSI and (on supported hardware) FTM round-trip-time ranging — never
 * true CSI. `ftmDistanceMm` is the 802.11mc estimate when present.
 */
export interface Measurement {
  /** RSSI readings collected during the dwell window. */
  rssi: RssiSample[];
  /** CSI frames collected during the dwell window (empty for RSSI-only agents). */
  csi: CsiFrame[];
  /** 802.11mc FTM distance estimate in millimetres, when the agent supports it. */
  ftmDistanceMm?: number;
  /** Standard deviation of the FTM estimate in mm, when reported. */
  ftmStdDevMm?: number;
}

/** Which calibration axis a labelled capture belongs to. */
export type CalibrationAxis = "distance" | "height";

/**
 * The ground-truth label attached to a capture taken during calibration.
 * Distance points are taken along `direction` at `valueMeters` from the AP.
 * Height points are taken directly above the AP at `valueMeters` up.
 */
export interface CalibrationLabel {
  axis: CalibrationAxis;
  /** Position along the axis in metres (height stored in metres too: 10cm = 0.10). */
  valueMeters: number;
  /** Heading of the distance axis. Required for `axis === "distance"`. */
  direction?: CompassDirection;
  /** Which repetition ("heart") this capture is, 0-based. */
  repetition: number;
}

/** A capture as published by an agent (calibration or free/inference). */
export interface Capture {
  deviceId: string;
  agent: AgentKind;
  /** Target AP this capture pings/listens to. */
  ap: AccessPoint;
  /** When the dwell window started, epoch ms. */
  startTs: number;
  /** When the dwell window ended, epoch ms. */
  endTs: number;
  measurement: Measurement;
  /** Present only when this capture is part of a calibration session. */
  label?: CalibrationLabel;
  /** Calibration session id, when applicable. */
  sessionId?: string;
}

/** Feature vector derived from a capture, consumed by ranging/localize/ML. */
export interface FeatureVector {
  /** Mean RSSI over the dwell, dBm. */
  rssiMean: number;
  /** RSSI standard deviation over the dwell, dBm. */
  rssiStd: number;
  /** Per-subcarrier mean amplitude (empty for RSSI-only agents). */
  csiAmpMean: number[];
  /** Per-subcarrier amplitude standard deviation. */
  csiAmpStd: number[];
  /**
   * CSI "Hz stability" score in [0,1] — how steady the channel response was
   * across the dwell. 1 = perfectly steady, 0 = highly volatile. See csi/.
   */
  csiStability: number;
  /** FTM distance in metres, when available. */
  ftmDistanceM?: number;
}

/** Result of localizing a capture against a trained model. */
export interface LocalizationResult {
  deviceId: string;
  ts: number;
  /** Estimated position in the local ENU frame (AP at origin). */
  position: Vec3;
  /** Straight-line distance from the AP in metres. */
  distanceM: number;
  /** Estimated heading from the AP toward the device. */
  direction: CompassDirection;
  /** Estimated height above the AP plane in metres. */
  heightM: number;
  /** Confidence in [0,1] derived from neighbour agreement / residuals. */
  confidence: number;
  /** Which method produced the estimate. */
  method: "fingerprint" | "pathloss" | "fused";
}
