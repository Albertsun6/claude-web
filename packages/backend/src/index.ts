import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { runSession } from "./cli-runner.js";
import { subscribeFs } from "./fs-watcher.js";
import { subscribeSession } from "./session-watcher.js";
import { contextRouter } from "./routes/context.js";
import { fsRouter } from "./routes/fs.js";
import { healthRouter } from "./routes/health.js";
import { gitRouter } from "./routes/git.js";
import { voiceRouter } from "./routes/voice.js";
import { sessionsRouter } from "./routes/sessions.js";
import { projectsRouter } from "./routes/projects.js";
import { ensureScratchProject } from "./projects-store.js";
import { telemetryRouter } from "./routes/telemetry.js";
import {
  permissionRouter,
  registerPermissionChannel,
  resolvePermission,
} from "./routes/permission.js";
import { inboxRouter } from "./routes/inbox.js";
import { runsRouter } from "./routes/runs.js";
import { helpRouter } from "./routes/help.js";
import { harnessConfigRouter } from "./routes/harness-config.js";
import { harnessConfigEvents } from "./harness-config.js";
import { worktreesRouter, workRouter } from "./routes/worktrees.js";
import { buildNotificationHub, type NotificationContext, type SessionEndReason } from "./notifications/index.js";
import {
  recordSpawn as heartbeatRecordSpawn,
  recordCompletion as heartbeatRecordCompletion,
  setActiveRunCountFn as heartbeatSetActiveRunCountFn,
  setNotificationChannelCount as heartbeatSetNotificationChannelCount,
} from "./heartbeat.js";
import { register as registerRun, unregister as unregisterRun, activeCount as runRegistryActiveCount } from "./run-registry.js";
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

app.route("/api/context", contextRouter);
app.route("/api/fs", fsRouter);
app.route("/api/health", healthRouter);
app.route("/api/git", gitRouter);
app.route("/api/voice", voiceRouter);
app.route("/api/sessions", sessionsRouter);
app.route("/api/projects", projectsRouter);
app.route("/api/telemetry", telemetryRouter);
app.route("/api/permission", permissionRouter);
app.route("/api/inbox", inboxRouter);
app.route("/api/runs", runsRouter);
app.route("/api/help", helpRouter);
app.route("/api/harness/config", harnessConfigRouter);
app.route("/api/worktrees", worktreesRouter);
app.route("/api/work", workRouter);

// Notification hub: builds Server酱 / future channels from settings.
// Returns NoOpHub if no channels configured.
const notifyHub = buildNotificationHub();
heartbeatSetNotificationChannelCount(notifyHub.channelCount);

// Always-on scratch project — sticky-pinned no-cwd chat target.
ensureScratchProject().catch((err) => {
  console.warn("[backend] ensureScratchProject failed:", err);
});

// Track active runs across all WS clients so /health can report.
const allConnections = new Set<{ runs: Map<string, RunHandle> }>();
// Make active-run count visible to heartbeat snapshot.
heartbeatSetActiveRunCountFn(() => runRegistryActiveCount());
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

  // Cache index.html by mtime so a frontend rebuild while backend stays up
  // is picked up automatically. Tiny file → safe to re-read on miss.
  const indexPath = path.join(FRONTEND_DIST, "index.html");
  let indexCache: { mtimeMs: number; html: string; htmlGz: Buffer } | null = null;
  const loadIndex = () => {
    const st = statSync(indexPath);
    if (indexCache && indexCache.mtimeMs === st.mtimeMs) return indexCache;
    const html = readFileSync(indexPath, "utf-8");
    const htmlGz = gzipSync(Buffer.from(html, "utf-8"));
    indexCache = { mtimeMs: st.mtimeMs, html, htmlGz };
    return indexCache;
  };

  const sendIndex = (c: any) => {
    const { html, htmlGz } = loadIndex();
    const ae = c.req.header("accept-encoding") ?? "";
    if (ae.includes("gzip")) {
      return new Response(htmlGz as unknown as BodyInit, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
          "content-length": String(htmlGz.length),
          "cache-control": "no-cache",
        },
      });
    }
    return c.html(html);
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

