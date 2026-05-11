/**
 * M1A-α minimal panel HTML — served at `/vessel/min/`.
 *
 * Self-contained: no build step, vanilla HTML + JS, calls `/api/vessel/*`.
 * Per [M1A-slicing-arbiter](../../../docs/reviews/M1A-slicing-arbiter-2026-05-10-0210.md)
 * A-MINOR-2 fix: separate path `/vessel/min/`, does NOT touch Eva main App.tsx.
 *
 * Out of scope (M1A-β/γ):
 *   - WS streaming (just polls runs list every 3s)
 *   - Eva ProjectTabs integration
 *   - Conversation switcher
 */

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vessel — minimal panel (M1A-α)</title>
<style>
  body { font: 13px/1.4 -apple-system, system-ui, monospace; margin: 16px; color: #ddd; background: #111; }
  h1 { font-size: 16px; margin: 0 0 12px; color: #fff; }
  h2 { font-size: 13px; margin: 16px 0 6px; color: #aaa; text-transform: uppercase; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 4px 8px; text-align: left; border-bottom: 1px solid #222; vertical-align: top; }
  th { color: #888; font-weight: normal; }
  tr.success td { color: #6c6; }
  tr.error td, tr.cancelled td { color: #c66; }
  .runId, .traceId, .sessionId { font-family: ui-monospace, monospace; color: #69c; }
  .traceId { cursor: pointer; text-decoration: underline; }
  pre { background: #1a1a1a; border: 1px solid #333; padding: 12px; overflow-x: auto; max-height: 60vh; }
  .form { margin: 16px 0; padding: 12px; background: #1a1a1a; border: 1px solid #333; }
  input, button, select { font: inherit; padding: 6px 10px; border: 1px solid #444; background: #222; color: #ddd; }
  input { width: 60ch; }
  button { cursor: pointer; }
  button:hover { background: #333; }
  .empty { color: #666; font-style: italic; padding: 8px; }
  .meta { color: #888; }
  .span-tree { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>Vessel — minimal panel <span class="meta">M1A-β <span id="ws-state">○ connecting…</span></span></h1>

<div class="form">
  <select id="skill">
    <option value="echo">echo (instant)</option>
    <option value="coding">coding (spawns Claude CLI)</option>
  </select>
  <input id="prompt" placeholder='try "hi" or "写 fibonacci.py"' />
  <button id="run">Run intent</button>
  <span id="status" class="meta"></span>
</div>
<div class="form" id="auth-row" style="display:none">
  <input id="token" type="password" placeholder="VESSEL_TOKEN" style="width:30ch" />
  <button id="save-token">Save</button>
  <span class="meta">(stored in localStorage; required when backend has VESSEL_TOKEN set)</span>
</div>

<h2>Workflows <span class="meta" id="wf-count"></span></h2>
<div id="workflows"><div class="empty">no active workflows</div></div>

<h2 id="hitl-header" style="display:none;color:#fa0">⏸ HITL — awaiting your decision</h2>
<div id="hitl-panel" style="display:none;padding:12px;background:#221800;border:1px solid #844;margin-bottom:12px;">
  <div id="hitl-message" style="margin-bottom:10px;color:#fc8"></div>
  <div id="hitl-buttons"></div>
</div>

<h2>Recent runs</h2>
<div id="runs">loading…</div>

<h2 id="stream-header" style="display:none">Live stream (WS)</h2>
<div id="stream" style="display:none; max-height: 30vh; overflow-y: auto; background:#1a1a1a; border:1px solid #333; padding:8px; font-family: ui-monospace, monospace;"></div>

<h2 id="trace-header" style="display:none">Trace</h2>
<pre id="trace" style="display:none"></pre>

<script>
const TK = 'vessel:token';
function getToken() { try { return localStorage.getItem(TK) || ''; } catch { return ''; } }
function setToken(t) { try { if (t) localStorage.setItem(TK, t); else localStorage.removeItem(TK); } catch {} }
function authHeaders() { const t = getToken(); return t ? { 'Authorization': 'Bearer ' + t } : {}; }
async function get(p) { const r = await fetch(p, { headers: authHeaders() }); if (r.status === 401) { showAuth(); throw new Error('401'); } return r.json(); }
async function post(p, body) { const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) }); if (r.status === 401) { showAuth(); throw new Error('401'); } return r.json(); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function showAuth() { document.getElementById('auth-row').style.display = 'block'; document.getElementById('status').textContent = '✗ 401 — set VESSEL_TOKEN below'; }
document.getElementById('save-token').addEventListener('click', () => { setToken(document.getElementById('token').value.trim()); document.getElementById('status').textContent = 'token saved'; refreshRuns().catch(()=>{}); });

async function refreshRuns() {
  const data = await get('/api/vessel/runs?limit=20');
  const el = document.getElementById('runs');
  if (!data.runs || data.runs.length === 0) { el.innerHTML = '<div class="empty">no runs yet</div>'; return; }
  let h = '<table><tr><th>run</th><th>skill</th><th>status</th><th>started</th><th>trace</th><th>intent</th></tr>';
  for (const r of data.runs) {
    h += '<tr class="' + esc(r.status) + '">'
      + '<td><span class="runId">' + esc(r.run_id.slice(0, 8)) + '</span></td>'
      + '<td>' + esc(r.skill_id) + '</td>'
      + '<td>' + esc(r.status) + '</td>'
      + '<td class="meta">' + esc(r.started_at || '') + '</td>'
      + '<td><span class="traceId" data-trace="' + esc(r.trace_id) + '">' + esc(r.trace_id.slice(0, 16)) + '</span></td>'
      + '<td>' + esc((r.intent_text || '').slice(0, 80)) + '</td>'
      + '</tr>';
  }
  h += '</table>';
  el.innerHTML = h;
  for (const span of el.querySelectorAll('.traceId')) {
    span.addEventListener('click', () => loadTrace(span.dataset.trace));
  }
}

async function loadTrace(traceId) {
  const data = await get('/api/vessel/traces/' + encodeURIComponent(traceId));
  document.getElementById('trace-header').style.display = 'block';
  const el = document.getElementById('trace');
  el.style.display = 'block';
  if (data.error) { el.textContent = 'error: ' + data.error; return; }
  // Build span tree by parent_span_id
  const byParent = new Map();
  for (const e of data.events) {
    const k = e.parent_span_id || null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(e);
  }
  const lines = ['# trace ' + data.trace_id + ' (' + data.span_count + ' spans)'];
  function walk(parentKey, depth) {
    for (const e of (byParent.get(parentKey) || [])) {
      const indent = '  '.repeat(depth);
      const dur = (e.duration_ms != null) ? e.duration_ms + 'ms' : '—';
      lines.push(indent + '[' + e.event_type + '] ' + e.component + ' ' + e.status + ' (' + dur + ') span=' + e.span_id.slice(0, 8));
      walk(e.span_id, depth + 1);
    }
  }
  walk(null, 0);
  el.textContent = lines.join('\\n');
}

async function refreshWorkflows() {
  const data = await get('/api/vessel/workflows?limit=20').catch(() => ({ workflows: [] }));
  const el = document.getElementById('workflows');
  const count = document.getElementById('wf-count');
  if (!data.workflows || data.workflows.length === 0) {
    el.innerHTML = '<div class="empty">no workflows</div>';
    count.textContent = '';
    return;
  }
  count.textContent = '(' + data.workflows.length + ')';
  let h = '<table><tr><th>id</th><th>status</th><th>step</th><th>kind</th><th>paused reason</th><th>action</th></tr>';
  for (const w of data.workflows) {
    const isPaused = w.status === 'paused' || w.status === 'interrupted';
    h += '<tr class="' + esc(w.status === 'completed' ? 'success' : w.status === 'failed' || w.status === 'cancelled' ? 'error' : '') + '">'
      + '<td class="runId">' + esc(w.id.slice(0, 8)) + '</td>'
      + '<td>' + esc(w.status) + '</td>'
      + '<td>' + esc(w.current_step) + '/' + esc(w.total_steps) + '</td>'
      + '<td>' + esc(w.kind) + '</td>'
      + '<td>' + esc(w.paused_reason || '—') + '</td>'
      + '<td>' + (isPaused
        ? '<button onclick="resumeWorkflow(\'' + esc(w.id) + '\',\'approve\')">Approve</button> '
          + '<button onclick="resumeWorkflow(\'' + esc(w.id) + '\',\'reject\')">Reject</button>'
        : '—')
      + '</td>'
      + '</tr>';
  }
  h += '</table>';
  el.innerHTML = h;
}

async function resumeWorkflow(id, option) {
  try {
    await post('/api/vessel/workflows/' + encodeURIComponent(id) + '/resume', { option });
    document.getElementById('hitl-panel').style.display = 'none';
    document.getElementById('hitl-header').style.display = 'none';
    refreshWorkflows().catch(() => {});
  } catch (e) {
    alert('resume failed: ' + e);
  }
}

function showHitlPanel(workflowId, message, options) {
  document.getElementById('hitl-header').style.display = 'block';
  document.getElementById('hitl-panel').style.display = 'block';
  document.getElementById('hitl-message').textContent = message;
  const btns = document.getElementById('hitl-buttons');
  btns.innerHTML = (options || ['approve', 'reject']).map(opt =>
    '<button onclick="resumeWorkflow(\'' + esc(workflowId) + '\',\'' + esc(opt) + '\')" style="margin-right:8px">' + esc(opt) + '</button>'
  ).join('');
}

// M1A-β: WS connection for live trace + progress + completed events.
let ws = null;
let wsConnected = false;
function rid() { return crypto.randomUUID(); }

let wsRetries = 0;
const WS_MAX_RETRIES = 5;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const t = getToken();
  const url = proto + '://' + location.host + '/ws' + (t ? '?token=' + encodeURIComponent(t) : '');
  ws = new WebSocket(url);
  ws.addEventListener('open', () => { wsConnected = true; wsRetries = 0; document.getElementById('ws-state').textContent = '● connected'; });
  ws.addEventListener('close', (ev) => {
    wsConnected = false;
    // 1008 = policy violation (auth fail). 401 over WS upgrade often surfaces as 1006.
    // Don't retry forever on auth; let user fix token.
    if (ev.code === 1008 || wsRetries >= WS_MAX_RETRIES) {
      document.getElementById('ws-state').textContent = '✗ disconnected (gave up after ' + wsRetries + ' tries; check VESSEL_TOKEN)';
      showAuth();
      return;
    }
    wsRetries += 1;
    document.getElementById('ws-state').textContent = '○ retry ' + wsRetries + '/' + WS_MAX_RETRIES;
    setTimeout(connectWS, 1000 * Math.min(8, 2 ** wsRetries));
  });
  ws.addEventListener('error', () => {});
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'vessel_trace' || msg.type === 'vessel_progress' || msg.type === 'vessel_completed' || msg.type === 'vessel_error') {
        appendStreamLine(msg);
        if (msg.type === 'vessel_completed' || msg.type === 'vessel_error') refreshRuns().catch(()=>{});
      }
      if (msg.type === 'vessel_workflow_paused') {
        showHitlPanel(msg.workflowId, msg.message, msg.options);
        refreshWorkflows().catch(()=>{});
      }
      if (msg.type === 'vessel_workflow_step' || msg.type === 'vessel_workflow_completed' || msg.type === 'vessel_workflow_failed' || msg.type === 'vessel_workflow_cancelled') {
        if (msg.type !== 'vessel_workflow_step') {
          document.getElementById('hitl-panel').style.display = 'none';
          document.getElementById('hitl-header').style.display = 'none';
        }
        refreshWorkflows().catch(()=>{});
      }
    } catch {}
  });
}

function appendStreamLine(msg) {
  const el = document.getElementById('stream');
  el.style.display = 'block';
  document.getElementById('stream-header').style.display = 'block';
  const line = document.createElement('div');
  const runShort = msg.runId ? msg.runId.slice(0, 8) : '----';
  let text = '[' + runShort + '] ' + msg.type;
  if (msg.type === 'vessel_trace' && msg.event) text += ' ' + msg.event.event_type + ' ' + msg.event.component + ' ' + msg.event.status;
  else if (msg.type === 'vessel_progress' && msg.message && msg.message.type) text += ' ' + msg.message.type;
  else if (msg.type === 'vessel_completed' && msg.result) text += ' status=' + msg.result.status;
  else if (msg.type === 'vessel_error' && msg.error) text += ' ' + msg.error.type + ': ' + msg.error.message;
  line.textContent = text;
  el.appendChild(line);
  if (el.children.length > 200) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

document.getElementById('run').addEventListener('click', () => {
  const text = document.getElementById('prompt').value.trim();
  if (!text) return;
  const skill = document.getElementById('skill').value;
  const status = document.getElementById('status');
  if (!wsConnected) { status.textContent = '✗ WS not connected'; return; }
  const runId = rid();
  status.textContent = 'streaming run ' + runId.slice(0, 8) + '…';
  ws.send(JSON.stringify({ type: 'vessel_intent', runId, text, skill }));
});

connectWS();
refreshRuns();
refreshWorkflows();
setInterval(refreshRuns, 5000);
setInterval(refreshWorkflows, 5000);
</script>
</body>
</html>`;

export function vesselPanelHandler() {
  // returns Hono-compatible handler
  return (c: { html: (s: string) => unknown }) => c.html(HTML);
}
