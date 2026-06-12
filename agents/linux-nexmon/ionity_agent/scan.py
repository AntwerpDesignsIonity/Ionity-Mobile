"""WiFi scanning + RSSI via the `iw` userspace tool (nl80211).

Requires `iw` and, for scans, CAP_NET_ADMIN (run with sudo or set capabilities).
All values are read from the live radio — nothing is synthesised.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass


@dataclass
class ScannedAp:
    bssid: str
    ssid: str
    freq_mhz: float
    rssi: float

    def to_protocol(self, bandwidth_mhz: int | None = None) -> dict:
        ap = {"bssid": self.bssid, "ssid": self.ssid, "freqMhz": self.freq_mhz, "rssi": self.rssi}
        if bandwidth_mhz:
            ap["bandwidthMhz"] = bandwidth_mhz
        return ap


def scan(iface: str) -> list[ScannedAp]:
    """Trigger a scan and parse `iw dev <iface> scan`."""
    out = subprocess.run(
        ["iw", "dev", iface, "scan"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout

    aps: list[ScannedAp] = []
    bssid = ssid = ""
    freq = rssi = 0.0
    for line in out.splitlines():
        line = line.strip()
        m = re.match(r"^BSS ([0-9a-fA-F:]{17})", line)
        if m:
            if bssid:
                aps.append(ScannedAp(bssid, ssid, freq, rssi))
            bssid, ssid, freq, rssi = m.group(1), "", 0.0, 0.0
        elif line.startswith("freq:"):
            freq = float(line.split(":", 1)[1].strip())
        elif line.startswith("signal:"):
            rssi = float(line.split(":", 1)[1].strip().split()[0])
        elif line.startswith("SSID:"):
            ssid = line.split(":", 1)[1].strip()
    if bssid:
        aps.append(ScannedAp(bssid, ssid, freq, rssi))
    return aps


def connected_rssi(iface: str) -> float | None:
    """RSSI (dBm) of the currently associated AP, or None if not associated."""
    out = subprocess.run(["iw", "dev", iface, "link"], capture_output=True, text=True).stdout
    m = re.search(r"signal:\s*(-?\d+)\s*dBm", out)
    return float(m.group(1)) if m else None


def ap_rssi(iface: str, bssid: str) -> float | None:
    """Latest RSSI for a specific BSSID from a fresh scan."""
    for ap in scan(iface):
        if ap.bssid.lower() == bssid.lower():
            return ap.rssi
    return None
