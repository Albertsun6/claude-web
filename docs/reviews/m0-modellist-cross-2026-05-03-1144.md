我会按你贴出的 artifact 内容直接做静态 cross-review，只输出 verdict markdown，不改文件也不跑命令。# Cross Review — M0 Harness Config ModelList

**Reviewer**: reviewer-cross  
**Model**: gpt-5.5-medium (via cursor-agent CLI)  
**Date**: 2026-05-03 11:44  
**Files reviewed**:
- docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md
- docs/HARNESS_PROTOCOL.md
- docs/adr/ADR-0011-server-driven-thin-shell.md

---

## Summary

- Blockers: 2
- Majors: 4
- Minors: 3
- 总体判断：必须先修

## Numeric Score

| Lens | Score (0..5) |
|---|---|
| 正确性 | 2.5 |
| 跨端对齐 | 2.0 |
| 不可逆 | 3.0 |
| 安全 | 4.0 |
| 简化 | 3.5 |

**Overall score**：3.0（有 blocker，上限 3.9）

## Findings

### B1 [BLOCKER] M0 是否有 `config_changed` WS push 前后矛盾

**Where**: `docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md §0 / §2.4 / §5.2`, `docs/adr/ADR-0011-server-driven-thin-shell.md Decision #3`  
**Lens**: 正确性 / 跨端对齐  
**Issue**: §0 和 §5.2 把“WS 推 `config_changed`”列为 M0 退出条件，但 §2.4 又明确说 M0 不引入额外 push，`config_changed` 推到 M0.5。ADR-0011 也把 WS push 写成 server-driven thin-shell 的核心行为。  
**Why this is a blocker**: 这个矛盾会让实现者和验收者无法判断 M0 到底该做什么。若只靠 backend 重启 + iOS reconnect refetch，就不应该验收 WS push；若要验收 `config_changed`，backend 必须实现真实事件。  
**Suggested fix**: 二选一并全文件统一：
- M0 简化版：删除 §0 / §5.2 / ADR-0011 中“WS 推 `config_changed`”作为 M0 必须项，改成“WS 重连后 iOS 立即 GET config”。
- M0 完整版：保留验收项，并在 backend WS 协议中实现 `harness_event { kind: "config_changed" }`。

### B2 [BLOCKER] ETag canonical JSON 算法按字面实现会忽略嵌套字段

**Where**: `docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md §1.3 ETag 算法`  
**Lens**: 正确性  
**Issue**: 文中写 `JSON.stringify({ protocolVersion, minClientVersion, modelList }, Object.keys 排序)`。如果实现者用 `JSON.stringify(value, sortedKeys)`，第二个参数在 JS 里是“全层级 key 白名单”，不是递归排序器。结果 `modelList` 里的 `id/displayName/capabilities/...` 可能被过滤掉，ETag 不随模型字段变化。  
**Why this is a blocker**: M0 的核心目标就是“改 modelList 后 iOS 看到新列表”。如果 ETag 不覆盖嵌套字段，客户端可能收到 304，继续用旧配置。  
**Suggested fix**: 明确写成递归 canonicalizer：对 object 的 keys 递归排序，array 保持顺序，所有 primitive 原样序列化；并加 fixture 测试，断言改 `displayName` / `capabilities.contextWindow` / `recommendedFor` 都会改变 etag。

### M1 [MAJOR] `isDefault` exactly-one 只写在注释，schema 没 enforce

**Where**: `docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md §1.1 ModelListItem schema`, field `isDefault`  
**Lens**: 正确性 / 跨端对齐  
**Issue**: 注释说 `exactly one item should be true`，但 `ModelListItemSchema` 只能验证单项，`HarnessConfigSchema` 没有 `.superRefine()` 保证全局恰好一个默认模型。  
**Suggested fix**: 在 `HarnessConfigSchema` 上加 cross-item 校验：`modelList.filter(m => m.isDefault && m.enabled).length === 1`。如果允许 default 被 disabled，也要明确 fallback 规则。

### M2 [MAJOR] `HARNESS_PROTOCOL.md` 内 ID 契约仍自相矛盾

**Where**: `docs/HARNESS_PROTOCOL.md §1 ID`, `docs/HARNESS_PROTOCOL.md §8 ID 格式契约`  
**Lens**: 跨端对齐 / 不可逆  
**Issue**: §1 仍写“ID UUIDv4 字符串”，但 §8 又说所有 `id` / `*Id` 是 opaque stable string，推荐 `<type>-<ULID>`，不强制 UUIDv4。  
**Suggested fix**: 把 §1 表格中的 ID 行改成 opaque stable string，并注明“不解析内容；推荐 `<type>-<ULID>`；只要求稳定 unique”。否则新 `modelList.id` 的 opaque 约定会和全局协议相冲突。

