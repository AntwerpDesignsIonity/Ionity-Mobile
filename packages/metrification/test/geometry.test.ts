import { test } from "node:test";
import assert from "node:assert/strict";
import {
  directionToUnitVector,
  azimuthToCompass,
  vectorToCompass,
  multilaterate,
  distance,
  type RangeAnchor,
} from "../src/geometry/index.ts";
import type { Vec3 } from "../src/models/index.ts";

test("compass unit vectors point the right way in ENU", () => {
  const n = directionToUnitVector("N");
  assert.ok(Math.abs(n.x) < 1e-9 && Math.abs(n.y - 1) < 1e-9, "N → +North");
  const e = directionToUnitVector("E");
  assert.ok(Math.abs(e.x - 1) < 1e-9 && Math.abs(e.y) < 1e-9, "E → +East");
  const s = directionToUnitVector("S");
  assert.ok(Math.abs(s.y + 1) < 1e-9, "S → -North");
});

test("azimuth ↔ compass round-trips on the 8 winds", () => {
  assert.equal(azimuthToCompass(0), "N");
  assert.equal(azimuthToCompass(45), "NE");
  assert.equal(azimuthToCompass(90), "E");
  assert.equal(azimuthToCompass(225), "SW");
  assert.equal(azimuthToCompass(359), "N"); // wraps
});

test("vectorToCompass reads heading from a position", () => {
  assert.equal(vectorToCompass({ x: 0, y: 5, z: 0 }), "N");
  assert.equal(vectorToCompass({ x: 5, y: 5, z: 0 }), "NE");
  assert.equal(vectorToCompass({ x: -5, y: 0, z: 1 }), "W");
});

test("multilateration recovers a known target from exact ranges", () => {
  const target: Vec3 = { x: 1.5, y: -0.8, z: 0.2 };
  const anchorPts: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
    { x: 0, y: 3, z: 0 },
    { x: 0, y: 0, z: 3 },
  ];
  const anchors: RangeAnchor[] = anchorPts.map((p) => ({ position: p, range: distance(p, target) }));
  const { position, rmsResidual } = multilaterate(anchors);
  assert.ok(distance(position, target) < 1e-3, "position within 1mm");
  assert.ok(rmsResidual < 1e-3, "residual near zero");
});
