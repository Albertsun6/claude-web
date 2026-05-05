# Cross Review — M2 Loop 1 failed_reason additive schema

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-05 23:19  
**Files reviewed**:
- `packages/backend/src/migrations/0003_stage_failed_reason.sql`
- `packages/backend/src/harness-store.ts`
- `packages/shared/src/harness-protocol.ts`
- `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`
- `packages/shared/fixtures/harness/stage-failed.json`
- `packages/shared/src/__tests__/harness-protocol.test.ts`
- `packages/backend/src/test-harness-schema.ts`
- `packages/backend/src/migrations/0001_initial.sql`
- `packages/backend/src/migrations/0002_stage_status_dispatched.sql`
- `packages/backend/src/scheduler.ts`
- `packages/backend/src/routes/harness.ts`

---

## Summary

- Blockers: 0
- Majors: 0
- Minors: 3
- 总体判断：建议合并。Loop 1 保持在 charter 内；三个 minor 都是测试/注释锁定强度问题，不影响本圈通过。

## Numeric Score

| Lens | Score (0..5) |
|---|---:|
| 正确性 | 4.7 |
| 跨端对齐 | 4.7 |
| 不可逆 | 4.8 |
| 安全 | 5.0 |
| 简化 | 4.8 |

**Overall score**: 4.8

---

## Loop 1 Charter Compliance

结论：scope discipline held。

1. **没有产品写入路径溜入**。全仓 `failed_reason` / `failed_at` / `failedReason` / `failedAt` 命中集中在 migration、DTO、fixture、protocol test、schema test；`scheduler.ts` 失败 catch 仍只写 `status='failed'`，没有写 failed reason，见 `packages/backend/src/scheduler.ts:208-216`。`test-harness-schema.ts` 的 `UPDATE stage SET failed_reason = ?` 是测试验证 schema 可写，不是 runtime writing path，见 `packages/backend/src/test-harness-schema.ts:637-647`。

2. **没有新增 skip API / retry policy / cancelled enum / runtime_state / dashboard / review-orchestrator**。当前 harness router 仍是既有通用 status mutation `PUT /stages/:id/status`，没有新增 `POST /api/harness/stages/:id/skip` 之类 Loop 3 API，见 `packages/backend/src/routes/harness.ts:120-140`。`task.status` 里的 `cancelled` 是 0001 既有值，不是本圈新增，见 `packages/backend/src/migrations/0001_initial.sql:163-178`。

3. **HARNESS_PROTOCOL_VERSION 没 bump**。TS 端仍是 `1.1`，`MIN_CLIENT_VERSION` 仍是 `1.0`，见 `packages/shared/src/harness-protocol.ts:47-48`。0003 migration 注释也明确保持不 bump，见 `packages/backend/src/migrations/0003_stage_failed_reason.sql:19-23`。

4. **MIN_CLIENT_VERSION 没 bump**。Swift 端协议客户端版本仍是 `1.0`，见 `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift:18-27`；TS 端 `MIN_CLIENT_VERSION` 仍是 `1.0`，见 `packages/shared/src/harness-protocol.ts:47-48`。

---

## Findings

### m1 [MINOR] Phase 5 没有机械锁住 0003 必须走 default migration mode

**Where**: `packages/backend/src/test-harness-schema.ts:486-492`, `packages/backend/src/migrations/0003_stage_failed_reason.sql:1-26`, `packages/backend/src/harness-store.ts:142-146`  
**Lens**: 正确性 / 不可逆  
**Issue**: 当前实现本身是 default path：0003 只有 `TARGET_VERSION = 102`，没有 `MIGRATION_MODE = schema-rebuild`，runner 因此落到 default，见 `harness-store.ts:142-146`。但 Phase 5 主要验证迁移结果，没有直接 assert “0003 header 不含 MIGRATION_MODE / 不是 schema-rebuild”。  
**Why this is minor**: 这不是当前 patch 的 bug。当前 SQL 是两条最薄 `ALTER TABLE ADD COLUMN`，见 `0003_stage_failed_reason.sql:25-26`。风险在未来有人把 0003 改成 schema-rebuild 且仍拷贝正确时，Phase 5 可能继续通过，无法单靠测试拦住“charter 违约”。  
**Suggested fix**: 可选加一条测试：读取 `0003_stage_failed_reason.sql` 前 20 行，assert 不包含 `MIGRATION_MODE` 或解析后 mode 为 `default`；同时 assert SQL 不含 `DROP TABLE stage` / `CREATE TABLE stage_new`。

### m2 [MINOR] old-client compat test 能抓 `.strict()`，但不是冻结的 v0.4.5 schema 模拟

**Where**: `packages/shared/src/__tests__/harness-protocol.test.ts:113-139`  
**Lens**: 跨端对齐  
**Issue**: 这组测试使用当前 `StageDtoSchema` 解析带 `futureFieldZ` 的 payload，并 assert unknown key 被 strip。它确实会在未来有人给当前 schema 加 `.strict()` 时失败，这是本圈最关键的 compat lock。  
**Why this is minor**: 注释里说模拟 “v0.4.5 老客户端”，但测试没有内联一个“不含 failedReason / failedAt 的 legacy Stage schema”。所以它锁住的是“当前 schema 不准 strict”，不是完整证明旧 binary 的实际行为。考虑到旧 TS schema 也是默认 `z.object` 非 strict，当前证据足够支持 Loop 1；只是测试表达可以更精确。  
**Suggested fix**: 可选补一个 `LegacyStageDtoSchema`（字段到 `createdAt` 为止，不含 failed fields），用它 parse 带 `failedReason` / `failedAt` / `futureFieldZ` 的 payload，assert 不 throw 且 unknown 被 strip；保留当前测试用于防 future `.strict()`。

