# Cross Review — M2 Master Plan v2

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-05 22:55  
**Files reviewed**:
- `docs/proposals/M2-master-plan.md`
- `docs/HARNESS_ROADMAP.md` §0.5
- `docs/retrospectives/M2-h14-prod-migration-failure.md`
- `packages/backend/src/migrations/0001_initial.sql`
- `packages/backend/src/migrations/0002_stage_status_dispatched.sql`
- `packages/backend/src/harness-store.ts`
- `packages/shared/src/harness-protocol.ts`
- `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`

---

## Summary

- Blockers: 0
- Majors: 3
- Minors: 3
- 总体判断：建议小改后合并。v2 的 loop-by-loop 方向成立，Loop 1 的真实 DB 变更也可以做到 additive；但 proposal 内还有几处 v1 残留文字会误导实现者，把 Loop 1 重新拉回 schema-rebuild / protocol bump / cancelled enum 的大批次。

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 3.7 |
| 跨端对齐 | 3.6 |
| 不可逆 | 4.0 |
| 安全 | 4.3 |
| 简化 | 3.8 |

**Overall score**: 3.9

---

## Loop-by-Loop Verification

### 1. scope 收缩后是否仍自洽？

**结论：基本自洽，未 amputate essential scope，但需要一处文字收口。**

5 个 M2 目标仍有可信覆盖路径：§3 给了 #1 到 #5 的圈映射，包含 pipeline 稳定、ResourceLock、ContextManager、状态可观察、review 流程五条线；§7 明确只批准 Loop 1，Loop 2 / Loop 3 hold，Loop 4+ 不预设，由 retrospective 后按剩余风险排序。这符合 §0.5 里“每圈 retrospective + 下一圈 scope”以及 ship/drop/defer 的要求。

关键证据：
- M2 五目标定义在 `docs/proposals/M2-master-plan.md:34-44`。
- §3 覆盖 #1 到 #5，例：#2 ResourceLock / worktree / port / owned files 在 `docs/proposals/M2-master-plan.md:80-87`，#3 ContextManager 在 `docs/proposals/M2-master-plan.md:89-97`，#5 review flow 在 `docs/proposals/M2-master-plan.md:107-113`。
- Loop 4+ 明确“不预设”，候选包含 ResourceLock / cancelled enum / ContextMgr v2 / e2e test，在 `docs/proposals/M2-master-plan.md:307-313`。
- §0.5 要求每圈 risk → slice → verification → dogfood → review → retrospective，在 `docs/HARNESS_ROADMAP.md:155-162`，并要求 exit 只能 ship/drop/defer，在 `docs/HARNESS_ROADMAP.md:164-168`。

剩余问题：§6 仍写“关键路径 ≈ 7 圈”和“M2 done 判定：所有 5 大目标核心圈完成”，会制造一点“总计划已经排完”的感觉，虽然 §7 又撤销总估算。建议把 §6 标成 non-authoritative dependency map，避免回到 batch 读法。

### 2. Loop 1 解冻清单是否真 additive only？

**结论：如果按 §5 实施，是真 additive only；但 §3 / §4 有冲突文字，必须修掉。**

当前真实 `stage` 表已经在 v101 包含 `dispatched`，它有 CHECK enum、FK、unique index 和 running partial index。Loop 1 若只执行：

```sql
ALTER TABLE stage ADD COLUMN failed_reason TEXT;
ALTER TABLE stage ADD COLUMN failed_at INTEGER;
```

则不会触碰 CHECK enum、不会 DROP/RENAME stage、不会重建 index、不会新增 FK、不会需要填充现有行；这和 v0.4.4 的“看似只是加 enum，实际要 rebuild 父表”不是同一类风险。

核对点：
- 当前 `stage.status` CHECK enum 在 `packages/backend/src/migrations/0002_stage_status_dispatched.sql:52-54`。
- `decision.stage_id` 这类 child FK 已存在，见 `packages/backend/src/migrations/0001_initial.sql:276-287`。
- v0.4.4 失败根因是 rebuild 期间 DROP parent table 被 schema-level FK 检查挡住，见 `docs/retrospectives/M2-h14-prod-migration-failure.md:44-48`。
- runner 默认 mode 是事务内 FK ON；schema-rebuild mode 才会在 transaction 外关 FK，见 `packages/backend/src/harness-store.ts:40-47` 和 `packages/backend/src/harness-store.ts:178-192`。

