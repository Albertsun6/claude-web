#!/usr/bin/env node
// Claude Code PreToolUse hook script.
//
// Reads the hook payload from stdin, POSTs it to the claude-web backend's
// /api/permission/ask endpoint (which forwards to the user's browser via
// WebSocket and waits for a click), and emits a hook-decision JSON to stdout.
//
// Usage (configured via --settings hooks): node permission-hook.mjs <token> <backendBase>

const [token, backendBase] = process.argv.slice(2);
if (!token || !backendBase) {
  console.error("permission-hook: missing token or backendBase");
  process.exit(1);
}

const allow = (reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        ...(reason ? { permissionDecisionReason: reason } : {}),
      },
    }),
  );
  process.exit(0);
};

const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason ?? "用户拒绝了该工具调用",
      },
    }),
  );
  process.exit(0);
};

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", async () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // bad payload: fail open with a note (otherwise tool always denied)
    return allow("hook payload parse failed");
  }
  try {
    const url = `${backendBase}/api/permission/ask?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return allow(`backend returned ${res.status}; failing open`);
    }
    const body = await res.json();
    if (body.decision === "deny") return deny(body.reason);
    return allow();
  } catch (err) {
    return allow(`backend unreachable: ${err?.message ?? err}; failing open`);
  }
});
