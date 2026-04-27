// End-to-end smoke test for the per-tool permission flow.
// Connects to the running backend WebSocket, asks Claude to run `pwd`,
// expects a permission_request, replies allow, and prints the tool result.
//
// Prereq: backend already running on PORT 3030.

import WebSocket from "ws";

const WS_URL = "ws://localhost:3030/ws";
const ws = new WebSocket(WS_URL);

let permissionsAsked = 0;
let toolResults = 0;

ws.on("open", () => {
  console.log("[test] connected");
  ws.send(
    JSON.stringify({
      type: "user_prompt",
      prompt: "请用 Bash 工具执行 pwd 命令并把结果告诉我。",
      cwd: process.cwd(),
      model: "claude-haiku-4-5",
      permissionMode: "default",
    }),
  );
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "permission_request") {
    permissionsAsked++;
    const decision = process.env.DECISION === "deny" ? "deny" : "allow";
    console.log(`[test] permission_request #${permissionsAsked}: ${msg.toolName} → ${decision}`);
    ws.send(JSON.stringify({ type: "permission_reply", requestId: msg.requestId, decision }));
    return;
  }

  if (msg.type === "sdk_message") {
    const m = msg.message as any;
    if (m?.type === "user" && m.message?.content) {
      for (const block of m.message.content) {
        if (block?.type === "tool_result") {
          toolResults++;
          const text = typeof block.content === "string"
            ? block.content
            : block.content?.[0]?.text ?? JSON.stringify(block.content).slice(0, 100);
          console.log(`[test] tool_result: ${text.slice(0, 120)}`);
        }
      }
    }
    if (m?.type === "result") {
      console.log(`[test] DONE permissions=${permissionsAsked} toolResults=${toolResults}`);
      console.log(`[test] final: ${m.result?.slice(0, 200)}`);
      ws.close();
      process.exit(permissionsAsked > 0 ? 0 : 1);
    }
  }

  if (msg.type === "error") {
    console.error("[test] error:", msg.error);
    process.exit(1);
  }
});

ws.on("close", () => console.log("[test] disconnected"));
ws.on("error", (err) => {
  console.error("[test] ws error", err);
  process.exit(1);
});

setTimeout(() => {
  console.error("[test] timeout");
  process.exit(1);
}, 60_000);
