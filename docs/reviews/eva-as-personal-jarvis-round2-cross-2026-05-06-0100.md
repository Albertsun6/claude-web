我已经核对了当前 `0001_initial.sql`：`stage.kind` 确实是 10 值固定，`issue.project_id` 是普通 FK，不要求每个 project 必须有 issue；但 `decision.stage_id` 现在是 `NOT NULL REFERENCES stage(id)`，这会影响所有“不创建 Issue/Stage 但创建 Decision row”的新设计。# Round 2 Lightweight Cross-check — EVA_AS_PERSONAL_JARVIS.md v0.2

**Reviewer**: reviewer-cross (lightweight round 2)  
**Model**: cursor-agent gpt-5.5  
**Date**: 2026-05-06 01:00

## Summary

- Hard requirement pass: 0 / 5 clean pass
- New BLOCKER: 2
- Drift findings: 3
- 总体判断: **建议修后 PASS**

## Findings

### F1 [BLOCKER] 内部一致性：M7a 仍然隐式依赖 M6 Memory/Decision schema

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:242`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:256`, `packages/backend/src/migrations/0001_initial.sql:276`

**Status**: M7a 声明“不依赖 Memory 表”，但核心动作要求 routine 配置和处理结果都写入 `Memory`，同时还要创建 `Decision row`；当前 `decision.stage_id` 是 `NOT NULL REFERENCES stage(id)`，而 routine domain 明确“不创建 Issue / Stage row”。

**Suggested fix**: 二选一：
- 把 M7a 改成真正不依赖 Memory/Decision 表：routine 配置先存在 retrospective / config file / server-driven config，Decision 只做文档级 dry-run，不落 `decision` 表。
- 或把最小 `memory` + stage-less `decision` schema 前置到 M5/M7a 入场条件，并明确 M6 只做 fact extraction / FTS / registry 扩展，而不是第一次引入 Memory 表。

### F2 [DRIFT] memory_kind_registry 字段方向基本合理，但“核心 kind CHECK enum + 扩展 registry FK”表达有歧义

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:166`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:281`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:421`

**Status**: `kind / payload_schema_ref / owner_domain / deprecated_at` 作为 registry 字段合理；`memory` 字段也覆盖了 phase 2 要求的 `provenance + sensitivity_level`。问题是文档同时说“核心 kind 走 CHECK enum，扩展 kind 走 registry”，但 DDL 草案又是 `memory.kind TEXT NOT NULL REFERENCES memory_kind_registry(kind)`；如果 `memory.kind` 再加 CHECK enum，扩展 kind 会被 CHECK 拦住。

**Suggested fix**: 明确 U-J1-B 的 SQL 语义：推荐“所有合法 kind 都必须先在 registry seed/insert，核心 kind 只是启动时 seed rows + protected/deprecated policy”，不要在 `memory.kind` 上再加限制扩展 kind 的 CHECK enum。若确实要保留核心/扩展分层，给 registry 加 `tier TEXT CHECK (tier IN ('core','extension'))` 比在 `memory.kind` 上混用 CHECK 更清楚。

### F3 [BLOCKER] M7a/M7b 拆分没有完全消除循环依赖

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:244`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:257`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:271`

**Status**: M7a 被放在 M6 前，目标是积累 retrospective 给 M6 fact extraction；但 routine dry-run 的配置、触发结果、用户处理结果都写成 Memory kind。这让 M7a 运行前需要 M6 的核心表，形成新循环依赖。

**Suggested fix**: 把 M7a 拆成两层：
- `M7a-pre-memory`: routine/knowledge dry-run，只产 retrospective，不写 `memory`。
- `M7a-post-memory` 或并入 M6 退出条件：把 retrospective 抽成 `config.routine.cron` / `decision.routine.handled` memory rows。

### F4 [DRIFT] Stage 分层本身不破坏 Issue/Stage 模型，但“Decision 直驱”需要 schema 级落点

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:225`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:456`, `packages/backend/src/migrations/0001_initial.sql:50`, `packages/backend/src/migrations/0001_initial.sql:120`, `packages/backend/src/migrations/0001_initial.sql:276`

**Status**: `health Subject` 是 `harness_project` row 但没有 `issue` row，这一点和当前 `issue.project_id REFERENCES harness_project(id)` 不冲突；FK 不要求每个 project 都有 issue。真正的错位在 `Decision`：当前 `decision` 只能挂在 `stage_id` 上，不能挂在 project/subject/memory/routine event 上。

**Suggested fix**: 不需要 schema-level 强制“memory-driven domain 不允许 INSERT issue”作为 M5 blocker；这可以先由 application gate 做。但必须在 M5/M7a contract 里补 `decision` 扩展方案，例如：
- `decision.stage_id` 改 nullable，并新增 `project_id NOT NULL` + `subject_domain` + `source_ref_type/source_ref_id`；
- 或新建 `subject_decision`，避免污染现有 stage decision 语义。

### F5 [DRIFT] K-jarvis-5/6/7 没有新增不可接受 blocker，但 K6/K7 落地契约不足

**Where**: `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:377`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:378`, `docs/proposals/EVA_AS_PERSONAL_JARVIS.md:379`, `packages/backend/src/migrations/0001_initial.sql:276`, `packages/backend/src/index.ts:90`

**Status**: K-jarvis-5 的“默认同 Subject + 同 domain，跨域显式允许”方向合理，但“同 domainProfile 跨 Subject”允许规则还需要 policy 字段表达。K-jarvis-6 的 `trivial/minor/major` 当前 `decision` 表没有字段承载。K-jarvis-7 说的是 iPad 直接读 read-only DB 副本、不跑 backend，所以不依赖当前 HTTP 路由区分 read-only/write；当前 `index.ts` 确实只按 auth 挂 `/api/*`，没有 read-only route mode。

**Suggested fix**:
- K5：把 query policy 写成 `same_subject` / `same_domain_cross_subject` / `cross_domain_explicit` 三档，而不是只写“默认禁止跨 domain”。
- K6：给未来 decision schema 明确加 `severity TEXT CHECK (severity IN ('trivial','minor','major'))` 或等价字段。
- K7：保留“不跑 backend”的定位；如果未来要走 HTTP degraded mode，再单独设计只读 router，不要暗示现有 backend 已支持。

## What I Did Not Look At

- 没有重新评审 v0.2 整体方向、外部竞品事实或长期路线合理性。
- 没有读 phase 1/2 reviewer 原 verdict，只按本次 prompt 要求核对 v0.2、arbitration log、当前 migration SQL 和 backend route 事实。
- 没有运行 migration、测试或修改任何文件。
