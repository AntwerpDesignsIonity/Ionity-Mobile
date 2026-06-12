/** SQLite persistence layer (better-sqlite3). Synchronous, transactional. */
import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AccessPoint,
  Capture,
  FeatureVector,
  LocalizationResult,
} from "@ionity/metrification";
import type { MetrificationModel } from "@ionity/metrification";

const here = dirname(fileURLToPath(import.meta.url));

export interface SessionRow {
  id: string;
  device_id: string;
  ap_bssid: string;
  direction: string;
  config_json: string;
  status: string;
  created_at: number;
  completed_at: number | null;
}

export class Db {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const sql = readFileSync(resolve(here, "../migrations/001_init.sql"), "utf8");
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  // ---- devices / aps -------------------------------------------------------

  upsertDevice(deviceId: string, agent: string, state: string, message: string | null, ts: number): void {
    this.db
      .prepare(
        `INSERT INTO devices (device_id, agent, state, last_message, last_seen)
         VALUES (@deviceId, @agent, @state, @message, @ts)
         ON CONFLICT(device_id) DO UPDATE SET
           agent=@agent, state=@state, last_message=@message, last_seen=@ts`,
      )
      .run({ deviceId, agent, state, message, ts });
  }

  listDevices(): unknown[] {
    return this.db.prepare(`SELECT * FROM devices ORDER BY last_seen DESC`).all();
  }

  upsertAp(ap: AccessPoint, ts: number): void {
    this.db
      .prepare(
        `INSERT INTO aps (bssid, ssid, freq_mhz, bandwidth_mhz, last_seen)
         VALUES (@bssid, @ssid, @freqMhz, @bandwidthMhz, @ts)
         ON CONFLICT(bssid) DO UPDATE SET
           ssid=@ssid, freq_mhz=@freqMhz, bandwidth_mhz=@bandwidthMhz, last_seen=@ts`,
      )
      .run({
        bssid: ap.bssid,
        ssid: ap.ssid,
        freqMhz: ap.freqMhz,
        bandwidthMhz: ap.bandwidthMhz ?? null,
        ts,
      });
  }

  listAps(): unknown[] {
    return this.db.prepare(`SELECT * FROM aps ORDER BY last_seen DESC`).all();
  }

  // ---- sessions ------------------------------------------------------------

  createSession(row: Omit<SessionRow, "status" | "completed_at">): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, device_id, ap_bssid, direction, config_json, status, created_at, completed_at)
         VALUES (@id, @device_id, @ap_bssid, @direction, @config_json, 'active', @created_at, NULL)`,
      )
      .run(row);
  }

  getSession(id: string): SessionRow | undefined {
    return this.db.prepare(`SELECT * FROM sessions WHERE id=?`).get(id) as SessionRow | undefined;
  }

  setSessionStatus(id: string, status: string, completedAt: number | null): void {
    this.db.prepare(`UPDATE sessions SET status=?, completed_at=? WHERE id=?`).run(status, completedAt, id);
  }

  // ---- captures ------------------------------------------------------------

  insertCapture(
    capture: Capture,
    features: FeatureVector,
    accepted: boolean,
    createdAt: number,
  ): number {
    const info = this.db
      .prepare(
        `INSERT INTO captures
          (device_id, agent, ap_bssid, session_id, start_ts, end_ts, label_json, measurement_json, features_json, accepted, created_at)
         VALUES (@device_id, @agent, @ap_bssid, @session_id, @start_ts, @end_ts, @label_json, @measurement_json, @features_json, @accepted, @created_at)`,
      )
      .run({
        device_id: capture.deviceId,
        agent: capture.agent,
        ap_bssid: capture.ap.bssid,
        session_id: capture.sessionId ?? null,
        start_ts: capture.startTs,
        end_ts: capture.endTs,
        label_json: capture.label ? JSON.stringify(capture.label) : null,
        measurement_json: JSON.stringify(capture.measurement),
        features_json: JSON.stringify(features),
        accepted: accepted ? 1 : 0,
        created_at: createdAt,
      });
    return Number(info.lastInsertRowid);
  }

  // ---- models --------------------------------------------------------------

  insertModel(model: MetrificationModel, source: "calibration" | "ml", makeActive: boolean): number {
    const tx = this.db.transaction(() => {
      if (makeActive) {
        this.db.prepare(`UPDATE models SET active=0 WHERE ap_bssid=?`).run(model.ap.bssid);
      }
      const info = this.db
        .prepare(
          `INSERT INTO models (ap_bssid, direction, model_json, n_fingerprints, source, active, created_at)
           VALUES (@ap_bssid, @direction, @model_json, @n, @source, @active, @created_at)`,
        )
        .run({
          ap_bssid: model.ap.bssid,
          direction: model.direction,
          model_json: JSON.stringify(model),
          n: model.fingerprints.length,
          source,
          active: makeActive ? 1 : 0,
          created_at: Date.now(),
        });
      return Number(info.lastInsertRowid);
    });
    return tx();
  }

  getActiveModel(apBssid: string): MetrificationModel | undefined {
    const row = this.db
      .prepare(`SELECT model_json FROM models WHERE ap_bssid=? AND active=1 ORDER BY created_at DESC LIMIT 1`)
      .get(apBssid) as { model_json: string } | undefined;
    return row ? (JSON.parse(row.model_json) as MetrificationModel) : undefined;
  }

  listModels(): unknown[] {
    return this.db
      .prepare(`SELECT id, ap_bssid, direction, n_fingerprints, source, active, created_at FROM models ORDER BY created_at DESC`)
      .all();
  }

  // ---- localizations -------------------------------------------------------

  insertLocalization(apBssid: string, r: LocalizationResult): void {
    this.db
      .prepare(
        `INSERT INTO localizations
          (device_id, ap_bssid, ts, x, y, z, distance_m, direction, height_m, confidence, method, created_at)
         VALUES (@device_id, @ap_bssid, @ts, @x, @y, @z, @distance_m, @direction, @height_m, @confidence, @method, @created_at)`,
      )
      .run({
        device_id: r.deviceId,
        ap_bssid: apBssid,
        ts: r.ts,
        x: r.position.x,
        y: r.position.y,
        z: r.position.z,
        distance_m: r.distanceM,
        direction: r.direction,
        height_m: r.heightM,
        confidence: r.confidence,
        method: r.method,
        created_at: Date.now(),
      });
  }

  recentLocalizations(deviceId: string | undefined, since: number, limit: number): unknown[] {
    if (deviceId) {
      return this.db
        .prepare(`SELECT * FROM localizations WHERE device_id=? AND ts>=? ORDER BY ts DESC LIMIT ?`)
        .all(deviceId, since, limit);
    }
    return this.db
      .prepare(`SELECT * FROM localizations WHERE ts>=? ORDER BY ts DESC LIMIT ?`)
      .all(since, limit);
  }
}
