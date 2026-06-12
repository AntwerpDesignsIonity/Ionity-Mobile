import { test } from "node:test";
import assert from "node:assert/strict";
import { CalibrationMachine, type CalibrationStep } from "../src/calibration/index.ts";
import { buildModel, localize } from "../src/localize/index.ts";
import type { AccessPoint, Capture, CompassDirection } from "../src/models/index.ts";

const AP: AccessPoint = { bssid: "aa:bb:cc:dd:ee:ff", ssid: "Router", freqMhz: 5180 };
const A = -40; // RSSI at 1 m
const N = 3; // path-loss exponent

// RSSI from the log-distance model used to drive calibration (test fixture only).
function rssiAt(distanceM: number): number {
  if (distanceM <= 0) return A + 6; // 0 m point: strongest, near the AP
  return A - 10 * N * Math.log10(distanceM);
}

function capture(step: CalibrationStep, dir: CompassDirection): Capture {
  // Distance points vary RSSI with distance; height points sit at the AP plane.
  const d = step.axis === "distance" ? step.valueMeters : 0.0;
  const rssi = rssiAt(Math.max(d, step.axis === "height" ? 0.0 : d));
  const start = 0;
  const end = 4000;
  const amp = [10 + d, 12 - d, 11, 13 - d * 0.5];
  return {
    deviceId: "dev",
    agent: "esp32",
    ap: AP,
    startTs: start,
    endTs: end,
    measurement: {
      rssi: [
        { rssi, ts: start },
        { rssi, ts: end },
      ],
      csi: [
        { ts: start, amplitude: amp, phase: [0, 0, 0, 0], rssi },
        { ts: end, amplitude: amp, phase: [0, 0, 0, 0], rssi },
      ],
    },
    label: { axis: step.axis, valueMeters: step.valueMeters, direction: step.direction, repetition: step.repetition },
  };
}

function trainedModel(dir: CompassDirection) {
  const m = new CalibrationMachine("sess", { direction: dir });
  while (!m.isComplete()) {
    const step = m.current()!;
    const out = m.accept(capture(step, dir));
    assert.equal(out.status, "accepted", out.status === "rejected" ? out.reason : "");
  }
  return buildModel(m.getAccepted(), dir, AP);
}

test("model fits the path-loss exponent from calibration", () => {
  const model = trainedModel("E");
  assert.ok(Math.abs(model.pathLoss.exponent - N) < 0.2, `n≈${model.pathLoss.exponent}`);
  assert.ok(model.fingerprints.length === 24);
});

test("localize recovers distance and heading for a 2 m capture", () => {
  const dir: CompassDirection = "E";
  const model = trainedModel(dir);
  // A fresh capture taken at 2 m along the calibrated heading.
  const probe: Capture = {
    deviceId: "probe",
    agent: "esp32",
    ap: AP,
    startTs: 0,
    endTs: 4000,
    measurement: {
      rssi: [{ rssi: rssiAt(2), ts: 0 }],
      csi: [{ ts: 0, amplitude: [12, 10, 11, 12], phase: [0, 0, 0, 0], rssi: rssiAt(2) }],
    },
  };
  const r = localize(model, probe);
  assert.ok(Math.abs(r.distanceM - 2) < 0.6, `distance≈${r.distanceM.toFixed(2)} m`);
  assert.equal(r.direction, dir);
  assert.ok(r.confidence > 0 && r.confidence <= 1);
});

test("FTM-equipped capture reports the fused method", () => {
  const model = trainedModel("N");
  const probe: Capture = {
    deviceId: "probe",
    agent: "android",
    ap: AP,
    startTs: 0,
    endTs: 4000,
    measurement: {
      rssi: [{ rssi: rssiAt(1.5), ts: 0 }],
      csi: [],
      ftmDistanceMm: 1500,
    },
  };
  const r = localize(model, probe);
  assert.equal(r.method, "fused");
});
