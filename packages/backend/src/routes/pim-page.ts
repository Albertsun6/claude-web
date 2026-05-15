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

// ============================================================================
// Week 3 Day 16 — /pim/list (self-contained HTML list view)
//
// Cross-device PIM list (Mac browser / iPhone Safari / any). Filters by
// commitment + free-text FTS query. Export link to /api/pim/export?format=md.
// Auth via ?token= or localStorage 'eva:auth-token' (same as capture page).
// ============================================================================

const LIST_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PIM List — Vessel</title>
<style>
  :root {
    --bg: #fafafa; --bg-card: #fff; --fg: #222; --fg-dim: #666;
    --accent: #0a84ff; --border: #ddd; --error: #d33; --success: #2a8;
    --pill: #eef;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #111; --bg-card: #1a1a1a; --fg: #ddd; --fg-dim: #888;
      --border: #333; --pill: #234; }
  }
  * { box-sizing: border-box; }
  body { font: 14px/1.4 -apple-system, system-ui, sans-serif; margin: 0;
    color: var(--fg); background: var(--bg); }
  header { padding: 12px 16px; border-bottom: 1px solid var(--border);
    background: var(--bg-card); position: sticky; top: 0; z-index: 1; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .filters input, .filters select, .filters button, .filters a {
    font: inherit; padding: 6px 10px; border: 1px solid var(--border);
    border-radius: 6px; background: var(--bg-card); color: var(--fg);
    text-decoration: none;
  }
  .filters input { flex: 1; min-width: 120px; }
  .filters .clear { color: var(--fg-dim); padding: 6px 8px; cursor: pointer; }
  main { padding: 12px 16px; max-width: 800px; margin: 0 auto; }
  .item { background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px; margin-bottom: 8px; }
  .item .meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
    font-size: 11px; color: var(--fg-dim); margin-bottom: 6px; }
  .item .pill { padding: 1px 6px; border-radius: 3px; background: var(--pill);
    color: var(--fg); }
  .item .pill.commit { background: #c5e4ff; color: #033; }
  .item .pill.archived { background: #ddd; color: #555; }
  .item .content { white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, monospace; font-size: 13px; }
  .item .actions { margin-top: 8px; display: flex; gap: 6px; }
  .item .actions button { font-size: 11px; padding: 3px 8px;
    border: 1px solid var(--border); background: var(--bg-card);
    color: var(--fg); border-radius: 4px; cursor: pointer; }
  .item .actions button:hover { background: var(--bg); }
  .item .actions button.del { color: var(--error); }
  .empty { color: var(--fg-dim); text-align: center; padding: 40px 16px;
    font-style: italic; }
  .stat { color: var(--fg-dim); margin: 8px 0; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>PIM List</h1>
  <div class="filters">
    <input id="q" placeholder="搜索（中文用前缀 *，例 '跑*'）" autocomplete="off">
    <select id="commitment">
      <option value="">All commitment</option>
    </select>
    <a href="/pim/capture">＋ Capture</a>
    <a id="export-md" href="/api/pim/export?format=markdown" download>Export MD</a>
    <a id="export-csv" href="/api/pim/export?format=csv" download>Export CSV</a>
    <span class="clear" id="clear">×</span>
  </div>
</header>
<main>
  <div class="stat" id="stat">Loading…</div>
  <div id="items"></div>
</main>
<script>
(async () => {
  const params = new URLSearchParams(location.search);
  let token = params.get("token") || localStorage.getItem("eva:auth-token") || "";
  if (params.get("token")) {
    localStorage.setItem("eva:auth-token", token);
    history.replaceState(null, "", location.pathname);
  }
  function authHeaders(extra) {
    const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }
  function applyTokenToHref(el) {
    if (!token) return;
    const url = new URL(el.href, location.origin);
    url.searchParams.set("token", token);
    el.href = url.toString();
  }
  applyTokenToHref(document.getElementById("export-md"));
  applyTokenToHref(document.getElementById("export-csv"));

  // Server-driven commitment list
  let states = ["inbox", "action", "calendar", "waiting", "reference", "archived"];
  try {
    const cfgRes = await fetch("/api/harness/config", { headers: authHeaders() });
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg.pim && Array.isArray(cfg.pim.commitmentStates)) states = cfg.pim.commitmentStates;
    }
  } catch (e) { console.warn("config fetch failed", e); }
  const sel = document.getElementById("commitment");
  for (const s of states) {
    const opt = document.createElement("option");
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  }

  const qEl = document.getElementById("q");
  const statEl = document.getElementById("stat");
  const itemsEl = document.getElementById("items");

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  }
  function fmtTime(ms) {
    const d = new Date(ms);
    return d.toLocaleString();
  }

  async function load() {
    statEl.textContent = "Loading…";
    const qs = new URLSearchParams();
    qs.set("limit", "100");
    if (qEl.value.trim()) qs.set("q", qEl.value.trim());
    if (sel.value) qs.set("commitment", sel.value);
    let data;
    try {
      const res = await fetch("/api/pim/list?" + qs.toString(), { headers: authHeaders() });
      if (!res.ok) {
        const txt = await res.text();
        statEl.textContent = "Error " + res.status + ": " + txt.slice(0, 200);
        itemsEl.innerHTML = "";
        return;
      }
      data = await res.json();
    } catch (e) {
      statEl.textContent = "Network error: " + e.message;
      return;
    }
    const items = data.items || [];
    statEl.textContent = items.length + " items (total " + (data.total || items.length) + ")";
    if (items.length === 0) {
      itemsEl.innerHTML = '<div class="empty">No items match.</div>';
      return;
    }
    const html = items.map((it) => {
      const c = escapeHtml(it.commitmentState || "inbox");
      const cls = c === "archived" ? "archived" : "commit";
      const dt = fmtTime(it.capturedAt);
      const aiBadge = it.aiStatus && it.aiStatus !== "pending" && it.aiStatus !== "disabled"
        ? '<span class="pill">ai:' + escapeHtml(it.aiStatus) + '</span>' : '';
      return [
        '<div class="item" data-id="' + escapeHtml(it.id) + '">',
        '  <div class="meta">',
        '    <span class="pill ' + cls + '">' + c + '</span>',
        '    <span class="pill">' + escapeHtml(it.modality || 'text') + '</span>',
        '    <span class="pill">' + escapeHtml(it.source || '?') + '</span>',
        '    ' + aiBadge,
        '    <span>· ' + dt + '</span>',
        '  </div>',
        '  <div class="content">' + escapeHtml(it.content) + '</div>',
        '  <div class="actions">',
        states.filter(s => s !== c).map(s =>
          '<button data-action="move" data-target="' + s + '">→ ' + s + '</button>'
        ).join(''),
        '    <button data-action="delete" class="del">Delete</button>',
        '  </div>',
        '</div>'
      ].join("\\n");
    }).join("\\n");
    itemsEl.innerHTML = html;
  }

  itemsEl.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const item = btn.closest(".item");
    if (!item) return;
    const id = item.dataset.id;
    const action = btn.dataset.action;
    btn.disabled = true;
    try {
      if (action === "delete") {
        if (!confirm("Soft-delete this item?")) { btn.disabled = false; return; }
        await fetch("/api/pim/" + encodeURIComponent(id), { method: "DELETE", headers: authHeaders() });
      } else if (action === "move") {
        await fetch("/api/pim/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ commitmentState: btn.dataset.target }),
        });
      }
      await load();
    } catch (e) {
      alert("Action failed: " + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  let debounce;
  qEl.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 300);
  });
  sel.addEventListener("change", load);
  document.getElementById("clear").addEventListener("click", () => {
    qEl.value = ""; sel.value = ""; load();
  });

  await load();
})();
</script>
</body>
</html>`;

export function pimListPageHandler() {
  return (c: any) => c.html(LIST_HTML);
}

export const pimPageRouter = new Hono();
pimPageRouter.get("/", pimCapturePageHandler());
pimPageRouter.get("/capture", pimCapturePageHandler());
pimPageRouter.get("/capture/", pimCapturePageHandler());
pimPageRouter.get("/list", pimListPageHandler());
pimPageRouter.get("/list/", pimListPageHandler());
