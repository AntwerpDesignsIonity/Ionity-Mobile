/** REST API routes for the dashboard and tooling. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { compassSchema, accessPointSchema } from "@ionity/metrification";
import type { CompassDirection } from "@ionity/metrification";
import type { Db } from "./db.js";
import type { SessionManager } from "./sessions.js";
import type { Hub } from "./hub.js";

const createSessionSchema = z.object({
  deviceId: z.string().min(1),
  ap: accessPointSchema,
  direction: compassSchema,
  config: z
    .object({
      distancePointsM: z.array(z.number().nonnegative()).optional(),
      heightPointsM: z.array(z.number().nonnegative()).optional(),
      repetitions: z.number().int().positive().optional(),
      dwellSeconds: z.number().positive().optional(),
      minCsiStability: z.number().min(0).max(1).optional(),
      maxRssiStd: z.number().positive().optional(),
    })
    .optional(),
});

export interface ApiDeps {
  db: Db;
  sessions: SessionManager;
  hub: Hub;
}

export function registerApi(app: FastifyInstance, deps: ApiDeps): void {
  const { db, sessions, hub } = deps;

  app.get("/api/health", async () => ({ ok: true, ts: Date.now(), wsClients: hub.size() }));

  app.get("/api/devices", async () => ({ devices: db.listDevices() }));
  app.get("/api/aps", async () => ({ aps: db.listAps() }));
  app.get("/api/models", async () => ({ models: db.listModels() }));

  app.get("/api/localizations", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const deviceId = q.deviceId;
    const since = q.since ? Number(q.since) : 0;
    const limit = q.limit ? Math.min(Number(q.limit), 5000) : 500;
    return { localizations: db.recentLocalizations(deviceId, since, limit) };
  });

  app.post("/api/sessions", async (req, reply) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const { deviceId, ap, direction, config } = parsed.data;
    const view = sessions.create(deviceId, ap, direction as CompassDirection, config ?? {});
    hub.broadcast({ type: "calibration", data: { status: "started", session: view } });
    return view;
  });

  app.get("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const view = sessions.getView(id);
    if (!view) return reply.status(404).send({ error: "session not found" });
    return view;
  });

  app.post("/api/sessions/:id/abort", async (req) => {
    const { id } = req.params as { id: string };
    sessions.abort(id);
    return { ok: true };
  });
}
