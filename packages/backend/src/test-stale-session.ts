// Test that a stale resumeSessionId triggers auto-retry without --resume.
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3030/ws");

let recovered = false;
let gotResult = false;

ws.on("open", () => {
  console.log("[test] sending with bogus session id");
  ws.send(JSON.stringify({
    type: "user_prompt",
    prompt: "回我一句：好的",
    cwd: process.cwd(),
    model: "claude-haiku-4-5",
    permissionMode: "bypassPermissions",
    resumeSessionId: "aa4ef8c4-dc55-4eed-a578-b5ea03dff30b", // doesn't exist
  }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "sdk_message") {
    const m = msg.message as any;
    if (m?.type === "system" && m?.subtype === "stale_session_recovered") {
      recovered = true;
      console.log("[test] ✓ stale_session_recovered signal received");
    }
    if (m?.type === "system" && m?.subtype === "init") {
      console.log(`[test] new session_id=${m.session_id}`);
    }
    if (m?.type === "result") {
      gotResult = true;
      console.log(`[test] result: ${m.result?.slice(0, 80)}`);
    }
  }
  if (msg.type === "session_ended") {
    console.log(`[test] DONE recovered=${recovered} gotResult=${gotResult}`);
    ws.close();
    process.exit(recovered && gotResult ? 0 : 1);
  }
  if (msg.type === "error") {
    console.error("[test] error:", msg.error);
    process.exit(1);
  }
});

setTimeout(() => { console.error("[test] timeout"); process.exit(1); }, 60_000);
