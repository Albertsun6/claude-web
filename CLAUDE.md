# claude-web

Personal mobile-friendly UI for the `claude` CLI. Reuses the user's Claude Pro/Max
subscription by **spawning the CLI as a subprocess** (`child_process.spawn` →
`claude --print --input-format=stream-json --output-format=stream-json …`).

**Do NOT use the Anthropic Agent SDK.** It bills against `ANTHROPIC_API_KEY`. The
CLI inherits the user's OAuth credentials at `~/.claude/.credentials.json`.

## Layout

```
packages/
  backend/    Hono + ws on :3030. Spawns claude CLI per WS prompt. Serves the dist/.
  frontend/   React 18 + Vite + Zustand. Built dist served by backend.
  shared/     Protocol types (ClientMessage, ServerMessage).
```

Single-port deploy: backend serves `dist/` + `/api/*` + `/ws` from one origin.
Vite dev (`pnpm dev:frontend`) proxies to backend at 3030.

## Backend

- [packages/backend/src/index.ts](packages/backend/src/index.ts) — Hono app, WS upgrade, parallel-run map per connection, in-memory gzip cache for static assets.
- [packages/backend/src/cli-runner.ts](packages/backend/src/cli-runner.ts) — `runOnce` spawns the CLI, parses stream-json line-by-line. Auto-retries without `--resume` on stale-session error and emits `clear_run_messages` to wipe partial UI. SIGTERM → SIGKILL after 5s.
- [packages/backend/src/auth.ts](packages/backend/src/auth.ts) — `CLAUDE_WEB_TOKEN` (Bearer/?token=) + `CLAUDE_WEB_ALLOWED_ROOTS` (colon-separated path allowlist). Both optional; warn if unset.
- [packages/backend/src/routes/permission.ts](packages/backend/src/routes/permission.ts) — registry `<token, {send, pending}>`. PreToolUse hook POSTs `/api/permission/ask?token=…` and blocks. WS reply resolves via runId.
- [packages/backend/scripts/permission-hook.mjs](packages/backend/scripts/permission-hook.mjs) — hook script invoked by CLI. Reads stdin payload, POSTs to backend, writes `{permissionDecision: allow|deny}` to stdout. **Fail-open** on errors so a dead backend doesn't deny everything.
- [packages/backend/src/routes/voice.ts](packages/backend/src/routes/voice.ts) — `/transcribe` (whisper-cli + ffmpeg), `/tts` (edge-tts → mp3), `/cleanup` (claude haiku rewrites STT output).
- [packages/backend/src/routes/sessions.ts](packages/backend/src/routes/sessions.ts) — reads `~/.claude/projects/<encoded-cwd>/*.jsonl` for history. Caches preview by mtime.
- [packages/backend/src/routes/{fs,git}.ts](packages/backend/src/routes/) — read-only fs tree + git status/diff/log/branch.

## Frontend

- [packages/frontend/src/App.tsx](packages/frontend/src/App.tsx) — top-level shell. ProjectTabs + sidebar + main + right panel + drawers + AuthGate + OfflineBanner.
- [packages/frontend/src/store.ts](packages/frontend/src/store.ts) — Zustand. `byCwd: Record<string, ProjectSession>` is the canonical per-project state. Multiple tabs run in parallel; each WS message is routed by `runId`.
- [packages/frontend/src/ws-client.ts](packages/frontend/src/ws-client.ts) — single WS, multiplexed by runId. Uses `withAuthQuery(WS_URL)` for token. Auto-allows tools if `isToolAllowedForRun(runId, toolName)`.
- [packages/frontend/src/auth.ts](packages/frontend/src/auth.ts) — bearer token in localStorage; `authFetch` wrapper.
- [packages/frontend/src/hooks/useVoice.ts](packages/frontend/src/hooks/useVoice.ts) — STT (Web Speech OR remote whisper) + TTS (audio queue with edge-tts mp3 from backend). Replay last turn; mute toggle; mode auto-picks remote on iOS PWA standalone.

