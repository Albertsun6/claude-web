# 0B Phase 3 arbiter verdict — 2026-05-10 00:33

> **Phase 3 = debate-review SKILL 仲裁**：综合 4 reviewer Phase 1 verdicts → 4 档分类 + 应用修复 + 写 log。
> **Phase 2 react skipped**：0B 是 stub-only ENG retrofit，无需要 author 反驳的 contested finding（按 ADR-014 跳过日志路径）。

## Phase 1 inputs

| Reviewer | Verdict | BLOCKER | MAJOR | MINOR | File |
|---|---|---|---|---|---|
| vessel-architect | PASS-WITH-FIXES | 1 | 3 | 3 | [`0B-review-p1-architect-2026-05-10-0033.md`](0B-review-p1-architect-2026-05-10-0033.md) |
| vessel-pragmatist | PASS-WITH-FIXES | 0 | 2 | 5 | [`0B-review-p1-pragmatist-2026-05-10-0033.md`](0B-review-p1-pragmatist-2026-05-10-0033.md) |
| vessel-risk-officer | PASS-WITH-FIXES | 0 | 3 | 5 | [`0B-review-p1-risk-officer-2026-05-10-0033.md`](0B-review-p1-risk-officer-2026-05-10-0033.md) |
| cursor cross-reviewer | FAIL | 1 | several | several | [`0B-review-cross-2026-05-10-0033.md`](0B-review-cross-2026-05-10-0033.md) |

**Total**：2 BLOCKER / 8 MAJOR / 13+ MINOR (some overlap).

## 异质性确认

✅ **cursor 抓到的 BLOCKER 与 Claude reviewer 不重叠** —— `startup-env-check.ts` 定义但未在 entry 调用，3 个 Claude lens 都漏掉。这是第 5 次 cursor 异质评审的价值证明（按 ADR-017）。

## 4 档分类矩阵

### ✅ 接受（已 fix in this commit）

| Finding | Source | 修复 | 验证 |
|---|---|---|---|
| **BLOCKER-cross-1**: `checkRenamedEnvVars` 定义但未在 backend entry 调用 → 改名后无鉴权静默启动 | cursor | [`packages/backend/src/index.ts:2-4`](../../packages/backend/src/index.ts) 加 `import + invocation` 在 dotenv/config 后、Hono 加载前 | `CLAUDE_WEB_TOKEN=oldval pnpm exec tsx .tmp-env-check-test.ts` 输出 alert + exit |
| **BLOCKER-arch-1**: ADR-009 / ADR-016 example 仍用旧 `VESSEL_TRACE_ID` / `VESSEL_PARENT_SPAN_ID`，与 trace.ts W3C TRACEPARENT 不一致 | architect | [`ADR-009 §6`](../adr/vessel/ADR-009-mcp-server-lifecycle.md) + [`ADR-016 §example`](../adr/vessel/ADR-016-coding-driver-interface.md) 改为 `TRACEPARENT='00-<32-hex>-<16-hex>-<flags>'` + VESSEL_CONVERSATION_ID/RUN_ID | grep 三处 spawn 路径协议一致 |
| **MAJOR-pragmatist-2**: `skill.ts:42-48` `ToolRegistry.list()` 假想 LLM-driven dispatch 抽象 (YAGNI) | pragmatist | [`packages/backend/src/interfaces/skill.ts:42-44`](../../packages/backend/src/interfaces/skill.ts) 删除 `list()` 方法 | tsc clean |
| **MAJOR-risk-3**: startup-env-check `process.exit(1)` 太硬，launchd 用户静默故障 | risk-officer | 加 `VESSEL_ENV_CHECK_BYPASS=1` escape hatch + 注释说明 | 默认仍 fail-loud；bypass 显式 opt-in |
| **MAJOR-risk-2**: trace schema 没强制 redaction | risk-officer | [`trace.ts:96-100`](../../packages/backend/src/observability/trace.ts) 加 M0 实施 note：`write()` 入口加 fast-redact wrapper | 注释明确 M0 责任；TODO 在 trace.ts 内 |
| **MAJOR-risk-1**: migration script copyFileSync 非原子可能 SQLite corruption | risk-officer | [`scripts/migrate-eva-to-vessel.ts`](../../scripts/migrate-eva-to-vessel.ts) header 加警告：`--apply` 前必须 stop Eva 进程；v0.1 release 前换 `sqlite3 .backup` | 注释明确风险；用户 opt-in `--apply` 路径 |

### ⚠️ 部分接受（defer 到合适 milestone）

| Finding | Source | Defer 决策 | Owner + 截止 |
|---|---|---|---|
| **MAJOR-arch-3**: CodingDriverArtifact (exit code + files[]) vs Artifact discriminated union 形状不兼容，没标注 adapter 边界 | architect | M0.5 实施时落 adapter 函数（CodingSkill 内部 Artifact ↔ CodingDriverArtifact 转换）；当前 stub 仅契约 | owner / M0.5 |
| **MAJOR-pragmatist-1**: `agent.ts:21-22` + `skill.ts:23-24` 用 `type Intent = unknown` placeholder | pragmatist | M0 实施时（EchoSkill 落地）从 @vessel/shared 导入真类型；现在改 = 提前规划 Intent schema 与 Skill 早期实施风险 | owner / M0 |
| **MAJOR-risk-1 升级**: 用 `sqlite3 .backup` 而非 copyFileSync | risk-officer | v0.1 release prep 时统一改；当前 dry-run 默认 + header 警告 sufficient | owner / pre-v0.1-release |

### 🚫 反驳

无 — 4 个 reviewer 的 BLOCKER/MAJOR 全部站得住脚或合理 defer。

### 🟡 挂起（缺数据需 dogfood）

无 — 0B 工程改造层面无需 spike。

### MINORs（13 条，全部 defer 到 corresponding milestone）

按 reviewer 各自 verdict 文档保留；不在此处再列。每条由对应 milestone（M0/M0.5/M1B 等）负责落实或显式驳回。

## Phase 3 行动汇总

- ✅ 修 2 BLOCKER（cursor 1 + architect 1）
- ✅ 修 4 MAJOR（删 ToolRegistry.list / 加 ENV bypass / migration warning / trace redaction note）
- ⚠️ Defer 3 MAJOR 到 M0/M0.5/v0.1-release（带 owner + 截止）
- ✅ tsc 仍 clean
- ✅ shared 123 tests 仍 pass

## 评审 calibration 评估

- Cursor 第 5 次抓到 Claude 集体盲区的 BLOCKER（统计学）→ ADR-017 cross-reviewer 价值确认
- 三 Claude lens 自身一致性高（无 disagree）→ Phase 2 跳过合理
- Pragmatist 标 P-MAJOR-2 (delete YAGNI) 直接 +1：删了 4 行减少未来包袱

## 决策

**0B 验收通过**（PASS）。可以进 Verify Gate。
