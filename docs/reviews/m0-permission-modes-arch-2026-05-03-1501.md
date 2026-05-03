# Architecture Review — M0_PERMISSION_MODES.md (mini-milestone B, server-driven permissionModes + minor bump 真测)

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7 (1M)
**Date**: 2026-05-03 15:01
**Files reviewed**:
- /Users/yongqian/Desktop/claude-web/docs/proposals/M0_PERMISSION_MODES.md
- /Users/yongqian/Desktop/claude-web/docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md (前作同源)
- /Users/yongqian/Desktop/claude-web/docs/adr/ADR-0015-schema-migration.md
- /Users/yongqian/Desktop/claude-web/packages/shared/fixtures/harness/fallback-config.json
- /Users/yongqian/Desktop/claude-web/packages/shared/src/harness-protocol.ts (相关段)
- /Users/yongqian/Desktop/claude-web/packages/shared/src/protocol.ts (PermissionMode 现状)
- /Users/yongqian/Desktop/claude-web/packages/backend/src/cli-runner.ts (permission-hook 现状)
- /Users/yongqian/Desktop/claude-web/packages/ios-native/Sources/ClaudeWeb/Settings.swift (硬编码现状)
- /Users/yongqian/Desktop/claude-web/packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift (Codable 现状)
- /Users/yongqian/Desktop/claude-web/packages/ios-native/Sources/ClaudeWeb/HarnessConfigAPI.swift (现状)

## Summary
- Blockers: 1
- Majors: 3
- Minors: 4
- 总体判断：**建议小改后合并**——核心方向对（modelList 模式复刻 + minor bump 真测有价值），但 §4.1 把 build 32 的 `permissionModes` 写成 non-optional 与 §7 风险 4 / OQ-C "倾向 non-optional" 共同制造了一个**单向自陷 trap**：build 32 一旦 ship，backend 永远回不到 v1.0 schema，等于把 ADR-0015 minor bump "永久兼容（additive only）" 的对称性单方向打掉。这是一行字 (`[PermissionModeItem]?` vs `[PermissionModeItem]`) 就能修的事，但没修就 ship 会埋一颗锁定 backend 的雷。

---

## [BLOCKER-1] iOS `HarnessConfig.permissionModes` non-optional 与 ADR-0015 minor bump "永久兼容" 形成单向 trap

**Where**: §4.1 Codable 定义 `let permissionModes: [PermissionModeItem]` + §7 风险表第 3、4 行 + §8 OQ-C "作者倾向 non-optional"

**Lens**: 架构可行性 + 风险遗漏

**Issue**:
- §3.1 验证矩阵第 4 行明确写了一种合法状态："v1.1 build 32 + Server payload v1.0 → ✅ Codable 可选字段缺省"。
- 但 §4.1 把 `permissionModes` 声明为非可选 `[PermissionModeItem]`。Swift `JSONDecoder` 默认 init(from:) 在非可选属性缺失 key 时抛 `DecodingError.keyNotFound`，**不会**走"默认值"——Swift Codable **没有**"缺省字段使用空数组"这种隐式行为。
- HarnessConfigAPI.swift:55 当前实现：`let cfg = try JSONDecoder().decode(HarnessConfig.self, from: data)`，decode 失败直接 throw 给 HarnessStore.refetch()，整次 refetch 失败 → store 保留旧 cache，但 telemetry 会出 `harness_store.refetch.error`。
- 后果链：
  1. build 32 ship → 已装机用户的 client schema 是 v1.1（要求 permissionModes）
  2. 任意时刻 backend 想回滚到 v1.0 (删 permissionModes / 回退 fallback-config.json) → build 32 client decode 失败 → Settings 卡 fallback Bundle config + 看不到 backend 任何更新
  3. 这等于宣布 backend **永远不能去除 permissionModes 字段**，违反 ADR-0015 "minor bump 永久兼容" 的对称语义
- §8 OQ-C 的备选 "若想保险：写 optional `[PermissionModeItem]?`，但需要在 build 31 升级之前 backend 不能去除该字段" — 这条**逻辑反了**：build 31 与此完全无关 (build 31 根本不知道 permissionModes 字段)。"backend 不能去除字段" 是 ADR-0015 minor 档的天然约束 (additive only)，不是 optional 的代价。这条理由站不住，作者倾向背后的判断是错的。

