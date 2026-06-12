/** Thin REST client for the Ionity-CSI server. */
import type { AccessPoint, ApRow, CompassDirection, DeviceRow, LocalizationRow, SessionView } from "./types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => jsonFetch<{ ok: boolean; ts: number; wsClients: number }>("/api/health"),
  devices: () => jsonFetch<{ devices: DeviceRow[] }>("/api/devices").then((r) => r.devices),
  aps: () => jsonFetch<{ aps: ApRow[] }>("/api/aps").then((r) => r.aps),
  models: () => jsonFetch<{ models: unknown[] }>("/api/models").then((r) => r.models),
  localizations: (deviceId?: string, since = 0, limit = 500) =>
    jsonFetch<{ localizations: LocalizationRow[] }>(
      `/api/localizations?${new URLSearchParams({
        ...(deviceId ? { deviceId } : {}),
        since: String(since),
        limit: String(limit),
      })}`,
    ).then((r) => r.localizations),
  createSession: (body: {
    deviceId: string;
    ap: AccessPoint;
    direction: CompassDirection;
    config?: Record<string, unknown>;
  }) => jsonFetch<SessionView>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
  getSession: (id: string) => jsonFetch<SessionView>(`/api/sessions/${id}`),
  abortSession: (id: string) => jsonFetch<{ ok: boolean }>(`/api/sessions/${id}/abort`, { method: "POST" }),
};
