/**
 * M0-PIM minimal capture page — served at `/pim/capture/`.
 *
 * Self-contained HTML: no React, no build step, vanilla JS calls `/api/pim`.
 * Pattern mirrors routes/vessel-panel.ts.
 *
 * 设计要点 (per plan §Day 4c + ADR-020 §D10):
 * - 跨设备捕获入口 (Mac / iPhone Safari / 任何浏览器都能用)
 * - 从 GET /api/harness/config 拉 server-driven `pim.commitmentStates` 给 picker
 *   (failure → fallback PIM_CONFIG_FALLBACK 默认 5+1 buckets)
 * - Authorization Bearer header support — 从 ?token= URL param 或 localStorage 读
 *   (与 Eva 主 frontend 的 AuthGate localStorage key 'eva:auth-token' 兼容)
 * - POST /api/pim 成功 → 清 textarea + flash success + 移到 list view
 *
 * Out of scope (Week 2-3):
 * - GET /api/pim/list 列表显示 (Day Week 3 加)
 * - PATCH / DELETE / sanity-report viz
 * - AI 建议 pending 状态可视化
 */

import { Hono } from "hono";

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>PIM 捕获 — Vessel</title>
<style>
  :root {
    --bg: #fafafa; --bg-card: #fff; --fg: #222; --fg-dim: #666;
    --accent: #0a84ff; --border: #ddd; --error: #d33; --success: #2a8;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #111; --bg-card: #1a1a1a; --fg: #ddd; --fg-dim: #888;
      --border: #333; }
  }
  * { box-sizing: border-box; }
  body {
    font: 16px/1.4 -apple-system, system-ui, sans-serif;
    margin: 0; padding: 0;
    color: var(--fg); background: var(--bg);
    min-height: 100vh;
    display: flex; flex-direction: column; align-items: center;
  }
  main {
    width: 100%; max-width: 600px; padding: 20px 16px;
  }
  h1 { font-size: 18px; margin: 0 0 16px; font-weight: 600; }
  .card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px; margin-bottom: 12px;
  }
  textarea {
    width: 100%; min-height: 140px; padding: 12px;
    font: inherit; color: inherit; background: transparent;
    border: 1px solid var(--border); border-radius: 8px;
    resize: vertical;
  }
  textarea:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
  label { font-size: 13px; color: var(--fg-dim); }
  select, button {
    font: inherit; padding: 8px 14px;
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg-card); color: var(--fg);
  }
  button.primary {
    background: var(--accent); color: white; border-color: var(--accent);
    flex: 1; font-weight: 600;
  }
  button.primary:disabled { opacity: 0.5; }
  button:active:not(:disabled) { transform: scale(0.98); }
  .status { margin-top: 12px; font-size: 13px; min-height: 20px; }
  .status.success { color: var(--success); }
  .status.error { color: var(--error); }
  .hint { font-size: 12px; color: var(--fg-dim); margin-top: 8px; }
  .footer { font-size: 11px; color: var(--fg-dim); text-align: center; padding: 12px; }
</style>
</head>
<body>
<main>
  <h1>PIM 捕获</h1>
  <form class="card" id="capture-form">
    <textarea
      id="content"
      placeholder="把脑子里的东西扔进来…"
      autofocus
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
    ></textarea>
    <div class="row">
      <label for="commitment">Commitment</label>
      <select id="commitment">
        <option value="">默认 (inbox)</option>
      </select>
      <button type="submit" id="send" class="primary">Send</button>
    </div>
    <div class="status" id="status"></div>
    <div class="hint">默认入 Inbox。⌘+Enter / Ctrl+Enter 快捷发送。</div>
  </form>
  <div class="footer">M0-PIM Day 4 · ADR-020</div>
</main>
<script>
(async () => {
  // ============================================================
  // Auth token — try URL ?token=, then localStorage 'eva:auth-token'
  // (matches Eva frontend AuthGate key for single-tenant convenience)
  // ============================================================
  const params = new URLSearchParams(location.search);
  let token = params.get("token") || localStorage.getItem("eva:auth-token") || "";
  if (token && params.get("token")) {
    // Persist URL-provided token
    localStorage.setItem("eva:auth-token", token);
    // Strip from URL to avoid leaking via history
    history.replaceState(null, "", location.pathname);
  }
  function authHeaders(extra) {
    const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }

  // ============================================================
  // Fetch server-driven config → populate commitmentStates picker
  // ============================================================
  const FALLBACK_STATES = ["inbox", "action", "calendar", "waiting", "reference", "archived"];
  try {
    const res = await fetch("/api/harness/config", { headers: authHeaders() });
    if (res.ok) {
      const cfg = await res.json();
      const states = (cfg.pim && cfg.pim.commitmentStates) || FALLBACK_STATES;
      const sel = document.getElementById("commitment");
      for (const s of states) {
        if (s === "archived") continue; // Don't allow capturing as archived
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        sel.appendChild(opt);
      }
    }
  } catch (e) {
    console.warn("config fetch failed; using fallback states", e);
  }

  // ============================================================
  // Form submit → POST /api/pim
  // ============================================================
  const form = document.getElementById("capture-form");
  const contentEl = document.getElementById("content");
  const commitmentEl = document.getElementById("commitment");
  const sendBtn = document.getElementById("send");
  const statusEl = document.getElementById("status");

  async function submit() {
    const content = contentEl.value.trim();
    if (!content) return;
    sendBtn.disabled = true;
    statusEl.textContent = "Sending…";
    statusEl.className = "status";

    const payload = { content, source: "web-capture" };
    if (commitmentEl.value) payload.commitmentState = commitmentEl.value;

    try {
      const res = await fetch("/api/pim", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (res.status === 201) {
        const data = await res.json();
        statusEl.textContent = "✓ Captured (id: " + (data.item.id.slice(0, 12)) + "…)";
        statusEl.className = "status success";
        contentEl.value = "";
        contentEl.focus();
        // Auto-clear status after 3s
        setTimeout(() => { if (statusEl.className === "status success") statusEl.textContent = ""; }, 3000);
      } else {
        const txt = await res.text();
        statusEl.textContent = "Error " + res.status + ": " + txt.slice(0, 200);
        statusEl.className = "status error";
      }
    } catch (e) {
      statusEl.textContent = "Network error: " + e.message;
      statusEl.className = "status error";
    } finally {
      sendBtn.disabled = false;
    }
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  contentEl.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
})();
</script>
</body>
</html>`;

export function pimCapturePageHandler() {
  return (c: any) => c.html(HTML);
}

export const pimPageRouter = new Hono();
pimPageRouter.get("/", pimCapturePageHandler());
pimPageRouter.get("/capture", pimCapturePageHandler());
pimPageRouter.get("/capture/", pimCapturePageHandler());
