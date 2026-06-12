/**
 * Wire protocol shared by agents, the server, and the dashboard: MQTT topic
 * builders and zod schemas that validate every message. Validation is the trust
 * boundary — agents are untrusted devices on the network.
 */
import { z } from "zod";
import { COMPASS_DIRECTIONS } from "../models/index.js";

/** Root namespace for all Ionity-CSI MQTT topics. */
export const TOPIC_ROOT = "ionity";

export const topics = {
  /** Agent → server: a completed capture (calibration or inference). */
  capture: (deviceId: string) => `${TOPIC_ROOT}/${deviceId}/capture`,
  /** Agent → server: liveness / scan results / progress. */
  status: (deviceId: string) => `${TOPIC_ROOT}/${deviceId}/status`,
  /** Server → dashboard/agent: localization result for a device. */
  localize: (deviceId: string) => `${TOPIC_ROOT}/localize/${deviceId}`,
  /** Server → agents: calibration commands (start/advance/abort). */
  command: (deviceId: string) => `${TOPIC_ROOT}/${deviceId}/command`,
  /** Wildcard subscriptions for the server. */
  allCaptures: () => `${TOPIC_ROOT}/+/capture`,
  allStatus: () => `${TOPIC_ROOT}/+/status`,
} as const;

export const compassSchema = z.enum(
  COMPASS_DIRECTIONS as unknown as [string, ...string[]],
);

export const accessPointSchema = z.object({
  bssid: z.string().min(1),
  ssid: z.string(),
  freqMhz: z.number().positive(),
  bandwidthMhz: z.number().positive().optional(),
  rssi: z.number().optional(),
});

export const rssiSampleSchema = z.object({
  rssi: z.number(),
  ts: z.number().int().nonnegative(),
});

export const csiFrameSchema = z.object({
  ts: z.number().int().nonnegative(),
  amplitude: z.array(z.number()),
  phase: z.array(z.number()),
  rssi: z.number().optional(),
  freqMhz: z.number().positive().optional(),
  bandwidthMhz: z.number().positive().optional(),
  nStreams: z.number().int().positive().optional(),
});

export const measurementSchema = z.object({
  rssi: z.array(rssiSampleSchema),
  csi: z.array(csiFrameSchema),
  ftmDistanceMm: z.number().optional(),
  ftmStdDevMm: z.number().optional(),
});

export const calibrationLabelSchema = z.object({
  axis: z.enum(["distance", "height"]),
  valueMeters: z.number().nonnegative(),
  direction: compassSchema.optional(),
  repetition: z.number().int().nonnegative(),
});

export const captureSchema = z
  .object({
    deviceId: z.string().min(1),
    agent: z.enum(["esp32", "android", "linux-nexmon"]),
    ap: accessPointSchema,
    startTs: z.number().int().nonnegative(),
    endTs: z.number().int().nonnegative(),
    measurement: measurementSchema,
    label: calibrationLabelSchema.optional(),
    sessionId: z.string().optional(),
  })
  .refine(
    (c) => c.label === undefined || c.label.axis !== "distance" || c.label.direction !== undefined,
    { message: "distance calibration captures require a compass direction" },
  );

export const statusSchema = z.object({
  deviceId: z.string().min(1),
  agent: z.enum(["esp32", "android", "linux-nexmon"]),
  ts: z.number().int().nonnegative(),
  state: z.enum(["online", "scanning", "capturing", "idle", "error"]),
  /** Scan results (when state === "scanning"/idle). */
  scan: z.array(accessPointSchema).optional(),
  message: z.string().optional(),
});

export const localizeResultSchema = z.object({
  deviceId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  distanceM: z.number(),
  direction: compassSchema,
  heightM: z.number(),
  confidence: z.number().min(0).max(1),
  method: z.enum(["fingerprint", "pathloss", "fused"]),
});

export type CaptureMessage = z.infer<typeof captureSchema>;
export type StatusMessage = z.infer<typeof statusSchema>;
export type LocalizeResultMessage = z.infer<typeof localizeResultSchema>;

/** Parse + validate a JSON payload as a Capture. Throws on invalid input. */
export function parseCapture(payload: string | Uint8Array): CaptureMessage {
  const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
  return captureSchema.parse(JSON.parse(text));
}

/** Parse + validate a JSON payload as a Status message. */
export function parseStatus(payload: string | Uint8Array): StatusMessage {
  const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
  return statusSchema.parse(JSON.parse(text));
}
