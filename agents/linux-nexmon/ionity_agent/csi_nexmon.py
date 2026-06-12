"""Nexmon CSI reader.

nexmon_csi forwards CSI as UDP datagrams (default port 5500). Each datagram
carries a small header followed by the per-subcarrier channel response as
interleaved int16 I/Q pairs. This module listens for those datagrams and turns
them into amplitude/phase frames matching the Ionity protocol.

The exact byte layout depends on the chip/firmware build of nexmon_csi; the
parser below targets the common Broadcom layout (bcm43455c0 / Raspberry Pi,
Nexus 5, etc.) and is deliberately defensive: malformed packets are skipped, not
guessed. Set the bandwidth so the expected subcarrier count is known.

Reference: github.com/seemoo-lab/nexmon_csi
"""
from __future__ import annotations

import socket
import struct
import time

import numpy as np

# Subcarriers per channel bandwidth (802.11 FFT sizes).
SUBCARRIERS = {20: 64, 40: 128, 80: 256, 160: 512}

# nexmon_csi UDP payload: 18-byte header then int16 I/Q pairs.
#   magic(2) | rssi(1,int8) | fctl(1) | src_mac(6) | seq(2) | core_spatial(2) |
#   chanspec(2) | chip_version(2) | csi(int16 I,Q * n_sub)
_HEADER = struct.Struct("<H b B 6s H H H H")
_NEXMON_MAGIC = 0x1111


class NexmonCsiSource:
    def __init__(self, udp_port: int, bandwidth_mhz: int):
        self.n_sub = SUBCARRIERS.get(bandwidth_mhz, 256)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("0.0.0.0", udp_port))
        self.sock.settimeout(0.5)
        self.bandwidth_mhz = bandwidth_mhz

    def close(self) -> None:
        self.sock.close()

    def read_frame(self) -> dict | None:
        """Read one CSI datagram → protocol CsiFrame dict, or None on timeout."""
        try:
            data, _addr = self.sock.recvfrom(4096)
        except socket.timeout:
            return None
        return self._parse(data)

    def _parse(self, data: bytes) -> dict | None:
        if len(data) < _HEADER.size:
            return None
        magic, rssi, _fctl, _mac, _seq, _core, _chanspec, _chip = _HEADER.unpack_from(data, 0)
        if magic != _NEXMON_MAGIC:
            return None
        body = data[_HEADER.size:]
        # int16 I/Q pairs; clamp to the expected subcarrier count.
        count = min(len(body) // 4, self.n_sub)
        if count == 0:
            return None
        iq = np.frombuffer(body[: count * 4], dtype=np.int16).astype(np.float64)
        i = iq[0::2]
        q = iq[1::2]
        amplitude = np.hypot(i, q)
        phase = np.arctan2(q, i)
        return {
            "ts": int(time.time() * 1000),
            "amplitude": amplitude.tolist(),
            "phase": phase.tolist(),
            "rssi": float(rssi),
            "bandwidthMhz": self.bandwidth_mhz,
        }
