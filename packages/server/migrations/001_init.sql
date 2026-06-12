-- Ionity-CSI SQLite schema. Stores REAL captures and trained models only.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
  device_id    TEXT PRIMARY KEY,
  agent        TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'online',
  last_message TEXT,
  last_seen    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS aps (
  bssid         TEXT PRIMARY KEY,
  ssid          TEXT NOT NULL,
  freq_mhz      REAL NOT NULL,
  bandwidth_mhz REAL,
  last_seen     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL,
  ap_bssid     TEXT NOT NULL,
  direction    TEXT NOT NULL,
  config_json  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',   -- active | complete | aborted
  created_at   INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS captures (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id        TEXT NOT NULL,
  agent            TEXT NOT NULL,
  ap_bssid         TEXT NOT NULL,
  session_id       TEXT,
  start_ts         INTEGER NOT NULL,
  end_ts           INTEGER NOT NULL,
  label_json       TEXT,            -- CalibrationLabel when part of a session
  measurement_json TEXT NOT NULL,   -- raw Measurement (rssi + csi + ftm)
  features_json    TEXT NOT NULL,   -- extracted FeatureVector
  accepted         INTEGER NOT NULL DEFAULT 0,  -- passed the calibration gates
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_captures_session ON captures(session_id);
CREATE INDEX IF NOT EXISTS idx_captures_ap ON captures(ap_bssid);

CREATE TABLE IF NOT EXISTS models (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ap_bssid       TEXT NOT NULL,
  direction      TEXT NOT NULL,
  model_json     TEXT NOT NULL,
  n_fingerprints INTEGER NOT NULL,
  source         TEXT NOT NULL DEFAULT 'calibration', -- calibration | ml
  active         INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_models_ap ON models(ap_bssid);

CREATE TABLE IF NOT EXISTS localizations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT NOT NULL,
  ap_bssid    TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  z           REAL NOT NULL,
  distance_m  REAL NOT NULL,
  direction   TEXT NOT NULL,
  height_m    REAL NOT NULL,
  confidence  REAL NOT NULL,
  method      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_localizations_device ON localizations(device_id, ts);
