# @ionity/metrification

The MIT-licensed core of **Ionity Metrification CSI** — pure, hardware-free
TypeScript shared by the capture agents, server, dashboard, and ML pipeline.

```
models/        Shared data types (Capture, CsiFrame, RssiSample, …)
protocol/      MQTT topic builders + zod schemas (the trust boundary)
geometry/      ENU frame, compass↔vector, Gauss-Newton multilateration
ranging/       RSSI log-distance path-loss fit + FTM fusion
csi/           Amplitude/phase, phase unwrap, Hz-stability score
features/      Capture → FeatureVector extraction
calibration/   The Metrification method as a state machine (gates + plan)
localize/      Model builder + kNN-fingerprint / path-loss fused localizer
```

## The method in one paragraph

Anchor the local ENU frame at a chosen AP (origin). Capture along a horizontal
**distance axis** at 0/1/2/3 m on a tagged compass heading, then a vertical
**height axis** at 0/10/20/30 cm above the AP — each point captured 3× ("hearts")
over a multi-second dwell, gated on CSI Hz-stability and RSSI noise so a moving
room is rejected. `buildModel()` fits a path-loss curve from the distance points
and stores z-scored fingerprints. `localize()` then fuses RSSI/FTM range with
kNN-fingerprint heading + height to estimate any device's position.

## Use

```ts
import {
  CalibrationMachine, buildModel, localize, parseCapture, topics,
} from "@ionity/metrification";

const machine = new CalibrationMachine(sessionId, { direction: "E" });
for (const capture of incoming) {            // validated agent captures
  const out = machine.accept(capture);       // gates dwell + stability
  if (out.status === "rejected") promptRecapture(out.reason);
}
const model = buildModel(machine.getAccepted(), "E", ap);
const result = localize(model, freshCapture); // → {position, distanceM, direction, heightM, confidence}
```

## Test

```bash
npm run test     # runs against TS sources via the repo dev loader (no build needed)
npm run build    # emits dist/ for consumers
```

All test fixtures are deterministic constructions used to verify the math; the
library never generates synthetic measurement data at runtime.
