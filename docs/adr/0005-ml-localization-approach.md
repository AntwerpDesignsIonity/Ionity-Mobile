# ADR-0005: Fused kNN-fingerprint + path-loss localization

- Status: accepted
- Date: 2026-06-11

## Context

From a small, structured calibration set (8 points × 3 repetitions) we must
estimate a device's position, distance, direction, and height — robustly, on the
device, and consistently whether the model was fit by the built-in routine or the
ML pipeline.

## Decision

Fuse two estimators over the shared feature vector:

1. **Path-loss ranging** — fit `RSSI = A − 10·n·log10(d)` from the distance
   points; invert for a radius. Fuse with 802.11mc **FTM** by inverse-variance
   weighting when present.
2. **kNN fingerprinting** — z-score features, take the `k` nearest calibration
   fingerprints, inverse-distance-weight their ENU positions for heading + height.

The final position places the device at the fused **radius** along the
fingerprint **heading** at the fingerprint **height**. Confidence = neighbour
agreement × path-loss R². The ML pipeline exports the **same `MetrificationModel`
JSON**, so trained and built-in models are interchangeable.

## Consequences

- Works with as few as the 24 default captures; improves with more.
- Heading resolution is limited by the single calibrated axis; a second axis or
  more APs would improve azimuth coverage (future work).
- Identical model schema across TS and Python keeps the system inspectable and
  avoids a separate ML serving stack.

## Alternatives considered

- **Pure path-loss trilateration**: needs ≥3 APs; we anchor on one.
- **Deep models**: data-hungry and opaque for a 24-sample calibration; kNN +
  path-loss is interpretable and trains instantly.
