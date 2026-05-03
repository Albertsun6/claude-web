# Architecture Review — contract #3 (ContextProtocol + ADR-0014) + #4 (PR Guide + ADR-0013) + methodologies (00-discovery, 01-spec)

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7 (1M context)
**Date**: 2026-05-03
**Files reviewed**:
- docs/HARNESS_CONTEXT_PROTOCOL.md
- docs/adr/ADR-0014-context-bundle-explicit.md
- docs/HARNESS_PR_GUIDE.md
- docs/adr/ADR-0013-worktree-pr-double-reviewer.md
- methodologies/00-discovery.md
- methodologies/01-spec.md

## Summary
- Blockers: 0
- Majors: 4
- Minors: 5
- 总体判断：建议小改后合并

---

## 总体判断

四份契约 + 两份方法论一致性高、与 LEARNINGS 沉淀（#5 协议优先 / #2 评审独立性）对齐紧密，硬约束（不引向量库、单线程写、worktree 隔离、reviewer mustInclude 严格）已落到 ADR + 协议双层。M-1 不需重做。

主要顾虑集中在两处：(1) 一些"自动化 enforce"承诺被推到 M2 但 M-1 阶段已开始 dogfood，存在协议生效但守门缺失的窗口；(2) 方法论中 retrospective / 阈值偏离触发的"方法论 v2 ritual"路径模糊，可能导致流程僵化。

---

## 必须先改

无 BLOCKER。MAJOR 项见下。

---

## 四维评审

### 架构可行性（MAJOR ×2 / MINOR ×2）

**[MAJOR-1] M-1 dogfood 与 M2 enforce 窗口断层**
- Where: HARNESS_PR_GUIDE.md §4 "M2 引入 pr-manager.ts enforce" / ADR-0013 §"#3 Risk-Triggered" / ADR-0014 §Decision §"实操：Context Manager 在产 Bundle 前预检"
- Lens: 架构可行性
- Issue: M-1 仅产契约，Context Manager / pr-manager / review-orchestrator / git-guard 的 enforce 全在 M2。但 M2 的入口条件之一是"按 v1 方法论跑真实 Issue 通流水线"——意味着 M-1 末尾就要手动跑流程，此时无 fail-loud 机制，agent 能脑补缺失 mustInclude，PR 模板能漏字段。
- Suggested fix: 在 HARNESS_ROADMAP M-1 / M2 之间显式插一个 "M1.5 enforce 落地" 子里程碑，或在 M-1 完工 checklist 加一行 "git-guard.mjs + 一份最小 context-manager.preflight.mjs（仅做 mustInclude 存在性检查，不挑选）已可运行"。否则 dogfood 第一周就会破契约。

**[MAJOR-2] ContextBudget 的 token 计算锚点未定**
- Where: HARNESS_CONTEXT_PROTOCOL.md §2 "maxTokens（按 SHA-256 后估算或精确算）"
- Lens: 架构可行性
- Issue: "SHA-256 后估算"语义不通——SHA 是 hash 不能反推 token；"或精确算"留给实施方未指定 tokenizer。不同 model（haiku / sonnet / opus / gpt-5）tokenizer 不同。M2 实现 Context Manager 时会撞到，可能每个 profile 的 budget 数字含义都不同。
- Suggested fix: 协议层定一个"参考 tokenizer"（建议 cl100k_base 或 claude 自己的 byte-fallback 估算），写明"实际 model 走自己 tokenizer，超 10% 不告警"；或干脆从 maxTokens 改为 maxBytes，避开 tokenizer 之争，等 M3 真出问题再补 token-aware。

**[MINOR-3] artifactRefs 间接引用的 GC 语义未定**
- Where: HARNESS_CONTEXT_PROTOCOL.md §1 "artifactRefs 只存 Artifact id（间接引用），不复制内容"
- Lens: 架构可行性
- Issue: Bundle 永不修改，但 Artifact 本体（contentPath 指向的文件）若被改写或清理，旧 Bundle 的 snapshot.md 仍然引用——审计时拉到的是新内容，破坏可复盘性。
- Suggested fix: 协议加一句 "Artifact 一旦被 Bundle 引用即不可变（CoW / 重命名时 hash 锁）"，或要求 snapshot.md 落 inline content 不止 hash。

