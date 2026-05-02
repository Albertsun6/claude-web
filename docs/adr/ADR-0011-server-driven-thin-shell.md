# ADR-0011 — Server-driven Thin-shell iOS Configuration

**状态**：**Proposed**（2026-05-03，M-1 立项 placeholder；决定推到 M0 升级为 Accepted）

**Decider（pending）**：用户 + reviewer-cross + reviewer-architecture（M0 验收 ritual）

**关联**：[ADR-0015](ADR-0015-schema-migration.md) · [HARNESS_PROTOCOL.md](../HARNESS_PROTOCOL.md) · [HARNESS_ROADMAP.md §0 #1](../HARNESS_ROADMAP.md)（iOS thin shell 原则）· [CLAUDE.md "iOS path policy"](../../CLAUDE.md)

---

## Context

Seaidea iOS 原生 app 是 thin shell（CLAUDE.md 既定路线），核心约束：

- 改 Swift 代码就要重装 / TestFlight，成本贵
- 大量内容（模型列表 / 权限模式说明 / onboarding 文案 / decisionForms / agentProfiles / featureFlags）应该由后端配置下发，而不是写死在二进制里
- harness 流水线有 12+ AgentProfile、10 Stage、N 个 decisionForm，未来还会增——这些都不该重装才能迭代

但纯 server-driven 也有风险（详见 [.claude/skills/harness-architecture-review/LEARNINGS.md #1](../../.claude/skills/harness-architecture-review/LEARNINGS.md)）：
- iOS 老版本撞上后端新字段 → decode 失败一夜炸
- "看似 thin，实际到处兼容分支"的负债
- minClientVersion 检测 + fallback 行为不约定，灰度升级会乱

---

## Decision (Pending — M0 时敲定)

**M-1 立项**（本 ADR）：声明 server-driven thin-shell 是长期路线，关键约束在 M0 实施时落定：

1. **服务端 endpoint**：`GET /api/harness/config` 返回 schema：`{ stages, agentProfiles, decisionForms, modelList, reviewMatrix, methodologyTemplates, promptTemplates, featureFlags, copy, healthChecks, protocolVersion, minClientVersion }`
2. **iOS 端**：HarnessStore 持有 config snapshot；冷启动用打包内 fallback config 兜底；联网后拉新 config + ETag 缓存
3. **WS 推送**：`harness_event { kind: "config_changed" }` → iOS 自动 refetch（不重装）
4. **版本协商**：`HARNESS_PROTOCOL_VERSION = "1.0"` + `MIN_CLIENT_VERSION = "1.0"`；`clientVersion < MIN_CLIENT_VERSION` → 推升级提示 + fallback config
5. **离线兜底范围**（用户 M0 敲定）：iOS fallback config 仅保留**老聊天功能**；Board / Decision / 创建 Initiative 在离线 / 未连接时显示"未连接"占位

---

## Why placeholder ADR (not deferred entirely)

ADR-0015 §"与 ADR-0011 的协作" 引用本 ADR 描述四端同步语义。如果本 ADR 不立项，那段引用悬空（[Round 1 评审 BLOCKER-1](../HARNESS_REVIEW_LOG.md) 指出过这个孤悬引用）。

立 placeholder ADR 的好处：
- ADR-0015 引用有锚点
- HARNESS_PROTOCOL.md / HARNESS_ROADMAP.md §0 #1 可以指向具体 status
- M0 升级为 Accepted 时只需追加 Decision / Consequences 段，不重写

---

## Consequences (Pending Decision)

待 M0 决策完成后填补。M-1 阶段仅承认本 ADR 处于 Proposed status。

---

## 与 ADR-0015 的衔接

[ADR-0015](ADR-0015-schema-migration.md) §"与 ADR-0011 的协作" 已说明：
- minor bump（加 stage / agentProfile）→ 老 iOS 不重装就能通过 server-driven config 显示新内容
- major bump（改语义）→ iOS 必须重装；server config 检测 minClientVersion 后吐 fallback

本 ADR 升级为 Accepted 时，需要把上述协作落到具体 payload schema（M0 任务）。
