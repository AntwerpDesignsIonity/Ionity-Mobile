import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  distancePointPosition,
  heightPointPosition,
  type CompassDirection,
  type Vec3,
} from "@ionity/metrification";
import { api } from "./api";
import { useLiveEvents } from "./useLiveEvents";
import { Scene, type DeviceTrack } from "./scene3d/Scene";
import { CalibrationWizard } from "./wizard/CalibrationWizard";
import type { ApRow, CalibrationEvent, DeviceRow, HubEvent, LocalizationRow, SessionView } from "./types";

const TRAIL_MAX = 40;
const DEFAULT_DISTANCE_POINTS = [0, 1, 2, 3];
const DEFAULT_HEIGHT_POINTS = [0, 0.1, 0.2, 0.3];

export default function App() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [aps, setAps] = useState<ApRow[]>([]);
  const [session, setSession] = useState<SessionView | null>(null);
  const [lastEvent, setLastEvent] = useState<CalibrationEvent | null>(null);
  const [tracks, setTracks] = useState<Map<string, DeviceTrack>>(new Map());
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const refreshLists = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([api.devices(), api.aps()]);
      setDevices(d);
      setAps(a);
    } catch {
      /* server may not be up yet */
    }
  }, []);

  useEffect(() => {
    refreshLists();
    // Seed device tracks from recent localizations.
    api
      .localizations(undefined, 0, 200)
      .then((rows) => setTracks(seedTracks(rows)))
      .catch(() => undefined);
    const t = setInterval(refreshLists, 5000);
    return () => clearInterval(t);
  }, [refreshLists]);

  const onEvent = useCallback((event: HubEvent) => {
    if (event.type === "localization") {
      const r = event.data.result;
      setTracks((prev) => {
        const next = new Map(prev);
        const existing = next.get(r.deviceId);
        const trail = [...(existing?.trail ?? []), r.position].slice(-TRAIL_MAX);
        next.set(r.deviceId, {
          deviceId: r.deviceId,
          position: r.position,
          trail,
          distanceM: r.distanceM,
          direction: r.direction,
          heightM: r.heightM,
          confidence: r.confidence,
        });
        return next;
      });
    } else if (event.type === "calibration") {
      setSession(event.data.session);
      setLastEvent(event.data);
    } else if (event.type === "status") {
      refreshLists();
    }
  }, [refreshLists]);

  const { connected } = useLiveEvents(onEvent);

  const onStart = useCallback(
    async (deviceId: string, apBssid: string, direction: CompassDirection, repetitions: number, dwellSeconds: number) => {
      const ap = aps.find((a) => a.bssid === apBssid);
      if (!ap) return;
      const view = await api.createSession({
        deviceId,
        ap: { bssid: ap.bssid, ssid: ap.ssid, freqMhz: ap.freq_mhz, bandwidthMhz: ap.bandwidth_mhz ?? undefined },
        direction,
        config: { repetitions, dwellSeconds },
      });
      setSession(view);
      setLastEvent({ status: "started", session: view });
    },
    [aps],
  );

  const onAbort = useCallback(async () => {
    if (session) await api.abortSession(session.sessionId);
    setSession(null);
    setLastEvent(null);
  }, [session]);

  // Nominal calibration markers + the current target, derived from the session.
  const { calibrationPoints, target } = useMemo(() => {
    if (!session) return { calibrationPoints: [] as Vec3[], target: null };
    const dir = session.direction;
    const points: Vec3[] = [
      ...DEFAULT_DISTANCE_POINTS.map((m) => distancePointPosition(m, dir)),
      ...DEFAULT_HEIGHT_POINTS.map((m) => heightPointPosition(m)),
    ];
    let tgt = null as null | { position: Vec3; label: string };
    if (session.current) {
      const s = session.current;
      const position = s.axis === "distance" ? distancePointPosition(s.valueMeters, dir) : heightPointPosition(s.valueMeters);
      const label =
        s.axis === "distance"
          ? `${s.valueMeters} m ${dir}`
          : `${Math.round(s.valueMeters * 100)} cm up`;
      tgt = { position, label };
    }
    return { calibrationPoints: points, target: tgt };
  }, [session]);

  const trackList = useMemo(() => Array.from(tracks.values()), [tracks]);

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>Ionity-CSI</h1>
          <span className={connected ? "dot ok" : "dot bad"} title={connected ? "live" : "disconnected"} />
        </header>

        <CalibrationWizard
          devices={devices}
          aps={aps}
          session={session}
          lastEvent={lastEvent}
          onStart={onStart}
          onAbort={onAbort}
        />

        <div className="panel">
          <h2>Live devices ({trackList.length})</h2>
          {trackList.length === 0 && <p className="muted">No localizations yet. Complete a calibration, then move a device.</p>}
          <ul className="tracklist">
            {trackList.map((t) => (
              <li key={t.deviceId}>
                <strong>{t.deviceId}</strong>
                <span>
                  {t.distanceM.toFixed(2)} m {t.direction} · {Math.round(t.heightM * 100)} cm · conf {t.confidence.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>Agents ({devices.length})</h2>
          <ul className="tracklist">
            {devices.map((d) => (
              <li key={d.device_id}>
                <strong>{d.device_id}</strong>
                <span>
                  {d.agent} · {d.state}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="stage">
        <Scene devices={trackList} calibrationPoints={calibrationPoints} target={target} />
      </main>
    </div>
  );
}

function seedTracks(rows: LocalizationRow[]): Map<string, DeviceTrack> {
  const byDevice = new Map<string, LocalizationRow[]>();
  for (const r of rows) {
    const arr = byDevice.get(r.device_id) ?? [];
    arr.push(r);
    byDevice.set(r.device_id, arr);
  }
  const out = new Map<string, DeviceTrack>();
  for (const [deviceId, list] of byDevice) {
    const sorted = list.sort((a, b) => a.ts - b.ts).slice(-TRAIL_MAX);
    const latest = sorted[sorted.length - 1]!;
    out.set(deviceId, {
      deviceId,
      position: { x: latest.x, y: latest.y, z: latest.z },
      trail: sorted.map((r) => ({ x: r.x, y: r.y, z: r.z })),
      distanceM: latest.distance_m,
      direction: latest.direction,
      heightM: latest.height_m,
      confidence: latest.confidence,
    });
  }
  return out;
}
