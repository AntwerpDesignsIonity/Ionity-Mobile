import { test } from "node:test";
import assert from "node:assert/strict";
import { fitPathLoss, rssiToDistance, fuseRange, type RangeSample } from "../src/ranging/index.ts";

test("fitPathLoss recovers A and n from clean log-distance points", () => {
  // Construct RSSI = A - 10 n log10(d) with A = -40, n = 3.
  const A = -40;
  const n = 3;
  const samples: RangeSample[] = [1, 2, 3].map((d) => ({
    distanceM: d,
    rssi: A - 10 * n * Math.log10(d),
  }));
  const model = fitPathLoss(samples);
  assert.ok(Math.abs(model.rssiAt1m - A) < 1e-6, "recovers A");
  assert.ok(Math.abs(model.exponent - n) < 1e-6, "recovers n");
  assert.ok(model.r2 > 0.999, "near-perfect fit");
});

test("rssiToDistance inverts the fitted model", () => {
  const A = -40;
  const n = 3;
  const samples: RangeSample[] = [1, 2, 3].map((d) => ({ distanceM: d, rssi: A - 10 * n * Math.log10(d) }));
  const model = fitPathLoss(samples);
  const d = rssiToDistance(A - 10 * n * Math.log10(2), model);
  assert.ok(Math.abs(d - 2) < 1e-3, "recovers 2 m");
});

test("fuseRange leans on FTM when present", () => {
  // RSSI says 5 m, FTM says 2 m (2000 mm). Fused should sit near FTM.
  const fused = fuseRange(5, 2000);
  assert.ok(fused < 3, `fused (${fused}) pulled toward FTM`);
  // No FTM → returns the RSSI distance unchanged.
  assert.equal(fuseRange(5, undefined), 5);
});
