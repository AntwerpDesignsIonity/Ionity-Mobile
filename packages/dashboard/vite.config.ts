import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard talks to the server's REST + WS. In dev, proxy them so the app
// can be served from Vite (5173) while the API runs on 8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: { outDir: "dist" },
});
