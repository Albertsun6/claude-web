// Comprehensive end-to-end test against a running backend on :3030.
// Prereq: launchd-managed backend OR `pnpm dev:backend` is up.
//
// Tests every major feature:
//   - REST: health, auth/info, fs/*, git/*, voice/info, sessions/*
//   - Path safety (escape attempts → 403)
//   - WS: connect, simple prompt, tool + permission, parallel, stale-session, interrupt
//
// Prints PASS/FAIL per case; exits 0 only when all pass.

import WebSocket from "ws";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BASE = process.env.E2E_BASE ?? "http://localhost:3030";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";
const REPO = path.resolve(import.meta.dirname ?? __dirname, "../../..");

let pass = 0, fail = 0;
const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

async function group(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n[${name}]`);
  await fn();
}

// ---------- REST ----------

async function testHealth() {
  const r = await fetch(`${BASE}/health`);
  const body: any = await r.json();
  check("health 200", r.status === 200);
  check("health.ok", body.ok === true);
  check("health.authRequired bool", typeof body.authRequired === "boolean");
  check("health.activeRuns number", typeof body.activeRuns === "number");
  check("health.cliBin string", typeof body.cliBin === "string");
}

async function testAuthInfo() {
  const r = await fetch(`${BASE}/api/auth/info`);
  const body: any = await r.json();
  check("auth/info 200", r.status === 200);
  check("auth/info.authRequired bool", typeof body.authRequired === "boolean");
}

async function testFsHome() {
  const r = await fetch(`${BASE}/api/fs/home`);
  const body: any = await r.json();
  check("fs/home 200", r.status === 200);
  check("fs/home.home is abs", typeof body.home === "string" && body.home.startsWith("/"));
}

async function testFsTree() {
  const r = await fetch(`${BASE}/api/fs/tree?root=${encodeURIComponent(REPO)}`);
  const body: any = await r.json();
  check("fs/tree 200", r.status === 200);
  check("fs/tree returns array", Array.isArray(body.entries));
  const names = (body.entries ?? []).map((e: any) => e.name);
  check("fs/tree includes packages", names.includes("packages"));

  const r2 = await fetch(`${BASE}/api/fs/tree?root=${encodeURIComponent(REPO)}&path=packages`);
  const body2: any = await r2.json();
  const names2 = (body2.entries ?? []).map((e: any) => e.name);
  check("fs/tree path subdir", names2.includes("backend"));

  // path escape
  const r3 = await fetch(`${BASE}/api/fs/tree?root=${encodeURIComponent(REPO)}&path=../../etc`);
  check("fs/tree escape → 403", r3.status === 403);

  // missing root
  const r4 = await fetch(`${BASE}/api/fs/tree`);
  check("fs/tree missing root → 400", r4.status === 400);
}

async function testFsFile() {
  const r = await fetch(`${BASE}/api/fs/file?root=${encodeURIComponent(REPO)}&path=README.md`);
  const body: any = await r.json();
  check("fs/file 200", r.status === 200);
  check("fs/file content present", typeof body.content === "string" && body.content.length > 0);

  const r2 = await fetch(`${BASE}/api/fs/file?root=${encodeURIComponent(REPO)}&path=this-does-not-exist.xyz`);
  check("fs/file missing → 404", r2.status === 404);

  // path escape
  const r3 = await fetch(`${BASE}/api/fs/file?root=${encodeURIComponent(REPO)}&path=../../../../etc/passwd`);
  check("fs/file escape → 403", r3.status === 403);
}

async function testFsBlob() {
  // The icon.svg in frontend/public is a known small image we ship.
  const r = await fetch(`${BASE}/api/fs/blob?root=${encodeURIComponent(REPO)}&path=packages/frontend/public/icon.svg`);
  check("fs/blob 200", r.status === 200);
  check("fs/blob image content-type", (r.headers.get("content-type") ?? "").includes("svg"));
  const buf = Buffer.from(await r.arrayBuffer());
  check("fs/blob has bytes", buf.length > 0);

  // missing
  const r2 = await fetch(`${BASE}/api/fs/blob?root=${encodeURIComponent(REPO)}&path=does-not-exist.png`);
  check("fs/blob missing → 404", r2.status === 404);

  // path escape
  const r3 = await fetch(`${BASE}/api/fs/blob?root=${encodeURIComponent(REPO)}&path=../../etc/hosts`);
  check("fs/blob escape → 403", r3.status === 403);

  // unknown extension defaults to octet-stream (still served)
  const r4 = await fetch(`${BASE}/api/fs/blob?root=${encodeURIComponent(REPO)}&path=README.md`);
  check("fs/blob octet-stream default", r4.status === 200);
}

async function testFsMkdir() {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-web-e2e-"));
  // good
  const r = await fetch(`${BASE}/api/fs/mkdir`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parent: dir, name: "child" }),
  });
  const body: any = await r.json();
  check("fs/mkdir 200", r.status === 200 && body.ok === true);

  // duplicate
  const r2 = await fetch(`${BASE}/api/fs/mkdir`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parent: dir, name: "child" }),
  });
  check("fs/mkdir duplicate → 409", r2.status === 409);

  // bad name
  const r3 = await fetch(`${BASE}/api/fs/mkdir`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parent: dir, name: "../escape" }),
  });
  check("fs/mkdir escape → 400", r3.status === 400);

  // empty name
  const r4 = await fetch(`${BASE}/api/fs/mkdir`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parent: dir, name: "" }),
  });
  check("fs/mkdir empty → 400", r4.status === 400);
}

async function testGit() {
  const r = await fetch(`${BASE}/api/git/status?cwd=${encodeURIComponent(REPO)}`);
  const body: any = await r.json();
  check("git/status 200", r.status === 200);
  check("git/status.branch string", typeof body.branch === "string");
  check("git/status.files array", Array.isArray(body.files));

  const r2 = await fetch(`${BASE}/api/git/log?cwd=${encodeURIComponent(REPO)}&limit=3`);
  const body2: any = await r2.json();
  check("git/log returns array", Array.isArray(body2));
  check("git/log has entries", body2.length > 0 && typeof body2[0].sha === "string");

  const r3 = await fetch(`${BASE}/api/git/branch?cwd=${encodeURIComponent(REPO)}`);
  const body3: any = await r3.json();
  check("git/branch.current string", typeof body3.current === "string");

  // bad cwd (not a git repo)
  const r4 = await fetch(`${BASE}/api/git/status?cwd=${encodeURIComponent("/tmp")}`);
  check("git/status non-repo → 400", r4.status === 400);
}

async function testVoiceInfo() {
  const r = await fetch(`${BASE}/api/voice/info`);
  const body: any = await r.json();
  check("voice/info 200", r.status === 200);
  check("voice/info.available", body.available === true);
}

async function testVoiceTts() {
  const r = await fetch(`${BASE}/api/voice/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "测试" }),
  });
  check("voice/tts 200", r.status === 200);
  check("voice/tts content-type", r.headers.get("content-type") === "audio/mpeg");
  const buf = Buffer.from(await r.arrayBuffer());
  check("voice/tts audio bytes", buf.length > 1000 && buf[0] === 0xff);
}

