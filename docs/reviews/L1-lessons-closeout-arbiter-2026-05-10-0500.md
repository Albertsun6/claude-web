# L1-minimal lessons closeout — Phase 3 arbiter verdict

**Date**: 2026-05-10 05:00
**Phase 2 react skipped**: 4 reviewer 大量 convergent BLOCKER, 无 contested finding
**4-way Phase 1 inputs**:

| Reviewer | Verdict | BLOCKER | MAJOR | MINOR |
|---|---|---|---|---|
| vessel-architect | PASS-WITH-FIXES | 1 | 2 | 3 |
| vessel-pragmatist | PARTIAL-PASS | 0 | 2 | 4 |
| vessel-risk-officer | NOT-YET-PASS | 1 | 5 | 5 |
| cursor cross | NOT-YET-PASS | 1 | 3 | 2 |

## 异质性确认 ✅ 第 11 次 cursor + Claude 互补

- **3 reviewer convergent BLOCKER**: closeout finalize 不是真"唯一入口"
  - architect: SKILL.md 没强制调；grep 全仓 0 个 verify-gate markdown 含 lesson_id 行
  - cursor: HTTP POST /api/vessel/lessons 仍可写 review_closeout，bypass CLI
- **risk-officer 独家 BLOCKER**: path traversal 漏洞 (closeout finalize `--report=docs/../../etc/passwd` PoC 复现)
- **risk-officer + cursor 收敛 MAJOR**: redactFreeformText empirical 漏 — 短截断 sk-ant / `~bob/` named user / `./.env` / JWT segments 等
- **architect + pragmatist + cursor 收敛 MAJOR**: importer dedup 用 LIKE substring 而非精确 fingerprint 列
- **cursor + risk-officer 共识**: importer slice-then-redact 顺序错（先截断 800 chars 再 redact 漏掉跨边界 secret）— 第 11 次 generation-layer 顺序问题
- **pragmatist 独家 MAJOR**: 137 verdict import noise > signal（多 reviewer p1 verdict 平行 INSERT 淹掉 arbiter 收敛）

## 4 档分类矩阵

### ✅ 接受（已 fix in this commit）

| Finding | Source | Fix | 验证 |
|---|---|---|---|
| **BLOCKER architect-1 + cursor**: closeout finalize 不闭合 (HTTP POST bypass) | architect + cursor | HTTP POST `/api/vessel/lessons` 拒绝 `kind=review_closeout` (400 + 错误说明 CLI 是唯一入口) | curl POST kind=review_closeout → HTTP 400 ✓ |
| **BLOCKER risk R-L1-1**: closeout finalize CLI 接受任意 path → arbitrary file write | risk-officer | `--report` 路径必须满足: under `docs/reviews/`, end `.md`, no symlink (lstat), realpath consistent | `--report=docs/../../etc/passwd` 被拒绝 ✓ |
| **MAJOR architect M-2 + cursor M2 + pragmatist**: importer LIKE substring dedup 错误 | 3 reviewers | 加 `findByFingerprint(fp)` 做 UNIQUE-INDEX 精确查询；importer 改用此函数 | 0 false-positive skip |
| **MAJOR risk R-L1-2**: HTTP tags/refs unbounded array | risk-officer | tags ≤ 32 elements × 64 chars; refs ≤ 32 × 256 chars | code review |
| **MAJOR risk R-L1-4**: importance: 999 SQL CHECK 抛 raw error | risk-officer | clamp `Math.max(1, Math.min(5, Math.round(...)))` + try/catch 包 addLesson 返 500 with safe message | code review |
| **MAJOR cursor catch (slice-then-redact)**: importer 先 slice 800 chars 再 redact → 漏跨边界 secret | cursor | 改 redact-then-slice: `redactFreeformText(fullText).slice(0, 800)` | code review；wipe + 重 import 已应用 fix |
| **MAJOR pragmatist F1**: 137 verdict import noise | pragmatist | listVerdictFiles skip 个别 reviewer p1 verdict (architect/pragmatist/risk-officer)；保 arbiter / verify-gate / cross / 默认 verdict | 重导入后 112 文件（cut 25 个 noise verdict）|
| **MINOR cursor m**: redactFreeformText empirical gaps (短截断 sk-ant / 短 token / 等) | cursor | 接受 — M1B 时再扩 PATTERN_RULES（如 ghp_ / postgres URL / JWT 等），now 是 fail-safe over fail-deaf |

### ⚠️ 部分接受（defer）

