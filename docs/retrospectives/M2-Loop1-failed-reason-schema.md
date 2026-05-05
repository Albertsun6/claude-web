# M2 Loop 1 — failed_reason + failed_at additive schema

**Date**: 2026-05-05
**Phase**: M2 Loop 1（first loop under M2 master plan v2 loop-by-loop approval）
**Risk addressed this loop**: "M2 #1 失败可诊断 — 当前 stage 失败仅 console.log，无法从持久化 state 区分 orphan / spawn fail / harvest fail / CLI fail"
**Exit**: **ship**
**Related PRs**:
- #29 M2 master plan v2 (proposal)
- #28 F orphan cleanup (cross-review 反向喂出 8 项 MUST-do)
**Related artifacts**:
- `packages/backend/src/migrations/0003_stage_failed_reason.sql`
- `packages/shared/src/model-registry.ts` 同期 ship（不属本 Loop 但同 dev 周期）
- `docs/proposals/M2-master-plan.md` Loop 1 charter
- `docs/reviews/m2-loop1-failed-reason-cross-2026-05-05-2319.md`

---

## 一句话本圈风险

让 stage 失败原因可以**持久化到 DB**（schema 字段），从而后续 Loop 2 能写入、Loop 3 能基于失败类型决策 skip / retry。Loop 1 **只**做 schema additive — 写入路径 / API / retry policy 全部留给后续 Loop。

## 6 步循环执行

### 1. 风险陈述

stage 失败时仅 `console.warn` 输出原因，DB 只剩 `status='failed'`。operator 无法分辨：
- orphan after restart（F 圈引入但只能日志辨识）
- spawn setup failure（ContextBundle / createTask 期间的 throw）
- spec harvest failure（strategy stage 后 harvest 阶段）
- CLI execution failure（runSession 内 throw）

诊断要靠看 backend log + 时间窗口对照，不可靠。

### 2. 最小可运行切片

```sql
ALTER TABLE stage ADD COLUMN failed_reason TEXT;
ALTER TABLE stage ADD COLUMN failed_at INTEGER;
```

两列 nullable，无 DEFAULT / CHECK / FK / index。`MIGRATION_MODE = default`（不是 schema-rebuild）。

### 3. 机器验证

- `pnpm --filter @claude-web/shared test` → **123/123 pass**（118 + 5 new）
  - +5: enum lock for failed fixture / old-client compat parsing payload with extra `futureFieldZ` / old-server payload without failed fields / new fixture round-trip / displayName lock retained
- `pnpm --filter @claude-web/backend test:harness-schema` → Phase 1+2+3+4+5 全绿
  - Phase 5 加 13 项 prod-shape 断言 + 5 项 charter compliance lock（cross m1 应用，机械 assert 0003 必须 default mode + 不含 DROP TABLE / CREATE TABLE stage_new）
- `pnpm -r exec tsc --noEmit` → clean

### 4. 真实 dogfood

复制真实 prod `~/.claude-web/harness.db`（v101 + 53 stages + 46 decisions）到 `/tmp/prod-loop1-copy.db`，跑 0003 migration：

| 验证 | 结果 |
|---|---|
| schema 升级 | v101 → v102 ✅ |
| 53 stages 全保留 | ✅ |
| 46 decisions 全保留 | ✅ |
| 46/46 decisions FK refs JOIN 到 stage 仍有效 | ✅ |
| `foreign_key_check` 0 violations | ✅ |
| `failed_reason` + `failed_at` 列加成功 | ✅ |
| 53/53 行默认 NULL（既有数据未触动）| ✅ |
| 既有 `idx_stage_issue_kind` / `idx_stage_running` 保留 | ✅ |

Live `~/.claude-web/harness.db` 完全未触动，dogfood 仅用拷贝。

### 5. cross-review

`docs/reviews/m2-loop1-failed-reason-cross-2026-05-05-2319.md` — cursor-agent gpt-5.5-medium：

- **0 BLOCKER + 0 MAJOR + 3 MINOR**，overall 4.8 / 5
- **Charter compliance held**：scope discipline 完整保持
  - 无 runtime 写入路径溜入
  - 无 skip API / retry policy / cancelled enum / runtime_state / dashboard / review-orchestrator
  - HARNESS_PROTOCOL_VERSION 保持 1.1（未 bump）
  - MIN_CLIENT_VERSION 保持 1.0（未 bump）
