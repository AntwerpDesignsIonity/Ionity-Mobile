# ESP32 capture agent (real CSI)

ESP-IDF firmware that associates with an AP, enables native CSI, and publishes
real CSI + RSSI captures to the Ionity-CSI broker. The cheapest source of *true*
CSI and the "run from ESP later" target.

## Build & flash (ESP-IDF v5.x)

```bash
cd agents/esp32
idf.py set-target esp32          # or esp32s3 / esp32c3 / esp32c6
idf.py menuconfig                # → "Ionity-CSI Agent": SSID, password, MQTT URI, device id
idf.py build flash monitor
```

CSI requires `CONFIG_ESP_WIFI_CSI_ENABLED=y` (set in `sdkconfig.defaults`).

## How it talks to the system

- On boot it joins the AP, enables CSI, connects to MQTT, and publishes
  `ionity/<id>/status = idle`.
- It subscribes to `ionity/<id>/command`:

  ```bash
  # One labelled calibration capture (distance axis, 2 m East, pass 1):
  mosquitto_pub -h <broker> -t ionity/esp32-1/command -m \
    '{"action":"capture","sessionId":"<id>","label":{"axis":"distance","valueMeters":2,"direction":"E","repetition":0}}'

  # Continuous inference captures every second:
  mosquitto_pub -h <broker> -t ionity/esp32-1/command -m '{"action":"run","intervalMs":1000}'
  mosquitto_pub -h <broker> -t ionity/esp32-1/command -m '{"action":"stop"}'
  ```

- Each capture gathers up to `CONFIG_IONITY_MAX_FRAMES` CSI frames over the dwell
  window and publishes them as a `Capture` on `ionity/<id>/capture`.

## Notes

- Timestamps are milliseconds since boot (the ESP has no RTC); the server orders
  captures by arrival. Add SNTP if you need wall-clock time.
- CSI bytes are the ESP's interleaved `[imag, real]` int8 pairs, converted to
  amplitude/phase before publishing. HT20 yields up to 64 subcarriers.
