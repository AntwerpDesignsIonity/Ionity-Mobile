/**
 * MQTT ingest: subscribe to agent captures + status, validate, persist, and
 * route. Calibration captures (with a sessionId) drive the session machine;
 * unlabelled captures are localized against the active model.
 */
import mqtt, { type MqttClient } from "mqtt";
import {
  parseCapture,
  parseStatus,
  topics,
  type CaptureMessage,
  type StatusMessage,
} from "@ionity/metrification";
import type { Db } from "./db.js";
import type { SessionManager } from "./sessions.js";
import type { Localizer } from "./localizer.js";
import type { Hub } from "./hub.js";

export interface IngestDeps {
  db: Db;
  sessions: SessionManager;
  localizer: Localizer;
  hub: Hub;
  minConfidence: number;
}

export class Ingest {
  private client: MqttClient | null = null;

  constructor(
    private readonly mqttUrl: string,
    private readonly deps: IngestDeps,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(this.mqttUrl, { reconnectPeriod: 2000 });
      this.client = client;

      client.on("connect", () => {
        client.subscribe([topics.allCaptures(), topics.allStatus()], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      client.on("error", (err) => {
        // Surface but keep the reconnect loop alive.
        console.error("[mqtt] error:", err.message);
      });
      client.on("message", (topic, payload) => this.onMessage(topic, payload));
    });
  }

  async stop(): Promise<void> {
    await this.client?.endAsync();
  }

  private onMessage(topic: string, payload: Buffer): void {
    try {
      if (topic.endsWith("/status")) {
        this.onStatus(parseStatus(payload));
      } else if (topic.endsWith("/capture")) {
        this.onCapture(parseCapture(payload));
      }
    } catch (err) {
      console.error(`[ingest] dropped invalid message on ${topic}:`, (err as Error).message);
    }
  }

  private onStatus(status: StatusMessage): void {
    const ts = status.ts || Date.now();
    this.deps.db.upsertDevice(status.deviceId, status.agent, status.state, status.message ?? null, ts);
    for (const ap of status.scan ?? []) {
      this.deps.db.upsertAp(ap, ts);
    }
    this.deps.hub.broadcast({ type: "status", data: status });
  }

  private onCapture(capture: CaptureMessage): void {
    const ts = Date.now();
    this.deps.db.upsertDevice(capture.deviceId, capture.agent, "capturing", null, ts);
    this.deps.db.upsertAp(capture.ap, ts);

    if (capture.sessionId) {
      const outcome = this.deps.sessions.handleCapture(capture);
      this.deps.hub.broadcast({ type: "calibration", data: outcome });
      return;
    }

    // Inference path: localize against the active model for this AP.
    const result = this.deps.localizer.process(capture, this.deps.minConfidence);
    if (result) {
      this.client?.publish(topics.localize(capture.deviceId), JSON.stringify(result));
      this.deps.hub.broadcast({ type: "localization", data: { apBssid: capture.ap.bssid, result } });
    }
  }
}
