# Protocol — MQTT topics & message schemas

All messages are JSON, validated server-side by the zod schemas in
`@ionity/metrification/protocol`. Agents are untrusted; invalid messages are
dropped, not guessed.

## Topics

| Topic | Direction | Payload |
|---|---|---|
| `ionity/<deviceId>/capture` | agent → server | `Capture` |
| `ionity/<deviceId>/status` | agent → server | `Status` |
| `ionity/<deviceId>/command` | server/operator → agent | `Command` (agent-defined) |
| `ionity/localize/<deviceId>` | server → subscribers | `LocalizationResult` |

The server subscribes to `ionity/+/capture` and `ionity/+/status`.

## `Capture`

```jsonc
{
  "deviceId": "esp32-1",
  "agent": "esp32",                 // esp32 | android | linux-nexmon
  "ap": { "bssid": "aa:bb:cc:dd:ee:ff", "ssid": "Router", "freqMhz": 5180, "bandwidthMhz": 80 },
  "startTs": 1718200000000,
  "endTs":   1718200004000,
  "measurement": {
    "rssi": [ { "rssi": -47, "ts": 1718200000500 } ],
    "csi":  [ { "ts": 1718200000500, "amplitude": [/* per-subcarrier */], "phase": [/* … */], "rssi": -47, "bandwidthMhz": 80 } ],
    "ftmDistanceMm": 1500,          // optional (Android FTM)
    "ftmStdDevMm": 200              // optional
  },
  "label": {                        // present only during calibration
    "axis": "distance",             // distance | height
    "valueMeters": 2,
    "direction": "E",               // required when axis = distance
    "repetition": 0
  },
  "sessionId": "uuid"               // present only during calibration
}
```

- RSSI-only agents (Android) send `csi: []`.
- A distance-axis label **must** include `direction`.

## `Status`

```jsonc
{
  "deviceId": "linux-pi",
  "agent": "linux-nexmon",
  "ts": 1718200000000,
  "state": "scanning",              // online | scanning | capturing | idle | error
  "scan": [ { "bssid": "…", "ssid": "…", "freqMhz": 5180, "rssi": -52 } ],
  "message": "optional"
}
```

## `LocalizationResult`

```jsonc
{
  "deviceId": "esp32-1",
  "ts": 1718200004000,
  "position": { "x": 1.4, "y": 0.2, "z": 0.05 },  // ENU metres, AP at origin
  "distanceM": 1.42,
  "direction": "E",
  "heightM": 0.05,
  "confidence": 0.83,
  "method": "fused"                  // fingerprint | pathloss | fused
}
```

## WebSocket (dashboard)

The server's `/ws` pushes `{ "type", "data" }` envelopes where `type` is one of
`status`, `calibration`, `localization`. The dashboard renders the 3D map from
these.
