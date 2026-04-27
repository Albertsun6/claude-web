import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { runSession } from "./cli-runner.js";
import type {
  ClientMessage,
  ServerMessage,
} from "@claude-web/shared";

const PORT = Number(process.env.PORT ?? 3000);

const app = new Hono();
app.use("*", cors());
app.get("/health", (c) => c.json({ ok: true }));

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

wss.on("connection", (ws) => {
  console.log("[ws] client connected");
  let abort = new AbortController();

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

    if (msg.type === "interrupt") {
      abort.abort();
      abort = new AbortController();
      return;
    }

    // permission_reply is a no-op in v1 (CLI handles permissions via --permission-mode)
    if (msg.type === "permission_reply") {
      return;
    }

    if (msg.type === "user_prompt") {
      try {
        await runSession({
          prompt: msg.prompt,
          cwd: msg.cwd,
          model: msg.model,
          permissionMode: msg.permissionMode,
          resumeSessionId: msg.resumeSessionId,
          signal: abort.signal,
          onMessage: (cliMsg) => send({ type: "sdk_message", message: cliMsg }),
        });
        send({ type: "session_ended", reason: "completed" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[session error]", err);
        send({ type: "error", error: message });
        send({ type: "session_ended", reason: "error" });
      }
    }
  });

  ws.on("close", () => {
    console.log("[ws] client disconnected");
    abort.abort();
  });
});
