import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { runSession } from "./cli-runner.js";
import { fsRouter } from "./routes/fs.js";
import { gitRouter } from "./routes/git.js";
import { realtimeRouter } from "./routes/realtime.js";
import { voiceRouter } from "./routes/voice.js";
import {
  permissionRouter,
  registerPermissionChannel,
  resolvePermission,
} from "./routes/permission.js";
import type {
  ClientMessage,
  ServerMessage,
} from "@claude-web/shared";

const PORT = Number(process.env.PORT ?? 3030);
const BACKEND_BASE = process.env.BACKEND_BASE ?? `http://localhost:${PORT}`;

const app = new Hono();
app.use("*", cors());
app.get("/health", (c) => c.json({ ok: true }));
app.route("/api/fs", fsRouter);
app.route("/api/git", gitRouter);
app.route("/api/realtime", realtimeRouter);
app.route("/api/voice", voiceRouter);
app.route("/api/permission", permissionRouter);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[backend] http  http://localhost:${info.port}`);
  console.log(`[backend] ws    ws://localhost:${info.port}/ws`);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws") {
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
      // permission token is per-run; iterate to find the one with this requestId
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
      const abort = new AbortController();
      const permissionToken = randomUUID();

      const sendForRun = (toolName: string, input: unknown) => {
        send({
          type: "permission_request",
          runId,
          requestId: randomUUID(), // unused (resolver uses its own); we keep a stable shape
          toolName,
          input,
        });
      };
      void sendForRun;

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
            signal: abort.signal,
            onMessage: (cliMsg) => send({ type: "sdk_message", runId, message: cliMsg }),
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
  });
});
