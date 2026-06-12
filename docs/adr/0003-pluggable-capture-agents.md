# ADR-0003: Pluggable capture agents behind one protocol

- Status: accepted
- Date: 2026-06-11

## Context

The user wants capture on "any device". Radios differ wildly: ESP32 and Nexmon
expose true CSI; stock Android exposes RSSI + 802.11mc FTM but never CSI; a
browser exposes nothing. We must support all of these without forking the server
or the model.

## Decision

Define a single `Capture` message (`measurement.rssi[]`, `measurement.csi[]`,
optional `ftmDistanceMm`) and a shared **feature vector** that degrades
gracefully. Each agent (ESP32 firmware, Android app, Linux-Nexmon Python) is a
thin client that fills whatever fields its radio supports. The server, model, and
dashboard are agent-agnostic.

## Consequences

- Adding a new radio means writing one agent that emits `Capture` — no server
  changes.
- The localizer must handle CSI-rich and RSSI/FTM-only feature vectors; it does
  so by truncating to the common feature length and fusing FTM when present.
- A pure-browser capture path is explicitly out of scope (no radio access); the
  browser is the dashboard only.

## Alternatives considered

- **CSI-only**: simplest model, but excludes the phone the user actually has.
- **Per-agent bespoke pipelines**: maximal fidelity per device, but triples the
  server/model surface and breaks cross-device localization.
