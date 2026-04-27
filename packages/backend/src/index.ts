import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { runSession } from "./cli-runner.js";
import { fsRouter } from "./routes/fs.js";
import { gitRouter } from "./routes/git.js";
import { voiceRouter } from "./routes/voice.js";
import { sessionsRouter } from "./routes/sessions.js";
import {
  permissionRouter,
  registerPermissionChannel,
  resolvePermission,
} from "./routes/permission.js";
import {
  authMiddleware,
  checkWsAuth,
  isAuthEnabled,
  isPathAllowlistEnabled,
  getAllowedRoots,
  verifyAllowedPath,
} from "./auth.js";
import type {
  ClientMessage,
  ServerMessage,
} from "@claude-web/shared";

const PORT = Number(process.env.PORT ?? 3030);
// Default-bind to localhost; only listen on all interfaces if BACKEND_HOST is set
// explicitly. Tailscale serve / reverse proxy handles external access.
const HOST = process.env.BACKEND_HOST ?? "127.0.0.1";
const BACKEND_BASE = process.env.BACKEND_BASE ?? `http://localhost:${PORT}`;

const app = new Hono();
// CORS allow Authorization so the frontend can attach a Bearer token.
app.use("*", cors({ origin: "*", allowHeaders: ["authorization", "content-type"] }));

// Public: liveness + a tiny capability advertisement (no secrets).
app.get("/health", (c) =>
  c.json({
    ok: true,
    authRequired: isAuthEnabled(),
    pathAllowlist: isPathAllowlistEnabled(),
    activeRuns: globalActiveRuns(),
    cliBin: process.env.CLAUDE_CLI ?? "claude",
  }),
);
app.get("/api/auth/info", (c) =>
  c.json({
    authRequired: isAuthEnabled(),
    pathAllowlist: isPathAllowlistEnabled(),
    allowedRoots: isPathAllowlistEnabled() ? getAllowedRoots() : [],
  }),
);

// Everything else under /api requires the token (when CLAUDE_WEB_TOKEN is set).
app.use("/api/*", authMiddleware);

app.route("/api/fs", fsRouter);
app.route("/api/git", gitRouter);
app.route("/api/voice", voiceRouter);
app.route("/api/sessions", sessionsRouter);
app.route("/api/permission", permissionRouter);

// Track active runs across all WS clients so /health can report.
const allConnections = new Set<{ runs: Map<string, RunHandle> }>();
function globalActiveRuns(): number {
  let n = 0;
  for (const c of allConnections) n += c.runs.size;
  return n;
}

// Serve the frontend production build, if present.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, "../../frontend/dist");
if (existsSync(FRONTEND_DIST)) {
  console.log(`[backend] serving frontend from ${FRONTEND_DIST}`);

  // in-memory cache of pre-gzipped static assets keyed by file path.
  // Wins big on cellular: 873KB JS → ~280KB over wire.
  const gzipCache = new Map<string, Buffer>();
  const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|webmanifest|map)$/i;
  const IMMUTABLE = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|svg)$/;

  const indexHtml = readFileSync(path.join(FRONTEND_DIST, "index.html"), "utf-8");
  const indexHtmlGz = gzipSync(Buffer.from(indexHtml, "utf-8"));

  const sendIndex = (c: any) => {
    const ae = c.req.header("accept-encoding") ?? "";
    if (ae.includes("gzip")) {
      return new Response(indexHtmlGz as unknown as BodyInit, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
          "content-length": String(indexHtmlGz.length),
          "cache-control": "no-cache",
        },
      });
    }
    return c.html(indexHtml);
  };

  app.use("/*", async (c, next) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/ws" || url.pathname === "/health") {
      return next();
    }
    // Root or any path without an extension → SPA index
    if (url.pathname === "/" || !/\.[a-z0-9]+$/i.test(url.pathname)) {
      return sendIndex(c);
    }

    const safe = path.normalize(url.pathname).replace(/^\/+/, "");
    const filePath = path.join(FRONTEND_DIST, safe);
    if (!filePath.startsWith(FRONTEND_DIST)) return next();

    if (!existsSync(filePath)) {
      // 404 for missing assets (don't fall back to index.html for asset-like requests)
      return c.text("not found", 404);
    }

    let body: Buffer;
    try { body = readFileSync(filePath); } catch { return next(); }

    const compressible = COMPRESSIBLE.test(filePath);
    const ae = c.req.header("accept-encoding") ?? "";
    const wantsGzip = compressible && ae.includes("gzip");

    let payload: Buffer = body;
    const headers: Record<string, string> = {};
    headers["cache-control"] = IMMUTABLE.test(url.pathname)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300";
    headers["content-type"] = mimeFor(filePath);

    if (wantsGzip) {
      let gz = gzipCache.get(filePath);
      if (!gz) { gz = gzipSync(body); gzipCache.set(filePath, gz); }
      payload = gz;
      headers["content-encoding"] = "gzip";
    }
    headers["content-length"] = String(payload.length);

    return new Response(payload as unknown as BodyInit, { headers });
  });
}

