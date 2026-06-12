"""Insert a trained MetrificationModel JSON into the server SQLite DB as the
active model for its AP (source='ml'). The running server then localizes new
captures against it immediately.

Usage:
    python -m ml.pipelines.publish_model --db ../data/ionity.sqlite --model models/model_xxx.json
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import time


def publish(db_path: str, model_path: str) -> None:
    with open(model_path) as fh:
        model = json.load(fh)
    bssid = model["ap"]["bssid"]

    con = sqlite3.connect(db_path)
    try:
        con.execute("UPDATE models SET active=0 WHERE ap_bssid=?", (bssid,))
        con.execute(
            """INSERT INTO models (ap_bssid, direction, model_json, n_fingerprints, source, active, created_at)
               VALUES (?, ?, ?, ?, 'ml', 1, ?)""",
            (bssid, model["direction"], json.dumps(model), len(model["fingerprints"]), int(time.time() * 1000)),
        )
        con.commit()
    finally:
        con.close()
    print(f"published ML model for {bssid} as active")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True)
    p.add_argument("--model", required=True)
    publish(*vars(p.parse_args()).values())
