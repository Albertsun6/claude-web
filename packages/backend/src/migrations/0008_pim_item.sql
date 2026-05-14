-- PIM v2.1 — 统一捕获入口 schema (M0-PIM)
--
-- 同源：
-- - ADR: docs/adr/vessel/ADR-020-pim-capture-entry.md
-- - 调研: ~/Desktop/HTMLvsMD/mece-research-v2-validation.md
-- - 完整设计: ~/Desktop/HTMLvsMD/mece-final-v2.1.md
-- - 实施 plan: ~/.claude/plans/mece-clever-wilkinson.md
--
-- 幂等：所有业务表 CREATE 用 IF NOT EXISTS。
-- TARGET_VERSION = 103  (M0-PIM v2.1 PIM)
-- mode 隐式 default（不写 mode header；runner 只识别 schema-rebuild header，省略 = default）
--
-- 关键设计决策（详见 ADR-020）：
-- - D5: pim_item 表 schema + 6 张关联表 + FTS5 virtual table + 11 ALTER issue 加 pim_item_id
-- - D6: commitment_state / modality / ai_status / visibility 字段用 TEXT 无 CHECK enum
--       （v2.1 红线"不要先建分类法"；ADR-006 §enum CHECK 收窄需 schema-rebuild）
--       规范化由应用层 pim-queries.ts 做（trim().toLowerCase() + 白名单 warn）
-- - D7: owner_user_id TEXT NULL 预留（本期单用户不读不写，v2.2 多用户用）
-- - 不要在本文件设置 PRAGMA user_version！由 runner 在事务结束时推进（参 0001 line 8-9）

PRAGMA foreign_keys = ON;

