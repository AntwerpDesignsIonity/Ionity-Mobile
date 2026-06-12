# ADR-0001: MQTT (Mosquitto) as the capture transport

- Status: accepted
- Date: 2026-06-11

## Context

Heterogeneous agents (ESP32, Android, Linux) must stream captures to the server
over a LAN, with the server also pushing localization results. The transport must
run on a microcontroller, survive flaky WiFi, and fan messages out to multiple
subscribers (server, dashboard).

## Decision

Use **MQTT** via an **Eclipse Mosquitto** broker. Agents publish to
`ionity/<deviceId>/capture` and `…/status`; the server subscribes with wildcards
and publishes `ionity/localize/<deviceId>`.

## Consequences

- ESP32 has first-class MQTT support (esp-mqtt); Android (HiveMQ) and Python
  (paho) clients are mature.
- Pub/sub decouples agents from the server and lets the dashboard subscribe
  directly over MQTT-over-WebSocket if desired.
- Adds a broker to the deployment (one container). Auth/TLS are off by default in
  dev and must be enabled for production.

## Alternatives considered

- **Raw WebSocket/HTTP to the server**: simpler stack but no microcontroller-grade
  client story and no native fan-out.
- **CoAP/UDP**: lighter, but lacks broker fan-out and tooling.