隐藏触发器复查：
- `failed_reason TEXT NULL`: 无 NOT NULL、无 DEFAULT、无 CHECK、无 FK、无 index，不触发 rebuild。
- `failed_at INTEGER NULL`: 同上。
- 不应在 Loop 1 加 `CHECK(failed_at IS NULL OR failed_at > 0)`。SQLite 新版本对 ADD COLUMN with CHECK 会验证既有行；虽然仍不一定 rebuild，但已经不是最薄 additive slice。
- 不应在 Loop 1 新增 failed_reason index、FK、generated column、status enum、或 backfill UPDATE；这些都超出 §5 解冻清单。

### 3. Loop 2 / Loop 3 依赖关系是否形成隐式 batch？

**结论：没有形成必须一次批准的 batch，但 Loop 1 → Loop 2 是“强自然后继”，需要明确每步仍可 drop/defer。**

Loop 2 依赖 Loop 1，因为没有列就没法持久化失败原因；Loop 3 依赖 Loop 2，因为 minimal skip 的 operator 决策最好基于可诊断失败类型。这是 data dependency，不是 approval dependency。只要每个 Loop 启动前重新过 anchor gate，并在 retrospective 里写 ship/drop/defer，它就不是 2-loop batch。

支持证据：
- proposal 明确“后续 Loop 的启动必须基于上一 Loop 的证据”，见 `docs/proposals/M2-master-plan.md:11-17`。
- Loop 2/3 hold 条件写在 `docs/proposals/M2-master-plan.md:307-313`。
- 每个 Loop 独立 anchor gate 写在 `docs/proposals/M2-master-plan.md:320-322`。
- §0.5 允许每圈后基于信号转下一圈、drop 或 defer，见 `docs/HARNESS_ROADMAP.md:155-168`。

风险：Loop 1 本身用户价值很薄，主要是铺 schema。如果 Loop 1 ship 后 Loop 2 defer，DB 会留下未用列；这是可接受的低成本 forward-only 残留，但 retrospective 里应显式记录“unused nullable columns accepted / cleanup not needed”。

### 4. OQ-G / OQ-H 是否完整执行？

**OQ-G：边界执行得基本完整。** Loop 3 被限定为 `failed → skipped` 单向转换，文本显式排除 retry / resume / auto-retry / reset pending / attempt count / parentTaskId。没有看到 retry-policy 行为偷渡进 Loop 3。

证据：
- Loop 3 定义在 `docs/proposals/M2-master-plan.md:311-318`。
- OQ-G 答案在 `docs/proposals/M2-master-plan.md:339-341`。

注意：§2 仍列 MD2 “retry/resume/skip policy 闭环”作为 8 项 MUST-do，见 `docs/proposals/M2-master-plan.md:52-61`。这可以保留为来源记录，但建议在 MD2 行加注：“v2 已拆分，Loop 3 只覆盖 skip，retry/resume 后续重新 gate”，防止读者把 MD2 当成 Loop 3 范围。

**OQ-H：语义执行完整，但文字上不是 100% 替换。** 文档仍出现 `wave/Wave`，不过都在 v1 deprecation 或原 plan 引用上下文里，不是新执行模型。建议把 OQ-H 的“本文档已改”改成“执行模型已统一为 Loop；仅在 v1 废弃说明中保留 wave 引用”。

证据：
- v1 废弃语境见 `docs/proposals/M2-master-plan.md:13-17`、`docs/proposals/M2-master-plan.md:295-297`、`docs/proposals/M2-master-plan.md:315-318`、`docs/proposals/M2-master-plan.md:324-326`。
- OQ-H 当前说“本文档已改”，见 `docs/proposals/M2-master-plan.md:339-341`。

---

## Findings

### M1 [MAJOR] Loop 1 的 schema mode / protocol scope 在不同章节互相冲突

