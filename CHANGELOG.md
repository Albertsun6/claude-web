# Changelog

Significant changes per release. Per-PR detail in each [release page](https://github.com/Albertsun6/claude-web/releases).

Versioning: `v<MAJOR>.<MINOR>.<PATCH>[-Mx]`. `Mx` suffix marks milestone tags.

## v0.8.3 — 2026-05-12

**Auto-update banner triggers for v0.8.2 users**

- Backend `0.1.0 → 0.1.1` so v0.8.2 installs (pkg 0.1.0) see the banner on next backend restart

## v0.8.2 — 2026-05-12

**Auto-build CI + auto-update banner**

- `.github/workflows/release.yml` adds `build-pkg` macos-15 job — push tag `v*` auto-builds & uploads `.pkg` ([#59](https://github.com/Albertsun6/claude-web/pull/59))
- Backend `/api/version/latest` (6h-cached GitHub Releases API) ([#61](https://github.com/Albertsun6/claude-web/pull/61))
- Frontend `UpdateBanner` shows when newer `.pkg` available — links to release page
- Backend bumped 0.0.1 → 0.1.0 (first releasable backend semver)

## v0.8.1 — 2026-05-12

**macOS `.pkg` installer (first releasable build)**

- `scripts/build-pkg.sh` complete pipeline: pnpm install + frontend build + pnpm deploy + bundled Node 24 + native rebuild + pkgbuild
- `installer/` pre/postinstall + plist template + uninstall.sh
- ~190MB `.pkg`; bundles better-sqlite3 native binding aligned to bundled Node ABI ([#57](https://github.com/Albertsun6/claude-web/pull/57))
- `cli-runner` temp-file cleanup race fix — `pnpm test:cli` was stably failing on dev HEAD ([#56](https://github.com/Albertsun6/claude-web/pull/56))
- Steward V0.4 / V0.5 contract — 即时代办 fastpath, worker self-signal I12, no-auto-merge I13 ([#51](https://github.com/Albertsun6/claude-web/pull/51) / [#53](https://github.com/Albertsun6/claude-web/pull/53) / [#54](https://github.com/Albertsun6/claude-web/pull/54))
- Two major surveys: parallel mechanism + AI coding agent execution control ([#53](https://github.com/Albertsun6/claude-web/pull/53) / [#55](https://github.com/Albertsun6/claude-web/pull/55))

## v0.8.0 — 2026-05-11

**Steward V0 contract — first cut**

- `docs/BACKLOG.md` (YAML in markdown) as single source of truth for tasks
- 10 user-facing prompts: `/boot`, `开始干 <id>`, `<id> 收线`, `加待办`, `即时代办`, etc.
- 11 invariants (I1-I11) in ADR-019
- `pnpm eva:sessions` derived view — zero-write, parses `ps` + `~/.claude/projects/*.jsonl` mtime
- `eva.json` worktree registry (port + dataDir + owns fields)

## v0.7.2 — 2026-05-11

**iOS GALAXY TELECOM team signing + Build 52 install**

- `DEVELOPMENT_TEAM` switched to `23PRXWBRNH` (GALAXY TELECOM)
- `xcodebuild -allowProvisioningDeviceRegistration` for iPhone register

## v0.7.1-M2gamma — 2026-05-11

**iOS M2-γ prep**

- iOS rename complete + voice telemetry + offline map + TestFlight playbook

## v0.7.0-M2 — 2026-05-11

**M2 milestone — Intent Classifier v1**

- Rules-first depth × domain classifier
- memory.db schema v4 → v5
- `orchestrator.runIntent` integrates `classify()`

## v0.6.0 — 2026-05-05

**Layered-spiral delivery + Vessel foundation**

- Layered Spiral Delivery principle codified in CLAUDE.md §0.5
- Vessel kernel migration (PR #39) + eva:sessions (PR #40) + intent-v1 (PR #41)

## v0.5.0 — 2026-05-05

**M1 milestone — Context Manager skeleton + harness audit-trail**

- ContextManager + stage-aware prompts
- Cross-review scaffolding (vessel-architect / pragmatist / risk-officer + cursor-agent cross-reviewer)

## v0.4.x — 2026-05-04 → 2026-05-05

**Pre-Vessel: claude-web → Eva → Vessel migration**

- Notification framework, heartbeat, Inbox, emergency intervention, Telegram (M0.5)
- iOS native (Seaidea) per-project state + cache + project registry (F1 v3)
- Voice mode UX polish

---

## v0.2.0 — 2026-04-29 (pre-rename history)

Highlight reel only; full list in git log + GitHub release page.

**Features** (selected)
- Multi-project tabs with parallel runs
- Voice mode: edge-tts backend (Xiaoxiao), STT cleanup via Claude Haiku, conversation mode
- Single-port deploy: backend serves frontend `dist` at `/`
- launchd autostart + caffeinate + offline banner
- History sessions list with click-to-resume + transcript replay
- File preview (image / pdf / video / audio / markdown / code) + resizable layout
- iOS Capacitor wrapper (later deprecated, see v0.4.x for native rewrite)
- iOS native (Seaidea) M1–M4: SwiftUI shell, WebSocket text chat, permission, PTT, TTS, voice session, lock screen
- Real-time file tree + viewer sync via chokidar + WS
- Multimodal: PhotosPicker image attach, `@file` autocomplete
- Voice: four-layer accuracy boost (DSP, ffmpeg, whisper prompt, vocab cleanup)
- `/api/projects` + `/api/telemetry` routes

**Fixes** (selected)
- Auto-retry without `--resume` on stale session id
- Self-destroying SW + static manifest (iOS PWA black-screen fix)
- voice: conversation mode accuracy — PCM ring buffer + pre-roll + EWMA
- voice: iOS PWA TTS playback — unlock + reuse single audio element
- ios-native: 8 review findings (M4.5) + 3+5 round-2/round-3 fixes

Older releases: see git log + [releases page](https://github.com/Albertsun6/claude-web/releases).
