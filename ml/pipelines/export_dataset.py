"""Read REAL accepted calibration captures from the server SQLite DB and build a
training dataset (features + ENU positions) for one AP.

Usage:
    python -m ml.pipelines.export_dataset --db ../data/ionity.sqlite [--ap <bssid>]
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys

# Allow running as a script from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from ml.features.extract import FeatureVector, extract_features, label_position  # noqa: E402


def pick_ap(con: sqlite3.Connection, ap: str | None) -> str:
    if ap:
        return ap
    row = con.execute(
        """SELECT ap_bssid, COUNT(*) c FROM captures
           WHERE accepted=1 AND label_json IS NOT NULL
           GROUP BY ap_bssid ORDER BY c DESC LIMIT 1""",
    ).fetchone()
    if not row:
        raise SystemExit("no accepted calibration captures found — run a real calibration first")
    return row[0]


def load_dataset(db_path: str, ap: str | None = None) -> dict:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    bssid = pick_ap(con, ap)

    ap_row = con.execute("SELECT * FROM aps WHERE bssid=?", (bssid,)).fetchone()
    rows = con.execute(
        """SELECT * FROM captures
           WHERE ap_bssid=? AND accepted=1 AND label_json IS NOT NULL
           ORDER BY id""",
        (bssid,),
    ).fetchall()
    con.close()

    samples = []
    direction = "N"
    for r in rows:
        label = json.loads(r["label_json"])
        measurement = json.loads(r["measurement_json"])
        fv: FeatureVector = extract_features(measurement)
        pos = label_position(label)
        if label["axis"] == "distance":
            direction = label.get("direction", direction)
        samples.append({"features": fv, "position": pos, "label": label})

    return {
        "ap": {
            "bssid": bssid,
            "ssid": ap_row["ssid"] if ap_row else "",
            "freqMhz": ap_row["freq_mhz"] if ap_row else 0.0,
            "bandwidthMhz": (ap_row["bandwidth_mhz"] if ap_row else None),
        },
        "direction": direction,
        "samples": samples,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True)
    p.add_argument("--ap")
    args = p.parse_args()
    ds = load_dataset(args.db, args.ap)
    print(f"AP {ds['ap']['ssid']} ({ds['ap']['bssid']}) · heading {ds['direction']} · {len(ds['samples'])} captures")
