# M1A-α Verify Gate — 2026-05-10 02:40

> 5 项必做（plan §0-meta-lite + ADR-014）。
> **结果**：✅ **5/5 全过**

## ✅ Gate 1: Finding 闭环

| 类型 | 数量 | 处理 |
|---|---|---|
| BLOCKER | 2 | 全部 fixed |
| MAJOR (合并) | 7 | 3 fixed / 4 deferred-with-owner+date |
| MINOR | 12 | defer |

[Phase 3 arbiter](M1A-alpha-review-p3-arbiter-2026-05-10-0240.md)。

## ✅ Gate 2: 修复落地

| Fix | 路径 | 验证 |
|---|---|---|
| panel auth | vessel-panel.ts: `authHeaders()` + token row + 401 → showAuth | grep `auth-row / authHeaders / setToken` ✓ |
| body/text cap | vessel-intent.ts: MAX_BODY_BYTES=64K / MAX_TEXT_CHARS=32K → 413 | curl 33000 chars → HTTP 413 ✓ |
| concurrency cap | vessel-intent.ts: MAX_CONCURRENT_INTENTS=5 → 429 | code review |
| path leak | vessel-intent.ts: relativizePath() + redactAgentResult / redactTraceEvent | code review |
| 0.0.0.0 + no token = exit | index.ts: HOST !== '127.0.0.1' + !VESSEL_TOKEN → fatal | `BACKEND_HOST=0.0.0.0` no token → FATAL ✓；with token → ok ✓ |
| limit clamp | vessel-intent.ts: Math.max(1, Math.min(100, ...)) | curl ?limit=-1 → 1 row ✓ |

## ✅ Gate 3: 回归测试

```
pnpm --filter @vessel/backend exec tsc --noEmit  # exit 0
pnpm --filter @vessel/shared test                # 123 tests pass
pnpm --filter @vessel/backend test:coding-driver # 13 assertions pass
pnpm --filter @vessel/backend test:vessel-http   # 5 assertions pass (CLI + HTTP concurrent, 0 SQLITE_BUSY)
```

## ✅ Gate 4: 链接完整性 + Doc 一致性

- M1A-slicing-proposal / arbiter / 4 Phase 1 verdicts / Phase 3 arbiter / Verify Gate 全部链路存在
- /api/vessel/* namespace 与 Eva /api/runs / /api/sessions 共存（语义不同，非 deprecation）
- Sub-acceptance 表显式声明 α 仅满足子集，γ 时对齐 plan §M1A 全集

## ✅ Gate 5: 调研引用

M1A-α 是 [accepted M1A-slicing proposal](M1A-slicing-proposal-2026-05-10-0210.md) 的实施段，**非新决策** → 不触发 ADR-015 DAR yes/no checklist。

## 🚫 Escalation triggers

无：
- ❌ 4 软触发（无 decision-required / 无 disagree-with-evidence / Verify Gate pass / closeout 已跑 cursor 异质 review）
- ❌ 4 硬触发：
  - secrets：path leak fix 已落 + trace stdout 子树 force-mask（M0.5 fix 仍生效）
  - license：M1A-α 无新依赖
  - CVE：无
  - 破坏性数据迁移：M1A-α 不动 schema

## 决策

✅ **M1A-α 验收通过**。可进 **M1A-β**（WS multi-conversation parallel）。

## debate-review log entry

```json
{"date":"2026-05-10","planFile":"/Users/yongqian/Desktop/Vessel/docs/reviews/M1A-alpha-*","totalClaims":21,"accepted":5,"partial":7,"rejected":0,"hung":0,"biggestInsight":"第 9 次 cursor + Claude 互补：M1A-α 把 vessel-core 第一次接到网络，pragmatist 看 '守边界' 漂亮 (0 BLOCKER 0 MAJOR) 但 risk-officer 看 'DoS/RCE BLOCKER'。制度性教训：surface 类型变化 (CLI→HTTP / HTTP→远程 / 本地→公网) 必须 pragmatist + risk-officer 双 lens 而非二选一。架构 reviewer 也独家抓到 panel 401 卡死的 dogfood 盲点","biggestMistake":"实施 panel HTML 时考虑了 XSS / SQLi 但漏看 auth flow — fetch 不带 Authorization header；这是 architect 5-lens-1 (Tailscale dogfood 体感) 的盲点；以后任何 cross-process / cross-network surface 切片都要做 'token mode' 集成测试","newPrinciplesAdded":1,"newRisksAdded":0,"reviewerSkippedQuestions":[],"counterChallenges":["pragmatist '立即 ship' vs risk-officer 'BLOCKER' 矛盾经 arbiter 仲裁：surface 类型变化场景 risk-officer lens 优先"],"contract":"M1A-α 4-way closeout (architect + pragmatist + risk-officer + cursor cross)","mechVersion":"v2-lite"}
```