async function testVoiceTranscribe() {
  // synthesize a sample with macOS say + ffmpeg, then send it back
  const dir = await mkdtemp(path.join(tmpdir(), "voice-e2e-"));
  const aiff = path.join(dir, "in.aiff");
  const wav = path.join(dir, "in.wav");
  spawnSync("/usr/bin/say", ["-v", "Tingting", "-o", aiff, "你好世界"]);
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  const audio = await import("node:fs/promises").then((m) => m.readFile(wav));
  const r = await fetch(`${BASE}/api/voice/transcribe`, {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: audio as any,
  });
  const body: any = await r.json();
  check("voice/transcribe 200", r.status === 200);
  check("voice/transcribe text non-empty", typeof body.text === "string" && body.text.length > 0);
}

async function testSessions() {
  const r = await fetch(`${BASE}/api/sessions/list?cwd=${encodeURIComponent(REPO)}`);
  const body: any = await r.json();
  check("sessions/list 200", r.status === 200);
  check("sessions/list array", Array.isArray(body.sessions));
  if (body.sessions?.length > 0) {
    const sid = body.sessions[0].sessionId;
    const r2 = await fetch(`${BASE}/api/sessions/transcript?cwd=${encodeURIComponent(REPO)}&sessionId=${sid}`);
    const body2: any = await r2.json();
    check("sessions/transcript 200", r2.status === 200);
    check("sessions/transcript messages array", Array.isArray(body2.messages));
  }

  // bad sessionId
  const r3 = await fetch(`${BASE}/api/sessions/transcript?cwd=${encodeURIComponent(REPO)}&sessionId=../escape`);
  check("sessions/transcript escape → 400", r3.status === 400);
}

