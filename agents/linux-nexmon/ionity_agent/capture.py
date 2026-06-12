"""Dwell capture: collect RSSI samples + CSI frames over a time window."""
from __future__ import annotations

import time

from .config import AgentConfig
from .csi_nexmon import NexmonCsiSource
from .scan import ap_rssi


class Capturer:
    def __init__(self, config: AgentConfig, csi: NexmonCsiSource | None):
        self.config = config
        self.csi = csi

    def dwell(self, bssid: str, seconds: float | None = None) -> tuple[int, int, list[dict], list[dict]]:
        """Capture for `seconds` (default config dwell). Returns
        (start_ts_ms, end_ts_ms, rssi_samples, csi_frames)."""
        dwell_s = seconds if seconds is not None else self.config.dwell_seconds
        start = int(time.time() * 1000)
        deadline = time.time() + dwell_s
        rssi_samples: list[dict] = []
        csi_frames: list[dict] = []

        last_rssi_poll = 0.0
        while time.time() < deadline:
            # Poll RSSI ~2 Hz from the live radio.
            now = time.time()
            if now - last_rssi_poll >= 0.5:
                r = ap_rssi(self.config.iface, bssid)
                if r is not None:
                    rssi_samples.append({"rssi": r, "ts": int(now * 1000)})
                last_rssi_poll = now

            # Drain available CSI frames.
            if self.csi is not None:
                frame = self.csi.read_frame()
                if frame is not None:
                    csi_frames.append(frame)
                    # If CSI carries RSSI and the scan poll lagged, use it too.
                    if not rssi_samples and "rssi" in frame:
                        rssi_samples.append({"rssi": frame["rssi"], "ts": frame["ts"]})
            else:
                time.sleep(0.05)

        end = int(time.time() * 1000)
        return start, end, rssi_samples, csi_frames
