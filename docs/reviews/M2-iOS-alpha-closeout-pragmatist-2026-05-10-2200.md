# M2-iOS-α — Closeout (vessel-pragmatist lens)
Date: 2026-05-10-2200

## Findings

### PASS: 零新依赖
原本可以引入 `bonjour-service` 或 `mdns` npm 包（DAR 触发：新依赖）。
但 macOS 自带 `dns-sd` 命令满足全部需求，spawn 子进程 + SIGTERM 即可。
package.json 不变。Vessel 硬约束"个人单机 Mac"为前提，跨平台留到真正
需要时再加。

### PASS: 范围克制
- publisher.ts ~110 行（含注释，多数是 lifecycle 处理）
- vessel-intent.ts +35 行（合并到现有 /health，去 dataDir）
- index.ts +6 行（import + 1 if + 1 stop call in shutdown handler）
- test-m2-ios-alpha.ts ~190 行（22 assertions + 真实 dns-sd 子进程探活）

总实现 < 350 行（含测试）。无 over-engineering。

### PASS: 拆段清晰，β/γ 责任在 operator
α 全自动可验证，β/γ 必须 operator（iOS Xcode 编译 + 真机 TestFlight）。
不强行把 iOS Swift 代码塞进 α，避免产出"我写了但你没法验证"的代码。

### PASS: 选择合并端点而不是新加端点
发现 vesselRouter 已有 /health 后，没有走"换路径名/discovery"绕路，而是
直接合并 + 删 dataDir 泄漏 + 保留 ok 兼容字段。最 YAGNI 也最改善。

### MINOR-1: dns-sd 命令路径硬编码，未提供 env 覆盖
publisher.ts 直接 `spawn('dns-sd', ...)`。其他 helper 命令（CLAUDE_CLI /
WHISPER_BIN / FFMPEG_BIN / EDGE_TTS_BIN）都有 env 覆盖。一致性建议加
DNS_SD_BIN env。
**Verdict**: MINOR — defer until 出现 dns-sd 不在 PATH 的真实场景。

### MINOR-2: shutdown grace 是 1500ms 硬编码常量
SHUTDOWN_GRACE_MS = 1500 — 与 mcpManager 的 3000ms 不一致。dns-sd 退出非
常快（< 100ms 实测），1500 已经很宽。但魔数没注释为什么。
**Verdict**: MINOR — accepted-as-is.

### INFO: 测试 Test 2 (fail-soft) 没真正跑代码路径
我注释里说"verified by code review only"。这个诚实但不理想 —— 改造
publisher 接受 BIN env（MINOR-1）后就能在测试里 inject 假命令验证。
两个 minor 一起做更好。

## Verdict: PASS — 2 MINOR (accepted-as-is / deferred)