**Why blocker**:
本提案的**自我宣称的最大价值**是 "**真实验证 ADR-0015 minor bump 流程**"（§0、§3 标题）。如果 build 32 ship 出去就把 backend 锁死在 v1.1 不能回滚，那这次 mini-milestone 不是"验证 minor bump"，而是"演示 minor bump 半边可行另半边失效"。验证矩阵第 4 行成了一份**永远跑不了**的测试 (build 32 装机后 backend 没法回 v1.0 来观察缺省字段行为)。第二契约是建立基线，基线写歪后续 M0.5+ permissionModes / agentProfiles / decisionForms 全跟。

**Suggested fix**:
- §4.1 改为 `let permissionModes: [PermissionModeItem]?`（optional）
- 改 §8 OQ-C 决议为 "**optional**——理由：让 ADR-0015 minor bump 双向兼容；缺省字段时 Settings 仍然可以 fall back to 硬编码 4 项 (cutover 兜底)"
- §7 风险表删掉第 4 行 (cache 路径自然成立)
- §5 step #6 改 `let permissionModes: [PermissionModeItem]?`
- §5.2 验证矩阵第 4 行改为 "可选字段缺省 → Settings 走兜底硬编码 4 项 + 加 telemetry warn"
- 加单元测试：`HarnessConfig` decode v1.0 payload 不抛 (verify optional)

---

## [MAJOR-1] §3.1 验证矩阵第 4 行 "v1.0 payload" 测试在实施步骤里没有可执行入口

**Where**: §3.1 验证矩阵 row 4 vs §5 实施步骤 #5 / §6 验收

**Lens**: 里程碑裁剪

**Issue**:
- 矩阵 row 4 "v1.1 build 32 + v1.0 payload" 是 ADR-0015 双向兼容的**关键测试**（不仅是 build 31 单向）
- §5 实施步骤 #5 只测 row 2 ("build 31 收 v1.1")
- §6.2 验收只勾 build 31 graceful skip
- §6.3 验收只勾 "build 32 收 v1.1"
- **row 3 (build 32 收 v1.1 全功能) + row 4 (build 32 收 v1.0 缺省字段)** 在哪一步真跑？没写
- 如果不显式跑 row 4，BLOCKER-1 永远不会被这个 RFC 自己发现

**Suggested fix**:
- §5 加 step "#5b 真机回滚验证：临时把 fallback-config.json 改回 v1.0 (删 permissionModes，protocolVersion 改 '1.0') → backend 重启 → build 32 telemetry 应仍正常 / Settings 走硬编码兜底 / 不崩 → 改完测完再恢复 v1.1"
- §6.2 加 row 4 验收 checkbox "build 32 收 v1.0 payload graceful 兜底，不崩"

---

## [MAJOR-2] riskLevel enum vs recommendedFor 非 enum 的取舍说明在 RFC 里**反**了 modelList Round 共识

**Where**: §1 (PermissionModeItem) `riskLevel: z.enum(["low","medium","high"]).optional()` + §8 OQ-B "倾向 锁 enum"

**Lens**: 架构可行性

**Issue**:
- modelList Round phase 3 收敛 (M0_HARNESS_CONFIG_MODELLIST.md §1.1 "字段语义" 第二点)：`recommendedFor` **不锁 enum**，hint-only string array，未知值 graceful skip → 这是 phase 3 arch MAJOR-3 + cross refine 的明确结果
- 现在 permissionModes 反过来：`riskLevel` **锁 enum** + UI "switch case 渲染颜色" (§8 OQ-B)
- 不一致风险：
  - server 想加 `riskLevel: "critical"` (例如新加自动 git push 模式) → build 32 Zod parse 失败 (server-side) 或 iOS Codable decode 失败 (client-side，因为 Swift `String` raw value 对枚举非 raw enum 没事，但如果作者后续把 Swift 也写成 enum 就崩)
  - 等于把 "未来加新 mode" 从 minor bump 变成 major bump
