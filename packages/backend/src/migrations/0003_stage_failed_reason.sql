-- TARGET_VERSION = 102
--
-- M2 Loop 1: stage 表加 failed_reason / failed_at 字段（additive nullable only）。
--
-- Why: M2 #1 "任务流水线稳定" 第一步 — 让失败可诊断（cursor-agent F review M2/MD1 finding：
-- 当前 stage 失败原因仅 console.log，无法从持久化 state 区分 orphan / spawn fail / harvest
-- fail / CLI fail。本圈先加列，写入路径留 Loop 2）。
--
-- Migration mode: **default**（NOT schema-rebuild）。
-- 原因：本 migration 仅 ALTER TABLE ADD COLUMN，列定义为 nullable + 无 DEFAULT + 无 CHECK
-- + 无 FK + 无 index。SQLite 对这种最薄 ADD COLUMN 是 O(1) catalog-only 操作，不重写既有
-- 行、不触发 schema-level FK 检查。区别于 v0.4.4 的 0002_stage_status_dispatched.sql
-- （改 CHECK enum 必须 rebuild 表）。
--
-- 引用 plan v2: docs/proposals/M2-master-plan.md §3 #1.1 + §5 Loop 1 解冻清单 + §4 Loop 1
-- anchor gate。cross-review verdict: docs/reviews/m2-master-plan-v2-cross-2026-05-05-2255.md
-- M1 (additive only 收紧) + M3 (prod-shape fixture 收紧到 v101 父子 FK + index)。
--
-- 兼容性：
--   - 老 backend (v0.4.5) 读 v102 schema：SELECT 不查这两列即正常工作
--   - 老 iOS / Web Codable / Zod：默认 ignore unknown keys（前提：上游不加 .strict()）—
--     Loop 1 测试加 old-schema parse fixture lock 这个不变量
--   - HARNESS_PROTOCOL_VERSION 暂不 bump（保持 1.1）；MIN_CLIENT_VERSION 保持 1.0

ALTER TABLE stage ADD COLUMN failed_reason TEXT;
ALTER TABLE stage ADD COLUMN failed_at INTEGER;