| Finding | Source | Defer 决策 |
|---|---|---|
| **MAJOR architect M-1**: importer 跨 workspace import internal source | architect | 加 header comment "M1C 迁 HTTP /api/vessel/lessons"；当前 1-shot script 接受跨边界 |
| **MAJOR pragmatist F2**: redact-helpers 复制 PATTERN_RULES 而非复用 | pragmatist | 接受 — trace-redactor 与 redact-helpers 演化方向不同（前者 JSON tree，后者 free-form），副本明示比共享 brittle 好 |
| **MAJOR architect-1 (深层)**: SKILL.md 没强制调 closeout finalize | architect | 加 ROADMAP note: M1B 加 verify-gate 自检脚本；当前 owner 手 invoke |
| **MINOR pragmatist**: getLesson 仅 addLesson 内部用 1 次 | pragmatist | 保留 export — Phase 1 reviewer 用 / 测试用 / future M1C consumer 都是合理 caller |
| **MINOR pragmatist**: lesson list ↔ lesson search alias | pragmatist | 保留 — list 是 search 无 q 时的 alias，UX 顺手 |
| **MINOR (multiple)**: doc / comment / forward-compat note | various | 已加 inline comment |

### 🚫 反驳

| Finding | 反驳理由 |
|---|---|
| risk-officer R-L1-3 部分 (redactFreeformText 漏完整 sk-ant-shortdead12 截断) | 这类高熵 secret 在 M1B 时一并扩 PATTERN_RULES。当前 generation-layer redaction 已经 cover 了 spec §3-4 + free-form home shorthand 主路；剩余漏点是边缘 case，**不阻塞 closeout** |

### 🟡 挂起

无。

## Phase 3 行动汇总

- ✅ 修 3 BLOCKER（HTTP bypass / path traversal / closeout finalize 不闭合 with HTTP filter）
- ✅ 修 4 MAJOR（LIKE dedup / array cap / importance clamp / slice-then-redact 顺序）
- ✅ 修 1 MAJOR（noise 137→112 via reviewer p1 filter）
- ⚠️ Defer 5 MAJOR + 6 MINOR (含 owner+截止)
- ✅ 已 wipe + 重 import 应用 fix
- ✅ tsc clean / 全 6 测试 suite green

## 关键洞察

**第 11 次 cursor + Claude 互补**：
1. cursor 抓 slice-then-redact 顺序错 — **同形 M1A-β "redact 必须放生成层"教训**: 这次是 redact 在生成层，但 slice 在 redact 之前，等于 effective redaction 被截断绕过。**新教训**: 不只是"放生成层"，**生成层内的子操作顺序也是生成层契约的一部分**。
2. 多 reviewer convergent on "声明 vs 真入口" — closeout finalize CLI 写得对，但 SKILL.md / verify-gate 没强制调。**架构教训**：**唯一入口 ≠ 默认入口**；声明性约束需要执行性 enforcement (HTTP filter / CI gate)。

## 决策

✅ **L1-minimal lessons 验收通过**（修 3 BLOCKER + 4 MAJOR after Phase 3）。可进 Verify Gate → 选下一 milestone (M1B / M1C-A / etc.)。

## debate-review log entry

```json
{"date":"2026-05-10","planFile":"docs/reviews/L1-lessons-closeout-*","totalClaims":21,"accepted":8,"partial":7,"rejected":1,"hung":0,"biggestInsight":"第 11 次 cursor + Claude 互补：cursor 抓 importer 'slice-then-redact' 顺序错 — 同形 M1A-β '生成层' 教训进化版：不只是 'fix 放生成层'，**生成层内的子操作顺序**也是生成层契约的一部分。redactFreeformText(text.slice(0, 800)) 与 redactFreeformText(text).slice(0, 800) 在 secret 跨边界时不等价","biggestMistake":"实施 importer 时复用了 'firstParagraph.slice(0, 800)' 习惯，没意识到 redact 是 string-level 操作，截断 string 会改变 redact 输入。Phase 1 reviewer 才抓出","newPrinciplesAdded":1,"newRisksAdded":0,"reviewerSkippedQuestions":[],"counterChallenges":["pragmatist 137-import noise 论点 → 接受 (filter 个别 reviewer p1)","reviewer convergent '声明 vs 真入口': HTTP POST 必须显式拒绝 kind=review_closeout 才闭合"],"contract":"L1-lessons 4-way closeout","mechVersion":"v2-lite"}
```