### m3 [MINOR] Phase 5 注释说“53 行模拟 prod”，实际 fixture 是 5 stages

**Where**: `packages/backend/src/test-harness-schema.ts:486-488`, `packages/backend/src/test-harness-schema.ts:520-542`  
**Lens**: 正确性 / 简化  
**Issue**: Phase 5 注释写“父表 stage 既有 53 行（模拟 prod）保留”，但实际 seed 是 5 个 stage，覆盖 `pending / dispatched / running / awaiting_review / approved`。  
**Why this is minor**: 这不影响 test adequacy。Loop 1 additive migration 的关键风险不是数据量，而是 v101 DB + parent rows + child FK refs + existing indexes + reopen + `foreign_key_check`。这些都覆盖到了，见 `test-harness-schema.ts:512-568`、`574-623`、`649-668`。  
**Suggested fix**: 把注释改成“多个 stage（覆盖代表性 status/kind）”，避免 review 时误以为真 seed 了 53 行。

---

## 5-Lens Findings

### Lens 1 — 正确性

无 blocker / major。0003 是纯 additive：`failed_reason TEXT` 和 `failed_at INTEGER` 没有 NOT NULL、DEFAULT、CHECK、FK、index、generated column 或 trigger，见 `packages/backend/src/migrations/0003_stage_failed_reason.sql:25-26`。现有 stage 表 FK / CHECK / index 来自 0001/0002，0003 没触碰它们，见 `packages/backend/src/migrations/0002_stage_status_dispatched.sql:45-89`。

唯一 minor 是 m1：Phase 5 结果验证足够，但没有机械 assert default mode。

### Lens 2 — 跨端对齐

TS / Swift / fixture 对齐成立。SQL 是 nullable columns；TS 是 `.optional()`，见 `packages/shared/src/harness-protocol.ts:207-212`；Swift 是 `String?` / `Int64?`，见 `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift:168-188`；fixture 用 camelCase `failedReason` / `failedAt`，见 `packages/shared/fixtures/harness/stage-failed.json:13-15`。

old-client compat lock 的核心有效：如果未来有人给 `StageDtoSchema` 加 `.strict()`，`futureFieldZ` 测试会 throw，见 `packages/shared/src/__tests__/harness-protocol.test.ts:121-139`。minor m2 只是建议补一个 legacy schema，让测试名和实际模拟更一致。

### Lens 3 — 不可逆

无 blocker / major。两个 nullable forward-only column 是低不可逆成本选择；没有把 future Loop 的 retry / cancelled / skip semantics 写进 schema。Loop 2 以后可以直接写入这两个字段，不需要 NOT NULL backfill。

### Lens 4 — 安全

无 finding。Loop 1 没有新增 route、auth surface、agent permission surface、FTS query、外部路径或 mutation API。现有 harness routes 没出现 Loop 3 skip endpoint，见 `packages/backend/src/routes/harness.ts:120-140`。

### Lens 5 — 简化

无 blocker / major。两列是最小可用 slice；用单个 JSON 字段会让查询、展示和未来 audit 更不清楚，不比当前设计更简单。minor m3 是注释过度声称，不是实现复杂度问题。

---

## Key Questions Answered

1. **Scope discipline**: held。没有 runtime failed_reason 写入、没有新 skip API、没有 retry policy、没有 cancelled enum、没有 protocol/minClient bump。

2. **Additive-only verification**: current SQL is actually pure additive。0003 不含 `MIGRATION_MODE`，runner 默认 mode 是 `default`，见 `packages/backend/src/harness-store.ts:142-146`；schema-rebuild 分支只在 mode 显式为 `schema-rebuild` 时走，见 `packages/backend/src/harness-store.ts:181-196`。Phase 5 对 0003 用真实文件复制到 v101 migrations dir 后 reopen，未人为走 broken schema-rebuild harness，见 `packages/backend/src/test-harness-schema.ts:559-568`。

3. **Old-client compat lock**: adequate for preventing future `.strict()` breakage。`futureFieldZ` 会在 `.strict()` 下报错，所以测试会抓住它，见 `packages/shared/src/__tests__/harness-protocol.test.ts:121-139`。它不是旧 binary E2E，只是 schema-level regression lock。

4. **Prod-shape Phase 5 adequacy**: adequate for the v0.4.4 lesson。它覆盖 v101 DB、父 rows、3 个 `decision.stage_id` child refs、`foreign_key_check`、两个既有 stage indexes、reopen/idempotency，见 `packages/backend/src/test-harness-schema.ts:512-668`。剩余 minor 是没有机械锁 default mode，见 m1。

5. **Future loop hooks**: no harm found。nullable `failed_reason` / `failed_at` 不强迫 Loop 2 做 NOT NULL backfill，也不预先绑定 retry/skip/cancelled 语义。

---

## False-Positive Watch

- m1 可能被视为“测试过度加固”。我认为它不是合并条件，因为当前 SQL 静态事实已经满足 default additive；它只是把 plan v2 的 charter 约束变成机器锁。
- m2 不是说 compat 测试无效；它有效抓 `.strict()`。我只区分“防 future strict”与“真正跑旧客户端代码”这两件事。

## What I Did Not Look At

- 没有运行 test suite；本次是静态 cross-review。
- 没有启动 backend 或在真实 `~/.claude-web/harness.db` 上执行 migration。
- 没有检查 PR #29 的 GitHub discussion / commit transcript；只读最终 artifact 和必要上下文文件。
- 没有 review Loop 2/3 设计，只判断 Loop 1 是否为后续写入路径 / skip API 留出空间。
- 没有做 Swift 编译或真机 Codable round-trip；只静态确认 `StageDto` 使用默认 Optional Codable。
