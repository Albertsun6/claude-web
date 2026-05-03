# Cross Review — M0 permissionModes server-driven + related config ADRs

**Reviewer**: reviewer-cross  
**Model**: gpt-5.5-medium (via cursor-agent CLI)  
**Date**: 2026-05-03 15:00  
**Files reviewed**:
- docs/proposals/M0_PERMISSION_MODES.md
- docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md
- docs/adr/ADR-0011-server-driven-thin-shell.md
- docs/adr/ADR-0015-schema-migration.md

---

## Summary

- Blockers: 0
- Majors: 3
- Minors: 4
- 总体判断：建议小改后合并

## Numeric Score（Round 1 contract #2 cross M3 修正：与 ReviewVerdict DTO 对齐）

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 4.0 |
| 跨端对齐 | 3.5 |
| 不可逆 | 4.0 |
| 安全 | 4.5 |
| 简化 | 3.5 |

**Overall score**：3.9

## Findings

### M1 [MAJOR] `permissionModes` 缺失时的回滚兼容叙述互相矛盾

**Where**: `docs/proposals/M0_PERMISSION_MODES.md §3.1 / §4.1 / §8 OQ-C`  
**Lens**: 正确性 / 跨端对齐  
**Issue**: §3.1 写 `v1.1 build 32 | v1.0 server` 期望 “Codable 可选字段缺省”，但 §4.1 里 `HarnessConfig.permissionModes` 是非 optional，§8 OQ-C 又明确倾向非 optional，缺失时 decode 失败再 fallback。  
**Why this is major**: 这是 minor bump 回滚路径的核心契约。实现者按 §3.1 会把它做成 optional；按 §4.1/§8 会做成 required。两种行为对缓存、fallback、telemetry 以及灰度回滚完全不同。  
**Suggested fix**: 二选一写死：
- 若要支持 `build32 + v1.0 server` graceful decode：Swift 写 `let permissionModes: [PermissionModeItem]?`，Store 层缺失时用 bundled default。
- 若要保持 required：把 §3.1 期望改成 “decode fails, falls back to bundled v1.1 fallback config, emits telemetry warn”，不要再写 “Codable 可选字段缺省”。

### M2 [MAJOR] `riskLevel` 说要锁 enum，但 Swift 契约仍是裸 `String?`

**Where**: `docs/proposals/M0_PERMISSION_MODES.md §1 / §4.1 / §8 OQ-B`  
**Lens**: 跨端对齐 / 不可逆  
**Issue**: TS 侧 `riskLevel` 是 `z.enum(["low", "medium", "high"]).optional()`，OQ-B 也说“锁 enum”；Swift 侧却是 `let riskLevel: String?`。  
**Why this is major**: UI 会按 `low/medium/high` 分支渲染颜色。如果 Swift 不建模 enum 或 unknown fallback，未来 server typo 或新增值会静默落入默认路径，风险提示可能消失。  
**Suggested fix**: Swift 明确写成类似：
`enum PermissionRiskLevel: String, Codable { case low, medium, high, unknown }`，并用自定义 decode 把未知值落到 `.unknown`。同时 Settings 对 `.unknown` 使用默认色并记录 telemetry warn。

### M3 [MAJOR] `ADR-0011` 仍保留与 M0 modelList 决议冲突的 `config_changed` wording

**Where**: `docs/adr/ADR-0011-server-driven-thin-shell.md §最小协议层行为契约 / fallback 行为`  
**Lens**: 正确性 / 跨端对齐  
**Issue**: ADR 前文 Decision #3 已改成 M0 不做 WS push，只靠 backend 重启 + WS reconnect + GET config；但后面的 fallback 行为仍写 “ETag 不匹配 → 静默 refetch + WS 推 `config_changed`”。  
**Why this is major**: ADR 是后续实现者会依赖的规范。这里保留旧说法，会让 M0 实施时误加 WS event，或让验收误以为必须有 push。  
**Suggested fix**: 把该 bullet 改为 “WS reconnect 或 app foreground/refetch 时携带 If-None-Match；ETag 不匹配则 200 更新”。`config_changed` 只留在 M0.5+ 不在范围。

