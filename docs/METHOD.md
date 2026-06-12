# Ionity Metrification CSI — the method

A guided, repeatable calibration that turns a closed room and one chosen AP into
a localization model. The method is deliberately simple to perform with a phone
or an ESP32 and a tape measure.

## Frame

The chosen AP (router) is the **origin** of a local ENU frame:

- **x** → East (metres)
- **y** → North (metres)
- **z** → Up (metres)

A capture's ground-truth position is fully determined by the axis it belongs to.

## Procedure

Perform in a **closed, static room** — furniture, doors, and people unchanged
for the whole session, so multipath reflections are stable ("bounces the same in
and out").

### 1. Scan & choose the AP
Scan WiFi from the agent and pick the target SSID/BSSID. Place the agent **on or
touching the router** for the 0 m / 0 cm reference.

### 2. Distance axis (horizontal)
Lay a straight line out from the router along one of the eight compass headings
(**N, NE, E, SE, S, SW, W, NW**) and tag it. Capture at:

| Point | Distance |
|------|----------|
| 1 | **0 m** (at the router) |
| 2 | **1 m** |
| 3 | **2 m** |
| 4 | **3 m** |

This line becomes the model's distance reference and fixes the heading.

### 3. Height axis (vertical)
Directly **above** the router, capture at:

| Point | Height |
|------|--------|
| 1 | **0 cm** |
| 2 | **10 cm** |
| 3 | **20 cm** |
| 4 | **30 cm** |

### 4. Repetitions — the "3 hearts"
Each point is captured **3 times** (configurable), each a **multi-second dwell**
(default 4 s). Repetitions average out instantaneous noise and let the stability
gate verify the room held still.

### 5. Stability gate
A repetition is **accepted** only if:
- CSI **Hz-stability** ≥ threshold (default 0.6) — the channel response held
  steady across the dwell (CSI-capable agents), **and**
- RSSI standard deviation ≤ threshold (default 4 dBm).

Otherwise it is **rejected** and re-captured. This enforces the closed-room
assumption.

### 6. Model build
On completion the system:
- Fits a **log-distance path-loss** curve `RSSI = A − 10·n·log10(d)` from the
  distance points (RSSI ↔ distance).
- Stores z-scored **fingerprints** (feature vector ↔ ENU position) for every
  accepted capture.

The feature vector cross-references RSSI level/noise with **CSI Hz-stability** and
per-subcarrier amplitude — the core of the metrification idea.

## Inference

Anywhere in the room, an agent captures to the same AP and pings it as before.
The server estimates:
- **distance** from path-loss (fused with 802.11mc FTM when available),
- **heading + height** from kNN fingerprinting,

and streams a fused **position / distance / direction / height** to the 3D map,
updating at a set interval or on request, with a confidence score.

## Why these hardware constraints

True CSI is only available from ESP32, Nexmon, or Atheros radios. Stock phones
provide RSSI + 802.11mc FTM. The method is defined over a feature vector that
degrades gracefully: a CSI-rich agent uses amplitude + stability + RSSI; an
RSSI/FTM agent uses RSSI + FTM. No step of the method fabricates data.
