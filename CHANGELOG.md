## [0.2.0] - 2026-04-29
### Changes
#### Features
- directory picker for cwd inputs (browse instead of type)
- create new directory from picker
- voice transcript cleanup via claude haiku before send
- route TTS through edge-tts backend (Xiaoxiao); add stop + replay buttons
- multi-project tabs with parallel runs; fix mic button shift
- separate Open project (one-shot) from Create project (form)
- backend serves frontend dist at / for single-port deploy
- launchd autostart + caffeinate + offline banner for reliability
- history sessions list with click-to-resume + transcript replay
- improvements per docs/IMPROVEMENTS.md
- hands-off token-saving automation
- parity with claude-code UX (todos, diff, status bar, @file)
- file preview — image / pdf / video / audio / markdown / code
- file preview pops into center; resizable + persisted panels
- cleaner stream + subscription bucket + image attachments
- spoken-style summary mode for assistant TTS
- 对话模式 + tap-to-toggle mic + voiceprint/wake idea entries
- dynamic slash commands from CLI's system:init advertisement
- mobile voice Tier 1 + Tier 2 (PWA convo, hands-free UX)
- voice commands 暂停 / 继续 / 清除 in conversation mode
- voice: add audio input/output device selection
- layout: collapsible sidebars on desktop
- fs: real-time file tree + viewer sync via chokidar + WS
- voice: four-layer accuracy boost — DSP, ffmpeg filters, whisper prompt, vocab cleanup
- picker: default open-directory dialog to ~/Desktop
- ios: wrap as Capacitor iOS app for native audio session
- ios-native: M1 — SwiftUI shell + WebSocket text chat
- ios-native: M1.5 + M2 — permission handling + PTT recording
- ios-native: M3 — TTS playback (foreground)
- ios-native: M4 — voice session, lock screen, MPRemoteCommandCenter
- ios-native: A — silent keepalive opt-in + model selector
- ios-native: add Bypass permission mode to settings
- ios-native: silent keepalive now runs independently of voice mode
- backend: add /api/projects + /api/telemetry routes
- ios: per-project conversations architecture (F1c2 + F1c3)
- ios: drawer UX + tool cards + markdown + Seaidea rename
- ios: app data reset action + small fixes
- ios: 抽屉加历史 session 浏览入口（groupedByCwd 合并 registry.projects）
- ios: drawer UX redesign — collapsible folders + per-folder new conversation + jump-to-latest
- permission: add "auto-allow this turn" checkbox for better UX
- ios: sync permission auto-allow feature from web
- ios: tool result collapsible display with content + isError
- ios: image attachment via PhotosPicker (multimodal input)
- ios: @file autocomplete — type @ in input to browse and insert file paths
- ios: session watcher, title helper, drawer polish, and misc improvements
- ios: prompt queue — auto-chain turns without waiting

#### Bug Fixes
- auto-retry without --resume when session id is stale
- stack voice controls above mic to avoid overflow on narrow sidebar
- self-destroying SW + static manifest to unblock iOS PWA black screen
- serve SPA at / and unknown paths; only return 404 for missing assets
- re-read index.html on mtime change so frontend rebuilds are picked up live
- convo mode auto-starts mic, shows live transcript in input, auto-submits
- strip markdown / code / table tokens before TTS so 朗读 stops saying 星号星号
- voice: conversation mode accuracy — PCM ring buffer + pre-roll + EWMA
- voice: default to manual review — split cleanup from auto-send
- layout: main column shrunk instead of growing on sidebar collapse at tablet width
- layout: main column collapsed to ~150px when sidebar hidden — real root cause
- voice: iOS PWA TTS playback — unlock + reuse single audio element
- auth+ios: probe failure now falls through, not falsely blocking with token modal
- ios-native: M4.5 — address all 8 review findings
- ios-native: silent keep-alive loop so Now Playing reliably shows
- ios-native: apply round-2 review findings (3 fixes)
- ios-native: apply round-3 review (5 fixes incl. critical bind ordering)
- ios-native: symmetrical silent-loop guard in enter()

#### Other
- : ignore tsbuildinfo
- : route all API + WS through Vite reverse proxy (single-origin)
- : vite allowedHosts true for tunnel/tailscale hostnames
- : gzip + immutable cache + lazy-load Files/Git panels + vendor split
- : token-saving improvements
- : explore mobile voice interaction options (4 tiers)
- : enterprise internal-tool path B (≤50 users) breakdown
- : add USER_MANUAL.md + update-manual skill for auto-maintenance
- : sanitize personal info before publishing
- ideas: add multi-device sync + cursor CLI review MCP
- ios: one-shot CLI deploy script
- ios: split sim/device builds — sim uses http://localhost to avoid Tailscale loopback
- : iOS native M1-M4 review report for AI cross-check
- : real-device test checklist for iOS native v1
- ios-native: app icon placeholder + round 2 review doc
- : round 3 review for keepalive decoupling + Bypass mode
- : mark Section 2 (lock screen Now Playing) as platform-constrained skip
- : D + C + E — iOS native chapter, Mac mini migration plan, Capacitor deprecation
- ideas: iOS app v2 candidate features (web parity + net-new)
- : F1 implementation plan for iOS native v2 (A1+A2+A6+A7)
- : F1 v2/v3 plans + USER_MANUAL + CLAUDE updates
- ios: split ContentView into Views/ subdirectory
- ios: extract conversation models from BackendClient
- ios: split BackendClient into WebSocketClient + ConversationStore + RunRouter facade

---

# Changelog