// Broadcast harness_event{config_changed} to all connected WS clients when
// fallback-config.json is modified in-process (chokidar watch in harness-config.ts).
// tsx watch restart also reconnects iOS, but this covers the rare in-process path.
harnessConfigEvents.on("config_changed", () => {
  const msg: ServerMessage = { type: "harness_event", kind: "config_changed" };
  const payload = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
  console.log("[harness] config_changed broadcast to", wss.clients.size, "client(s)");
});

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

  // Per-connection fs watch subscriptions: cwd → unsubscribe.
  const fsSubs = new Map<string, () => void>();
  // Per-connection session jsonl tail subscriptions: "cwd::sid" → unsubscribe.
  const sessionSubs = new Map<string, () => void>();

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

    if (msg.type === "fs_subscribe") {
      const cwdErr = verifyAllowedPath(msg.cwd);
      if (cwdErr) {
        send({ type: "error", error: cwdErr });
        return;
      }
      if (fsSubs.has(msg.cwd)) return; // already subscribed
      const unsub = subscribeFs(msg.cwd, send);
      fsSubs.set(msg.cwd, unsub);
      return;
    }

    if (msg.type === "fs_unsubscribe") {
      const unsub = fsSubs.get(msg.cwd);
      if (unsub) {
        unsub();
        fsSubs.delete(msg.cwd);
      }
      return;
    }

    if (msg.type === "session_subscribe") {
      const cwdErr = verifyAllowedPath(msg.cwd);
      if (cwdErr) {
        send({ type: "error", error: cwdErr });
        return;
      }
      if (!/^[\w-]+$/.test(msg.sessionId)) {
        send({ type: "error", error: "invalid sessionId" });
        return;
      }
      const k = `${msg.cwd}::${msg.sessionId}`;
      if (sessionSubs.has(k)) return; // already subscribed on this connection
      const unsub = subscribeSession(msg.cwd, msg.sessionId, msg.fromByteOffset, send);
      sessionSubs.set(k, unsub);
      return;
    }

    if (msg.type === "session_unsubscribe") {
      const k = `${msg.cwd}::${msg.sessionId}`;
      const unsub = sessionSubs.get(k);
      if (unsub) {
        unsub();
        sessionSubs.delete(k);
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

      const notifyCtx: NotificationContext = {
        runId,
        cwd: msg.cwd,
        promptPreview: msg.prompt.slice(0, 80),
        agentName: "Claude",
      };

      const abort = new AbortController();
      const permissionToken = randomUUID();

      // wrap permission channel send so each permission_request carries this runId
      // AND fires a notification (Telegram / Server酱) so the user knows claude
      // has paused waiting for approval — they can decide whether to reach for
      // the iOS app right now or let it sit.
      const channelSend = (m: unknown) => {
        const obj = m as { type?: string; toolName?: string };
        if (obj?.type === "permission_request") {
          send({ ...(m as any), runId });
          void notifyHub.publishPermissionPending(notifyCtx, obj.toolName ?? "(unknown tool)");
        } else {
          send(m as ServerMessage);
        }
      };
      const unregisterPermission = registerPermissionChannel(permissionToken, channelSend);

      runs.set(runId, { abort, permissionToken, unregisterPermission });
      registerRun(runId, { abort, cwd: msg.cwd, prompt: msg.prompt, startedAt: Date.now() });
      heartbeatRecordSpawn();

      void (async () => {
        try {
          await runSession({
            prompt: msg.prompt,
            cwd: msg.cwd,
            model: msg.model,
            permissionMode: msg.permissionMode,
            resumeSessionId: msg.resumeSessionId,
            attachments: msg.attachments,
            permissionToken,
            backendBase: BACKEND_BASE,
            authToken: process.env.CLAUDE_WEB_TOKEN,
            signal: abort.signal,
            onMessage: (cliMsg) => {
              send({ type: "sdk_message", runId, message: cliMsg });
              const m = cliMsg as { type?: string; subtype?: string; sessionId?: string; session_id?: string };
              if (m?.type === "system" && m?.subtype === "init") {
                const sid = m.sessionId ?? m.session_id;
                if (sid) notifyCtx.sessionId = sid;
              }
            },
            onClearRunMessages: () => send({ type: "clear_run_messages", runId }),
          });
          const reason: SessionEndReason = abort.signal.aborted ? "interrupted" : "completed";
          send({ type: "session_ended", runId, reason });
          heartbeatRecordCompletion(reason);
          void notifyHub.publishSessionCompletion(notifyCtx, reason);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[session error]", err);
          send({ type: "error", runId, error: message });
          send({ type: "session_ended", runId, reason: "error" });
          heartbeatRecordCompletion("error");
          void notifyHub.publishSessionCompletion(notifyCtx, "error");
        } finally {
          unregisterPermission();
          runs.delete(runId);
          unregisterRun(runId);
          notifyHub.forgetRun(runId);
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
    for (const unsub of fsSubs.values()) unsub();
    fsSubs.clear();
    for (const unsub of sessionSubs.values()) unsub();
    sessionSubs.clear();
    allConnections.delete(conn);
  });
});