**Where**: `docs/proposals/M2-master-plan.md:69-78`, `docs/proposals/M2-master-plan.md:121-131`, `docs/proposals/M2-master-plan.md:189-199`, `docs/proposals/M2-master-plan.md:320-322`  
**Lens**: 正确性 / 不可逆  
**Issue**: §5 把 Loop 1 正确收缩成 `failed_reason` + `failed_at` additive/default mode/no protocol bump，但 §3 仍说 #1.1 是 “schema v102, schema-rebuild migration”，§4 M2 #1 anchor gate 又把 `cancelled` enum、retry 后 stage、HARNESS_PROTOCOL_VERSION 1.2 和 MIN_CLIENT_VERSION 讨论混在同一个答案里。  
**Why this matters**: 这正是 v1 被拒的残留风险：实现者可能按 §3/§4 走 schema-rebuild 或 protocol bump，把 Loop 1 从 additive-only 重新扩大成骨架批次。§0.5 明确 schema / protocol / MIN_CLIENT_VERSION 属于骨架层，必须单独 gate，见 `docs/HARNESS_ROADMAP.md:121-130`。  
**Suggested fix**: 把 §3 #1.1 改为 “schema v102, default migration, additive columns only”；§4 M2 #1 anchor gate 拆成 “Loop 1 anchor gate 草答”，只保留 failed fields；把 cancelled enum / retry API / protocol 1.2 移到 future Loop anchor gate 占位。

### M2 [MAJOR] Zod “passthrough” 依据不准确；不 bump protocol 的结论可保留但理由要改

**Where**: `docs/proposals/M2-master-plan.md:191-199`, `packages/shared/src/harness-protocol.ts:192-207`, `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift:168-185`, `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift:489-490`  
**Lens**: 跨端对齐 / 不可逆  
**Issue**: proposal 说老 Zod schema 用 `passthrough` 接受 extra fields，但实际 `StageDtoSchema` 是普通 `z.object({...})`，没有 `.passthrough()`。Zod 默认会接受并 strip unknown keys，这与 passthrough 不同。Swift 默认 Decodable 会 ignore unknown keys；项目里也有注释提醒不要破坏这个默认行为。  
**Why this matters**: “old client compat” 结论目前仍大体成立，但如果文档把机制写错，后续 reviewer 可能以为 round-trip 会保留 unknown 字段，或者在某端加 `.strict()` 时没意识到会破坏兼容。  
**Suggested fix**: 把 §5 文字改成：“老 TS Zod schema 是 non-strict object，默认接受并 strip extra fields；Swift Decodable 默认 ignore unknown keys；Loop 1 增加 old-schema parse fixture，确保 extra fields 不报错。”不要写 passthrough，除非真的改 schema。

### M3 [MAJOR] §4 anchor gate 的 “prod-shape verified” 还不是 Loop 1 粒度

**Where**: `docs/proposals/M2-master-plan.md:117-131`, `docs/proposals/M2-master-plan.md:189-199`, `docs/HARNESS_ROADMAP.md:182-194`, `docs/retrospectives/M2-h14-prod-migration-failure.md:50-56`  
**Lens**: 正确性 / 不可逆  
**Issue**: §4 说 prod-shape 测试必须包含 failed stages + cancelled stages + retry 后 stage；这对未来 #1.5/#1.3 合理，但对 Loop 1 additive columns 过宽。Loop 1 真正需要验证的是 v101 prod-shape DB 上 ADD COLUMN：已有 parent rows、child FK rows、stage CHECK、index、真实 user_version 升级后数据/FK/index 保持正常。  
**Why this matters**: v0.4.4 的教训不是“测试项越多越好”，而是 fixture shape 必须对应本次 migration 风险。过宽的 gate 会制造仪式负担，也会掩盖本次最关键的 v101 → v102 additive 验证。  
**Suggested fix**: 在 §5 Loop 1 prod-shape migration test 下写明最小 fixture：v101 DB、至少 1 issue、多个 stage 覆盖现有 status/kind、至少 1 decision FK 指向 stage、现有 `idx_stage_issue_kind`/`idx_stage_running` 可查询、迁移后二次 reopen、`foreign_key_check` 为空。

### m1 [MINOR] §6 全景图仍有 batch illusion 风险

**Where**: `docs/proposals/M2-master-plan.md:215-292`, `docs/proposals/M2-master-plan.md:324-327`  
**Lens**: 简化  
**Issue**: §6 的依赖图和“关键路径 ≈ 7 圈 / M2 done 判定”有信息价值，但它和 §7 “不再有 M2 总进度估算”放在一起，会让读者自然把它当成隐藏总计划。  
**Suggested fix**: 把 §6 标题改为 “Non-authoritative dependency map”，并在关键路径前加一句：“不是批准顺序，不是承诺执行完；每条边只表达技术依赖。”

