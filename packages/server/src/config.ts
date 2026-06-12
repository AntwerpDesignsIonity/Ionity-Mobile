/** Server configuration, sourced from environment variables with sane defaults. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoData = resolve(here, "../../../data");

export interface Config {
  /** HTTP/WebSocket port for the API + dashboard. */
  port: number;
  host: string;
  /** MQTT broker URL (Mosquitto). */
  mqttUrl: string;
  /** SQLite database file path. */
  dbPath: string;
  /** Directory of the built dashboard to serve, if present. */
  dashboardDir: string;
  /** Minimum confidence to publish/broadcast a localization. */
  minConfidence: number;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.IONITY_PORT ?? 8080),
    host: process.env.IONITY_HOST ?? "0.0.0.0",
    mqttUrl: process.env.IONITY_MQTT_URL ?? "mqtt://localhost:1883",
    dbPath: process.env.IONITY_DB_PATH ?? resolve(repoData, "ionity.sqlite"),
    dashboardDir:
      process.env.IONITY_DASHBOARD_DIR ?? resolve(here, "../../dashboard/dist"),
    minConfidence: Number(process.env.IONITY_MIN_CONFIDENCE ?? 0),
  };
}
