import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // self-destroying: actively unregister any previously-installed SW.
    // We keep the manifest (added as a static file in public/) for iOS
    // "Add to Home Screen" PWA behavior — no caching, always network.
    VitePWA({
      selfDestroying: true,
      registerType: "autoUpdate",
      manifest: false,        // we ship a static manifest in /public
      injectManifest: { globPatterns: [] },
      workbox: { globPatterns: [] },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:3030",
      "/ws": { target: "ws://localhost:3030", ws: true },
    },
  },
});