- m1（Phase 5 charter mode lock）✅ 应用
- m2（独立 LegacyStageDtoSchema）➡️ follow-up（避免 schema 重复维护负担）
- m3（注释 "53 行" 误传）✅ 已修

### 6. retrospective + 下一圈 scope

**Exit**: **ship**

**Loop 1 done 判定**：
- 以上 5 项 gate 全绿
- cross-review 0 blocker / 0 major
- charter 严格保持
- prod copy 真实兼容

**Loop 2 启动条件已具备**：Loop 1 retrospective 确认 schema 落地稳定 + dogfood 验证 prod 上加列无副作用。

**Loop 2 候选 scope**（待用户启动批批准）：在 scheduler.ts 各个 catch path 写入 `failed_reason`：
- `cleanupOrphanStages` → `'orphan_after_restart'`
- `spawnAgent` catch → `'spawn_setup_failed'`（bundle/task 期间 throw）/ `'cli_failed'`（runSession 期间 throw）
- `harvestSpecArtifact` catch → `'spec_harvest_failed'`

Loop 2 不动 schema（Loop 1 已加好列）；不动 protocol（仍 additive optional）。本圈 risk 是"写入路径覆盖完整 + audit log 同步"。

**Loop 3 仍 hold**：等 Loop 2 retrospective 确认 failed_reason 实际能区分失败类型 → 才启动 minimal skip API。

## 学到的（Trans-context lessons）

### Lesson A — Loop 1 真 additive 是可达到的

H14 v0.4.4 的教训让我担心"看起来 additive 实际触发 rebuild"重演。Loop 1 通过：
1. cross-review 重点检查（plan v2 cross M2 验证 zod compat 机制 / cross M3 收紧 prod-shape fixture）
2. 实施时 SQL 定义严格 minimal（无 DEFAULT / CHECK / FK / index）
3. Phase 5 加 charter compliance lock（机械 assert 0003 不含 schema-rebuild 标记 / DROP TABLE / CREATE TABLE stage_new）

证明真 additive 可以做到，但需要"防滑坡"机制（charter lock）才不会随时间蜕变。

### Lesson B — old-client compat 需要 schema-level lock 而非 binary E2E

cursor-agent verdict M2 抓到的关键点：plan v2 写"老 Zod 用 passthrough"是错的，实际是 default non-strict object（接受 + strip unknown）。修正后：靠 `futureFieldZ` 测试 lock "future strict 不允许加" — 这就足够，不需要冻结一份 v0.4.5 schema。

**记入 reviewer-cross/LEARNINGS.md（待补）**：跨端兼容 lock 应该针对"破坏兼容的代码改动"，不必模拟"旧 binary 完整行为"。

### Lesson C — Loop-by-Loop approval 真比 wave batch 安全

如果按 v1 plan 走 Wave A（捆绑 #1.1 + #2.1 + #4.1），cancelled enum + ResourceLock 必须一起 ship，每项的 cross-review 复杂度 ×3 + scope 边界模糊 + 回滚成本累积。v2 拆 Loop 1 only：scope 极清晰 → cross-review 4.8/5 + 0 finding 是 major。这验证了用户 + 另一 AI PK 收敛的"loop-by-loop"是对的。

### Lesson D — Charter lock 应当机械化

cross m1 提议 "Phase 5 加 charter compliance lock（机械 assert 0003 是 default mode）" — 应用后立即起作用：5 项断言机械 lock 0003 SQL 形状。未来加新 migration 时如果不慎用 schema-rebuild + 模仿 Loop 1 形状，这 5 项断言不会通过 → CI 拦截。

**记入 reviewer-cross/LEARNINGS.md（待补）**：scope discipline 也是可机械验证的不变量，不应只靠 review 视觉检查。

## Follow-up（不阻塞 Loop 1 ship）

- **m2 follow-up**：可选补独立 LegacyStageDtoSchema（v0.4.5 冻结版）—— 评估认为成本（每次 Loop 都要冻结新版）大于收益（当前 .strict() lock 已 cover），暂不做
- **LEARNINGS.md 更新**：把 Lesson B / D 写进 `.claude/skills/reviewer-cross/LEARNINGS.md`（下一次 review 工作流时合并）
- **Loop 2 plan**：单独 PR 启动时填 anchor gate 7 问草答 + 加锁 charter（写入路径 only，不动 schema）
