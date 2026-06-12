<h1 align="center">Ionity-CSI</h1>

<p align="center">
  <strong>WiFi CSI/RSSI Metrification &amp; realtime 3D localization</strong><br/>
  Capture real channel measurements from any capable radio, calibrate a room with the
  <em>Ionity Metrification CSI</em> method, and localize devices live on a 3D map.
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green"/>
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js"/>
  <img alt="ESP-IDF" src="https://img.shields.io/badge/ESP--IDF-5.x-E7352C?logo=espressif"/>
  <img alt="Android" src="https://img.shields.io/badge/Android-API%2028%2B-3DDC84?logo=android"/>
  <img alt="Data" src="https://img.shields.io/badge/data-real%20only%2C%20no%20simulation-blue"/>
</p>

---

## What it does

1. **Capture** real WiFi measurements from a device that can touch the radio:
   - **ESP32** — true CSI + RSSI (ESP-IDF firmware)
   - **Android** — RSSI + 802.11mc FTM ranging (native Kotlin app)
   - **Linux + Nexmon/Atheros** — true CSI + RSSI (Python agent)
2. **Calibrate** a closed room with the **Ionity Metrification** method: 0/1/2/3 m
   along a chosen compass heading, then 0/10/20/30 cm above the router, each point
   captured 3× over a multi-second dwell, gated on CSI Hz-stability + RSSI noise.
3. **Localize** any device afterwards — distance, direction, and height from the
   router — fusing path-loss/FTM ranging with kNN fingerprinting.
4. **Visualize** everything live in a **3D map** (React + Three.js) with movement
   trails, updated over WebSocket.

> **Why not a pure web app reading WiFi?** Browsers have no access to the radio, and
> stock phones cannot read CSI at all. So capture runs in native agents and the web
> app is the (real) dashboard + control plane. See
> [ADR-0003](docs/adr/0003-pluggable-capture-agents.md).
>
> **No simulation, ever.** The DB starts empty, the dashboard shows nothing until
> real captures arrive, and the ML pipeline trains only on real rows. There is no
> synthetic-data path anywhere in the system.

## Architecture

```
        ESP32 / Android / Linux-Nexmon  (real CSI / RSSI / FTM)
                         │  MQTT  ionity/<id>/capture
                         ▼
                ┌──────────────────┐      WebSocket /ws     ┌────────────────────┐
   Mosquitto ──▶│  @ionity/server  │───────────────────────▶│ @ionity/dashboard  │
                │  ingest · SQLite │      REST /api          │ 3D map · wizard    │
                │  sessions · model│◀──────────────────────  │ (React + Three.js) │
                │  localization    │                         └────────────────────┘
                └────────┬─────────┘
                         │ reads/writes
                         ▼
                 data/ionity.sqlite ──▶ ml/ (train → publish model)
                         ▲                         │
                         └──── active model JSON ──┘
                 @ionity/metrification (shared MIT core: protocol, geometry,
                 ranging, CSI metrics, calibration FSM, localization)
```

## Repository layout

```
packages/metrification   MIT core library (protocol, geometry, ranging, CSI, calibration, localize)
packages/server          MQTT ingest · SQLite · sessions · localization · REST + WS
packages/dashboard       React + Three.js realtime 3D map + calibration wizard
agents/esp32             ESP-IDF firmware (true CSI)
agents/android           Kotlin/Compose app (RSSI + 802.11mc FTM)
agents/linux-nexmon      Python agent (Nexmon/Atheros CSI + RSSI)  ← reference
ml/                      Training pipeline (real captures → model JSON)
docs/                    METHOD.md · PROTOCOL.md · ADRs
infra/mosquitto          Broker config
```

## Quick start

```bash
# 0. Prereqs: Node ≥20, Docker (for the broker), Python 3.11+ (agent/ML).

# 1. Broker
docker compose up -d mosquitto

# 2. Library + server
npm install
npm run build:lib
npm run dev:server                 # http://localhost:8080

# 3. Dashboard (separate terminal)
npm run dev:dashboard              # http://localhost:5173  (proxies /api + /ws)

# 4. A capture agent (Linux reference; needs iw + a CSI source — see agent README)
cd agents/linux-nexmon && pip install -r requirements.txt
sudo -E python -m ionity_agent.cli scan                 # publishes APs
#   → in the dashboard: start a calibration session for this device + an AP
python -m ionity_agent.cli calibrate --session <id>     # walk the points
python -m ionity_agent.cli run --bssid <ap-bssid>       # live localization
```

Build the dashboard (`npm run build:dashboard`) and the server will serve it on
port 8080 directly.

## Library at a glance

```ts
import { CalibrationMachine, buildModel, localize } from "@ionity/metrification";

const m = new CalibrationMachine(sessionId, { direction: "E" });
for (const capture of captures) m.accept(capture);   // gates dwell + stability
const model = buildModel(m.getAccepted(), "E", ap);
const fix = localize(model, freshCapture);            // {position, distanceM, direction, heightM, confidence}
```

## Status & verification

- `@ionity/metrification` ships unit tests for geometry, ranging, the calibration
  FSM, and localization (`npm run test --workspace @ionity/metrification`).
- The Python agent + ML modules byte-compile; they require `pip install` for
  runtime deps and real capture hardware to produce data.
- End-to-end verification (broker + server + dashboard + a real agent) is described
  in each package README and in [docs/METHOD.md](docs/METHOD.md).

## Documentation

- [The method](docs/METHOD.md) · [Protocol](docs/PROTOCOL.md) · [ADRs](docs/adr)
- Per-package: [`metrification`](packages/metrification/README.md) ·
  [`server`](packages/server/README.md) · [`dashboard`](packages/dashboard/README.md) ·
  [`esp32`](agents/esp32/README.md) · [`android`](agents/android/README.md) ·
  [`linux-nexmon`](agents/linux-nexmon/README.md) · [`ml`](ml/README.md)

## License

MIT © Ionity Global (Pty) Ltd. See [LICENSE](LICENSE).
