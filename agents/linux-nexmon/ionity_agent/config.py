"""Agent configuration from environment / CLI."""
from __future__ import annotations

import os
import socket
from dataclasses import dataclass


@dataclass
class AgentConfig:
    device_id: str
    iface: str
    mqtt_host: str
    mqtt_port: int
    server_url: str
    csi_udp_port: int
    csi_bandwidth_mhz: int
    dwell_seconds: float

    @staticmethod
    def from_env() -> "AgentConfig":
        return AgentConfig(
            device_id=os.environ.get("IONITY_DEVICE_ID", f"linux-{socket.gethostname()}"),
            iface=os.environ.get("IONITY_IFACE", "wlan0"),
            mqtt_host=os.environ.get("IONITY_MQTT_HOST", "localhost"),
            mqtt_port=int(os.environ.get("IONITY_MQTT_PORT", "1883")),
            server_url=os.environ.get("IONITY_SERVER_URL", "http://localhost:8080"),
            csi_udp_port=int(os.environ.get("IONITY_CSI_UDP_PORT", "5500")),
            csi_bandwidth_mhz=int(os.environ.get("IONITY_CSI_BW_MHZ", "80")),
            dwell_seconds=float(os.environ.get("IONITY_DWELL_S", "4")),
        )
