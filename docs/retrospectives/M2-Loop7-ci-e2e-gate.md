# M2 Loop 7 — CI gate for backend regression + e2e tests (含 7a hot-fix: chokidar leak)

**Date**: 2026-05-06
**Phase**: M2 Loop 7（seventh loop under M2 master plan v2 loop-by-loop approval；含 Loop 7a hot-fix）
**Risk addressed this loop**: "v0.6.0 ship 后 Loop 4-6 加的 backend regression + e2e tests 只在 reviewer 手动跑时执行；PR check 只跑单元 + tsc + frontend build。回归风险靠 reviewer 记得跑 = 不可靠 gate。"
**Exit**: **ship**
**Related PRs**:
- #39 Loop 7 (base) + Loop 7a (hot-fix)
**Related artifacts**:
- `.github/workflows/ci.yml` — 5 个新 backend test steps
- `packages/backend/package.json` — `test:harness-ci` aggregator
- `packages/backend/src/harness-config.ts` — pure module load + start/close API
- 5 test files — defensive close + Phase 8 mechanical lock + smoke
- `docs/reviews/m2-loop7-... (no separate file — review captured inline in retrospective)`

---

## 一句话本圈风险

把 Loop 4-6 加的 backend regression + e2e tests 接入 GitHub Actions PR gate，让回归保护从"reviewer 手动记得跑"升级到自动 CI 强制。

## 6 步循环执行

### 1. 风险陈述

v0.6.0 之后每个 PR 仍只跑：
- protocol fixture tests
- frontend TS build
- protocol sync check

**未跑**：harness schema (Phase 1-7) / scheduler-cleanup / scheduler-failed-reasons / e2e-pipeline / e2e-failures。M2 #1 的所有 e2e 投资靠 reviewer 自觉，回归风险高。

### 2. 最小可运行切片

Loop 7 base（PR #39 第一个 commit）：
- `.github/workflows/ci.yml` 加 5 个独立 step（每 test 一个，GHA UI 易看哪个 fail）
- `packages/backend/package.json` 加 `test:harness-ci` aggregator script

CI yaml 看似简单 21 行 + script 1 行。**但实际 ship 不出去**——CI 跑了 6 小时超时。

### 3. 机器验证（Loop 7a 揭示的真问题）

**第一次跑 CI** → step 1 (harness-schema) ✓ pass，step 2 (scheduler-cleanup) **6 小时未完成**直到 GHA timeout。

Explore agent 抓出根因：

`packages/backend/src/harness-config.ts:29` 在 module load 时**同步执行**：
```typescript
chokidar.watch(_configPath, { ignoreInitial: true }).on("change", () => { ... });
```

watcher reference 没保存，没有 `close()` 路径。chokidar 启动后开 fs.watch handle 让 Node event loop 永不退出。

| Test | 是否 import scheduler.ts | 是否触发 harness-config.ts module load | 是否启 chokidar | 行为 |
|---|---|---|---|---|
| test-harness-schema.ts | ❌ | ❌ | ❌ | exit clean |
| test-scheduler-orphan-cleanup.ts | ✅ | ✅ | ✅ | hang 6h |
| 其他 3 e2e | ✅ | ✅ | ✅ | hang 6h |

**本地 macOS 也 hang**——但之前我用 `pkill -9 -f tsx` 误以为是测试慢，实际是测试逻辑早完成、process 不退出。pkill 干扰让根因隐藏 7 个 Loop（Loop 4-6 都靠 pkill workaround）。

### 4. 真实 dogfood（Loop 7a hot-fix）

按 plan v2 + cross-review verdict (0 BLOCKER + 3 MAJOR + 2 MINOR, approve with edits):

**修法**（Option 1 — explicit lifecycle）：
- `harness-config.ts`：`startConfigWatcher()` / `closeConfigWatcher()` 函数对；module 顶层不再创建 watcher
- `index.ts`：boot 序列调 `startConfigWatcher()`（production 行为完全不变）
- 4 个 test 文件 outer finally 加 `await closeConfigWatcher()` (defensive — no-op if not started)
- `test-harness-schema.ts` Phase 8：
  - **mechanical lock**：静态扫 `harness-config.ts` 非注释文本，assert `chokidar.watch(` 仅在 `startConfigWatcher()` 函数体内（用 brace counting 确认）
  - **lifecycle smoke**：start + double-start + close + double-close 都 idempotent + non-throwing

**file-change → emit contract test 弃用**：FSEvents/inotify 时序 flaky，setTimeout 1500ms 仍漏检。Mechanical lock 是真 charter 保护，不依赖时序。

**本地验证**（Loop 4 LEARNINGS.md #6 模式 + 无 pkill 干扰）：
| Test | exit | 时间 |
|---|---|---|
| test-harness-schema.ts | ✓ 0 | 0s |
| test-scheduler-orphan-cleanup.ts | ✓ 0 | 1s |
| test-scheduler-failed-reasons.ts | ✓ 0 | 0s |
| test-e2e-pipeline.ts | ✓ 0 | 1s |
| test-e2e-pipeline-failures.ts | ✓ 0 | 0s |

之前 hang 6 小时；现在 0-1 秒 exit。**根因解决**。

### 5. cross-review

