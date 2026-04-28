import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.albertsun6.claudeweb",
  appName: "Claude Web",
  // Bundled web assets — built by `pnpm build:ios`. Frontend lives in
  // capacitor://localhost (iOS) and talks to the Mac backend over HTTPS via
  // the absolute URL baked in at build time (VITE_API_URL / VITE_WS_URL).
  webDir: "dist",
  server: {
    iosScheme: "capacitor",
    // Allow WKWebView navigation/fetch/WS to your Mac's Tailscale URL.
    // Edit this list if your tailnet hostname changes.
    allowNavigation: [
      "mymac.tailcf3ccf.ts.net",
      "*.tailcf3ccf.ts.net",
      "localhost", // simulator dev only — fetch/WS to http://localhost:3030
    ],
    // localhost http allowed via Info.plist NSAllowsLocalNetworking; remote
    // URLs still go over HTTPS via Tailscale.
    cleartext: true,
  },
  ios: {
    contentInset: "always",
    // Loosens autoplay so TTS doesn't need a user gesture (we still keep the
    // unlock effect as defense in depth).
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