### m1 [MINOR] `PermissionModeItem.isDefault` exactly-one 没限定是否只在 enabled/available mode 内检查

**Where**: `docs/proposals/M0_PERMISSION_MODES.md §1 / §2`  
**Lens**: 正确性 / 不可逆  
**Issue**: modelList 的规则是 `isDefault && enabled` exactly-one；permissionModes 当前没有 `enabled` 字段，但未来若要灰度隐藏某个 mode，会立刻遇到默认值语义问题。  
**Suggested fix**: 现在可以不加 `enabled`，但要把 invariant 写清楚：“M0 permissionModes 没有 disabled 状态，因此 exactly-one over all items；未来加 enabled 时必须改为 enabled+isDefault exactly-one”。

### m2 [MINOR] `displayName` 中英文和括号文案被协议化，后续 i18n / 文案调整会牵动配置含义

**Where**: `docs/proposals/M0_PERMISSION_MODES.md §1 初始 4 项`  
**Lens**: 不可逆 / 简化  
**Issue**: `displayName` 同时承载 mode 名称、中文解释、风险提示，例如 `Plan（只读规划，最安全）`。后续 UI 如果又按 `riskLevel` 着色，`displayName` 里的“最安全/最危险”会和结构化字段重复。  
**Suggested fix**: `displayName` 保持短名，如 `Plan` / `Default` / `Accept Edits` / `Bypass`；中文说明放 `description`，风险只由 `riskLevel` 表达。

### m3 [MINOR] build 31 graceful skip 的证据字段不够具体

**Where**: `docs/proposals/M0_PERMISSION_MODES.md §3.2 / §6.2`  
**Lens**: 正确性 / 安全  
**Issue**: 验收写 telemetry `harness_store.refetch.updated` 含 build 31 + 新 etag + models=3，但没有要求记录 `protocolVersion=1.1` 或 “unknown field skipped / decode success” 这一类可证明字段。  
**Suggested fix**: 验收证据加一条：telemetry props 至少包含 `protocolVersion`, `etag`, `modelCount`, `buildVersion`。否则只能证明拿到某次更新，不能证明 build 31 成功吃到了 v1.1 payload。

### m4 [MINOR] `permissionModes` 与实际发送 prompt 的 `permissionMode` 枚举对齐缺少测试项

**Where**: `docs/proposals/M0_PERMISSION_MODES.md §1 / §5 / §6`  
**Lens**: 跨端对齐  
**Issue**: 提案说 `PermissionModeIdSchema` 与 `ClientMessage.permissionMode + cli-runner` 一致，但验收只覆盖 Settings 显示，没有覆盖用户选中 server-driven mode 后，发送 prompt 的 `ClientMessage.permissionMode` 仍是同一个字符串。  
**Suggested fix**: 自动化或手动验收加一项：分别选择 4 个 mode，确认 outbound WS `ClientMessage.permissionMode` 值完全等于 config item `id`，至少覆盖 `plan` 和 `bypassPermissions`。

## False-Positive Watch

- F? M2 可能是 false positive，如果 Swift 现有代码约定所有 server-driven hint enum 都先用 `String`，再由 UI 层 switch default 处理。但本提案 OQ-B 明确写“锁 enum”，所以我仍按跨端不一致记 major。
- F? m1 是面向后续扩展的语义提醒。M0 没有 `enabled` 字段时不阻塞实施。

## What I Did Not Look At

- Did not read actual repository files or run tests; review is based only on the pasted artifacts.
- Did not verify current Swift `HarnessProtocol.swift` implementation.
- Did not verify current `ClientMessage.permissionMode` / CLI permission mode enum in code.
- Did not check external Apple Codable behavior beyond the contract described in the proposal.