--------------------------------------------------------------------------------
-- 1. pim_item (核心实体)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pim_item (
  id                TEXT PRIMARY KEY,
  content           TEXT NOT NULL,
  captured_at       INTEGER NOT NULL,                  -- epoch ms
  source            TEXT NOT NULL,                     -- manual/email/screenshot/voice/clip/forwarded/ios/web/...
                                                      -- 不加 CHECK，应用层规范化（D6）

  -- L1 骨架（enum 单选，TEXT 无 CHECK 见 D6）
  commitment_state  TEXT NOT NULL DEFAULT 'inbox',     -- inbox/action/calendar/waiting/reference/archived/...
  modality          TEXT NOT NULL DEFAULT 'text',      -- text/link/image/audio/file/structured

  -- AI 三档授权（D9）
  ai_status         TEXT NOT NULL DEFAULT 'pending',   -- pending/running/done/failed/timeout/disabled
  ai_suggested_at   INTEGER,                            -- AI 建议最近写入时间，NULL = 从未跑过

  -- 隐私 + 多用户预留
  visibility        TEXT NOT NULL DEFAULT 'private',   -- private/dev/shared
  owner_user_id     TEXT,                               -- D7 预留，本期 NULL；v2.2 多用户用

  -- 审计
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER                             -- soft delete；NULL = 未删
);
CREATE INDEX IF NOT EXISTS idx_pim_commitment ON pim_item(commitment_state) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pim_captured_at ON pim_item(captured_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pim_ai_status ON pim_item(ai_status) WHERE deleted_at IS NULL AND ai_status IN ('pending','running');

--------------------------------------------------------------------------------
-- 2. pim_commitment_state_history (commitment_state 历史快照)
--
-- 承认意图漂移（v2.1 §1.2 "信息 × 时刻"）：同一条 pim_item 的 commitment 会随时间变化。
-- 每次 PATCH commitment_state 时 append 一条历史记录。
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pim_commitment_state_history (
  id            TEXT PRIMARY KEY,
  pim_item_id   TEXT NOT NULL REFERENCES pim_item(id) ON DELETE CASCADE,
  old_state     TEXT,                                  -- NULL = 首次 INSERT
  new_state     TEXT NOT NULL,
  changed_at    INTEGER NOT NULL,                      -- epoch ms
  changed_by    TEXT NOT NULL,                         -- 'user' | 'ai' | actor identifier
  reason        TEXT                                   -- 可选注释
);
CREATE INDEX IF NOT EXISTS idx_pim_csh_item ON pim_commitment_state_history(pim_item_id, changed_at DESC);

--------------------------------------------------------------------------------
-- 3. pim_domain_tags (多对多 domain 关联)
--
-- L2 视图层 facet。受控词表 ≤ 7（plan §10 默认：工作/家庭/健康/财务/学习/兴趣/关系）
-- 应用层规范化（不在 schema 强制 enum）。
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pim_domain_tags (
  pim_item_id   TEXT NOT NULL REFERENCES pim_item(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL,                          -- 工作/家庭/健康/财务/学习/兴趣/关系 等
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (pim_item_id, domain)
);
CREATE INDEX IF NOT EXISTS idx_pim_domain_lookup ON pim_domain_tags(domain, pim_item_id);

--------------------------------------------------------------------------------
-- 4. pim_people_refs (多对多人物关联)
--
-- L2 视图层 facet。AI 抽取候选 + 用户确认；person_ref 暂用 TEXT 名字，未来引入 person 表后转 FK。
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pim_people_refs (
  pim_item_id   TEXT NOT NULL REFERENCES pim_item(id) ON DELETE CASCADE,
  person_ref    TEXT NOT NULL,                          -- 人物标识（暂用名字字符串）
  confidence    REAL NOT NULL DEFAULT 1.0,             -- 0.0-1.0；AI 抽取 < 1.0，用户确认 = 1.0
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (pim_item_id, person_ref)
);
CREATE INDEX IF NOT EXISTS idx_pim_people_lookup ON pim_people_refs(person_ref, pim_item_id);

--------------------------------------------------------------------------------
-- 5. pim_intent_snapshot (意图向量快照表)
--
-- L3 时间性 MECE 层。本期建表但**不写入**（Week 4+ 才考虑加 AI 打分）。
-- vector_json 是 6 维向量 JSON：{"unloading":0-1, "scheduling":0-1, ...}
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pim_intent_snapshot (
  id            TEXT PRIMARY KEY,
  pim_item_id   TEXT NOT NULL REFERENCES pim_item(id) ON DELETE CASCADE,
  vector_json   TEXT NOT NULL,                          -- 6 维向量 JSON
  snapshot_at   INTEGER NOT NULL,                       -- epoch ms
  source        TEXT NOT NULL                           -- 'ai_suggest' | 'user_confirm' | 'user_override'
);
CREATE INDEX IF NOT EXISTS idx_pim_intent_item ON pim_intent_snapshot(pim_item_id, snapshot_at DESC);

--------------------------------------------------------------------------------
-- 6. pim_refs (多对多 derived_from 边)
--
-- 加工关系层（不是分类层）。
-- 一条 pim_item 可以由多条 raw item 加工而来（拆分/合并）。
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pim_refs (
  child_id      TEXT NOT NULL REFERENCES pim_item(id) ON DELETE CASCADE,
  parent_id     TEXT NOT NULL REFERENCES pim_item(id) ON DELETE CASCADE,
  rel_kind      TEXT NOT NULL DEFAULT 'derived_from',  -- derived_from / related_to / merged_into / ...
  confidence    REAL NOT NULL DEFAULT 1.0,             -- AI 建议 < 1.0；用户确认 = 1.0
  created_by    TEXT NOT NULL,                          -- 'user' | 'ai'
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (child_id, parent_id, rel_kind)
);
CREATE INDEX IF NOT EXISTS idx_pim_refs_parent ON pim_refs(parent_id);
CREATE INDEX IF NOT EXISTS idx_pim_refs_child ON pim_refs(child_id);

--------------------------------------------------------------------------------
-- 7. pim_audit_summary (每日 sanity 聚合表)
--
-- D6 应用层规范化的兜底：每日聚合 commitment_state typo 检测。
-- 每天日志输出 SELECT commitment_state, count(*) FROM pim_item GROUP BY commitment_state;
-- 写入本表后可历史回看。
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pim_audit_summary (
  date          TEXT NOT NULL,                          -- YYYY-MM-DD
  scope         TEXT NOT NULL,                          -- 'commitment_state' | 'modality' | 'domain'
  value         TEXT NOT NULL,                          -- 实际值（含 typo）
  count         INTEGER NOT NULL,
  whitelisted   INTEGER NOT NULL CHECK (whitelisted IN (0,1)),  -- 1 = 在白名单内，0 = typo 候选
  generated_at  INTEGER NOT NULL,                       -- epoch ms
  PRIMARY KEY (date, scope, value)
);

--------------------------------------------------------------------------------
-- 8. pim_item_fts (FTS5 全文搜索)
--
-- 参考 0001 issue_fts pattern（line 67-81）。
-- Day 1 前置（不留到 Week 3 才发现 FTS 没建）—— cursor-agent Round 1 finding #4。
--------------------------------------------------------------------------------

CREATE VIRTUAL TABLE IF NOT EXISTS pim_item_fts USING fts5(
  content,
  content='pim_item', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS pim_item_fts_ai AFTER INSERT ON pim_item BEGIN
  INSERT INTO pim_item_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS pim_item_fts_ad AFTER DELETE ON pim_item BEGIN
  INSERT INTO pim_item_fts(pim_item_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS pim_item_fts_au AFTER UPDATE ON pim_item BEGIN
  INSERT INTO pim_item_fts(pim_item_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO pim_item_fts(rowid, content) VALUES (new.rowid, new.content);
END;

--------------------------------------------------------------------------------
-- 9. ALTER TABLE issue ADD pim_item_id (derived_from 链接)
--
-- 当 PimItem 被"升级"为 Issue（用户手动标），写 issue.pim_item_id 指向 pim_item。
-- 这是 v2.1 derived_from 边的天然实现 + harness Issue/Stage/Task 流程入口。
-- ON DELETE SET NULL：issue 不应该跟着 pim_item 删除（harness 流程独立生命周期）。
--
-- SQLite ALTER ADD COLUMN 只支持 ADD COLUMN nullable（默认 NULL），符合 ADR-006。
-- 注意：SQLite ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS（< 3.35），但 migration 单次 apply
-- 不会重复（schema_migrations 表记录），无需幂等保护。
--------------------------------------------------------------------------------

ALTER TABLE issue ADD COLUMN pim_item_id TEXT REFERENCES pim_item(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_issue_pim_item ON issue(pim_item_id) WHERE pim_item_id IS NOT NULL;
