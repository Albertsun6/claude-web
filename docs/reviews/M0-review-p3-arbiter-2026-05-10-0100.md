# M0 Phase 3 arbiter verdict — 2026-05-10 01:00

> Phase 3 = debate-review SKILL 仲裁；Phase 2 react skipped（4 reviewer 全部 BLOCKER 一致，无 contested finding）。

## Phase 1 inputs (4 reviewers)

| Reviewer | Verdict | BLOCKER | MAJOR | MINOR | File |
|---|---|---|---|---|---|
| vessel-architect | PASS-WITH-FIXES | 1 | 2 | 4 | [`M0-review-p1-architect`](M0-review-p1-architect-2026-05-10-0100.md) |
| vessel-pragmatist | PASS-WITH-FIXES | 1 | 2 | 2 | [`M0-review-p1-pragmatist`](M0-review-p1-pragmatist-2026-05-10-0100.md) |
| vessel-risk-officer | FAIL | 4 | 5 | 6 | [`M0-review-p1-risk-officer`](M0-review-p1-risk-officer-2026-05-10-0100.md) |
| cursor cross | FAIL | 2 | — | 2 | [`M0-review-cross`](M0-review-cross-2026-05-10-0100.md) |

## 异质性确认

✅ **第 6 次** cursor 与 Claude reviewer 互补 ：
- 4 reviewer **一致**抓 BLOCKER 1（migration 编号冲突 → harness-store glob 误吞）—— 非常强的信号
- risk-officer 独家抓 BLOCKER 3 (4KB throw 而非 spillover) + BLOCKER 4 (file mode 0644 / dir mode 0755)
- 4 reviewer 一致 PASS Focus 4 (orchestrator 边界守住) + PASS Focus 5 (M0 范围 SIGINT 可用)

## 4 档分类矩阵

### ✅ 接受（已 fix in this commit）

| Finding | Source | 修复 | 验证 |
|---|---|---|---|
| **BLOCKER-1**: `0004_m0_sessions.sql` 与 harness-store 共用 `migrations/` 目录 → glob 误吞 → harness.db user_version 推到 200 / ADR-006 §3 编号冲突 | 4/4 unanimous | 移到 `packages/backend/src/migrations-memory/0001_m0_sessions.sql`；session-store.ts MIGRATIONS_DIR 改路径；MEMORY_SCHEMA_VERSION = 1（独立版本序列） | sqlite3 memory.db 只显示 sessions/intents/skill_invocations 三表，无 Eva harness 表污染 |
| **BLOCKER-2**: trace-writer 完全无 redaction，trace-redaction-spec §7 M0 acceptance C-3 必做 | risk-officer + cursor + architect | 新建 `observability/trace-redactor.ts`（path blacklist §3a + content patterns §3b + path whitelist §4 + UUID v4 exempt + payload size check）；trace-writer write() 入口调用 | `redactPayload({user_prompt:"x"})` → `{user_prompt:"***"}`；sk-ant / AWS / email / 私人路径全脱敏；UUID + Vessel 路径明文 |
| **BLOCKER-3**: payload > 4KB throw 而非 §5 artifact_refs spillover | risk-officer | trace-writer 检测 inline limit 违反 → 写 `<span_id>.stdout` (mode 0600) + 200-char redacted summary 留 inline + path 进 artifact_refs | `payloadFitsInline(8KB)` = false；spillover path coded |
| **BLOCKER-4**: `~/.vessel/` mkdir 默认 0755 + memory.db 默认 0644，多用户 mac mini intents.text 可读 | risk-officer | session-store mkdirSync `mode: 0o700` + chmodSync 0o600 on db / wal / shm；trace dir 0700 + file 0600（已 0B 落） | `stat -f '%Lp'` 全为 600/700 |
| **MAJOR-M-R1**: SIGINT 立即 exit 不 propagate SIGTERM 子进程；M0.5 Coding Driver 子进程会孤儿；launchd 用 SIGTERM 但 vessel-core 没注册 | risk-officer | vessel-core.ts 加 SIGTERM handler（与 SIGINT 共用 onShutdown）；exit code 143/130 区分 | `kill -TERM` 也走 graceful close DB；M0.5 接 driver.cancel() 时挂同一 hook |

### ⚠️ 部分接受（defer）

| Finding | Source | Defer | Owner+截止 |
|---|---|---|---|
| **MAJOR-arch-A1**: orchestrator 用 `tools:{get:()=>null}/memory:{} as never/workspaceDir:''` 假手对象 | architect + pragmatist | M0.5 实施 SkillContext 三字段 optional 化 + CodingSkill 落 Tool registry 真值；M0 仅 EchoSkill 不需要 Tool/Memory，假手是合理 stub | M0.5 |
| **MAJOR-pragmatist M-P1**: `Intent = unknown` placeholder 仍在；M0 应该落真类型 | pragmatist | M0 EchoSkill 用 inline `{text:string}` 已足够；@vessel/shared 真 schema export 留给 M1A WS 接入 | M1A |
| **MAJOR-risk M-R2** SIGINT 5s 预算无机制 | risk-officer | M0 echo 跑 < 100ms 用不上预算；M0.5 spawn 子进程时落定时 SIGKILL 兜底（按 ADR-016 cancel 5s grace） | M0.5 |
| **MINOR-arch A2**: `parent_span_id` 在 trace event JSON 序列化保留 vs spec 不要求；trace event 本身字段 OK | architect | 接受现状（OTEL 标准） | — |

### 🚫 反驳

无（4/4 reviewer 的 BLOCKER 全部站得住脚）。

### 🟡 挂起

无。

## Phase 3 行动汇总

- ✅ 修 4 BLOCKER（migration 隔离 / redaction wrapper / 4KB spillover / file mode 0600/0700）
- ✅ 修 1 MAJOR（SIGTERM handler）
- ⚠️ Defer 4 MAJOR/MINOR 到 M0.5 / M1A
- ✅ tsc clean
- ✅ shared 123 tests 仍 pass
- ✅ M0 acceptance 重跑全过：echo / sqlite3 / SIGINT 3ms / mode 0600/0700 / trace-redaction-spec §7 C-1/C-2/C-3

## 评审 calibration

- 4-way unanimous on BLOCKER 1 = 制度性 catch（不是单 reviewer 偶然）；future M-x 都该 priority 检查跨 runner 资源冲突
- risk-officer 抓到 file mode + 4KB spillover 是 cursor + architect 没看到的 detail-lens 价值
- orchestrator 边界 4/4 PASS = M0 范围纪律守住，可放心进 M0.5

## 决策

**M0 验收通过**（PASS）。可以进 Verify Gate → M0.5。
