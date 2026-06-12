"""Feature extraction + geometry, mirroring @ionity/metrification in Python.

Keeping these in lock-step with the TypeScript library is what lets the ML
pipeline export a model the server can load directly. Operates on REAL captures
read from the server's SQLite database — never synthetic data.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

AZIMUTH_DEG = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}


@dataclass
class FeatureVector:
    rssi_mean: float
    rssi_std: float
    csi_amp_mean: list[float]
    csi_amp_std: list[float]
    csi_stability: float
    ftm_distance_m: float | None = None

    def to_array(self, include_csi: bool = True) -> list[float]:
        base = [self.rssi_mean, self.rssi_std, self.csi_stability]
        if include_csi and self.csi_amp_mean:
            return base + list(self.csi_amp_mean)
        return base


def extract_features(measurement: dict) -> FeatureVector:
    """Mirror of the TS extractFeatures(): RSSI stats + CSI aggregate + stability."""
    rssi = [s["rssi"] for s in measurement.get("rssi", [])]
    csi = measurement.get("csi", [])
    if not rssi and csi:
        rssi = [f["rssi"] for f in csi if "rssi" in f]

    rssi_mean = float(np.mean(rssi)) if rssi else float("nan")
    rssi_std = float(np.std(rssi, ddof=1)) if len(rssi) > 1 else 0.0

    amps = [f["amplitude"] for f in csi if f.get("amplitude")]
    if amps:
        n = min(len(a) for a in amps)
        mat = np.array([a[:n] for a in amps], dtype=float)  # frames × subcarriers
        amp_mean = mat.mean(axis=0)
        amp_std = mat.std(axis=0, ddof=1) if mat.shape[0] > 1 else np.zeros(n)
        with np.errstate(divide="ignore", invalid="ignore"):
            cv = np.where(amp_mean > 1e-9, amp_std / amp_mean, np.nan)
        mean_cv = float(np.nanmean(cv)) if np.any(np.isfinite(cv)) else 1.0
        stability = max(0.0, min(1.0, 1.0 - mean_cv))
        amp_mean_list, amp_std_list = amp_mean.tolist(), amp_std.tolist()
    else:
        stability, amp_mean_list, amp_std_list = 0.0, [], []

    ftm = measurement.get("ftmDistanceMm")
    return FeatureVector(
        rssi_mean=rssi_mean,
        rssi_std=rssi_std,
        csi_amp_mean=amp_mean_list,
        csi_amp_std=amp_std_list,
        csi_stability=stability,
        ftm_distance_m=(ftm / 1000.0) if ftm is not None else None,
    )


def label_position(label: dict) -> tuple[float, float, float]:
    """ENU position (x=East, y=North, z=Up) for a calibration label."""
    if label["axis"] == "distance":
        az = math.radians(AZIMUTH_DEG[label["direction"]])
        d = label["valueMeters"]
        return (math.sin(az) * d, math.cos(az) * d, 0.0)
    return (0.0, 0.0, label["valueMeters"])


def fit_path_loss(distances: list[float], rssis: list[float]) -> dict:
    """OLS of RSSI vs log10(distance) → {rssiAt1m, exponent, r2, samples}."""
    pts = [(d, r) for d, r in zip(distances, rssis) if d > 0 and math.isfinite(r)]
    if len(pts) < 2:
        anchor = pts[0] if pts else None
        rssi_at_1m = anchor[1] + 10 * 2 * math.log10(anchor[0]) if anchor else -40.0
        return {"rssiAt1m": rssi_at_1m, "exponent": 2.0, "r2": 0.0, "samples": len(pts)}
    x = np.log10([d for d, _ in pts])
    y = np.array([r for _, r in pts], dtype=float)
    slope, intercept = np.polyfit(x, y, 1)
    yhat = slope * x + intercept
    ss_res = float(np.sum((y - yhat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return {"rssiAt1m": float(intercept), "exponent": max(0.5, float(-slope) / 10), "r2": r2, "samples": len(pts)}
