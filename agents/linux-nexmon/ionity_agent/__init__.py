"""Ionity-CSI Linux capture agent (Nexmon / Atheros CSI + RSSI → MQTT).

Captures REAL channel measurements only. If no CSI source is reachable the agent
reports RSSI-only captures; it never fabricates CSI or RSSI samples.
"""

__version__ = "0.1.0"
