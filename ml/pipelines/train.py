"""Train a Metrification model from real calibration captures and export it in the
exact JSON shape the server loads (`MetrificationModel`), so ML-trained models are
drop-in replacements for the built-in calibration fit.

Cross-references RSSI (path-loss) with CSI Hz-stability via the shared feature
vector, evaluates leave-one-out kNN position error, and writes the model.

Usage:
    python -m ml.pipelines.train --db ../data/ionity.sqlite --out models/ [--k 3]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from ml.features.extract import fit_path_loss  # noqa: E402
from ml.pipelines.export_dataset import load_dataset  # noqa: E402


def build_model(dataset: dict, k: int = 3) -> dict:
    samples = dataset["samples"]
    include_csi = any(s["features"].csi_amp_mean for s in samples)
    raw = [s["features"].to_array(include_csi) for s in samples]
    feature_length = min(len(a) for a in raw)
    arrays = np.array([a[:feature_length] for a in raw], dtype=float)

    mu = arrays.mean(axis=0)
    sigma = arrays.std(axis=0, ddof=1) if arrays.shape[0] > 1 else np.ones(feature_length)
    sigma = np.where(sigma > 1e-12, sigma, 1.0)

    fingerprints = [
        {"feature": arrays[i].tolist(), "position": {"x": p[0], "y": p[1], "z": p[2]}}
        for i, p in enumerate(s["position"] for s in samples)
    ]

    dist_samples = [(s["label"]["valueMeters"], s["features"].rssi_mean) for s in samples if s["label"]["axis"] == "distance"]
    path_loss = fit_path_loss([d for d, _ in dist_samples], [r for _, r in dist_samples])

    return {
        "version": 1,
        "ap": dataset["ap"],
        "direction": dataset["direction"],
        "pathLoss": path_loss,
        "fingerprints": fingerprints,
        "includeCsi": include_csi,
        "featureLength": feature_length,
        "mu": mu.tolist(),
        "sigma": sigma.tolist(),
        "k": max(1, min(k, len(fingerprints))),
        "createdAt": int(time.time() * 1000),
    }


def evaluate_loo(model: dict) -> dict:
    """Leave-one-out kNN position error over the fingerprints (metres)."""
    fps = model["fingerprints"]
    if len(fps) <= model["k"]:
        return {"loo_rmse_m": None, "n": len(fps)}
    X = np.array([f["feature"] for f in fps], dtype=float)
    P = np.array([[f["position"]["x"], f["position"]["y"], f["position"]["z"]] for f in fps], dtype=float)
    mu = np.array(model["mu"]); sigma = np.array(model["sigma"])
    Z = (X - mu) / sigma
    errs = []
    for i in range(len(fps)):
        d = np.linalg.norm(Z - Z[i], axis=1)
        d[i] = np.inf
        nn = np.argsort(d)[: model["k"]]
        w = 1.0 / (d[nn] + 1e-6)
        est = (P[nn] * w[:, None]).sum(axis=0) / w.sum()
        errs.append(float(np.linalg.norm(est - P[i])))
    return {"loo_rmse_m": float(np.sqrt(np.mean(np.square(errs)))), "n": len(fps)}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True)
    p.add_argument("--ap")
    p.add_argument("--out", default="models")
    p.add_argument("--k", type=int, default=3)
    args = p.parse_args()

    ds = load_dataset(args.db, args.ap)
    model = build_model(ds, k=args.k)
    metrics = evaluate_loo(model)

    os.makedirs(args.out, exist_ok=True)
    safe = model["ap"]["bssid"].replace(":", "")
    path = os.path.join(args.out, f"model_{safe}.json")
    with open(path, "w") as fh:
        json.dump(model, fh)

    print(f"trained model for {model['ap']['ssid']} ({model['ap']['bssid']})")
    print(f"  fingerprints : {len(model['fingerprints'])}")
    print(f"  path-loss    : n={model['pathLoss']['exponent']:.2f}  r2={model['pathLoss']['r2']:.3f}")
    print(f"  LOO RMSE     : {metrics['loo_rmse_m']}")
    print(f"  written      : {path}")
    print("Publish with: python -m ml.pipelines.publish_model --db <db> --model " + path)


if __name__ == "__main__":
    main()
