# Phase 2 React Verdict — M0_PERMISSION_MODES.md

**Reviewer**: harness-architecture-review
**Phase**: 2 (debate / cross-pollinate)
**Model**: claude-opus-4-7 (1M)
**Date**: 2026-05-03 15:30
**Read sibling**: /Users/yongqian/Desktop/claude-web/docs/reviews/m0-permission-modes-cross-2026-05-03-1500.md

---

## 对 sibling finding 的逐项表态

### sibling M1 [MAJOR] `permissionModes` 缺失时的回滚兼容叙述互相矛盾
**Stance**: refine
**Evidence / Refinement**: sibling 准确点中 §3.1 vs §4.1 vs OQ-C 三处自相矛盾，方向对。但 sibling 给的"二选一"两条等价并列；我 phase 1 BLOCKER-1 已提供具体反例（Swift `Decodable` 合成 init 对非可选缺失 key 抛 `keyNotFound`，且 §8 OQ-C "需 backend 不能去除字段" 理由逻辑反了——那是 ADR-0015 minor 档天然约束而非 optional 代价）。建议升级 sibling M1 → BLOCKER 并锁定方案 A（optional + bundled fallback），不留方案 B 余地——方案 B（保持 required + decode fail + bundled fallback）会让每次 backend 临时回滚都产生 telemetry warn 风暴 + Settings UI 凝固在 fallback bundle，与 ADR-0011 "thin shell, server is truth" 反向。

### sibling M2 [MAJOR] `riskLevel` 说要锁 enum，但 Swift 契约仍是裸 `String?`
**Stance**: disagree-with-evidence
**Evidence / Refinement**: sibling 说"Swift 应建模成 enum + .unknown fallback"——方向反了。我 phase 1 MAJOR-2 给出反例：modelList Round phase 3 收敛已立 "hint-only string + graceful skip" 共识（recommendedFor 决议），permissionModes.riskLevel 同属 UI hint 非契约字段，**应取消 Zod enum 锁，Swift 保持裸 String?，UI 用 if/else 而非 switch exhaustive**。sibling 路线（Swift 加 `.unknown` case）等价于把 enum 锁定意图保留下来（只是软化），未来加 "critical" 仍需双端改 + 重新 ship build；我的路线（双端都 string）让 server 单方加新值即生效，与 modelList recommendedFor 对称，建立"枚举锁定权属于契约字段"可复用规则。sibling False-Positive Watch 自己也标了 F? M2 可能 FP，承认了不确定性。

### sibling M3 [MAJOR] `ADR-0011` 仍保留与 M0 modelList 决议冲突的 `config_changed` wording
**Stance**: agree
**Evidence / Refinement**: 这是 ADR-0011 文本与 modelList Round phase 3 OQ-D 决议的真实漂移，sibling 抓得准。我 phase 1 MINOR-1 提了 ADR 同步动作但未具体到 ADR-0011 §"最小协议层行为契约 / fallback 行为" 的过期 bullet——sibling 的定位更精确，应纳入 §5 step #11（ADR-0015 footnote + ADR-0011 Decision #1 audit + **ADR-0011 fallback bullet 修文**）。

### sibling m1 [MINOR] `isDefault` exactly-one 没限定是否只在 enabled/available mode 内检查
**Stance**: refine
**Evidence / Refinement**: 方向对（modelList 用 `isDefault && enabled`，permissionModes 当前无 enabled），sibling 建议"M0 写清 invariant"分寸恰当。但 sibling 没指出实操位置——应落到 `harness-protocol.ts` superRefine 注释 + ADR-0015 footnote 同步标记 "permissionModes.enabled 字段加入时为 minor bump，但 superRefine 语义需同时改"。否则未来加 enabled 时只改 schema 不改 superRefine 会静默放过 0-default 配置。

### sibling m2 [MINOR] `displayName` 中英文和括号文案被协议化
**Stance**: agree
**Evidence / Refinement**: 这是我 phase 1 漏掉的一条。`displayName: "Plan（只读规划，最安全）"` 同时承载名称 + 解释 + 风险三层语义，与 `description` 和 `riskLevel` 字段重复。一旦 riskLevel 字段成了 UI hint 真源，`displayName` 里的"最安全/最危险"就成了冗余且会失同步（若 server 改 riskLevel 但忘改 displayName 文案）。sibling 建议拆分（短名 + description + riskLevel 各司其职）正确，应纳入 §1 fallback-config 修订。

