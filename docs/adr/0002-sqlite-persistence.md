# ADR-0002: SQLite for persistence

- Status: accepted
- Date: 2026-06-11

## Context

We must persist real captures, calibration sessions, trained models, and
localization history on the device that runs the server — which may be a laptop,
a Raspberry Pi, or eventually an embedded box. Zero-admin and single-file backup
matter more than horizontal scale.

## Decision

Use **SQLite** (via `better-sqlite3`) embedded in the server process. Schema in
`packages/server/migrations/001_init.sql`. Measurement payloads are stored as JSON
columns; positions and confidences are normalized columns for querying.

## Consequences

- No separate DB service; the whole state is one `.sqlite` file, easy to copy and
  inspect, and the ML pipeline reads it directly.
- Synchronous better-sqlite3 keeps the ingest path simple and fast for LAN-scale
  rates.
- Not suited to multi-writer or large-cluster deployments — acceptable for a
  per-room, per-device system.

## Alternatives considered

- **Postgres**: scales further but adds a service and ops burden unjustified here.
- **Flat files / NDJSON**: trivial to write but poor for the relational queries
  the dashboard and ML need.
