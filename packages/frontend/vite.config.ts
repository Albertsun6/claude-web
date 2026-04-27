import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "claude-web",
        short_name: "Claude",
        description: "Mobile-friendly UI for the Claude CLI",
        theme_color: "#0f1115",
        background_color: "#0f1115",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        // never cache the websocket or backend API; only the static shell
        navigateFallbackDenylist: [/^\/ws/, /^\/api/],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true, // accept cloudflare tunnel / tailscale hostnames
    proxy: {
      "/api": "http://localhost:3030",
      "/ws": { target: "ws://localhost:3030", ws: true },
    },
  },
});