## Run

```bash
# one-time: install
pnpm install

# launchd-managed backend (recommended)
launchctl load -w ~/Library/LaunchAgents/com.claude-web.backend.plist
# manual: pnpm dev:backend

# dev frontend (only when changing UI)
pnpm dev:frontend     # http://localhost:5173, proxies /api + /ws to :3030

# build for prod (served by backend)
pnpm --filter @claude-web/frontend build
```

Tailscale serve already wired to expose :3030 on `https://<your-mac-hostname>.<tailnet>.ts.net`:

```bash
tailscale serve --bg --https=443 http://localhost:3030
```

## Required external tools

- `claude` CLI (subscription-authenticated; check `~/.claude/.credentials.json`)
- `whisper-cli` + model at `~/.whisper-models/ggml-large-v3-turbo-q5_0.bin`
- `ffmpeg` (audio transcode)
- `edge-tts` (TTS via Microsoft Edge voices, voice `zh-CN-XiaoxiaoNeural`)

Override paths via env: `CLAUDE_CLI`, `WHISPER_BIN`, `WHISPER_MODEL`, `FFMPEG_BIN`, `EDGE_TTS_BIN`, `EDGE_TTS_VOICE`.

## Env vars

| Name | Purpose |
|---|---|
| `PORT` | backend HTTP/WS port (default 3030) |
| `BACKEND_HOST` | bind interface (default 127.0.0.1; set 0.0.0.0 only behind a reverse proxy) |
| `BACKEND_BASE` | self-URL the hook script POSTs to |
| `CLAUDE_WEB_TOKEN` | shared bearer token; required for any non-localhost exposure |
| `CLAUDE_WEB_ALLOWED_ROOTS` | colon-separated absolute paths; cwd/root must equal or be under one |

## Common pitfalls / things future Claude must NOT change

1. **Never reach for `@anthropic-ai/claude-agent-sdk`**. It bills the API key.
2. **Never run `claude --bare`**. `--bare` forces API key auth and breaks subscription.
3. **Never call backend HTTP endpoints with absolute `localhost:3030`** in frontend code. Use relative paths so Tailscale / Cloudflare deploys work.
4. The **PWA service worker is `selfDestroying`** — don't try to make it cache stuff. iOS PWA black-screen bug. Just keep the manifest for "Add to Home Screen".
5. **Stream-json output_format messages and saved jsonl entries differ slightly** — saved transcripts include extra fields like `parentUuid`, `isSidechain`. Use [normalizeJsonlEntry](packages/backend/src/routes/sessions.ts#L100) when reading from disk.
6. **CLI permission flow goes via PreToolUse hook**, not `canUseTool` — the SDK's mechanism doesn't apply to subprocess-mode.

## Maintenance reflex

After completing any **user-visible** feature change (new UI, voice command,
slash command, env var, persistence key, deploy detail, mobile UX, etc.), check
whether [docs/USER_MANUAL.md](docs/USER_MANUAL.md) needs updating. The
[update-manual](.claude/skills/update-manual/SKILL.md) skill handles this — it
auto-triggers on phrases like "完成了 / 搞定 / ship 了 / 更新手册" or after a
`feat:` commit.

When in doubt: ask the user "要更新手册吗？" rather than assume.

## Docs map

| File | Purpose |
|---|---|
| `docs/USER_MANUAL.md` | **What the app does today** — user-facing reference |
| `docs/IDEAS.md` | Deferred features (yes-but-not-now) |
| `docs/IMPROVEMENTS.md` | Historic audit (mostly closed) |
| `docs/MOBILE_VOICE.md` | Mobile voice strategy doc |
| `docs/ENTERPRISE_INTERNAL.md` | Speculative multi-user migration plan |
| `CLAUDE.md` (this file) | Architecture brief for new Claude sessions |

## Improvements / TODOs

See [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) for the full punch list.