- 作者倾向 "三档够用" 是当前判断；ADR-0015 §"不允许的操作" 第二条 "minor bump 里删字段或改语义"，加 enum 值算 minor 的 graceful path，**但前提是 hint-only string** (像 modelList 的 recommendedFor)
- §1 把 PermissionMode**Id** 锁 enum 是对的 (这是核心契约，cli-runner.ts:58 直接 `--permission-mode` 透传)；但 `riskLevel` 是纯 UI hint，没有契约价值，没必要锁

**Suggested fix**:
- §1 `riskLevel` 改 `z.string().optional()` (未知值 graceful skip + UI 用 if/else 而非 switch exhaustive)
- §8 OQ-B 决议改为 "**不锁 enum，与 modelList recommendedFor 一致**——hint-only，未知值 graceful skip，未来加 'critical' 不需要 major bump"
- §4.2 iOS Settings cutover 着色逻辑改为 `switch riskLevel { case "low": ...; case "medium": ...; case "high": ...; default: 默认色 }`
- 这样保持与 modelList Round 共识对称，建立 "枚举锁定权属于契约字段，非契约字段一律 string + graceful skip" 的可复用规则

---

## [MAJOR-3] iOS Codable 默认 ignoreUnknownKeys 是 Apple 文档默认且**不可关闭**——但 RFC §3.2 + §7 风险 1 写得像是"可能崩"，自我矛盾

**Where**: §3.2 测试方法第 4 步 "Swift Codable 默认 decode 时忽略 JSON 中未声明的字段" + §7 风险表第 1 行 "Swift Codable 收到未知字段 strict 模式 → decode 失败 → build 31 崩"

**Lens**: 架构可行性 + 风险遗漏

**Issue**:
- Swift `JSONDecoder` 对 **unknown keys 默认 silently ignore**——这是 `Decodable` 协议的合成 init(from:) 行为，没有 strict 开关 (与 Zod 的 `.strict()` 不同)
- 也就是说 §3.2 的 graceful skip 行为是 **平台保证** (`Decodable` 协议本身)，不是 build 31 实现幸运
- §7 风险 1 "Swift Codable 收到未知字段 strict 模式" 的中和缓解 "iOS 17 默认 ignoreUnknownKeys" 措辞混淆——iOS 版本无关，Swift 1.0+ 的 Codable 都这样 (`Decodable` synthesized init)
- 真正风险不是 build 31 strict，而是**作者后续给 HarnessConfig 写自定义 init(from:) 用 `decoder.container.allKeys` 校验** —— 这才会崩，但 RFC 没说会写
- 现读 HarnessConfigAPI.swift:55 是 default `JSONDecoder()`，没自定义 → graceful skip 板上钉钉

**Why not blocker**: 风险评估方向反了但结论没错 (build 31 确实不会崩)。不过 §3.3 失败兜底 "Zod `.passthrough()` 而不是依赖 Swift 默认行为" 这句把读者引向"双端都得显式声明 passthrough"，**不对**——Zod passthrough 是 backend 校验生成的 payload，与 iOS 解析无关；iOS 端没有 strict 模式可关。

**Suggested fix**:
- §3.2 step 4 改为 "Swift `Decodable` 协议合成的 init(from:) **协议保证** silently ignore 未知 key——这是平台行为，不是 iOS 17 特性，不会 (也不能) 关闭"
- §7 风险表 row 1 "Swift Codable 收到未知字段 strict 模式" 整行删掉，换成 "未来若有人给 HarnessConfig 写自定义 init(from:) 显式校验 allKeys → 加 PR 审查 checklist：HarnessConfig Codable 不允许自定义 init"
- §3.3 失败兜底删 ".passthrough()" 这条 (Zod passthrough 防的是后端 strict 校验把扩展字段拒掉，与 iOS graceful skip 无关，作者把方向搞混了)

---

## [MINOR-1] §0 退出条件没写 ADR-0011 / ADR-0015 同步更新动作 (modelList Round 教训漏了)

**Where**: §0 退出条件 vs M0_HARNESS_CONFIG_MODELLIST.md OQ-D 决议

**Lens**: 里程碑裁剪

