# @ionity/dashboard

Realtime 3D map + calibration wizard for Ionity-CSI (React + Three.js via
react-three-fiber). Runs on the device that hosts the server; renders the AP at
the origin and live device tracks in the local ENU frame.

```bash
npm run dev --workspace @ionity/dashboard     # Vite on :5173, proxies /api + /ws → :8080
npm run build --workspace @ionity/dashboard   # emits dist/, auto-served by the server
```

- **Calibration wizard** — choose agent + scanned AP + heading, start a session,
  follow point-by-point instructions (0/1/2/3 m, then 0/10/20/30 cm), with live
  accept/reject feedback streamed from the server.
- **3D scene** — AP at origin, ENU axes + compass, nominal calibration points,
  a pulsing target for the current step, and live device spheres with movement
  trails updated from `/ws` localization events.

The map stays empty until real captures arrive — no demo/placeholder tracks.
