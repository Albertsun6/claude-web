# Eva (formerly claude-web)

Personal mobile-friendly UI for the `claude` CLI. Reuses the user's Claude Pro/Max
subscription by **spawning the CLI as a subprocess** (`child_process.spawn` →
`claude --print --input-format=stream-json --output-format=stream-json …`).

**Do NOT use the Anthropic Agent SDK.** It bills against `ANTHROPIC_API_KEY`. The
CLI inherits the user's OAuth credentials at `~/.claude/.credentials.json`.

## Layout

```
packages/
  backend/      Hono + ws on :3030. Spawns claude CLI per WS prompt. Serves the dist/.
  frontend/    React 18 + Vite + Zustand. Built dist served by backend.
                packages/frontend/ios/  ⚠️ Capacitor wrapper — DEPRECATED. Don't add features here.
  shared/      Protocol types (ClientMessage, ServerMessage).
  ios-native/  ✅ SwiftUI native iOS app (display name "Seaidea", bundle id com.albertsun6.claudeweb-native).
                Canonical iOS path from v1. xcodegen-driven, talks to backend over WS + HTTP.
                Per-conversation state with runId routing (mirrors web's byCwd).
                Cache layer at Application Support persists conversations across launch.
                Server projects.json is the cross-device project registry.
```

Single-port deploy: backend serves `dist/` + `/api/*` + `/ws` from one origin.
Vite dev (`pnpm dev:frontend`) proxies to backend at 3030.

**iOS path policy**: any new mobile feature / fix goes into `packages/ios-native/`.
The Capacitor wrapper at `packages/frontend/ios/` is preserved as fallback but
unmaintained (see `packages/frontend/ios/DEPRECATED.md`).
SwiftUI native is the confirmed long-term iOS frontend strategy. Do not migrate
mobile work back to Capacitor/PWA or to React Native/Flutter unless the user
explicitly reopens the architecture decision. Prefer server-driven config for
copy, model lists, feature flags, profiles, and health-check display so routine
changes do not require reinstalling the iOS app.

## Backend

- [packages/backend/src/index.ts](packages/backend/src/index.ts) — Hono app, WS upgrade, parallel-run map per connection, in-memory gzip cache for static assets.
- [packages/backend/src/cli-runner.ts](packages/backend/src/cli-runner.ts) — `runOnce` spawns the CLI, parses stream-json line-by-line. Auto-retries without `--resume` on stale-session error and emits `clear_run_messages` to wipe partial UI. SIGTERM → SIGKILL after 5s.
- [packages/backend/src/auth.ts](packages/backend/src/auth.ts) — `CLAUDE_WEB_TOKEN` (Bearer/?token=) + `CLAUDE_WEB_ALLOWED_ROOTS` (colon-separated path allowlist). Both optional; warn if unset.
- [packages/backend/src/routes/permission.ts](packages/backend/src/routes/permission.ts) — registry `<token, {send, pending}>`. PreToolUse hook POSTs `/api/permission/ask?token=…` and blocks. WS reply resolves via runId.
- [packages/backend/scripts/permission-hook.mjs](packages/backend/scripts/permission-hook.mjs) — hook script invoked by CLI. Reads stdin payload, POSTs to backend, writes `{permissionDecision: allow|deny}` to stdout. **Fail-open** on errors so a dead backend doesn't deny everything.
- [packages/backend/src/routes/voice.ts](packages/backend/src/routes/voice.ts) — `/transcribe` (whisper-cli + ffmpeg), `/tts` (edge-tts → mp3), `/cleanup` (claude haiku rewrites STT output).
- [packages/backend/src/routes/sessions.ts](packages/backend/src/routes/sessions.ts) — reads `~/.claude/projects/<encoded-cwd>/*.jsonl` for history. Caches preview by mtime. Endpoints: `/list` and `/transcript`.
- [packages/backend/src/routes/projects.ts](packages/backend/src/routes/projects.ts) — server-side project registry at `~/.claude-web/projects.json`. CRUD: GET / POST (idempotent on cwd) / PATCH (rename) / cleanup / forget. Used by iOS as the canonical "what cwds are registered as projects" list across devices.
- [packages/backend/src/projects-store.ts](packages/backend/src/projects-store.ts) — atomic-rename writes + promise-queue write lock + `.bak` recovery + `version: 1`. Shared by all `/api/projects` mutations.
- [packages/backend/src/routes/{fs,git}.ts](packages/backend/src/routes/) — read-only fs tree + git status/diff/log/branch. fs has `/tree` `/file` `/blob` and `/mkdir` (used by iOS DirectoryPicker).
- [packages/backend/src/routes/telemetry.ts](packages/backend/src/routes/telemetry.ts) + [telemetry-store.ts](packages/backend/src/telemetry-store.ts) — append-only structured-event log at `~/.claude-web/telemetry.jsonl` (rotated to `.1` at 10MB). POST batches from iOS. tail/grep/jq for bug diagnosis; no SaaS, no PII filter.