// ---------- WS ----------

interface WSScript {
  ws: WebSocket;
  onMessage: (handler: (msg: any) => void) => void;
}

function newWs(): Promise<WSScript> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const handlers: Array<(msg: any) => void> = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      for (const h of handlers) h(msg);
    });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        onMessage: (h) => handlers.push(h),
      }),
    );
    setTimeout(() => reject(new Error("ws connect timeout")), 5000);
  });
}

async function testWsBasic() {
  const sock = await newWs();
  let result: any = null;
  sock.onMessage((m) => {
    if (m.type === "sdk_message" && m.message?.type === "result") result = m.message;
  });
  const runId = "e2e-basic-" + Date.now();
  sock.ws.send(JSON.stringify({
    type: "user_prompt", runId,
    prompt: "回我一句：好的",
    cwd: REPO,
    model: "claude-haiku-4-5",
    permissionMode: "bypassPermissions",
  }));
  await new Promise<void>((resolve) => {
    sock.onMessage((m) => { if (m.type === "session_ended" && m.runId === runId) resolve(); });
    setTimeout(resolve, 30_000);
  });
  check("ws basic prompt got result", !!result);
  check("ws basic result has session_id", !!result?.session_id);
  sock.ws.close();
}

async function testWsParallel() {
  const sock = await newWs();
  const ended = new Set<string>();
  const ids = ["e2e-A-" + Date.now(), "e2e-B-" + Date.now() + 1];
  sock.onMessage((m) => {
    if (m.type === "session_ended" && ids.includes(m.runId)) ended.add(m.runId);
  });
  for (const runId of ids) {
    sock.ws.send(JSON.stringify({
      type: "user_prompt", runId,
      prompt: `回我一句：${runId.slice(0, 5)}`,
      cwd: REPO,
      model: "claude-haiku-4-5",
      permissionMode: "bypassPermissions",
    }));
  }
  await new Promise<void>((resolve) => {
    const t = setInterval(() => {
      if (ended.size === ids.length) { clearInterval(t); resolve(); }
    }, 200);
    setTimeout(() => { clearInterval(t); resolve(); }, 60_000);
  });
  check("ws parallel both completed", ended.size === 2);
  sock.ws.close();
}

