"""Build protocol messages (must match @ionity/metrification zod schemas)."""
from __future__ import annotations

TOPIC_ROOT = "ionity"


def topic_capture(device_id: str) -> str:
    return f"{TOPIC_ROOT}/{device_id}/capture"


def topic_status(device_id: str) -> str:
    return f"{TOPIC_ROOT}/{device_id}/status"


def build_capture(
    device_id: str,
    ap: dict,
    start_ts: int,
    end_ts: int,
    rssi_samples: list[dict],
    csi_frames: list[dict],
    ftm_distance_mm: float | None = None,
    label: dict | None = None,
    session_id: str | None = None,
) -> dict:
    measurement: dict = {"rssi": rssi_samples, "csi": csi_frames}
    if ftm_distance_mm is not None:
        measurement["ftmDistanceMm"] = ftm_distance_mm
    capture: dict = {
        "deviceId": device_id,
        "agent": "linux-nexmon",
        "ap": ap,
        "startTs": start_ts,
        "endTs": end_ts,
        "measurement": measurement,
    }
    if label is not None:
        capture["label"] = label
    if session_id is not None:
        capture["sessionId"] = session_id
    return capture


def build_status(device_id: str, state: str, ts: int, scan: list[dict] | None = None, message: str | None = None) -> dict:
    status: dict = {"deviceId": device_id, "agent": "linux-nexmon", "ts": ts, "state": state}
    if scan is not None:
        status["scan"] = scan
    if message is not None:
        status["message"] = message
    return status
