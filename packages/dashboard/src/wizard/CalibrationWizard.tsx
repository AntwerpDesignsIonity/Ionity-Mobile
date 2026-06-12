/**
 * Calibration wizard. Drives the Ionity Metrification method: choose a device +
 * scanned AP + heading, start the session, then guide the operator point-by-
 * point. The capture itself is triggered on the agent device; this panel shows
 * the current instruction and live accept/reject feedback from the server.
 */
import { useState } from "react";
import { COMPASS_DIRECTIONS } from "@ionity/metrification";
import type { ApRow, CompassDirection, DeviceRow, SessionView, CalibrationEvent } from "../types";

export interface WizardProps {
  devices: DeviceRow[];
  aps: ApRow[];
  session: SessionView | null;
  lastEvent: CalibrationEvent | null;
  onStart: (deviceId: string, apBssid: string, direction: CompassDirection, repetitions: number, dwellSeconds: number) => void;
  onAbort: () => void;
}

export function stepInstruction(session: SessionView): string {
  const s = session.current;
  if (!s) return session.complete ? "Calibration complete — model trained." : "Waiting…";
  const rep = `pass ${s.repetition + 1}/${session.total / countPoints(session)}`;
  if (s.axis === "distance") {
    const m = s.valueMeters;
    const where = m === 0 ? "on top of / touching the router" : `exactly ${m} m ${s.direction} of the router, in a straight line`;
    return `Place the device ${where}. Hold still — ${rep}.`;
  }
  const cm = Math.round(s.valueMeters * 100);
  const where = cm === 0 ? "directly on the router" : `exactly ${cm} cm directly above the router`;
  return `Raise the device ${where}. Hold still — ${rep}.`;
}

function countPoints(session: SessionView): number {
  // total = points * repetitions; we don't know repetitions here directly, but
  // the plan is distance(4)+height(4) by default → 8 unique points.
  return 8;
}

export function CalibrationWizard(props: WizardProps) {
  const { devices, aps, session, lastEvent, onStart, onAbort } = props;
  const [deviceId, setDeviceId] = useState("");
  const [apBssid, setApBssid] = useState("");
  const [direction, setDirection] = useState<CompassDirection>("N");
  const [repetitions, setRepetitions] = useState(3);
  const [dwellSeconds, setDwellSeconds] = useState(4);

  const active = session && !session.complete;

  if (active) {
    return (
      <div className="panel">
        <h2>Calibrating</h2>
        <div className="progress">
          <div className="bar" style={{ width: `${Math.round(session!.progress * 100)}%` }} />
        </div>
        <p className="muted">
          {session!.accepted}/{session!.total} captures · heading {session!.direction}
        </p>
        <p className="instruction">{stepInstruction(session!)}</p>
        {lastEvent?.status === "rejected" && <p className="reject">Rejected: {lastEvent.reason}</p>}
        {lastEvent?.status === "error" && <p className="reject">Error: {lastEvent.reason}</p>}
        {lastEvent?.status === "accepted" && <p className="accept">✓ Point captured</p>}
        <button className="danger" onClick={onAbort}>
          Abort session
        </button>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>New calibration</h2>
      <label>
        Device
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          <option value="">— select agent —</option>
          {devices.map((d) => (
            <option key={d.device_id} value={d.device_id}>
              {d.device_id} ({d.agent}, {d.state})
            </option>
          ))}
        </select>
      </label>
      <label>
        Target AP (router)
        <select value={apBssid} onChange={(e) => setApBssid(e.target.value)}>
          <option value="">— select scanned AP —</option>
          {aps.map((a) => (
            <option key={a.bssid} value={a.bssid}>
              {a.ssid || "(hidden)"} · {a.bssid} · {Math.round(a.freq_mhz)} MHz
            </option>
          ))}
        </select>
      </label>
      <label>
        Distance-axis heading
        <select value={direction} onChange={(e) => setDirection(e.target.value as CompassDirection)}>
          {COMPASS_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <label>
          Repetitions ("hearts")
          <input type="number" min={1} max={9} value={repetitions} onChange={(e) => setRepetitions(Number(e.target.value))} />
        </label>
        <label>
          Dwell (s)
          <input type="number" min={1} max={30} value={dwellSeconds} onChange={(e) => setDwellSeconds(Number(e.target.value))} />
        </label>
      </div>
      <button
        className="primary"
        disabled={!deviceId || !apBssid}
        onClick={() => onStart(deviceId, apBssid, direction, repetitions, dwellSeconds)}
      >
        Start calibration
      </button>
      <p className="hint">
        Closed room, static during capture: 0/1/2/3 m along {direction}, then 0/10/20/30 cm above the router.
      </p>
    </div>
  );
}