## iOS Native (Seaidea)

- [packages/ios-native/Sources/ClaudeWeb/ClaudeWebApp.swift](packages/ios-native/Sources/ClaudeWeb/ClaudeWebApp.swift) — App entry. Builds Cache + ProjectsAPI + SessionsAPI + ProjectRegistry, runs the bootstrap sequence (cache → fetch /api/projects → reconcile + restore last conversation), wires `client.onConversationDirty` to flush to disk on every state change.
- [packages/ios-native/Sources/ClaudeWeb/BackendClient.swift](packages/ios-native/Sources/ClaudeWeb/BackendClient.swift) — WS client. Per-conversation state via `stateByConversation: [String: ConversationChatState]` + `runIdToConversation` routing. `sendPrompt` takes conversationId; `currentConversationId` drives computed views. **Conversation.id is a client UUID for new chats, but equals sessionId for loaded historical sessions** (see `ProjectRegistry.openHistoricalSession` for dedup).
- [packages/ios-native/Sources/ClaudeWeb/ProjectRegistry.swift](packages/ios-native/Sources/ClaudeWeb/ProjectRegistry.swift) — coordinator owning `projects: [ProjectDTO]` (server snapshot) + history sessions per project. `bootstrap()` is the launch sequence. `openByPath(cwd)` registers a cwd as a server project. `openHistoricalSession()` adopts a jsonl session into BackendClient.
- [packages/ios-native/Sources/ClaudeWeb/Cache.swift](packages/ios-native/Sources/ClaudeWeb/Cache.swift) — Application Support cache: `projects.json` snapshot, `conversations.json` metadata, `sessions/<convId>.json` ChatLine[] arrays. LRU keeps at most 50 session files. Atomic-rename writes; decode failures fall back to empty (server is truth).
- [packages/ios-native/Sources/ClaudeWeb/{ProjectsAPI,SessionsAPI,FsAPI}.swift](packages/ios-native/Sources/ClaudeWeb/) — thin HTTP clients. ProjectsAPI for `/api/projects/*`, SessionsAPI for `/api/sessions/{list,transcript}`, FsAPI for `/api/fs/{tree,mkdir,home}`.
- [packages/ios-native/Sources/ClaudeWeb/TranscriptParser.swift](packages/ios-native/Sources/ClaudeWeb/TranscriptParser.swift) — jsonl entries → `[ChatLine]`. Independent of `SDKMessage.parse` because jsonl carries true user prompts as `type=user` (which `SDKMessage.parse` always treats as toolResult).
- [packages/ios-native/Sources/ClaudeWeb/DirectoryPicker.swift](packages/ios-native/Sources/ClaudeWeb/DirectoryPicker.swift) — breadcrumb + subdirs + mkdir. Always opens at `settings.cwd` (the "浏览起始路径"), not the previously-picked cwd. mkdir auto-selects the new folder.
- [packages/ios-native/Sources/ClaudeWeb/TTSPlayer.swift](packages/ios-native/Sources/ClaudeWeb/TTSPlayer.swift) — per-conversation audio cache (`lastAudioByConversation`). `cancel()` on conversation switch stops playback but preserves cache; `replay(for: convId)` plays from that conversation's cache.
- [packages/ios-native/Sources/ClaudeWeb/ContentView.swift](packages/ios-native/Sources/ClaudeWeb/ContentView.swift) — main UI. Top toolbar shows `Seaidea` title with active-run badge; chip is connection dot + tappable conversation switcher; settings sheet hosts voice mode toggle.
- [packages/ios-native/Sources/ClaudeWeb/Telemetry.swift](packages/ios-native/Sources/ClaudeWeb/Telemetry.swift) — buffered (cap 1000) structured-event logger. Flushes to `/api/telemetry` every 30s OR every 50 events OR on background. Console-mirrored. Settings has "查看最近事件" entry that opens the in-memory ring viewer. Instrumented at: WS lifecycle, runId routing drops, sendPrompt, systemInit/sessionEnded, cache encode/decode/LRU, projects API. Schema fields: timestamp, level (info/warn/error/crash), event (dotted name), conversationId, runId, props, appVersion, buildVersion, deviceModel.