**Issue**: modelList Round phase 3 OQ-D 明确写了 "M0 实施完不仅推迟 Accepted，**还必须同步改 ADR-0011 Decision #1 写'分阶段扩展...'**"。本提案 §0 退出条件 + §5 实施步骤都没列对应动作 (此次 minor bump 应该在 ADR-0015 加一条经验性 footnote："首次真验证发生于 mini-milestone B，结果：xxx")。

**Suggested fix**: §5 加 step #11 "ADR-0015 加 footnote 记录首次 minor bump 真验证结果 + ADR-0011 Decision #1 列表加 'permissionModes (mini-B, 1.0→1.1)' 一行 audit"。

---

## [MINOR-2] 「2h 总工作量」这种日历估算与 user 的 "[no-time-estimates]" 偏好冲突

**Where**: §5 表末 "总：~2h"

**Lens**: 里程碑裁剪 (规范遵循)

**Issue**: 用户 MEMORY 中 [No time estimates in AI plans](feedback_no_time_estimates.md) 明确"用准入/退出条件推进，不用日历估算"。本提案把"工作量"列入步骤表 + "总：~2h"。modelList Round 也有但被复用。

**Suggested fix**: 表头 "工作量" 列删掉 + "总：~2h" 删掉，改为 §0 退出条件就是准入/退出。modelList Round 也建议补丁。

---

## [MINOR-3] PermissionModeId enum 锁定与 cli-runner 实际处理一致性的"硬关系"没在 RFC 里 trace 到代码

**Where**: §1 PermissionModeIdSchema "锁 enum：与 ClientMessage.permissionMode + cli-runner 实际 permission-hook 处理一致"

**Lens**: 架构可行性

**Issue**: 这个一致性约束有三个相关位置，都需要 keep in sync：
1. `packages/shared/src/protocol.ts:1-5` `PermissionMode` type union
2. `packages/backend/src/cli-runner.ts:58` `--permission-mode` 透传 (字符串 pass-through，不校验)
3. cli-runner.ts:66 `if (... permissionMode !== "bypassPermissions")` (硬编码字符串字面量比较)

如果未来 server config 加 `"yolo"` mode，三个位置都要改 + permission-hook 也要 case 处理。RFC 没标 "本提案不增加新 mode；新增需要 ADR + cli-runner 配套"，未来 contributor 可能只改 fallback-config 就以为生效。

**Suggested fix**: §1 加注 "**新增 PermissionModeId 必须三端同步**：(1) shared/protocol.ts PermissionMode union；(2) shared/harness-protocol.ts PermissionModeIdSchema enum；(3) cli-runner.ts permission-hook 行为分支。否则 backend 收到 server-driven 新 mode 透传到 CLI 会被 reject。"

---

## [MINOR-4] §5 验证步骤 #5 "watch telemetry" 没说怎么 watch，与 modelList Round 实测路径有 gap

**Where**: §5 step #5

**Lens**: 风险遗漏 (执行边界)

**Issue**: "watch telemetry harness_store.refetch.updated build 31 应仍成功" — 路径是 `~/.claude-web/telemetry.jsonl` (CLAUDE.md 说明)，需要 `tail -F | jq 'select(.event=="harness_store.refetch.updated")'`。modelList Round 是 doc-only 不重装真机 (§5.2 第 6 行)，本提案是 "**不重装 build 31**" + "watch telemetry"，但 build 31 能不能 push telemetry？需要 build 31 还在跑 + 网络畅通，**用户必须把 build 31 那台手机当时拿在手里 + 没换新装**。如果用户已在 build 31 之后装过别的 build (比如 v2 dogfood 期间)，build 31 已经被覆盖，验证不可能。

**Suggested fix**: §5 step #5 加前置条件 "**前提**：当前真机仍跑 build 31 (未升级到 v2 dogfood 或其他 build)；如果已升级，本验证回退为 'sim 跑 build 31 fixture-frozen 版本' 或推迟到 mini-C"。

---

## 4 维评审

### 架构可行性

复刻 modelList Round 模式是**对的方向**：M0 mini-milestone 应该 small bites，每个 mini 验证一项基础能力 (mini-A modelList = end-to-end fetch chain + 试 single-source；mini-B permissionModes = minor bump 真验证)。**但 BLOCKER-1 揭示 RFC 把 minor bump 验证写成单方向**：只测了"老 client + 新 payload" graceful skip，没意识到对称的"新 client + 老 payload" 走 `non-optional` 会自陷，把后续 minor bump 的回滚自由度永久砍掉。这是把 contract 写半边的典型错误，与 phase 3 cross B2 ETag 当时漏的 "key 白名单 vs 递归" 同族 (单方向想清楚，反方向漏)。