### M3 [MAJOR] ADR-0011 的 endpoint payload 仍是全量 config，和 M0 modelList-only 不一致

**Where**: `docs/adr/ADR-0011-server-driven-thin-shell.md Decision #1`, `docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md §1.2 / §7`  
**Lens**: 跨端对齐 / 不可逆  
**Issue**: ADR-0011 写 `/api/harness/config` 返回 `{ stages, agentProfiles, decisionForms, modelList, ... }`，但 M0 proposal 明确只返回 `protocolVersion/minClientVersion/etag/modelList`，其他推到 M1+。  
**Suggested fix**: M0 若要把 ADR-0011 升级 Accepted，必须同步改 ADR：把“完整 config”改成“分阶段扩展的 config，M0 仅 modelList”，并把新增字段规则写成 minor bump + old client graceful skip。

### M4 [MAJOR] iOS fallback config 的来源仍是 open question，但它是 M0 核心验收路径

**Where**: `docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md §3.1 / §3.5 / §6 OQ-A / §5.2`  
**Lens**: 正确性 / 跨端对齐  
**Issue**: proposal 多处要求“离线用打包内 fallback config”，但 OQ-A 仍未定 fallback 是 Bundle JSON、codegen、还是 Swift hardcode。  
**Suggested fix**: M0 契约应直接选定一个方案。建议选 Bundle JSON，并要求 Swift fallback decode 同一份 fixture；这样能减少 backend hardcode 与 iOS hardcode 漂移。

### m1 [MINOR] `enabled=false` 的“隐藏但回退仍可用”语义不清

**Where**: `docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md §1.1 field enabled`, `§3.4 Settings.swift 接 modelList`  
**Lens**: 正确性 / 跨端对齐  
**Issue**: §1.1 说 `enabled: false` 时 UI 隐藏但 fallback 仍含，用户回退老模型仍可用；§3.4 又说 Settings 过滤 `enabled: true`。如果当前已选模型变成 disabled，Picker 会不会还能显示并保留选择，没有定义。  
**Suggested fix**: 明确规则：disabled 模型不出现在新选择列表；若当前 selection 已是 disabled，则保留并显示“已停用”标签，用户切走后不可再选。

### m2 [MINOR] ETag header 是否加 HTTP 标准引号未定义

**Where**: `docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md §2.1 Response 200 / 304`  
**Lens**: 正确性  
**Issue**: 文中写 `ETag: <current etag>`，没有说明是否使用标准 HTTP ETag 引号，例如 `"sha256:xxxx"`。  
**Suggested fix**: 明确统一格式。推荐 header 用标准 quoted ETag，body 内 `etag` 字段保持裸字符串；服务端比较时同时兼容 quoted / unquoted `If-None-Match`。

### m3 [MINOR] endpoint auth 继承关系没有写明

**Where**: `docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md §2 Backend endpoint`  
**Lens**: 安全 / 运维风险  
**Issue**: `/api/harness/config` 是否走现有 `CLAUDE_WEB_TOKEN` auth 没写。modelList 本身不敏感，但 config endpoint 后续会承载 featureFlags、agentProfiles、healthChecks，提前锁住 auth 继承更稳。  
**Suggested fix**: 在 §2.1 增加一句：该 endpoint 挂在现有 `/api/*` auth 体系下，和 projects/sessions/fs 一样支持 bearer token；localhost/dev 行为沿用现有 auth 策略。

## False-Positive Watch

- F? B2 取决于作者实际准备怎么实现 `canonical_json`。如果实现者本来就打算写递归 canonicalizer，而不是用 `JSON.stringify(value, sortedKeysArray)`，那这是文档表达问题，不是实现 bug。但契约文本现在足够容易被按错方式实现。
- F? m3 如果 backend 的路由挂载层天然已经全局套 auth，这条只是文档缺口，不一定是代码风险。

## What I Did Not Look At

- 没有运行测试或验证现有 Zod / Swift 实现。
- 没有读取真实 `packages/shared/src/harness-protocol.ts`、`HarnessProtocol.swift`、`Cache.swift`、`Settings.swift`。
- 没有检查 backend 当前 auth middleware 的实际挂载方式。
- 没有检查 ADR-0015 的版本升级规则全文。
