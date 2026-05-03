# Phase 2 React Verdict — M0 Harness Config ModelList

**Reviewer**: harness-architecture-review
**Phase**: 2 (debate / cross-pollinate)
**Model**: claude-opus-4-7 (1M context)
**Date**: 2026-05-03 12:10
**Read sibling**: /Users/yongqian/Desktop/claude-web/docs/reviews/m0-modellist-cross-2026-05-03-1144.md

---

## 对 sibling finding 的逐项表态

### sibling B1 [BLOCKER] M0 是否有 `config_changed` WS push 前后矛盾
**Stance**: refine
**Evidence / Refinement**: 我 phase 1 把同一矛盾标 MAJOR-1（"建议小改后合并"），sibling 升 BLOCKER 是过分。本提案 §0 退出条件是 mini-milestone 子集级而非全局合同级，wording 矛盾不阻塞实施——选 (a) 真推 config_changed 或 (b) 删退出条件项，30min 内可收敛，不应阻塞 phase 3 进入实施。但 ADR-0011 Decision #3 同时被牵连这点 sibling 比我看得更准（我 phase 1 没单独点 ADR），refine 方向：保留 sibling 的 ADR-0011 同步修订要求，但严重度降到 MAJOR。

### sibling B2 [BLOCKER] ETag canonical JSON 算法按字面实现会忽略嵌套字段
**Stance**: refine
**Evidence / Refinement**: 我 phase 1 同点列 MAJOR-2，但只说"算法描述含糊 + 没说递归"。sibling 给出了具体反例（实现者真按字面用 `JSON.stringify(value, sortedKeysArray)` 会使 modelList 嵌套字段被白名单过滤掉），并直指"M0 核心目标失效——改 modelList 客户端拿不到新值"，严重度论证比我强。但仍判 BLOCKER 过分：(1) §1.3 "Object.keys 排序" 中文措辞虽不严谨但意图清晰是排序而非白名单；(2) sibling 自己在 False-Positive Watch 里也承认"取决于实现者意图"。Refine 方向：保留 sibling 的具体反例 + fixture 测试要求（断言改 `displayName`/`capabilities.contextWindow` 都改 etag），但严重度调到 MAJOR——必须 phase 3 改但不阻塞实施排期。

### sibling M1 [MAJOR] `isDefault` exactly-one 只写在注释，schema 没 enforce
**Stance**: agree
**Evidence / Refinement**: 与我 phase 1 MAJOR-4 (1) 同向，sibling 措辞更清晰（"`HarnessConfigSchema` 没有 `.superRefine()`"），且补充了"如果允许 default 被 disabled 也要明确 fallback 规则"——这个分支是我 phase 1 漏的。完全采纳。

### sibling M2 [MAJOR] `HARNESS_PROTOCOL.md` 内 ID 契约仍自相矛盾
**Stance**: agree
**Evidence / Refinement**: 这是我 phase 1 完全没看出来的协议层缺陷——HARNESS_PROTOCOL.md §1 vs §8 ID 定义矛盾（UUIDv4 vs opaque stable string），新 `modelList.id = "claude-opus-4-7"` 既不是 UUID 也不是 ULID 会立即触发协议契约破裂。sibling 跨视角看到的是"协议文档自洽"而非"提案自洽"，正属 reviewer-cross lens。完全采纳，建议 phase 3 同步修 HARNESS_PROTOCOL §1 表格，否则 M0 实施会留下 protocol-doc / proposal 不一致的 git log 痕迹。

### sibling M3 [MAJOR] ADR-0011 endpoint payload 仍是全量 config，和 M0 modelList-only 不一致
**Stance**: agree
**Evidence / Refinement**: 与我 phase 1 OQ-D 强意见相邻但 sibling 看得更具体——我只说"建议 ADR 升 Accepted 推迟到 M0 全部子任务"，sibling 直接指出 ADR-0011 Decision #1 和 proposal §1.2 的字段集不一致，这是我没读 ADR Decision #1 字面的疏漏。采纳，建议 OQ-D 选项升级：M0 实施完不仅推迟 Accepted，**还必须同步改 ADR-0011 Decision #1 写"分阶段扩展，M0 仅 modelList，新增字段走 minor bump + graceful skip"**。

