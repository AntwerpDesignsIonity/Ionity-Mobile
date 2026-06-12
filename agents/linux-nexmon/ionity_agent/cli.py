"""Command-line entrypoint for the Linux capture agent.

Subcommands:
  scan       Scan APs and publish them (so the dashboard can list them).
  run        Continuously capture a chosen AP and publish inference captures.
  calibrate  Walk a server-created calibration session point-by-point.
"""
from __future__ import annotations

import argparse
import sys
import time

import requests

from .capture import Capturer
from .config import AgentConfig
from .csi_nexmon import NexmonCsiSource
from .mqtt_client import MqttPublisher
from .protocol import build_capture, build_status, topic_capture, topic_status
from .scan import ScannedAp, scan


def _open_csi(cfg: AgentConfig) -> NexmonCsiSource | None:
    try:
        return NexmonCsiSource(cfg.csi_udp_port, cfg.csi_bandwidth_mhz)
    except OSError as exc:
        print(f"[warn] no CSI source on UDP {cfg.csi_udp_port} ({exc}); RSSI-only captures", file=sys.stderr)
        return None


def _resolve_ap(cfg: AgentConfig, bssid: str) -> dict:
    for ap in scan(cfg.iface):
        if ap.bssid.lower() == bssid.lower():
            return ap.to_protocol(cfg.csi_bandwidth_mhz)
    raise SystemExit(f"AP {bssid} not found in scan on {cfg.iface}")


def cmd_scan(cfg: AgentConfig) -> None:
    pub = MqttPublisher(cfg.mqtt_host, cfg.mqtt_port, cfg.device_id)
    pub.connect()
    aps: list[ScannedAp] = scan(cfg.iface)
    aps.sort(key=lambda a: a.rssi, reverse=True)
    for ap in aps:
        print(f"{ap.rssi:6.0f} dBm  {ap.bssid}  {ap.freq_mhz:.0f} MHz  {ap.ssid}")
    pub.publish(
        topic_status(cfg.device_id),
        build_status(cfg.device_id, "scanning", int(time.time() * 1000),
                     scan=[a.to_protocol(cfg.csi_bandwidth_mhz) for a in aps]),
    )
    time.sleep(0.5)
    pub.close()


def cmd_run(cfg: AgentConfig, bssid: str, interval: float) -> None:
    csi = _open_csi(cfg)
    cap = Capturer(cfg, csi)
    pub = MqttPublisher(cfg.mqtt_host, cfg.mqtt_port, cfg.device_id)
    pub.connect()
    ap = _resolve_ap(cfg, bssid)
    print(f"[run] localizing against {ap['ssid']} ({bssid}); Ctrl-C to stop")
    try:
        while True:
            start, end, rssi, frames = cap.dwell(bssid)
            if not rssi and not frames:
                print("[warn] no measurements this window — check iface/CSI source", file=sys.stderr)
            pub.publish(topic_capture(cfg.device_id), build_capture(cfg.device_id, ap, start, end, rssi, frames))
            time.sleep(interval)
    except KeyboardInterrupt:
        pass
    finally:
        pub.close()
        if csi:
            csi.close()


def cmd_calibrate(cfg: AgentConfig, session_id: str) -> None:
    s = requests.get(f"{cfg.server_url}/api/sessions/{session_id}", timeout=5).json()
    if "error" in s:
        raise SystemExit(f"session error: {s['error']}")
    bssid = s["apBssid"]
    ap = _resolve_ap(cfg, bssid)
    csi = _open_csi(cfg)
    cap = Capturer(cfg, csi)
    pub = MqttPublisher(cfg.mqtt_host, cfg.mqtt_port, cfg.device_id)
    pub.connect()

    print(f"[calibrate] session {session_id} · AP {ap['ssid']} · heading {s['direction']}")
    try:
        while not s.get("complete"):
            step = s.get("current")
            if step is None:
                break
            axis, val, rep = step["axis"], step["valueMeters"], step["repetition"]
            if axis == "distance":
                where = "on/touching the router" if val == 0 else f"{val} m {step['direction']} of the router"
            else:
                where = "on the router" if val == 0 else f"{round(val * 100)} cm above the router"
            input(f"  → Place device {where} (pass {rep + 1}). Press Enter when steady…")

            label = {"axis": axis, "valueMeters": val, "repetition": rep}
            if axis == "distance":
                label["direction"] = step["direction"]

            start, end, rssi, frames = cap.dwell(bssid)
            pub.publish(
                topic_capture(cfg.device_id),
                build_capture(cfg.device_id, ap, start, end, rssi, frames, label=label, session_id=session_id),
            )

            prev_index = step["index"]
            s = _wait_for_advance(cfg, session_id, prev_index)
            if s.get("current") and s["current"]["index"] == prev_index:
                print("    [rejected] room not static / too short — recapturing this point")
        print("[calibrate] complete — model trained on the server.")
    except KeyboardInterrupt:
        print("\n[calibrate] interrupted")
    finally:
        pub.close()
        if csi:
            csi.close()


def _wait_for_advance(cfg: AgentConfig, session_id: str, prev_index: int, timeout_s: float = 8.0) -> dict:
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        last = requests.get(f"{cfg.server_url}/api/sessions/{session_id}", timeout=5).json()
        if last.get("complete") or (last.get("current") and last["current"]["index"] != prev_index):
            return last
        time.sleep(0.5)
    return last or {}


def main(argv: list[str] | None = None) -> None:
    cfg = AgentConfig.from_env()
    parser = argparse.ArgumentParser(prog="ionity-agent", description="Ionity-CSI Linux capture agent")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("scan", help="scan + publish APs")

    run_p = sub.add_parser("run", help="continuous inference captures")
    run_p.add_argument("--bssid", required=True)
    run_p.add_argument("--interval", type=float, default=1.0)

    cal_p = sub.add_parser("calibrate", help="walk a server calibration session")
    cal_p.add_argument("--session", required=True)

    args = parser.parse_args(argv)
    if args.cmd == "scan":
        cmd_scan(cfg)
    elif args.cmd == "run":
        cmd_run(cfg, args.bssid, args.interval)
    elif args.cmd == "calibrate":
        cmd_calibrate(cfg, args.session)


if __name__ == "__main__":
    main()