**Plan-level cross-review**（cursor-agent gpt-5.5-medium）：0 BLOCKER + 3 MAJOR + 2 MINOR，approve with edits。完整 verdict 见 `/tmp/loop7-hotfix-plan-review.md`（临时文件）。

3 MAJOR 全应用：
- M1 chokidar 版本声明错（v3 vs ^5.0.0 实际）— plan 修正
- M2 prod live-reload 静默退化风险 — 通过 explicit boot call 显式化（不再依赖 module load 隐式）
- M3 plan 没防止 future 重新引入 module-level watcher — Phase 8 mechanical lock 应用

2 MINOR 全应用：
- m1 test-harness-schema.ts 加 finally cleanup 是 scope creep — 改加 mechanical lock + smoke
- m2 cross-loop 规则不应把 process.exit(0) 当等价 — rewrite 聚焦 resource ownership

### 6. retrospective + ship/drop/defer

**Exit**: **ship**

**CI 实测**（commit `7fccae6` push 后）：
```
✓ test in 30s (ID 74665093024)
  ✓ Backend harness schema test
  ✓ Backend scheduler orphan cleanup test
  ✓ Backend scheduler failed reasons test
  ✓ Backend e2e happy-path test
  ✓ Backend e2e failure-path test
  ✓ Protocol sync check
```

5 个新 backend test step 全绿，**30s 完成**（之前 6h timeout）。Loop 7 真正落地。

## M2 #1 Coverage 影响

cursor-agent 之前评估 Loop 6 后 ~62-65%。Loop 7 不算 MD8 进度推进（MD8 已在 Loop 6 完成），但**让所有已有 MUST-do 的回归保护从"自觉"升级到"自动"**。这是 cumulative coverage 的可信度提升，不是新 MUST-do 完成。

| MUST-do | 状态（Loop 7 后）|
|---|---|
| MD1 持久化失败原因 | ✅ + CI gate |
| MD2 minimal skip | ✅ + CI gate |
| MD3 e2e reproducible test | ✅ + CI gate |
| MD8 explicit boot ordering | ✅ + CI gate |
| MD7 stage cancellation | ❌ |
| MD2 完整 retry policy | ❌ |

剩 2 项核心都骨架层，需要单独 anchor gate。

## 学到的（Trans-context lessons）

### Lesson A — 资源拥有权规则（cross m2 收紧版本）

任何 module 在 import-time 创建长寿资源（fs.watch / chokidar / setInterval / setTimeout 持续 / open server / open WebSocket / EventEmitter with listeners that hold refs）**必须**：

1. 不在 module 顶层立即启动；提供 `startXxx()` / `closeXxx()` 显式函数对
2. close 函数 await 释放（Promise-returning if needed）
3. test 启用了任何这种资源的 fixture 必须在 finally 中 close
4. 加一条 mechanical lock 静态扫源码顶层不含 `chokidar.watch(` / `setInterval(` / `app.listen(` 等 module-load side effect

`process.exit(0)` 是 last resort（standalone CLI / 已知不可关 native handle），**不是** 默认 CI pattern。依赖 process.exit 隐藏资源泄露问题，会让"什么资源还开着"对维护者不可见。

**记入 reviewer-cross/LEARNINGS.md**（候选规则 #7）。

### Lesson B — pkill 干扰会隐藏真问题 7 个 Loop

Loop 4-6 我都用 `pkill -9 -f tsx` 应对"测试看似 hang"。Loop 7 终于在 GHA fresh ubuntu 上失去 pkill 干扰，6 小时 timeout 暴露了真根因。**pkill 是 workaround，不是 diagnose**。如果某个测试需要 pkill 才能看到 shell 返回，先问"为什么进程不退"，不是"如何让 shell 返回"。

### Lesson C — Plan 必须先 cross-review 再 ExitPlanMode

之前几次 ExitPlanMode 前没主动跑 cross-review，靠 retrospective 里"我看了一遍"自我评估。Loop 7 plan v1 用户拒绝 ExitPlanMode 显式提示"评审一下"——cursor-agent 抓出 3 MAJOR（版本错 / prod regression risk / 无 mechanical lock）。**写进新 memory `feedback_review_before_exit_plan_mode.md`**，未来 plan mode 默认先 review。

## Follow-up（不阻塞 Loop 7 ship）

- **新规则记入 LEARNINGS.md**：把 Lesson A 写进 `.claude/skills/reviewer-cross/LEARNINGS.md` 作为规则 #7（资源拥有权）
- **审视其他可能 leak**：grep `setInterval\|app\.listen\|new EventEmitter().*addListener` 等其他 module-level pattern；如果存在类似 anti-pattern，单独 Loop 修
- **Loop 8 候选**：MD7 stage cancellation 或 MD2 完整 retry policy（都骨架层，需要单独 plan + cross-review）

## Loop 7 charter 调整记录

原 Loop 7 charter（CI 接 e2e）实际拆成两步：
- **Loop 7 base** (PR #39 第一个 commit)：CI yaml + aggregator script（设计正确，被 chokidar leak 阻挡）
- **Loop 7a** (本 commit)：chokidar leak fix + mechanical lock + smoke

两步在同 PR 内，类似 v0.4.4 → v0.4.5 H14 hot-fix 模式（同 Loop 内的 hot-fix）。