### sibling M4 [MAJOR] iOS fallback config 来源仍是 OQ，但是 M0 核心验收路径
**Stance**: refine
**Evidence / Refinement**: 我 phase 1 没把这条单独提到 MAJOR——MINOR-2 提了"OQ-A + OQ-C 合并：fallback JSON 单 source 放 shared/fixtures"；sibling 升 MAJOR 是合理的（验收路径上的 OQ 应该 phase 3 收敛而非留 OQ）。Refine 方向：sibling 建议"Bundle JSON" 与我 MINOR-2 建议的 `packages/shared/fixtures/harness/fallback-config.json` 是同一路线但 sibling 没说明 single-source 这层——需要明确 fallback JSON **唯一 source 在 shared/fixtures，xcodegen 复制为 iOS Bundle resource，backend 也从此 import**，否则两端各 ship 一份会引入 OQ-C 的 drift 风险。

### sibling m1 [MINOR] `enabled=false` "隐藏但回退仍可用" 语义不清
**Stance**: agree
**Evidence / Refinement**: 我 phase 1 MAJOR-4 (3) 已点这条，但 sibling 给的 fix 描述比我清楚（"disabled 不出现在新选择列表；当前 selection 已 disabled 则保留 + '已停用' 标签 + 切走后不可再选"）。我 phase 1 MAJOR-4 (3) 写"灰色 + 一行说明 '已在服务端禁用，下次切换不可回选'" 措辞接近。两边可合并到 phase 3 同一 fix。

### sibling m2 [MINOR] ETag header 是否加 HTTP 标准引号未定义
**Stance**: agree
**Evidence / Refinement**: 完全没在我 phase 1 raised。sibling 这条是真正的"跨端对齐 lens"贡献——HTTP 标准 ETag 是 quoted（`ETag: "sha256:abc"`），iOS URLSession 默认按标准解析；如果 backend body 字段裸字符串而 header 不带引号，`If-None-Match` 比较时两端字符串可能不同（hono header 默认透传）。这条很值，phase 3 应纳入 §2.1 明确 quoted 标准。

### sibling m3 [MINOR] endpoint auth 继承关系没有写明
**Stance**: agree
**Evidence / Refinement**: 同样不在我 phase 1 范围（我把"安全 / 鉴权 / token 路径"显式划为 reviewer-cross lens，见 What I Did Not Look At 第 6 条），sibling 在自己的 lens 内补足。`/api/harness/config` 后续要承载 featureFlags / agentProfiles，提前在 §2.1 锁住 "走现有 `CLAUDE_WEB_TOKEN` auth 体系" 一句话即可，零工作量。

---

## Self-revision

- **Refine my own MAJOR-1 → keep as MAJOR but tighten fix wording**：sibling B1 比我多说了"ADR-0011 Decision #3 也被 wording 矛盾牵连"。我 phase 1 的 MAJOR-1 fix 只覆盖 proposal §0 / §2.4 / §7，没要求同步修 ADR-0011 Decision #3。phase 3 的 fix 应扩展到 ADR-0011 Decision #3 行——三处必须 reconcile（proposal §0 / proposal §2.4 / ADR-0011 Decision #3）。

- **Refine my own MAJOR-2 → split into MAJOR-2a / MAJOR-2b**：我 phase 1 把 ETag canonical_json 与 compareVersion 实施真空合并到一条 MAJOR-2，混搭两个独立问题不利于 phase 3 收敛 tracking。sibling B2 只覆盖 ETag 那半，反推我应该把 compareVersion 那半拆到独立 MAJOR-2b（"compareVersion 实施责任真空"）。这是格式 refine，非内容撤回。

