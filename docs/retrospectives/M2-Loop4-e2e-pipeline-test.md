# M2 Loop 4 — e2e reproducible pipeline test

**Date**: 2026-05-06
**Phase**: M2 Loop 4（fourth loop under M2 master plan v2 loop-by-loop approval）
**Risk addressed this loop**: "scheduler 完整流水线（issue → strategy → harvest spec → implement → done）没有可重复跑的端到端测试 — dogfood 一次成功不证明可重复"
**Exit**: **ship**
**Related PRs**:
- v0.5.0 release (#33) — Loop 1+2+3 在 prod
- #29 M2 master plan v2（OQ-D 明确不调真 Claude CLI；§7 Loop 4 候选 = MD3）
**Related artifacts**:
- `packages/backend/src/scheduler.ts` — 加 `RunSessionFn` type + constructor 第 3 参（默认真）
- `packages/backend/src/test-e2e-pipeline.ts` (new) — 27 项断言 e2e
- `docs/reviews/m2-loop4-e2e-pipeline-cross-2026-05-06-0032.md`

---

## 一句话本圈风险

证明 scheduler 状态机能反复跑通完整流水线（issue → strategy → harvest spec → implement → done），不调真 Claude CLI，不烧 token，不污染 prod 数据。

## 6 步循环执行

### 1. 风险陈述

v0.5.0 ship 后 Loop 1+2+3 都在 prod，但**完整流水线只跑过 1 次 dogfood**。无机器证据证明：
- (a) 可重复（多次跑结果一致）
- (b) 状态机精确（精确 broadcast 序列）
- (c) 与 Loop 1+2 的失败诊断链路集成（happy path 应 0 failed_reason）

### 2. 最小可运行切片

**Scheduler 注入接缝**：EvaScheduler constructor 加 optional `runSessionFn?: RunSessionFn`，默认 = 真 `runSession`（来自 cli-runner.ts）。生产路径 `new EvaScheduler(db, broadcast)` 完全不变。

**E2E test**：
- mkdtemp 隔离 DATA_DIR + DB + project cwd
- mock runSessionFn 通过 closure 反查 stage.kind：
  - strategy → 写 `<cwd>/docs/specs/<issueId>.md`（让真 harvestSpecArtifact 跑 fs read + createArtifact）
  - implement → noop
  - 触发 onMessage(system init) + onMessage(result) 模拟 stream
- tick → 等 stage_done broadcast → assert
- 跑 2 次完整 e2e 验证 reproducibility（结构等价，非 byte 等价）

### 3. 机器验证

- **`pnpm --filter @claude-web/shared test`** → 123/123
- **`pnpm --filter @claude-web/backend test:harness-schema`** → Phase 1+2+3+4+5+6+7 全绿
- **`pnpm --filter @claude-web/backend test:e2e-pipeline`** (new) → **27 项断言全绿**：
  - Run 1: 5 业务结果（issue/strategy/implement status, spec count, failed_reason count）+ 6 broadcast counts（含 stage_message 4，cross M3 应用）
  - Run 2 reproducibility: 5 业务等价 + 1 双向 broadcast key set 等价 + 6 individual count 等价（cross m1 应用）
  - audit 行为：3 项 distribution 断言（create ≥4, set_status ≥10, set_failed=0；cross M1 应用）
  - audit 路径隔离：写到 dataDirRoot tmp，**未**写到 ~/.claude-web（cross B1 应用）
- **`pnpm -r exec tsc --noEmit`** → clean

### 4. 真实 dogfood

跑两次 `runOnePipeline`，每次 mkdtemp 全新 DB + cwd + DATA_DIR：
- ✅ tick 1: strategy stage created → mock runSession 写 spec.md → harvestSpecArtifact 真读 fs + createArtifact → stage approved + stage_done broadcast
- ✅ tick 2: implement stage created → mock runSession resolve → stage approved + stage_done
- ✅ tick 3: no eligible stage → issue 标 done
- ✅ broadcast 计数完全相同（reproducibility 证）
- ✅ 0 failed_reason 行（happy path）
- ✅ audit log 14 creates + 12 set_status + 6 update_status，全在隔离 DATA_DIR 内

### 5. cross-review

`docs/reviews/m2-loop4-e2e-pipeline-cross-2026-05-06-0032.md` — cursor-agent gpt-5.5-medium：

- **1 BLOCKER + 3 MAJOR + 2 MINOR**，overall 3.8/5（有 blocker 上限 3.9）→ **应用全部 6 项后实际质量回到 4.5+**
- **关键 BLOCKER**：B1 — e2e test 用 mkdtemp DB / cwd 但 audit 仍写到真 `~/.claude-web/harness-audit.jsonl`（DATA_DIR 模块级 const 在 ESM static import 时已解析）。**违反 fixture-only charter**。
- **修法**：
  - 顶部用 `import type` 仅导入类型（编译期擦除）
  - 设 `process.env.CLAUDE_WEB_DATA_DIR = mkdtemp(...)` 在任何 dynamic import 之前
  - 业务模块用 `await import("./harness-store.js")` 等 dynamic import 加载，DATA_DIR 解析为 dataDirRoot

- **finding 处理**：
  - B1 (audit pollution to prod) ✅ 应用：dynamic import + env 设置 + tmp DATA_DIR
  - M1 (audit 行为未断言) ✅ 应用：3 项 audit distribution 断言
  - M2 (cleanup 不在 finally) ✅ 应用：try/finally 包装 runOnePipeline + 顶层 try/finally for dataDirRoot
  - M3 (stage_message 未断言) ✅ 应用：assert stage_message === 4
  - m1 (reproducibility 单向比较) ✅ 应用：双向 set 等价
  - m2 (structural vs byte) ✅ 应用：注释 explicit 说明

- **历史污染处理**：v1 e2e test（修 B1 之前）写了 12 条 fixture 行到真 prod `~/.claude-web/harness-audit.jsonl`。已 backup + 删除污染行（保留 prod 真活动）。**详见 §incidents 段**。

### 6. retrospective + ship/drop/defer

**Exit**: **ship**

## Incidents (cross-review 抓出的真问题)

### v1 e2e test 污染 prod audit log

**Date**: 2026-05-06 ~16:50 UTC
**Trigger**: e2e test v1（修 B1 之前）跑 → DATA_DIR 默认指向 `~/.claude-web` → audit() 函数 fire-and-forget appendFile 到 `~/.claude-web/harness-audit.jsonl` → 12 条 fixture 行（issue-run1 / proj-run1 / m-run1 等）落地 prod
**Detection**: cross-review B1 finding 显式抓出
**Fix**: e2e test v2 用 dynamic import + 提前设 `CLAUDE_WEB_DATA_DIR`，audit 写入 tmp dataDirRoot
**Cleanup**: backup 真 audit log 到 `~/.claude-web/harness-audit.jsonl.bak-pre-loop4-cleanup`，grep -v 删 12 行污染（保留 431 行真 prod 活动）
**Lesson**: 模块级 const 解析时机比想像的早；任何依赖 env 的 const 必须在 import 之前设置；test 默认有 prod 数据访问能力（除非显式隔离）

## M2 #1 Pipeline Stability Coverage After Loop 4

cursor-agent 评估：**~52-56%**（应用 cross-review 修复后；Loop 3 的 ~40-45% 起）。

| MUST-do | 状态 |
|---|---|
| MD1 持久化失败原因 | ✅ Loop 1+2 |
| MD2 minimal skip | ✅ Loop 3（MD2 完整 retry policy 仍 hold）|
| **MD3 e2e reproducible pipeline test** | ✅ **Loop 4** |
| MD7 stage cancellation | ❌ Loop 5+ 候选 |
| MD8 explicit boot ordering | ❌ refactor follow-up |

**可诚实 claim**：scheduler happy path 在 mock runtime 下可重复跑通；状态机 + audit + reproducibility 都有机器证据
**不能 claim**：失败路径 e2e（spawn_setup_failed / cli_failed / spec_harvest_failed）；真 Claude CLI 流程；cancellation；retry policy

## 学到的（Trans-context lessons）

### Lesson A — DATA_DIR 隔离不是默认的

模块级 const 在 ESM import graph evaluation 时解析；`process.env` 在 import 阶段已读取。任何 test 想隔离 DATA_DIR 必须：
1. 用 type-only imports 静态加载类型（编译期擦除）
2. 在 dynamic import 业务模块之前设 env
3. 业务模块用 `await import(...)` 加载

**记入 reviewer-cross/LEARNINGS.md（待补）**：测试基础设施安全审查必须问"模块级 const 在哪一刻解析？env 必须在那之前设置吗？"

### Lesson B — Reproducibility 测试要双向比较

cross m1 finding：原版只检查 r1 keys 在 r2 中匹配，不检查 r2 是否多 keys。一个新事件 silent regression 可漏过。修：用 set 等价检查（双向）。

### Lesson C — 测试基础设施扩展也是螺旋

EvaScheduler constructor 加 optional `runSessionFn` 是为 e2e test 而做的 production-code 改动。看似仅 test infra，实际改了构造签名。这种 cross-cutting 改动**也**该走完整 §0.5 6 步（cross-review + dogfood）—— Loop 4 走完了，证明这个原则跨 Loop 一致。

## Follow-up（不阻塞 Loop 4 ship）

- **失败路径 e2e**：mock runSessionFn 让 strategy throw → 验证 setStageFailed('cli_failed') 真落库 + stage_failed broadcast。这能把 Loop 2 写入路径的覆盖从单元测试升级到 e2e。建议 Loop 5 候选
- **Audit consumer**：当前 audit 是 fire-and-forget appendFile。如果未来 dashboard 真消费 audit，需要 transactional audit infrastructure（Loop 2 cross m4 already noted）
- **LEARNINGS.md 更新**：Lesson A / B / C 写进 `.claude/skills/reviewer-cross/LEARNINGS.md`
- **Loop 5 选题**：候选已在 plan v2 §3 #1 全景图。retrospective 后用户拍板 Loop 5 优先级（推荐：失败路径 e2e + MD8 explicit boot ordering，两者都纯螺旋）
