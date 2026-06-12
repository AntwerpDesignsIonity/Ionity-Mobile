# Linux / Nexmon capture agent

Real CSI + RSSI capture on Linux, published to the Ionity-CSI broker. This is the
most portable agent and the reference for the protocol.

## Requirements

- Python 3.11+
- `iw` (nl80211 userspace) for scanning + RSSI
- A **CSI source**, one of:
  - **Nexmon CSI** on a supported Broadcom chip (Raspberry Pi 3B+/4 bcm43455c0,
    Nexus 5/6P, …) forwarding CSI UDP to port 5500 — see
    [nexmon_csi](https://github.com/seemoo-lab/nexmon_csi).
  - **Atheros CSI Tool** (ath9k) — forward its CSI to the same UDP port, or adapt
    `csi_nexmon.py` to its frame format.
- Without a CSI source the agent still runs and publishes **RSSI-only** captures
  (it never fabricates CSI).

## Install

```bash
cd agents/linux-nexmon
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Configure (env)

| Var | Default | Meaning |
|---|---|---|
| `IONITY_DEVICE_ID` | `linux-<host>` | Agent id |
| `IONITY_IFACE` | `wlan0` | WiFi interface |
| `IONITY_MQTT_HOST` / `IONITY_MQTT_PORT` | `localhost` / `1883` | Broker |
| `IONITY_SERVER_URL` | `http://localhost:8080` | Server REST (calibration) |
| `IONITY_CSI_UDP_PORT` | `5500` | Nexmon CSI UDP port |
| `IONITY_CSI_BW_MHZ` | `80` | Capture bandwidth (sets subcarrier count) |
| `IONITY_DWELL_S` | `4` | Dwell seconds per capture |

## Use

```bash
# 1. Scan + publish APs (so the dashboard lists them)
sudo -E python -m ionity_agent.cli scan

# 2. In the dashboard, start a calibration session for this device + an AP,
#    then walk it from the agent (point-by-point prompts):
python -m ionity_agent.cli calibrate --session <session-id>

# 3. After calibration, localize continuously:
python -m ionity_agent.cli run --bssid aa:bb:cc:dd:ee:ff --interval 1
```

`scan` needs `CAP_NET_ADMIN` (hence `sudo -E`). The Nexmon CSI parser targets the
common Broadcom UDP layout; adjust `csi_nexmon.py` for your firmware build if the
subcarrier count or header differ.