**[MINOR-4] reviewer 严格 mustInclude 与"类似 review_notes"冲突未解释**
- Where: HARNESS_CONTEXT_PROTOCOL.md §3 review 行 "mayInclude: 类似 review_notes" vs §2 "reviewer mustInclude 严格只含 spec/design/patch/diff，Context Manager 强制 enforce"
- Lens: 架构可行性
- Issue: §2 说 reviewer Bundle 严格只含 4 类，§3 表却列出 mayInclude 含 review_notes。两者并不冲突（mustInclude vs mayInclude），但读者会困惑：reviewer 到底能不能看到历史 review_notes？若能，等于看到了 sibling reviewer 的判断模式（间接污染）。
- Suggested fix: §3 review 行 mayInclude 显式列空 `[]` 或注释 "reviewer profile 整段 mayInclude 强制为空，覆盖默认表"。

### 里程碑裁剪（MAJOR ×1 / MINOR ×1）

**[MAJOR-5] retrospective 阈值偏离触发"方法论 v2 ritual"流程缺细节**
- Where: 00-discovery.md §6 "阈值偏离触发方法论 v2 候选起草" / 01-spec.md §6 "需用户 + Reviewer-cross + Reviewer-architecture 三方独立审过才升级"
- Lens: 里程碑裁剪
- Issue: M-1 只产 v1，但已经埋下 v2 ritual 入口。关键问题没说：(a) 谁起草 v2（PM Agent? 用户? Architecture Reviewer?）；(b) v1 与 v2 并存窗口规则；(c) 已 in-flight 的 Issue 走哪个版本。LEARNINGS #4 指出指标会诱导刷分——若 retrospective 阈值是单一指标（如人审次数 > 5），agent 可以通过批量低难度 Issue 拉低均值规避升级。
- Suggested fix: 在 HARNESS_ROADMAP §16 进化体系或新建 methodologies/EVOLUTION.md 写明：v2 起草由用户启动 ritual（非自动）；v1 / v2 并行期 in-flight Issue 锁版本；阈值偏离自动产 retrospective.md 但不自动升级。

**[MINOR-6] Discovery "0..N 条 Issue draft" 不进 DB 的中间态生命周期**
- Where: 00-discovery.md §2 "不 commit 到 DB，先以 Artifact 形态产出"
- Lens: 里程碑裁剪
- Issue: discovery-output-*.md Artifact 的 kind=spec 是错的（应该是某种 issue_draft）。也没说人审 reject 后 Artifact 是删还是保留。M-1 schema 不闭环 → M2 实施时会临时拍脑袋。
- Suggested fix: HARNESS_DATA_MODEL §1.10 加 `issue_draft` 作为合法 artifact_kind；00-discovery §2 改 kind=`issue_draft`；§4 reject 时 Artifact 状态置 `discarded` 不删，便于 retrospective 复盘。

### 企业管理系统垂直贴谱性（MAJOR ×1 / MINOR ×1）

**[MAJOR-7] enterprise 必填 4 段在 spec 阶段硬填，但 discovery 已要求"硬性必填"——重复且时机错位**
- Where: 00-discovery.md §7 "这 4 段在 discovery 阶段是硬性必填" / 01-spec.md §7 "spec 阶段必填，不是附加"
- Lens: 垂直贴谱性
- Issue: 同样 4 段（businessEntities / permissionMatrix / approvalSteps / reportSchemas）在 discovery 与 spec 都"硬性必填"。discovery 阶段用户原文常常不够细致写出 schema 字段 diff / 审批步骤 diff——00-discovery §7 自己也承认 "无法从用户原文判定时挂 request_info"。等于发现阶段 80% 要 request_info，流程卡顿。
- Suggested fix: 00-discovery §7 降级为"指向某实体 + 标记涉及哪几段（businessEntities/permissionMatrix/approvalSteps/reportSchemas 任一）"，具体字段 diff / 步骤 diff 推到 spec 阶段填。spec 阶段保持硬性必填即可。两阶段职责分层，避免 PM Agent 在没 schema 的情况下脑补字段。