**Key invariants** (don't break):
1. All ServerMessage cases (sdkMessage / sessionEnded / error / clearRunMessages / permissionRequest) MUST route by `runIdToConversation`. Unrouted → silently dropped.
2. `runIdToConversation` is cleaned on EVERY `sessionEnded` reason (completed / interrupted / error). Otherwise the table grows unbounded.
3. `pendingPermission` lives on `ConversationChatState`, NOT BackendClient — switching conversations must not show A's permission sheet on B.
4. `onConversationDirty` fires on systemInit (so sessionId binding survives crashes), createConversation, and every sessionEnded.
5. TTS only auto-speaks when the finishing run belongs to `currentConversationId`. Background completions stay quiet.

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

## Branch & Release

分支模型：`main` → `dev` → `feat/eva-Mx-xxx`
- `feat/*` 从 `dev` 开，PR 回 `dev`（squash merge）
- `dev` 稳定后 PR 到 `main`（merge commit），打版本 tag
- 禁止直接 push `main` 或 `dev`（GitHub branch protection 保护）

版本格式：`v<MAJOR>.<MINOR>.<PATCH>[-Mx]`
示例：`v0.4.0-M1`（M1 里程碑完成）、`v0.4.1`（hotfix）

worktree 并行规则：见 [WORKTREE_LOCK.md](WORKTREE_LOCK.md)（端口隔离 + 文件锁登记）

GitHub Branch Protection（需在 GitHub UI 手动配置）：
- `main`：require PR + require CI job `test` pass + no force push
- `dev`：require PR + require CI job `test` pass + no force push

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
7. **iOS BackendClient is per-conversation, not global**. Don't add a top-level `messages` / `busy` / `pendingPermission` shortcut — every WS message must be attributed to a `Conversation` via `runIdToConversation`. Adding global state breaks parallel-conversation routing and TTS bleed-prevention.
8. **Never treat `Conversation.id` and `Conversation.sessionId` as interchangeable**. New conversations have a client UUID id and `sessionId == nil` until first systemInit. Loaded historical sessions use `sessionId` AS `id`. Cache + UI selection key on `id`. CLI `--resume` keys on `sessionId`.
9. **`~/.claude-web/projects.json` mutations always go through `withProjectsLock`** in [projects-store.ts](packages/backend/src/projects-store.ts). Skipping the lock means concurrent POST `/api/projects` race-conditions lose entries.
10. **iOS auto-name pattern is `<basename> <n>`** (e.g. `claude-web 1`). `BackendClient.isAutoNamedTitle` detects this so first prompt rewrites it to the prompt's first 30 chars; user-customized names are left alone. Don't change the format without updating the regex/check.

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
| `docs/HARNESS_INDEX.md` | **harness 文档总入口** — 推荐阅读顺序、所有 harness 文件清单、跨文档关键约束（5 条贯穿）、维护规则。第一次进 harness 话题先看这个。 |
| `docs/HARNESS_ARCHITECTURE.md` | **harness 完整分层架构** — 6 层（L1 Presentation / L2 API / L3 Orchestration / L4 Runtime / L5 Persistence / L6 Subject Project）+ L7 横切，鸟瞰图、每层职责、跨层数据流、20 条关键不变量速查 |
| `docs/HARNESS_ROADMAP.md` | **harness 演进路线图（待办）** — Context、20 条原则、里程碑（M-1 → M6）、Open Questions、§16 进化体系、§18 评审 skill 草案、评审辩论流水。M-1 未启动。 |
| `docs/HARNESS_DATA_MODEL.md` | **harness 数据模型** — 13 个核心实体（Project / Initiative / Issue / Stage / Task / Run / Artifact / ContextBundle / Methodology / ReviewVerdict / Decision / Retrospective / IdeaCapture）+ DDL + ADR-0010 / ADR-0015 schema 迁移策略 |
| `docs/HARNESS_AGENTS.md` | **harness Agent 角色 + 模型策略 + 评审矩阵** — 12 个默认 Profile、Coder 复杂度自适应、双 reviewer risk-triggered、评审独立性约束、工具白名单 |
| `docs/HARNESS_RISKS.md` | **harness 风险清单** — 18 条按 6 主题分组（Agent 行为 / 流程节奏 / 多 Agent / 不可逆 / 演化垂直 / 运维），按里程碑分布 |
| `docs/HARNESS_LANDSCAPE.md` | **harness 竞品/参考全景图** — hapi / Paseo / Multica / OpenHands 等同类工具横向对比，按 L1-L7 分层；战略含义（L1/L2 不卷、L3+L7 集中投入）；代码搬运规则（个人自用情形：AGPL 项目可直接搬运 + 保留版权声明）。每次外部评审前必喂给评审 AI。 |
| `docs/ENGINEERING_GOVERNANCE.md` | Engineering constraints plan: framework choices, CI, protocol tests, ADRs |
| `docs/MOBILE_VOICE.md` | Mobile voice strategy doc |
| `docs/ENTERPRISE_INTERNAL.md` | Speculative multi-user migration plan |
| `docs/IOS_NATIVE_REVIEW.md` / `_2.md` / `_3.md` | iOS native code-review threads (M1-M4.5) |
| `docs/IOS_NATIVE_DEVICE_TEST.md` | Real-device acceptance checklist for the SwiftUI app |
| `docs/IOS_NATIVE_F1_V3_PLAN.md` | Per-project state + cache + project registry plan (current implementation reference) |
| `docs/MAC_MINI_MIGRATION.md` | When the dedicated Mac mini arrives, follow this |
| `CLAUDE.md` (this file) | Architecture brief for new Claude sessions |

## Improvements / TODOs

See [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) for the full punch list.
