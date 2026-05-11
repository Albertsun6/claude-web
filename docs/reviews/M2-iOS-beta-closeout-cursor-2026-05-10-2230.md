# M2-iOS-β — Closeout (cursor cross-review lens)
Date: 2026-05-10-2230

## Cross-cutting concerns

### PASS: β 与 α 协议契约一致
α 段 `/api/vessel/health` JSON 字段（service / version / hostname /
uptimeSec / sessions / runs / bonjour / soul）→ β VesselHealth Codable
struct 字段精确镜像。回归测试在 α 端检查响应不含 dataDir / 不泄漏路径，
β 端 displayName 优先用 soul.name，不会捏造字段。

唯一不强制契约部分：β 把 sessions/runs 字段视为可省（VesselHealth 没有
这俩字段）。这是有意的 — 它们是内部诊断，β 不需要展示。后向兼容：α
未来增加新字段时 β 解码不会失败（Swift JSONDecoder 默认忽略未知字段）。

### PASS: simulator BUILD SUCCEEDED 是真实编译验证
不是 syntax check 不是 dry run — 是完整的 xcodebuild build 跑通：
- Swift 编译 → 链接 → CodeSign → Validate → Touch
- 完整 .app bundle 生成
- 含 NWBrowser/NWConnection 用法（如果 API 误用会编译失败）
- Info.plist 含 NSBonjourServices = ["_vessel._tcp"]（plutil -p 验证过）

### PASS: Eva path 完全不受影响
- Settings.swift / BackendClient.swift / ContentView.swift 0 改动
- 现有 com.albertsun6.claudeweb-native bundle id 保留
- TestFlight 装机记录不会因为 β 而失效
- 现有 saved backendURL（Tailscale / 手填）仍然 work

operator 接受 β 后立即装新 build，原有功能毫发无损 —— 这是 β 段保守路线
的核心安全特性。

### MINOR-1: Eva 仓库内 ClaudeWeb→Vessel 重命名仍未发生
β 范围决策不做（避免破坏性 git mv），但 plan 写的是"M2-iOS: iOS Vessel
适配（Eva iOS 改名 + Bonjour Network.framework）"。改名最终一定要做，
β 把它推到 γ。
**Verdict**: MINOR — defer to γ TestFlight 切换前一起做（用户明确承担时机）。

### Finding 矩阵汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | BonjourBrowser 没接入 ContentView/Settings UI | defer/UI 接入段 |
| MINOR-arch-2 | MINOR | architect | 没 Swift 单元测试 | defer |
| MINOR-prag-1 | MINOR | pragmatist | VesselHealth.BonjourInfo 全 Optional 可改 enum | accepted-as-is |
| MINOR-prag-2 | MINOR | pragmatist | 没 backendURL 写回 helper | defer/UI 接入段 |
| MINOR-risk-1 | MINOR | risk | scheme 校验 | defer/UI 接入时校验 |
| MINOR-risk-2 | MINOR | risk | host 解析 unknown default | accepted-as-is |
| MINOR-cursor-1 | MINOR | cursor | ClaudeWeb→Vessel 重命名延迟到 γ | deferred/γ |

7 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now.

## Verdict: PASS