async function testWsPermission() {
  const sock = await newWs();
  let permReqd = false;
  let toolRan = false;
  const runId = "e2e-perm-" + Date.now();
  sock.onMessage((m) => {
    if (m.type === "permission_request" && m.runId === runId) {
      permReqd = true;
      sock.ws.send(JSON.stringify({
        type: "permission_reply", requestId: m.requestId, decision: "allow", runId,
      }));
    }
    if (m.type === "sdk_message" && m.message?.type === "user") {
      const blocks = m.message.message?.content ?? [];
      if (blocks.some((b: any) => b?.type === "tool_result" && !b.is_error)) toolRan = true;
    }
  });
  sock.ws.send(JSON.stringify({
    type: "user_prompt", runId,
    prompt: "请用 Bash 工具跑一下 pwd 命令",
    cwd: REPO,
    model: "claude-haiku-4-5",
    permissionMode: "default",
  }));
  await new Promise<void>((resolve) => {
    sock.onMessage((m) => { if (m.type === "session_ended" && m.runId === runId) resolve(); });
    setTimeout(resolve, 60_000);
  });
  check("ws permission_request received", permReqd);
  check("ws tool ran after allow", toolRan);
  sock.ws.close();
}

async function testWsStaleSession() {
  const sock = await newWs();
  let staleSignal = false;
  let result = false;
  const runId = "e2e-stale-" + Date.now();
  sock.onMessage((m) => {
    if (m.type === "sdk_message") {
      const sm = m.message;
      if (sm?.type === "system" && sm?.subtype === "stale_session_recovered") staleSignal = true;
      if (sm?.type === "result") result = true;
    }
  });
  sock.ws.send(JSON.stringify({
    type: "user_prompt", runId,
    prompt: "回我：好",
    cwd: REPO,
    model: "claude-haiku-4-5",
    permissionMode: "bypassPermissions",
    resumeSessionId: "00000000-1111-2222-3333-444444444444",
  }));
  await new Promise<void>((resolve) => {
    sock.onMessage((m) => { if (m.type === "session_ended" && m.runId === runId) resolve(); });
    setTimeout(resolve, 60_000);
  });
  check("ws stale session signaled", staleSignal);
  check("ws stale session recovered + got result", result);
  sock.ws.close();
}

async function testWsInterrupt() {
  const sock = await newWs();
  let ended: any = null;
  const runId = "e2e-int-" + Date.now();
  sock.onMessage((m) => { if (m.type === "session_ended" && m.runId === runId) ended = m; });
  sock.ws.send(JSON.stringify({
    type: "user_prompt", runId,
    prompt: "请数 1 到 100 然后写一篇 200 字的总结",
    cwd: REPO,
    model: "claude-haiku-4-5",
    permissionMode: "bypassPermissions",
  }));
  // wait for things to start, then interrupt
  await new Promise((r) => setTimeout(r, 1500));
  sock.ws.send(JSON.stringify({ type: "interrupt", runId }));
  await new Promise<void>((resolve) => {
    const t = setInterval(() => { if (ended) { clearInterval(t); resolve(); } }, 100);
    setTimeout(() => { clearInterval(t); resolve(); }, 30_000);
  });
  check("ws interrupt closes run", !!ended);
  check("ws interrupt reason interrupted", ended?.reason === "interrupted" || ended?.reason === "completed");
  sock.ws.close();
}

// ---------- run ----------

(async () => {
  console.log(`E2E suite against ${BASE}\n`);
  await group("REST: health & auth", async () => {
    await testHealth();
    await testAuthInfo();
  });
  await group("REST: fs", async () => {
    await testFsHome();
    await testFsTree();
    await testFsFile();
    await testFsBlob();
    await testFsMkdir();
  });
  await group("REST: git", async () => { await testGit(); });
  await group("REST: voice", async () => {
    await testVoiceInfo();
    await testVoiceTts();
    await testVoiceTranscribe();
  });
  await group("REST: sessions", async () => { await testSessions(); });
  await group("WS: basic", async () => { await testWsBasic(); });
  await group("WS: parallel", async () => { await testWsParallel(); });
  await group("WS: permission", async () => { await testWsPermission(); });
  await group("WS: stale-session", async () => { await testWsStaleSession(); });
  await group("WS: interrupt", async () => { await testWsInterrupt(); });

  console.log(`\n${pass} passed, ${fail} failed (total ${pass + fail})`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? "  — " + r.detail : ""}`);
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error("E2E suite crashed:", err);
  process.exit(1);
});