- **Withdraw nothing**：我 phase 1 的 MAJOR-3（recommendedFor 开放 string） / MAJOR-4（isDefault + enabled + cutover 默认模型静默漂移） / 5 条 MINOR 都没被 sibling 给出反例否定，保留。特别是 MAJOR-4 (2)（"未 pin 用户 cutover 后默认从 haiku 变 sonnet"）sibling 完全没提，是 4 维 lens 独有贡献，不撤。

---

## New findings (phase 2 浮出)

### N1 [MAJOR] `protocolVersion` "1.0" 与 ADR-0015 minor bump 流程的语义对接缺失
**Where**: proposal §1.2 / ADR-0011 / sibling M3 隐含
**Issue**: sibling M3 提到"M0 ADR-0011 改成分阶段扩展 + 新增字段 minor bump + graceful skip"。但 proposal §1.2 只写 `protocolVersion: "1.0"` 字符串字面值，**没规定 minor bump 后版本数怎么变（1.0 → 1.1？1.0 → 1.0.1？）**，也没规定 iOS 老版本看到 `protocolVersion: "1.1"` + 新字段时的 graceful skip 行为是 "decode unknown fields = ignore"（Zod 默认）还是 "拒绝整个 payload + 切 fallback"。M0 单字段不暴露问题；M1+ 加 stages / agentProfiles 时第一次真触发 minor bump 会发现 ADR-0015 的版本规则没在 proposal 里 echo。
**Suggested fix**: §1.2 加一句 "minor bump = 1.x → 1.(x+1)，iOS 用 Zod safeParse + `.passthrough()`（或 Swift `Codable` ignoreUnknownKeys）graceful skip 未知字段；major bump = 1.x → 2.0 触发 minClientVersion 拦截"。这是 ADR-0015 的本意但没在 M0 第一契约 echo，会让 M1 第一次真扩展时再吵一次。

### N2 [MINOR] If-None-Match 不传时的语义未规定
**Where**: proposal §2.1
**Issue**: §2.1 说 "If-None-Match: <etag> (optional) → 304 if match"，但没说 iOS 第一次启动（cache 空）不传 If-None-Match 时 backend 是返 200 + body（这是隐含 sibling m2 上下文里 backend 的行为）。这是 HTTP 标准默认（无 If-None-Match → 200）但 M0 第一契约写实更稳，避免实施者误解为"必须传 If-None-Match 才能拿 config"。
**Suggested fix**: §2.1 加一句 "无 If-None-Match → 200 + 完整 body + ETag header"。

---

## Stance distribution

- agree: 5（sibling M1 / M2 / M3 / m1 / m2 / m3 中的 5 条；m3 也算 agree）
- disagree-with-evidence: 0
- refine: 4（sibling B1 / B2 / M4，及隐含的 self-revision 同 lens）
- not-reviewed-with-reason: 0
- self-revisions: 2（MAJOR-1 fix 范围扩展 + MAJOR-2 拆分）
- new-findings: 2（N1 protocolVersion 语义 / N2 无 If-None-Match 行为）

校核：sibling 共 9 条 finding（B1 / B2 / M1-M4 / m1-m3）。我表态：B1 refine、B2 refine、M1 agree、M2 agree、M3 agree、M4 refine、m1 agree、m2 agree、m3 agree。即 agree=6、refine=3、disagree=0。修正 distribution：

- agree: 6
- disagree-with-evidence: 0
- refine: 3
- not-reviewed-with-reason: 0
- self-revisions: 2
- new-findings: 2

(refine ≥ 1 ✓，硬约束 1 满足。)

---

## 三行 summary

- agree-6 / disagree-0 / refine-3 / new-findings-2
- Sibling 看出 ID 契约自相矛盾（M2）+ ADR-0011 payload 不一致（M3）+ ETag header quoting（m2）+ auth 继承（m3）这 4 条全是我 4 维 lens 之外的真正 cross-lens 贡献，全 agree
- Refine sibling B1/B2/M4：方向都对但严重度 / 范围需要调（B1/B2 BLOCKER → MAJOR；M4 fix 加 single-source 约束）
