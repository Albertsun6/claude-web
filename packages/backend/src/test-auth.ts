// Auth + path-allowlist E2E. Spawns a second backend on :3031 with
// CLAUDE_WEB_TOKEN + CLAUDE_WEB_ALLOWED_ROOTS set, runs probes, kills it.

import { spawn } from "node:child_process";
import path from "node:path";
import WebSocket from "ws";

const PORT = 3031;
const BASE = `http://localhost:${PORT}`;
const TOKEN = "test-token-" + Math.random().toString(36).slice(2, 10);
const REPO = path.resolve(import.meta.dirname ?? __dirname, "../../..");
const ALLOWED = `${REPO}:/tmp`;

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

async function waitFor(url: string, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* retrying */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

(async () => {
  console.log(`Starting auth-gated backend on :${PORT}…`);
  const child = spawn("tsx", ["src/index.ts"], {
    cwd: path.resolve(import.meta.dirname ?? __dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      CLAUDE_WEB_TOKEN: TOKEN,
      CLAUDE_WEB_ALLOWED_ROOTS: ALLOWED,
      BACKEND_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (b) => process.stderr.write(`  [bg] ${b}`));

  try {
    const up = await waitFor(`${BASE}/health`);
    if (!up) { console.error("backend never came up"); process.exit(1); }

    // /health is public
    const h = await fetch(`${BASE}/health`).then((r) => r.json()) as any;
    check("health public, no token", true);
    check("health.authRequired = true", h.authRequired === true);
    check("health.pathAllowlist = true", h.pathAllowlist === true);

    // /api/* without token → 401
    const r1 = await fetch(`${BASE}/api/fs/home`);
    check("api without token → 401", r1.status === 401);

    // wrong token → 401
    const r2 = await fetch(`${BASE}/api/fs/home`, {
      headers: { authorization: "Bearer wrong" },
    });
    check("api wrong token → 401", r2.status === 401);

    // good token via header → 200
    const r3 = await fetch(`${BASE}/api/fs/home`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    check("api good token (header) → 200", r3.status === 200);

    // good token via ?token= → 200
    const r4 = await fetch(`${BASE}/api/fs/home?token=${TOKEN}`);
    check("api good token (query) → 200", r4.status === 200);

    // path allowlist: REPO is allowed
    const r5 = await fetch(`${BASE}/api/fs/tree?root=${encodeURIComponent(REPO)}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    check("fs/tree allowed root → 200", r5.status === 200);

    // path NOT in allowlist → 403
    const r6 = await fetch(`${BASE}/api/fs/tree?root=${encodeURIComponent("/etc")}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    check("fs/tree non-allowed root → 403", r6.status === 403);

    // git on disallowed cwd → 403
    const r7 = await fetch(`${BASE}/api/git/status?cwd=${encodeURIComponent("/usr/local")}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    check("git/status non-allowed → 403", r7.status === 403);

    // sessions list non-allowed → 403
    const r8 = await fetch(`${BASE}/api/sessions/list?cwd=${encodeURIComponent("/etc")}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    check("sessions/list non-allowed → 403", r8.status === 403);

    // WS upgrade without token → 401
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      ws.on("error", () => resolve());
      ws.on("close", () => resolve());
      ws.on("unexpected-response", (_req, res) => {
        check("ws no token → 401", res.statusCode === 401);
        resolve();
      });
      ws.on("open", () => { check("ws no token → 401", false, "got open instead"); ws.close(); resolve(); });
      setTimeout(resolve, 3000);
    });

    // WS upgrade with token → opens
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${TOKEN}`);
      ws.on("open", () => { check("ws good token → connects", true); ws.close(); resolve(); });
      ws.on("error", (err) => { check("ws good token → connects", false, err.message); resolve(); });
      setTimeout(() => { check("ws good token → connects", false, "timeout"); resolve(); }, 4000);
    });

    // WS user_prompt for non-allowed cwd → error
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${TOKEN}`);
      let gotErr = false;
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "error" && /allowed root/i.test(m.error)) gotErr = true;
        if (m.type === "session_ended") {
          check("ws user_prompt non-allowed cwd → error", gotErr);
          ws.close();
          resolve();
        }
      });
      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "user_prompt", runId: "auth-test-1",
          prompt: "hi", cwd: "/etc",
          model: "claude-haiku-4-5", permissionMode: "bypassPermissions",
        }));
      });
      setTimeout(() => { check("ws non-allowed cwd → error", gotErr, "timeout"); ws.close(); resolve(); }, 8000);
    });
  } finally {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000);
  }

  console.log(`\n${pass} passed, ${fail} failed (total ${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error("auth E2E crashed:", err);
  process.exit(1);
});
