import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CalibrationMachine,
  buildPlan,
  DEFAULT_CALIBRATION_CONFIG,
  type CalibrationStep,
} from "../src/calibration/index.ts";
import type { AccessPoint, Capture } from "../src/models/index.ts";

const AP: AccessPoint = { bssid: "aa:bb:cc:dd:ee:ff", ssid: "Router", freqMhz: 5180, bandwidthMhz: 80 };

/** A clean, steady capture matching a given step (CSI identical → stability 1). */
function steadyCapture(step: CalibrationStep, rssi: number, dwellS = 4): Capture {
  const start = 1_000_000;
  const end = start + dwellS * 1000;
  const csiFrame = { ts: start, amplitude: [10, 12, 11, 13], phase: [0, 0.1, 0.2, 0.1], rssi };
  return {
    deviceId: "dev-1",
    agent: "esp32",
    ap: AP,
    startTs: start,
    endTs: end,
    measurement: {
      rssi: [
        { rssi, ts: start },
        { rssi, ts: end },
      ],
      csi: [csiFrame, { ...csiFrame, ts: end }],
    },
    label: { axis: step.axis, valueMeters: step.valueMeters, direction: step.direction, repetition: step.repetition },
  };
}

test("plan covers all points × repetitions, distance axis first", () => {
  const plan = buildPlan(DEFAULT_CALIBRATION_CONFIG);
  // (4 distance + 4 height) points × 3 repetitions = 24 steps.
  assert.equal(plan.length, 24);
  assert.equal(plan[0]!.axis, "distance");
  assert.equal(plan[plan.length - 1]!.axis, "height");
});

test("machine accepts steady captures and walks to completion", () => {
  const m = new CalibrationMachine("sess-1", { direction: "E" });
  let guard = 0;
  while (!m.isComplete() && guard++ < 100) {
    const step = m.current()!;
    const out = m.accept(steadyCapture(step, -45));
    assert.equal(out.status, "accepted", out.status === "rejected" ? out.reason : "");
  }
  assert.ok(m.isComplete());
  assert.equal(m.getAccepted().length, 24);
  assert.equal(m.progress(), 1);
});

test("dwell gate rejects too-short captures", () => {
  const m = new CalibrationMachine("sess-2");
  const step = m.current()!;
  const out = m.accept(steadyCapture(step, -45, 1)); // 1s < 4s required
  assert.equal(out.status, "rejected");
});

test("label mismatch is an error, not a silent accept", () => {
  const m = new CalibrationMachine("sess-3", { direction: "N" });
  const step = m.current()!;
  const wrong = steadyCapture(step, -45);
  wrong.label!.valueMeters = 99;
  const out = m.accept(wrong);
  assert.equal(out.status, "error");
});