### m2 [MINOR] MD2 仍按 full retry/resume/skip 表述，容易和 OQ-G 冲突

**Where**: `docs/proposals/M2-master-plan.md:52-61`, `docs/proposals/M2-master-plan.md:311-318`, `docs/proposals/M2-master-plan.md:339-341`  
**Lens**: 跨端对齐 / 简化  
**Issue**: §2 的 MD2 作为 reviewer 反馈来源可以保留，但它仍写 “retry/resume/skip policy 闭环 + 测试覆盖每条选择路径”。读者如果只扫 MUST-do 表，可能误以为 Loop 3 仍要做完整 retry policy。  
**Suggested fix**: 在 MD2 行末加注：“v2 已拆：Loop 3 only minimal skip；retry/resume/auto-retry/attempt count 后续 Loop 重新 gate。”

### m3 [MINOR] Loop 3 skip API 是状态变更 API，候选表里应提前标 auth gate

**Where**: `docs/proposals/M2-master-plan.md:311-313`, `docs/proposals/M2-master-plan.md:129-131`  
**Lens**: 安全  
**Issue**: Loop 1 不引入新 auth surface；但 Loop 3 的 `POST /api/harness/stages/:id/skip` 会改变 workflow state。§4 future retry/skip/cancel API 提到需要 token，但 §7 Loop 3 候选表没有显式写。  
**Suggested fix**: 在 Loop 3 触发条件或内容里加 “requires existing `CLAUDE_WEB_TOKEN` auth; no unauthenticated mutation route”。这不需要现在设计完整权限模型，只是防止后续实现忘记。

---

## 5-Lens Notes

### 正确性

Loop 1 的真实 schema slice 可以是安全 additive。当前最大 correctness 风险不是 SQL 本身，而是 proposal 内部对同一 Loop 的 mode/scope 说法不一致。v0.4.4 失败证明了“看似 additive”可能隐藏 rebuild；这次恰好相反：§5 已经把它收成真正 additive，但旧章节仍会把它误扩大。

### 跨端对齐

Swift old-client ignore unknown keys 的前提成立；StageDto 没有自定义 strict decoder。TS Zod 端也不是 strict，但不是 passthrough，而是默认 strip unknown。HARNESS_PROTOCOL_VERSION 暂不 bump 可以接受，但建议补 old-schema parse fixture，避免以后有人加 strict 破坏兼容。

### 不可逆

`failed_reason` / `failed_at` 作为 nullable forward-only columns 成本低。真正不可逆项是未来 cancelled enum、MIN_CLIENT_VERSION、ResourceLock table、skip API 行为语义；v2 已经把它们移到 hold / future gate，方向正确。

### 安全

Loop 1 不新增 route、不新增 auth surface、不触碰 filesystem/sandbox。未来 Loop 3 skip API 是 mutation route，应在该 Loop gate 中显式要求现有 bearer auth。

### 简化

保留 §3 全景 map 有价值，因为它回答“5 个 M2 目标是否还有覆盖路径”。但 §6 依赖图和关键路径应降级成 appendix / non-authoritative map，避免读者把它当成新版 batch。

---

## False-Positive Watch

- F? M2 的 Zod 兼容判断取决于实际 old clients 是否会调用 `StageDtoSchema.parse` 来处理 server payload。当前 shared schema 本身不是 strict；如果旧客户端完全不用 Zod parse，则风险更低。但 proposal 的 “passthrough” 用词仍应修正。
- F? Loop 2 → Loop 3 是否“自然后继”不是问题本身。只有当 proposal 或 PR 描述承诺一次批准 Loop 1-3 时才会升级为 blocker；当前文本没有这么做。

## What I Did Not Look At

- 没有运行 migration；本次只做静态 SQL / proposal / protocol 审读。
- 没有查看 PR #29 网页评论原文；按用户消息中列出的四个 review-request points 执行。
- 没有验证 iOS 真机 decode 行为；只静态检查 Swift `Codable` 结构与项目注释。
- 没有审查未来 ResourceLock / dashboard / ContextManager v2 的具体实现，因为 v2 没有授权这些 Loop。
- 没有修改 proposal 本身；本文件只给 cross-review verdict。
