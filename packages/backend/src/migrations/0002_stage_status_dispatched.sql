-- TARGET_VERSION = 101
-- MIGRATION_MODE = schema-rebuild
--
-- H14 v1: stage.status 加 'dispatched' 中间态（M2 first wave 后续）。
--
-- Why：scheduler.tick() createStage(pending) 到 spawnAgent runSession 之间有窗口（写
-- ContextBundle、create task、prepare prompt），现状 status 已经是 'running'。这窗口出错时
-- 排错困难（是 bundle 写失败？task INSERT 失败？还是 cli 卡死？）。引入 `dispatched` 表
-- "scheduler 已 reserve stage row + 准备 bundle/task/runtime；spawn 真起来前"。
--
-- 状态机变化：
--   旧：pending → running → approved/rejected/skipped/failed
--   新：pending → dispatched → running → approved/rejected/skipped/failed
--                            ↘ failed
--
-- v0.4.4 → v0.4.5 hot-fix（重要历史）：
-- 原版用 `PRAGMA defer_foreign_keys = ON` 期望让 DROP TABLE stage 通过，但 SQLite 的
-- defer_foreign_keys 只推迟 row-level immediate 检查，**不影响 DROP TABLE 的 schema-level
-- FK 引用检查**。prod 真实数据下（53 stages + 46 decisions FK 引用 stage.id）启动 backend
-- 触发 "FOREIGN KEY constraint failed"，promote 失败。详见
-- [docs/retrospectives/M2-h14-prod-migration-failure.md](../../../../docs/retrospectives/M2-h14-prod-migration-failure.md)。
--
-- Migration 策略（修复版，SQLite 12-step ALTER TABLE recipe）：
--   1. MIGRATION_MODE = schema-rebuild header → harness-store.ts runner 在 transaction 外
--      `PRAGMA foreign_keys = OFF`（SQLite 要求 FK pragma 必须在 transaction 外切）
--   2. 本 SQL 文件（runner 包在 transaction 内）：
--        CREATE TABLE stage_new (含新 CHECK)
--        INSERT INTO stage_new SELECT * FROM stage（拷数据）
--        DROP TABLE stage（FK 已 OFF，schema-level 检查跳过；child table 的 FK ref 暂时悬空）
--        ALTER TABLE stage_new RENAME TO stage（SQLite 3.25+ 自动重新绑定其他表的 FK ref）
--        重建 index
--   3. runner 在 transaction 后 `PRAGMA foreign_key_check` → 验证 FK 完整性（数据不变 +
--      名字不变 → child rows 仍指向有效父行 → 应返回空）
--   4. runner finally 恢复 `PRAGMA foreign_keys = ON`
--
-- Rollback 边界（cross m3 应用）：
-- v101 是 forward-only schema 步骤。`scripts/rollback.sh v0.4.3` 会回滚代码 + 重跑 pnpm
-- install + restart backend，但**不会** down-migrate harness.db 的 user_version 或
-- stage.status CHECK enum。回滚到 v0.4.3 仅在以下条件下安全：
--   (a) 当前 DB 没有 status='dispatched' 的 stage 行（v0.4.3 代码 read 这种行不会 crash，
--       但 enum 推进 / scheduler 选取逻辑会忽略，行为不可预期）
--   (b) 没有依赖 protocol 1.1 wire 字段的 in-flight 客户端
-- 想要真正回滚 schema → manual 从 promote 前的 backup 恢复 ~/.claude-web/harness.db。

-- 新 stage 表 — CHECK 约束加 'dispatched'
CREATE TABLE stage_new (
  id                       TEXT PRIMARY KEY,
  issue_id                 TEXT NOT NULL REFERENCES issue(id),
  kind                     TEXT NOT NULL CHECK (kind IN (
    'strategy','discovery','spec','compliance','design','implement','test','review','release','observe'
  )),
  status                   TEXT NOT NULL CHECK (status IN (
    'pending','dispatched','running','awaiting_review','approved','rejected','skipped','failed'
  )),
  weight                   TEXT NOT NULL CHECK (weight IN ('heavy','light','checklist')),
  gate_required            INTEGER NOT NULL DEFAULT 1 CHECK (gate_required IN (0,1)),
  assigned_agent_profile   TEXT NOT NULL,
  methodology_id           TEXT NOT NULL REFERENCES methodology(id),
  input_artifact_ids_json  TEXT NOT NULL DEFAULT '[]',
  output_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  review_verdict_ids_json  TEXT NOT NULL DEFAULT '[]',
  started_at               INTEGER,
  ended_at                 INTEGER,
  created_at               INTEGER NOT NULL
);

-- 拷数据 — 字段顺序必须和旧 stage 一致（旧 stage 没 dispatched 数据，全部 status 值都
-- 在新 enum 内 → INSERT 不会被 CHECK 拒）
INSERT INTO stage_new (
  id, issue_id, kind, status, weight, gate_required, assigned_agent_profile,
  methodology_id, input_artifact_ids_json, output_artifact_ids_json, review_verdict_ids_json,
  started_at, ended_at, created_at
)
SELECT
  id, issue_id, kind, status, weight, gate_required, assigned_agent_profile,
  methodology_id, input_artifact_ids_json, output_artifact_ids_json, review_verdict_ids_json,
  started_at, ended_at, created_at
FROM stage;

-- 替换 — task / artifact / review_verdict / decision 的 FK ref 通过 RENAME 重新指向新表
DROP TABLE stage;
ALTER TABLE stage_new RENAME TO stage;

-- 重建 index（必须，DROP TABLE 把 index 也删了）
CREATE UNIQUE INDEX idx_stage_issue_kind ON stage(issue_id, kind);
-- 注：idx_stage_running 仍只覆盖 'running'，"CLI 真在跑" 的窄义。dispatched 是 setup 窗口
-- （ContextBundle 写盘 / createTask）尚未起 CLI，没必要进 partial index——查询 path 不同。
-- scheduler.STAGE_ACTIVE_STATUSES 才是"广义 active"集合，但那是内存用，不依赖 DB index。
CREATE INDEX idx_stage_running ON stage(status) WHERE status = 'running';
