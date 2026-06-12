# ADR-0004: AP-anchored ENU coordinate frame

- Status: accepted
- Date: 2026-06-11

## Context

The method calibrates along a horizontal distance axis with a compass heading and
a vertical height axis. We need a coordinate frame that makes "distance",
"direction", and "height" first-class and that the 3D map can render directly.

## Decision

Use a local **ENU** frame with the chosen **AP at the origin**: x = East,
y = North, z = Up, in metres. Compass headings map to azimuth (N = 0°, clockwise);
a distance point at `d` metres on heading `h` sits at `d·(sin h, cos h, 0)`; a
height point at `c` metres sits at `(0, 0, c)`. The dashboard maps ENU → Three.js
as `(x, z, −y)`.

## Consequences

- Direction is recoverable as the compass label of a position's horizontal
  projection; height is just `z`.
- Multiple APs would each define their own frame; cross-AP fusion (future) needs a
  registration step between frames.
- Headings are operator-tagged (8-wind), so absolute orientation is only as good
  as the operator's compass call — acceptable for per-room use.

## Alternatives considered

- **Geographic (lat/lon/alt)**: needless precision/complexity for a single room.
- **Arbitrary per-session axes**: loses the intuitive compass/height semantics the
  method is built around.
