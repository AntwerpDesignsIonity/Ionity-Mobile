# ML pipeline

Trains a localization model from **real** calibration captures stored in the
server's SQLite DB and exports it in the exact JSON shape the server loads
(`MetrificationModel`), so an ML-trained model is a drop-in replacement for the
built-in calibration fit.

```
features/extract.py        Feature + geometry mirror of @ionity/metrification
pipelines/export_dataset.py  SQLite (accepted captures) → dataset
pipelines/train.py           Build model JSON + leave-one-out RMSE
pipelines/publish_model.py   Insert model into server DB as the active model
data/                        Real exports only (gitignored)
models/                      Exported model artifacts (gitignored)
notebooks/                   Analysis (no synthetic data)
```

## Install & run

```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Train from real captures (requires a completed calibration in the DB):
python -m ml.pipelines.train --db ../data/ionity.sqlite --out models/

# Push the trained model to the running server (becomes active immediately):
python -m ml.pipelines.publish_model --db ../data/ionity.sqlite --model models/model_<bssid>.json
```

`train.py` cross-references RSSI (log-distance path loss) with CSI Hz-stability
through the shared feature vector, evaluates leave-one-out kNN position error,
and prints the path-loss exponent + R². There is **no synthetic data path**: if
the DB has no accepted calibration captures, the pipeline stops.

## Parity

`features/extract.py` is kept in lock-step with the TypeScript
`@ionity/metrification` feature extraction. If you change the feature vector in
one, change it in both — the verification step checks they agree.