iOS Codable 的平台行为 (`Decodable` 协议合成 init 默认 silently ignore) 在 RFC §3.2 + §7 措辞中被错误归因为 "iOS 17 默认" / "strict 模式可能开" (MAJOR-3)，反映出作者对 Swift 协议层与 Zod `.strict() / .passthrough()` 概念混了。这不是阻断 ship 的事，但留这种描述在 RFC 里会让后续 contributor (尤其其他 AI 评审 / 实施 agent) 误以为 iOS 端要做防御性改动 → 可能添加多余自定义 init(from:) → 反而引入真崩点。

PermissionModeIdSchema 锁 enum 是对的 (契约) ；riskLevel 锁 enum 反了 modelList Round "hint-only string + graceful skip" 共识 (MAJOR-2)，破坏了"锁定权属于契约字段"这条可复用规则。

### 里程碑裁剪

mini-milestone B 的**主自承价值** "真实验证 ADR-0015 minor bump 流程" (§0、§3 标题) 设计了 4 行验证矩阵但只跑 2 行 (MAJOR-1)。row 3、row 4 在实施步骤完全没入口，等于把"验证基线"做成了"验证一半"。建议补 step "#5b 真机回滚验证" + §6.2 row 4 验收 checkbox，这是低成本一次跑得过的事 (临时改 fallback-config 删字段 → 重启 backend → 看 telemetry → 改回)，不补就是 ship 一份 incomplete baseline。

入口准入 (modelList Round 完工) 清晰；退出条件 §0 5 行清晰；但 ADR 同步动作 §0 没列入 (MINOR-1)。"工作量 2h" 写法违反用户 [no-time-estimates] 偏好 (MINOR-2)。

mini-B 是个干净的 small-bite，删掉 "工作量" 列 + 修 BLOCKER-1 + 补 row 3/4 验证后，可以作为 mini-C agentProfiles 的范本。

### 企业管理系统贴谱性

permissionModes 是 server-driven 的合理候选——每模式有 displayName/description/riskLevel/isDefault，正好匹配企业管理系统"模板字段表 + 风险标签 + 默认推荐"的标准 schema 形态。riskLevel 字段直接对应未来 enterprise scenario 的"角色风险审计" (high mode 触发审批 / 通知)，本 mini-B 不实施但 hint-only string 留着扩展空间 (前提 MAJOR-2 改为不锁 enum)。

但本 mini 没碰审批 / 报表 / 权限 (Stage 维度只是改 Settings UI 的渲染层，不涉业务对象)，**贴谱性 4 dim 在本 mini 没真正测**，是 mini-C+ (agentProfiles, decisionForms) 才会显形的事。本 mini 不算空跑 (它是契约基线测试)，但也不要在 RFC 自我宣称做了贴谱性验证——§0 说"M0 mini-milestone B" 不夸大，OK。

### 风险遗漏

§7 4 行风险表实际质量参差：
- row 1 "Swift Codable strict 模式" — **方向反了** (MAJOR-3)，Swift 没这种模式
- row 2 "isDefault exactly-one 冲突" — 真且已 Zod superRefine 防住，OK
- row 3 "1.1 → 1.0 client 触发误升级提示" — minClientVersion 仍 1.0 板上钉钉，重要确认
- row 4 "iOS cache 写到 Application Support 后重启读 cache decode 失败" — 这条**实际路径搞错了** (BLOCKER-1)：不是 cache，是 **live HTTP fetch path** + non-optional 字段 → backend 回滚后 build 32 也崩，不只 cache

漏掉的风险：
- (a) build 31 telemetry watch 的执行前提 (MINOR-4)
- (b) 单方向最小化测试矩阵 (MAJOR-1)
- (c) PermissionModeId 三端同步约束没文档化 (MINOR-3)
- (d) ADR 同步更新没列入 §0 退出条件 (MINOR-1)

