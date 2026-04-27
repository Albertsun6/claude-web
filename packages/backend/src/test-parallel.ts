// Smoke test: kick off two prompts in parallel via one WS, verify both complete.
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3030/ws");
const runs: Record<string, { name: string; ended: boolean; got: number }> = {
  "run-A": { name: "A (haiku, says hello)", ended: false, got: 0 },
  "run-B": { name: "B (haiku, says world)", ended: false, got: 0 },
};

ws.on("open", () => {
  console.log("[test] sending two prompts in parallel");
  ws.send(JSON.stringify({
    type: "user_prompt",
    runId: "run-A",
    prompt: "回我一句：hello A",
    cwd: process.cwd(),
    model: "claude-haiku-4-5",
    permissionMode: "bypassPermissions",
  }));
  ws.send(JSON.stringify({
    type: "user_prompt",
    runId: "run-B",
    prompt: "回我一句：hello B",
    cwd: process.cwd(),
    model: "claude-haiku-4-5",
    permissionMode: "bypassPermissions",
  }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "sdk_message") {
    const r = runs[msg.runId];
    if (!r) return;
    r.got++;
    const m = msg.message as any;
    if (m?.type === "result") {
      console.log(`[${msg.runId}] result: ${(m.result || "").slice(0, 40)}`);
    }
  }
  if (msg.type === "session_ended") {
    const r = runs[msg.runId];
    if (r) {
      r.ended = true;
      console.log(`[${msg.runId}] ended (${r.name})`);
    }
    if (Object.values(runs).every((x) => x.ended)) {
      console.log("[test] both runs done");
      ws.close();
      process.exit(0);
    }
  }
  if (msg.type === "error") {
    console.error("[test] error", msg);
    process.exit(1);
  }
});

setTimeout(() => { console.error("[test] timeout"); process.exit(1); }, 60_000);
