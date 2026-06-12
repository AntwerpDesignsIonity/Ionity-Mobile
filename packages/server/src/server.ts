/**
 * Ionity-CSI server entrypoint. Wires SQLite, the MQTT ingest, calibration
 * sessions, the localizer, the REST API, the WebSocket hub, and (optionally)
 * the built dashboard into one process.
 */
import Fastify from "fastify";
import websocket, { type SocketStream } from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { Db } from "./db.js";
import { Hub, type WsLike } from "./hub.js";
import { SessionManager } from "./sessions.js";
import { Localizer } from "./localizer.js";
import { Ingest } from "./ingest.js";
import { registerApi } from "./api.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = new Db(config.dbPath);
  const hub = new Hub();
  const sessions = new SessionManager(db);
  const localizer = new Localizer(db);
  const ingest = new Ingest(config.mqttUrl, {
    db,
    sessions,
    localizer,
    hub,
    minConfidence: config.minConfidence,
  });

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  await app.register(websocket);
  await app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (connection: SocketStream) => {
      // @fastify/websocket v8: connection.socket is the underlying ws WebSocket.
      hub.add(connection.socket as unknown as WsLike);
    });
  });

  registerApi(app, { db, sessions, hub });

  // Serve the built dashboard when present (npm run build --workspace @ionity/dashboard).
  if (existsSync(config.dashboardDir)) {
    await app.register(fastifyStatic, { root: config.dashboardDir, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      // SPA fallback for client-side routes (but not API/WS paths).
      if (req.raw.url && (req.raw.url.startsWith("/api") || req.raw.url.startsWith("/ws"))) {
        return reply.status(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn(`dashboard build not found at ${config.dashboardDir} — API/WS only`);
  }

  // Connect MQTT before listening so we don't miss early captures.
  try {
    await ingest.start();
    app.log.info(`connected to MQTT broker ${config.mqttUrl}`);
  } catch (err) {
    app.log.error(`MQTT connect failed: ${(err as Error).message} — will keep retrying`);
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Ionity-CSI server on http://${config.host}:${config.port}`);

  const shutdown = async () => {
    app.log.info("shutting down…");
    await ingest.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
