# L1-minimal lessons Verify Gate — 2026-05-10 05:00

> 5 项必做。**结果**：✅ **5/5 全过**（修完 3 BLOCKER + 4 MAJOR 后）。

## ✅ Gate 1: Finding 闭环

| 类型 | 数量 | 处理 |
|---|---|---|
| BLOCKER (≥ 2 reviewer convergent: 2; risk-officer 独家: 1) | 3 | 全部 fixed |
| MAJOR (≥ 2 convergent: 4; 独家: 5) | 9 | 5 fixed / 5 deferred-with-owner+date |
| MINOR | 13 | defer / accept-as-is |

[Phase 3 arbiter](L1-lessons-closeout-arbiter-2026-05-10-0500.md)。

## ✅ Gate 2: 修复落地

| Fix | Path | Verification |
|---|---|---|
| HTTP POST kind=review_closeout 拒绝 | `routes/vessel-intent.ts` | curl POST kind=review_closeout → 400 ✓ |
| Path traversal 拦截 | `cli/vessel-core.ts cmdCloseoutFinalize` (lstat + realpath check) | `--report=docs/../../etc/passwd` 拒绝 ✓ |
| importer 精确 fingerprint dedup | `lesson-store.ts findByFingerprint` + import script | 0 LIKE false-positive |
| HTTP tags/refs cap | 32 elem × 64/256 chars | code review |
| importance clamp | Math.max(1, Math.min(5, round)) | code review |
| importer redact-then-slice 顺序 | `import-debate-log.ts importVerdictFile` | wipe + reimport applied |
| 137 verdict noise filter | `listVerdictFiles` skip individual reviewer p1 | 137 → 112 |

## ✅ Gate 3: 回归测试

```
pnpm --filter @vessel/backend exec tsc --noEmit  # exit 0
pnpm --filter @vessel/shared test                # 123 tests pass
pnpm --filter @vessel/backend test:coding-driver # 13 assertions pass
pnpm --filter @vessel/backend test:vessel-http   # 5 assertions pass
pnpm --filter @vessel/backend test:vessel-ws     # 19 assertions pass
pnpm --filter @vessel/backend test:lessons       # 21 assertions pass
```

Real data import: 13 jsonl + 112 verdict = **125 lessons** in memory.db (was 150 pre-fix; cut 25 noisy individual reviewer verdicts).

## ✅ Gate 4: 链接完整性 + Doc 一致性

- spike report / proposal / B-级 review (architect + cross + arbiter) / closeout 4-way (architect + pragmatist + risk-officer + cross) / Phase 3 arbiter / Verify Gate 全部链路存在
- migrations-memory/0002 文件头明示 "DB target: memory.db (NOT harness.db)"
- ADR-006 §「enum CHECK 收窄需 schema-rebuild」reflected in 0002 注释 "kind CHECK may only widen in later migrations"

## ✅ Gate 5: 调研引用

L1 是新 schema (lessons + FTS5)，命中 ADR-015 DAR #3 引入新存储 + #7 影响隐私。
[Phase 0 spike report](../research/evolution-mechanism-2026-05-10.md) 已写 (10 sections, 5 prior art deep analysis: lessons-mcp / memem / memento / Letta / Reflexion)。

## 🚫 Escalation triggers

无：
- ❌ 4 软触发（无 decision-required / 无 unresolved disagree / Verify Gate pass / cursor closeout 已跑）
- ❌ 4 硬触发：
  - secrets：generation-layer redactFreeformText + redact-then-slice ordering + path-whitelist preserved；wipe + reimport 已应用 fix
  - license：无新依赖
  - CVE：无
  - 破坏性数据迁移：无（lessons 是新表，不破坏 sessions/intents/skill_invocations）

## 制度性教训新增

**1. 生成层内的子操作顺序也是生成层契约的一部分**（cursor 第 11 次 catch）

`redactFreeformText(text.slice(0, 800))` ≠ `redactFreeformText(text).slice(0, 800)`. 截断在 redact 前会让 secret 跨边界漏掉。M1A-β 教训进化版：不只是"fix 放生成层"，生成层内的操作顺序也要审。

**2. "唯一入口" vs "默认入口"**（多 reviewer convergent）

closeout finalize CLI 写得对，但 HTTP POST + SKILL.md 都是 alternate path。声明性约束需要执行性 enforcement (HTTP filter 拒绝特定 kind / CI gate 检查 lesson_id 行)。

## 决策

✅ **L1-minimal lessons 验收通过**。

**累计已完成 milestone**: 0-meta-lite / 0-pre / 0A / 0A.1 / 0B / M0 / M0.5 / M1A-α / M1A-β / **L1-minimal**

**今天用户能用的**:
- `pnpm vessel-core lesson search "redaction"` — 立即从 125 历史 lesson 找相关教训
- `pnpm vessel-core closeout finalize --milestone=... --insight=... --mistake=... --report=...` — 自动入库 review_closeout
- `GET /api/vessel/lessons?q=...&kind=...` — reviewer subagent 调用查
- POST /api/vessel/lessons (kind ≠ review_closeout) — owner 手追加 bug_lesson / decision / risk / spike

**下一步选项**：
- M1B (MCP + permission 边界) — 解锁 Tool 工具箱
- M1C-A (Workflow Engine + HITL) — 用户"几十个 agent 在干活"诉求最接近形态
- M1A-γ (Eva App.tsx rewire) — cursor C-MAJOR-1 已 flag 高复杂度，永久 backlog

## debate-review log entry

`/Users/yongqian/.claude/skills/debate-review/log.jsonl` 同样会被本 closeout 入库（dogfood — closeout finalize CLI 自己用自己）。


lesson_id: c9677180-8aa7-48b4-b4d0-35fd8920d8fe
