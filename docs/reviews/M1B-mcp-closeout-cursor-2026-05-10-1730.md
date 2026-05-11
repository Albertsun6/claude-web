# M1B MCP + permission — 4-way closeout: cursor-cross

**Date**: 2026-05-10 17:30  
**Verdict**: PASS-WITH-FIXES

## BLOCKER

**C-M1B-1 = R-M1B-1: null byte path sanitization missing**

同 risk-officer BLOCKER。需要 fix 才能 pass。

## MAJOR

**C-M1B-2: test-m1b.ts 中 `waitForBackend` health check 用的 `/api/vessel/health`**

这依赖 vessel-intent.ts 里的 `/health` 路由。如果 vessel-intent.ts 没 mount 或路径改变，test 会 fail on startup check 而非实际 M1B 功能。当前 vessel-intent.ts 确实有此路由，因此 ✅。但未来重构时注意。

**C-M1B-3: VESSEL_ALLOWED_ROOTS 在 test 中硬编码为 tmpdir**，但 `vesselFsRouter.get('/fs/file', ...)` 里用 `process.env.HOME` 展开 `~`

测试里直接用 absolute tmpdir path，没有 `~` 前缀，所以展开逻辑未被测试覆盖。需增加一个 `~`-prefix 测试 case。**Accept as MINOR** (security-relevant path is allowlist check, not tilde expansion).

## MINOR

**c-m1b-1: `McpServerManager` `shutdown()` 在 SIGKILL 后立即 `servers.clear()`**

SIGKILL 后进程异步消亡，但 clear() 即时。正常 case: sleep 3s wait loop + 50ms tick 已经让进程有时间退出。Edge case: 进程 D-state（disk I/O wait）可能在 SIGKILL 后延迟消亡，此时 clear() 提前但进程还活着。**Accept** — vessel-core 终止场景总比 infinite hang 好。

**c-m1b-2: 测试 trace 文件解析用 `readdirSync` 遍历所有 traces**

若其他测试（运行顺序不同）在同 dataDir 留下 traces，可能产生误判。在 M1B test 中 dataDir 是新 tmpdir，所以是 clean state。✅

## 落地

null byte fix → re-run tsc + test:m1b → pass。其余 defer 合理。