function mimeFor(p: string): string {
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json; charset=utf-8";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[backend] http  http://${info.address}:${info.port}`);
  console.log(`[backend] ws    ws://${info.address}:${info.port}/ws`);
  if (!isAuthEnabled()) {
    console.log("[backend] ⚠ no auth token — set CLAUDE_WEB_TOKEN before exposing.");
  }
  if (!isPathAllowlistEnabled()) {
    console.log("[backend] ⚠ no path allowlist — set CLAUDE_WEB_ALLOWED_ROOTS to limit cwd.");
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url?.split("?")[0] !== "/ws") {
    socket.destroy();
    return;
  }
  if (!checkWsAuth(req.url, req.headers.authorization as string | undefined)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

interface RunHandle {
  abort: AbortController;
  permissionToken: string;
  unregisterPermission: () => void;
}

wss.on("connection", (ws) => {
  console.log("[ws] client connected");
  const runs = new Map<string, RunHandle>();
  const conn = { runs };
  allConnections.add(conn);

  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.on("message", async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send({ type: "error", error: "invalid JSON" });
      return;
    }

    if (msg.type === "permission_reply") {
      // O(1) routing when client supplies runId; fall back to scan otherwise.
      if (msg.runId) {
        const handle = runs.get(msg.runId);
        if (handle) {
          resolvePermission(handle.permissionToken, msg.requestId, msg.decision);
          return;
        }
      }
      for (const handle of runs.values()) {
        resolvePermission(handle.permissionToken, msg.requestId, msg.decision);
      }
      return;
    }

    if (msg.type === "interrupt") {
      if (msg.runId) {
        runs.get(msg.runId)?.abort.abort();
      } else {
        for (const h of runs.values()) h.abort.abort();
      }
      return;
    }

    if (msg.type === "user_prompt") {
      const runId = msg.runId;

      // Defense-in-depth: even though /api routes check this, the WS path
      // accepts cwd directly — verify here too.
      const cwdErr = verifyAllowedPath(msg.cwd);
      if (cwdErr) {
        send({ type: "error", runId, error: cwdErr });
        send({ type: "session_ended", runId, reason: "error" });
        return;
      }

      const abort = new AbortController();
      const permissionToken = randomUUID();

      // wrap permission channel send so each permission_request carries this runId
      const channelSend = (m: unknown) => {
        const obj = m as { type?: string };
        if (obj?.type === "permission_request") {
          send({ ...(m as any), runId });
        } else {
          send(m as ServerMessage);
        }
      };
      const unregisterPermission = registerPermissionChannel(permissionToken, channelSend);

      runs.set(runId, { abort, permissionToken, unregisterPermission });

      void (async () => {
        try {
          await runSession({
            prompt: msg.prompt,
            cwd: msg.cwd,
            model: msg.model,
            permissionMode: msg.permissionMode,
            resumeSessionId: msg.resumeSessionId,
            permissionToken,
            backendBase: BACKEND_BASE,
            authToken: process.env.CLAUDE_WEB_TOKEN,
            signal: abort.signal,
            onMessage: (cliMsg) => send({ type: "sdk_message", runId, message: cliMsg }),
            onClearRunMessages: () => send({ type: "clear_run_messages", runId }),
          });
          send({ type: "session_ended", runId, reason: abort.signal.aborted ? "interrupted" : "completed" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[session error]", err);
          send({ type: "error", runId, error: message });
          send({ type: "session_ended", runId, reason: "error" });
        } finally {
          unregisterPermission();
          runs.delete(runId);
        }
      })();
    }
  });

  ws.on("close", () => {
    console.log("[ws] client disconnected");
    for (const h of runs.values()) {
      h.abort.abort();
      h.unregisterPermission();
    }
    runs.clear();
    allConnections.delete(conn);
  });
});
