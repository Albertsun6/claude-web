-- TARGET_VERSION = 101
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
-- Migration 策略（SQLite 不能 ALTER CHECK，必须 rebuild table 模式）：
--   PRAGMA defer_foreign_keys=ON  (内 transaction 推迟 FK 检查到 commit)
--   CREATE TABLE stage_new (含新 CHECK)
--   INSERT INTO stage_new SELECT * FROM stage  (拷数据)
--   DROP TABLE stage  (FK ref from task/artifact/review_verdict/decision 暂时悬空)
--   ALTER TABLE stage_new RENAME TO stage  (FK ref 重绑同名表)
--   重建 index (idx_stage_issue_kind + idx_stage_running)
--   commit 时 SQLite 校验 FK 完整性 — 数据不变 + 名字不变 = 满足
--
-- harness-store.ts migration runner 把整段包在 db.transaction()，原子。defer_foreign_keys
-- 是 SQLite 推荐的 transaction-scope FK 推迟方式（不像 PRAGMA foreign_keys=OFF 必须
-- 在 transaction 外执行）。

PRAGMA defer_foreign_keys = ON;

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
