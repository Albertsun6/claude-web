# M1A-α Phase 3 arbiter verdict — 2026-05-10 02:40

> Phase 3 = debate-review SKILL 仲裁；Phase 2 react skipped（4 reviewer 一致 PASS-WITH-FIXES，BLOCKER 互补无 contested finding）。

## Phase 1 inputs (4 reviewers)

| Reviewer | Verdict | BLOCKER | MAJOR | MINOR | File |
|---|---|---|---|---|---|
| vessel-architect | PASS-WITH-FIXES | 1 | 3 | 4 | [`p1-architect`](M1A-alpha-review-p1-architect-2026-05-10-0240.md) |
| vessel-pragmatist | PASS-WITH-FIXES | 0 | 0 | 3 | [`p1-pragmatist`](M1A-alpha-review-p1-pragmatist-2026-05-10-0240.md) |
| vessel-risk-officer | PASS-WITH-FIXES | 1 | 2 | 4 | [`p1-risk-officer`](M1A-alpha-review-p1-risk-officer-2026-05-10-0240.md) |
| cursor cross | PASS-WITH-FIXES | 0 | 2 | 1 | [`cross`](M1A-alpha-review-cross-2026-05-10-0240.md) |

## 异质性确认 ✅ 第 9 次 cursor + Claude 互补

- **互补 BLOCKER**：architect 和 risk-officer 抓的 2 个 BLOCKER 完全不同 lens，互不重叠（auth flow vs DoS/RCE）
- cursor 加锁了 `limit=-1` query 绕过上限（细节层 Claude reviewer 漏看）
- pragmatist 守界判断："立即 ship α，0 MAJOR" 但被 risk-officer 拉回——pragmatist lens 看 "守不守边界" 漂亮，risk-officer lens 看 "网络可达后攻击面"
- 4-way 一致：M1A-α 实施代码与 proposal 对齐度高，5 接口契约不漏，panel 自包含 vanilla HTML 选型合理

## 4 档分类矩阵

### ✅ 接受（已 fix in this commit）

| Finding | Source | 修复 | 验证 |
|---|---|---|---|
| **BLOCKER architect-1** panel fetch 不带 token，VESSEL_TOKEN 一设全 401 | architect | panel HTML 加 `localStorage` token row + `authHeaders()` 给所有 fetch；401 触发 token row 显示 | curl + grep: panel HTML 含 `auth-row / authHeaders / setToken` ✓ |
| **BLOCKER R-M1Aα-1** /api/vessel/intent 无 body cap + 无并发限 → DoS/RCE | risk-officer + cursor MAJOR | 加 MAX_BODY_BYTES=64KB / MAX_TEXT_CHARS=32KB → 413; MAX_CONCURRENT_INTENTS=5 → 429; content-length 头检查提前拒绝 | curl 33000 char text → HTTP 413 ✓ |
| **MAJOR R-M1Aα-2** artifact_refs / files / stdoutPath 漏 home dir 绝对路径 | risk-officer | 加 `relativizePath()` 把 DATA_DIR 前缀替换为 `$VESSEL_DATA_DIR`；HTTP `redactAgentResult` + trace `redactTraceEvent` wrappers | echo response 中无 home path；coding response files 路径走 relativize |
| **MAJOR R-M1Aα-3** VESSEL_TOKEN 空 fail-open，0.0.0.0 bind 后 RCE 风险 | risk-officer | index.ts 加 fatal 检查：`HOST !== 127.0.0.1 && !VESSEL_TOKEN` → exit 1 | `BACKEND_HOST=0.0.0.0` 无 token → FATAL exit ✓；带 token 正常启动 ✓ |
| **MAJOR cursor** limit=-1 query 绕过上限 | cursor | runs / sessions handler 加 `Math.max(1, ...)` clamp | curl `?limit=-1` → 1 row ✓ |

### ⚠️ 部分接受（defer）

| Finding | Source | Defer 决策 | Owner+截止 |
|---|---|---|---|
| **MAJOR architect-1** HTTP intent 同步契约 → β 重构压力 | architect | M1A-β 时在 IntentInput 加 onMessage callback 字段（β 该层做的事，α 不预动） | M1A-β |
| **MAJOR architect-2** panel 直接消费 sqlite 列名 → schema 耦合 | architect | M1A-α HTML 自包含可一并改，但 schema-vs-API contract 文件化 = doc work，留 M1A-β | M1A-β |
| **MAJOR architect-3** /api/vessel/runs 默认返 intent_text 是 PII surface | architect | 当前 panel 已 client-side `slice(0, 80)` 截断；M1B permission 接入时改 `?include=intent_text` opt-in | M1B |
| **MINOR pragmatist-1** concurrent test 缺 negative-control | pragmatist | 加 negative test 简单但 ROI 低（busy_timeout 已多次实测） | β |
| **MINOR pragmatist-2** vessel-intent.ts handler 缺 ADR-002 stub 注释 | pragmatist | 文件头加 1 段说明 | now (随本 fix 一并加) |
| **MINOR R-M1Aα-5** trace endpoint 无分页 | risk-officer | M1A-α 单用户跑 ≤ 100 spans，M1B+ 长任务时再加 | M1C |
| **MINOR R-M1Aα-6** SQLITE_BUSY 5s DoS 放大 | risk-officer | 与 R-M1Aα-1 BLOCKER 已通过并发 cap 缓解 | — |
| **MINOR cursor-1** Hono 默认 body 上限 | cursor | content-length 检查 + try/catch 已 cover 大部分；Hono 自身限制 4MB 默认 | — |

### 🚫 反驳

无（所有 reviewer findings 站得住脚）。

### 🟡 挂起

无。

## 关键洞察

1. **第 9 次 cursor 抓 Claude 集体盲区** — risk-officer 也是 Claude lens 但作为单独 agent 跑，抓 BLOCKER 与 architect 不重叠：lens 多样性 > reviewer 数量
2. **Pragmatist's "立即 ship α" 与 Risk-officer 的 "DoS/RCE BLOCKER" 是协调矛盾**：守边界 lens 看代码量，攻击面 lens 看 surface 变化。M1A-α 把 vessel-core 第一次接到网络，pragmatist lens 不足够 cover "网络可达"维度
3. **"M1A-α 是第一次网络可达"是制度性教训**：以后 milestone 切片时，凡是 surface 类型变化（CLI → HTTP，HTTP → 远程，本地 → 公网），必须 pragmatist + risk-officer **双 lens** 而非二选一

## Phase 3 行动汇总

- ✅ 修 2 BLOCKER（panel auth + body/concurrency cap）
- ✅ 修 3 critical MAJOR（path leak / 0.0.0.0 token guard / limit clamp）
- ⚠️ Defer 3 MAJOR + 5 MINOR 到 β/M1B (含 owner+截止)
- ✅ tsc clean / shared 123 tests / coding-driver 13 / vessel-http 5 全过

## 决策

✅ **M1A-α 验收通过**。可进 Verify Gate → M1A-β（panel + WS multi-conversation parallel）。