### sibling m3 [MINOR] build 31 graceful skip 的证据字段不够具体
**Stance**: agree
**Evidence / Refinement**: 这是我 phase 1 MINOR-4 (telemetry watch 前置条件) 的一个**互补缺口**——我盯了"watch 怎么跑"，sibling 盯了"watch 拿什么字段算证据"。两条合并：§5 step #5 加 "telemetry props 至少含 `protocolVersion`, `etag`, `modelCount`, `buildVersion`" + §6.2 验收 row 加同样字段约束。否则 telemetry 触发但拿不到 `protocolVersion=1.1` 字段就只能证明 build 31 收到了"某次更新"而非"v1.1 payload"，验证基线打折。

### sibling m4 [MINOR] `permissionModes` 与实际发送 prompt 的 `permissionMode` 枚举对齐缺少测试项
**Stance**: agree
**Evidence / Refinement**: sibling 抓中 §6 验收只覆盖 Settings UI 渲染，没覆盖"用户切到某 mode → outbound `ClientMessage.permissionMode` 字符串等于 config item.id"。这是我 phase 1 MINOR-3（PermissionModeId 三端同步）的**运行时验证镜像**：我说的是文档/代码层 trace，sibling 说的是真测一遍 outbound WS 帧。应同时加：§6 验收勾 "选 plan / bypassPermissions 各发一次 prompt，捕获 outbound WS `permissionMode` 字段值与 config item.id 全等"。

---

## Self-revision

无完全撤回项。

- **Refine 我的 phase 1 BLOCKER-1**：sibling M1 给我提供了 RFC §3.1 与 §4.1 的"互相矛盾"叙述维度（不只是"自陷 trap"，更是"两段文字读起来直接打架"），可加在 BLOCKER-1 评语首段——这让 issue 对实施 agent 更显眼（实施时即使没读 ADR-0015 也会看到自相矛盾）。
- **Augment 我的 phase 1 MINOR-1（ADR 同步）**：sibling M3 把 ADR-0011 fallback bullet 过期 wording 单独点出，比我泛泛说"ADR 同步"精确。MINOR-1 应升级范围：不仅 ADR-0015 footnote + ADR-0011 Decision #1 audit，还要 ADR-0011 fallback 行为 bullet 删掉 `config_changed` wording。

---

## New findings

### N1 [MINOR] `displayName` 协议化与 server-driven copy 治理 缺一条总则
**Where**: §1 fallback-config 4 项 + 后续所有 server-driven displayName 字段（modelList、agentProfiles、decisionForms ...）
**Issue**: sibling m2 揭示一个跨 mini-milestone 的治理空缺：**`displayName` 该承载多少语义** 没有总则。modelList Round 也用了 `displayName: "Claude Sonnet 4.7（默认）"` 这种"名 + 标签" 形式，permissionModes 重蹈。每次新字段加进来都会被作者拍脑袋决定"要不要把风险/默认/状态塞进 displayName"。
**Suggested fix**: ADR-0011 加一条 "**server-driven displayName 字段只承载短名**；状态/风险/默认/分组都用结构化字段（isDefault, riskLevel, badges[] etc.）。原因：避免文案与结构化字段失同步 + 简化 i18n + UI 渲染层逻辑解耦"。本提案 §1 fallback-config 4 项同步改为短名（"Plan" / "Default" / "Accept Edits" / "Bypass"）+ 把括号内描述移到 description。

---

## Stance distribution

- agree: 4 (M3, m2, m3, m4)
- disagree-with-evidence: 1 (M2 — Swift 应保持 String?，与 modelList recommendedFor 对称)
- refine: 2 (M1 — 升级到 BLOCKER 并锁方案 A; m1 — 落到 superRefine 注释 + ADR footnote)
- not-reviewed-with-reason: 0
- self-revisions: 2 (BLOCKER-1 augment matrix-contradiction wording; MINOR-1 升级到 ADR-0011 fallback bullet 修文)
- new-findings: 1 (N1 displayName 治理总则)

---

## 3-line summary

- agree-4 / disagree-with-evidence-1 / refine-2 / new-findings-1
- 与 sibling 主分歧：M2 riskLevel——sibling 倾向 Swift `.unknown` enum + 软化锁定，我倾向双端 string + graceful skip，与 modelList recommendedFor "枚举锁定权属于契约字段" 共识对称
- sibling M1 应升级到 BLOCKER 并合到我的 BLOCKER-1（同一根因，更清晰的"叙述互相矛盾"维度）；sibling m4 outbound WS 验证 + sibling m3 telemetry props 字段约束都是我 phase 1 漏的运行时验证镜像，应纳入 §6
