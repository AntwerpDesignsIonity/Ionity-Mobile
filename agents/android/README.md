# Android capture agent (RSSI + 802.11mc FTM)

Native Kotlin/Compose app that scans WiFi, walks a calibration session, and runs
inference captures. **Stock Android exposes RSSI and 802.11mc FTM ranging only —
never true CSI** (that needs ESP32 or a rooted Nexmon device). The agent reports
real RSSI samples and, on FTM-capable hardware, a real distance estimate.

## Build

Open `agents/android` in Android Studio (or `./gradlew :app:assembleDebug`).
Requires a Gradle wrapper — generate once with `gradle wrapper` if absent.

- `minSdk 28` (WifiRttManager / FTM)
- Permissions: `ACCESS_FINE_LOCATION`, `NEARBY_WIFI_DEVICES` (granted at launch)

## Use

1. Set **Device id**, **MQTT host**, and **Server URL** to your server/broker.
2. **Scan** — lists APs and publishes them to the dashboard.
3. Tap the target AP (router).
4. In the dashboard, start a calibration session for this device + AP; paste the
   **session id** into the app.
5. **Capture point** at each prompted location (0/1/2/3 m, then 0/10/20/30 cm).
   The app fetches the current step from the server, captures a 4 s dwell + FTM
   range, and publishes a labelled capture.
6. After completion, **Run** streams inference captures for live localization.

## Notes

- Android throttles background scans; for rapid inference, foreground use and
  developer "WiFi scan throttling = off" help.
- FTM accuracy depends on the AP advertising 802.11mc responder support.
- A Gradle wrapper and app icon are intentionally omitted; add them when opening
  the project in Android Studio.
