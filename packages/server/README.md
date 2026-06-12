# @ionity/server

Control plane for Ionity-CSI: MQTT ingest → SQLite → calibration sessions →
localization → REST + WebSocket. Computation (calibration, model fitting,
localization) happens here, on the device running the server; the dashboard is
the visual layer.

## Run

```bash
# 1. Start the broker
docker compose up -d mosquitto      # from repo root

# 2. Build the library + server, then start
npm run build --workspace @ionity/metrification
npm run build --workspace @ionity/server
npm run start --workspace @ionity/server
# or, no build: npm run dev --workspace @ionity/server
```

### Environment

| Var | Default | Meaning |
|---|---|---|
| `IONITY_PORT` | `8080` | HTTP/WebSocket port |
| `IONITY_HOST` | `0.0.0.0` | Bind address |
| `IONITY_MQTT_URL` | `mqtt://localhost:1883` | Mosquitto broker |
| `IONITY_DB_PATH` | `<repo>/data/ionity.sqlite` | SQLite file |
| `IONITY_DASHBOARD_DIR` | `../dashboard/dist` | Built dashboard to serve |
| `IONITY_MIN_CONFIDENCE` | `0` | Drop localizations below this confidence |

## REST

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + WS client count |
| GET | `/api/devices` | Known agents and last-seen state |
| GET | `/api/aps` | Access points seen in scans |
| GET | `/api/models` | Trained models (active flag) |
| GET | `/api/localizations?deviceId=&since=&limit=` | Recent position fixes |
| POST | `/api/sessions` | Start a calibration session |
| GET | `/api/sessions/:id` | Session progress + current step |
| POST | `/api/sessions/:id/abort` | Abort a session |

`POST /api/sessions` body:

```json
{
  "deviceId": "esp32-livingroom",
  "ap": { "bssid": "aa:bb:cc:dd:ee:ff", "ssid": "Router", "freqMhz": 5180 },
  "direction": "E",
  "config": { "repetitions": 3, "dwellSeconds": 4 }
}
```

## WebSocket `/ws`

Pushes `{type, data}` events: `status`, `calibration`, `localization`. The
dashboard subscribes here for the realtime 3D map.

## Data integrity

No model exists for an AP until a real calibration completes, and the localizer
returns nothing without a model — there is no synthetic fallback anywhere.