成本 / 安全 / 不可逆 三大风险检查：本 mini 没引入新依赖、没改安全表面 (permissionMode 透传 path 不变)、唯一不可逆是 build 32 装机后字段 schema 锁定 (BLOCKER-1)，所以 BLOCKER-1 修了之后整体风险敞口很小。

---

## Open Questions 强意见

- **OQ-A** (build 31 端写测试)：**同意作者 否**。telemetry 真测足够，不重装即得。无强反对。
- **OQ-B** (riskLevel 锁 enum)：**反对作者 锁 enum**。见 MAJOR-2，应保持与 modelList recommendedFor 一致 hint-only string，建立"枚举锁定权属于契约字段，非契约字段一律 string"可复用规则。
- **OQ-C** (permissionModes optional vs non-optional)：**强反对作者倾向 non-optional**。见 BLOCKER-1。non-optional 把 ADR-0015 minor bump "永久兼容" 单方向打掉，且作者列举的 "需要 backend 不能去除字段" 理由逻辑错位 (那是 ADR-0015 minor 档天然约束，不是 optional 代价)。**应改 optional**，缺省走兜底硬编码 4 项 + telemetry warn。

---

## 建议的下一版改动

1. **§4.1 + §5 step #6 + §8 OQ-C** — `permissionModes: [PermissionModeItem]?` (optional)。这是 BLOCKER-1 的一行修复。
2. **§1 + §8 OQ-B + §4.2** — `riskLevel: z.string().optional()` + Swift switch 加 `default` 默认色。MAJOR-2。
3. **§5 加 step #5b** — 真机临时回滚 fallback-config v1.0 验证 build 32 兜底 → 测完恢复 v1.1。MAJOR-1 + BLOCKER-1 双重价值 (回滚不崩 = optional 修复确认)。
4. **§3.2 step 4 + §7 row 1 + §3.3** — 删 "iOS 17 默认 ignoreUnknownKeys" / "Zod .passthrough() 替代依赖 Swift 默认" 措辞，改为 "Swift Decodable 协议合成 init(from:) 平台保证 silently ignore 未知 key，无 strict 开关"。MAJOR-3。
5. **§0 退出条件 + §5 step #11 (新)** — ADR-0015 加 footnote / ADR-0011 Decision #1 列表加 audit。MINOR-1。
6. **§5 表头删 "工作量" 列 + 删 "总：~2h"** —— 用户 [no-time-estimates] 偏好。MINOR-2。
7. **§1 加注 PermissionModeId 三端同步约束** — 防未来 contributor 只改 fallback-config 不改 cli-runner。MINOR-3。

---

## What I Did Not Look At

- **正确性 / 安全细节** (cross 视角)：留给 reviewer-cross
  - ETag canonical-json 算法是否确实覆盖 permissionModes 嵌套字段 (虽然 modelList Round 已 fix B2，但本 mini 加新字段后是否有遗漏)
  - 304 与 200 的 If-None-Match 行为在 v1.0 ↔ v1.1 边界
  - permission-hook fail-open 性是否被 server-driven 影响 (理论无关，因 mode 通过 cli-runner 传递不经 config endpoint)
- **iOS deploy.sh / xcodegen 实际能否复用 modelList Round 的 Bundle resource 路径**
- **build 31 真机当前 build 状态** — 没物理验证
- **Telemetry 字段 schema** 与 `harness_store.refetch.updated` 是否已实装 (假设 modelList Round 完工时已 ship)
- **跨 reviewer 信号对照** — 严格独立，未读 cross verdict
- **辩论历史 / 作者 transcript** — 严格 fresh context

---

**3-line summary**:
- Blockers: 1 (`permissionModes` non-optional 与 ADR-0015 minor 双向兼容自陷)
- Majors: 3 (验证矩阵 row 3/4 没实施入口；riskLevel 反 modelList enum 共识；Swift Codable 风险方向写反)
- Minors: 4 (ADR 同步漏；时间估算违反用户偏好；PermissionModeId 三端同步未文档化；build 31 telemetry watch 前置条件缺)
- Overall: 建议小改后合并——一行 optional + 一次 5 分钟回滚验证 + 措辞修，BLOCKER 即解；不修就 ship 等于把"minor bump 真测"基线做成"半边 baseline"。