**[MINOR-8] reportSchemas 字段语义未给最小 schema**
- Where: 01-spec.md §2 metadata_json `reportSchemas: [...]` / §7 报表口径段
- Lens: 垂直贴谱性
- Issue: §7 列了 4 个项要求填，但 metadata_json 中 `reportSchemas` 是开放数组，没给 TypeScript / Zod schema。M2 实施时 reviewer 难以机器校验。其他 3 段（businessEntities / permissionMatrix / approvalSteps）有较明确结构，独 reportSchemas 模糊。
- Suggested fix: 01-spec §2 metadata_json 给一个最小 ReportSchema 结构示例 `{ name, sourceTables[], granularity, fields[], compatWindow }`，或 packages/shared/src/harness-protocol.ts 加 ReportSchemaSchema。

### 风险遗漏（MINOR ×1）

**[MINOR-9] Hotfix 路径绕过 spec / discovery 但仍要求 risk-triggered 双 reviewer 判定，矛盾未解**
- Where: HARNESS_PR_GUIDE.md §7 "Hotfix 走 harness/hotfix-* 分支，跳过 strategy/discovery/spec，从 design 起步" / ADR-0013 §"#3 Risk-Triggered"（risk 信号来自 spec 阶段标 risk_high）
- Lens: 风险遗漏
- Issue: hotfix 跳过 spec，意味着 risk_high 信号永远不会触发；但 hotfix 通常是生产事故，恰恰是高风险场景。当前规则下 hotfix 默认走单 reviewer，与 §0 #16 "不可逆操作守门" 精神冲突。
- Suggested fix: ADR-0013 §3 加 "hotfix 默认 risk=high，强制双 reviewer，除非用户在 PR 描述中显式标 `hotfix-risk: low` 并写理由"。

---

## Open Questions 强意见

无新 open question。Round 2 流转待 debate-review 阶段合并。

---

## 建议的下一版改动

1. ADR-0013 加 hotfix 默认 risk=high 子条款（MINOR-9）
2. 00-discovery §7 降级为"指向 + 标记段"，spec §7 保留硬性字段 diff（MAJOR-7）
3. HARNESS_CONTEXT_PROTOCOL §2 maxTokens 改 maxBytes 或锚定 tokenizer（MAJOR-2）
4. M-1 完工 checklist 加 git-guard + minimum context-manager preflight（MAJOR-1）
5. methodologies 加 EVOLUTION.md 写 v1→v2 ritual（MAJOR-5）
6. HARNESS_DATA_MODEL artifact_kind 加 `issue_draft`（MINOR-6）
7. HARNESS_CONTEXT_PROTOCOL §3 review 行 mayInclude 显式空（MINOR-4）

---

## What I Did Not Look At

- packages/backend/scripts/git-guard.mjs / prod-guard.mjs（task 显式 skip，cross 域）
- docs/COMMIT_CONVENTION.md / docs/branch-naming.md / .github/PULL_REQUEST_TEMPLATE.md（task skip）
- packages/shared/src/harness-protocol.ts ContextBundleDtoSchema 的实际 zod 定义（仅读了协议文档引用）
- HARNESS_DATA_MODEL.md §1.8 / §1.10 实际 DDL（仅读了协议中的 reference）
- HARNESS_AGENTS.md §3 reviewer 独立性细节（仅读了协议中的 reference）
- ADR-0010 / ADR-0011 / ADR-0015 全文（仅读了引用）
- methodologies 02..N（task 仅指定 00 / 01）
- docs/reviews/contract-3-4-method-cross-*.md（独立性约束）
- 不读 author transcript / 思考流（独立性约束）

---

## 3-line summary

- Blockers: 0 / Majors: 4 / Minors: 5
- 4 个 MAJOR 集中在：M-1→M2 enforce 窗口、token 锚点、retrospective v2 ritual、enterprise 必填段时机错位
- 总体判断：建议小改后合并；M-1 契约方向正确，无须重做，主要靠下版补缺
