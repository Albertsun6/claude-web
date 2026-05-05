# Cross Review — PR #6 release-flow fix

**Reviewer**: reviewer-cross  
**Model**: GPT-5.5  
**Date**: 2026-05-05 10:36  
**Files reviewed**:
- `scripts/launchd/com.claude-web.backend.plist`
- `scripts/promote.sh`
- `scripts/rollback.sh`
- `packages/backend/src/index.ts`
- `packages/backend/src/routes/harness-config.ts`

## Summary

- Blockers: 1
- Majors: 2
- Minors: 2
- 总体判断：必须先修

## Numeric Score

| Lens | Score |
|---|---:|
| 正确性 | 2.5 |
| 跨端对齐 | N/A |
| 不可逆 | 3.0 |
| 安全 | 4.0 |
| 简化 | 3.5 |

**Overall score**: 3.2，有 blocker，上限 3.9。

## Findings

### B1 [BLOCKER] `/api/harness/config` 不能检测 harness DB init 失败

**Where**: `scripts/promote.sh`, `packages/backend/src/index.ts`

```66:75:scripts/promote.sh
# Quick health probe — both /health AND /api/harness/config so harness DB
# init failures (silent 503 on /api/harness/*) don't slip through
sleep 4
HEALTH=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/health || echo "000")
HARNESS=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/api/harness/config || echo "000")
if [[ "$HEALTH" == "200" && "$HARNESS" == "200" ]]; then
```

```100:119:packages/backend/src/index.ts
app.route("/api/harness/config", harnessConfigRouter);
// ...
// HARNESS_DISABLED=1 skips DB init and returns 503 for all /api/harness/* routes
// except /api/harness/config (already mounted above).
let _harnessDb: ReturnType<typeof openHarnessDb> | null = null;
if (!process.env.HARNESS_DISABLED) {
  try {
    _harnessDb = openHarnessDb();
```

**Lens**: 正确性  
**Issue**: `promote.sh` 以为 `/api/harness/config` 能发现 DB init failure，但实际代码明确把 config route 放在 DB init 之前，并且注释说明它是例外。  
**Why blocker**: 这正好漏掉 D6 要修的 failure mode。better-sqlite3 binding 坏了时，`/health=200` 且 `/api/harness/config=200` 仍可能成立，promote 会误报成功。  
**Suggested fix**: 换成真实依赖 harness DB 的轻量端点，例如 `/api/harness/projects`、`/api/harness/issues`，或新增 `/api/harness/health`，内部至少执行一次 DB-backed query。

### M1 [MAJOR] `promote.sh` 的 Node pin 不是硬 pin，会 fallback 到旧 PATH

**Where**: `scripts/promote.sh`

```20:24:scripts/promote.sh
PROD_DIR="$HOME/Desktop/claude-web-prod"
SERVICE="gui/$(id -u)/com.claude-web.backend"
# Pin to the node the launchd plist uses (must match plist ProgramArguments).
NODE_BIN_DIR="/Users/yongqian/.nvm/versions/node/v24.12.0/bin"
export PATH="$NODE_BIN_DIR:$PATH"
```

**Lens**: 正确性 / 不可逆  
**Issue**: 这里只是把目标 Node 放到 PATH 前面。如果该目录不存在、`pnpm` 不存在、或 nvm 升级后路径失效，脚本会继续用后面的 Homebrew/global `pnpm`。  
**Why major**: 这会复现 D1/D5：shell rebuild 和 launchd runtime 又可能不是同一个 Node。  
**Suggested fix**: 启动前强校验并使用绝对路径：`[[ -x "$NODE_BIN_DIR/node" && -x "$NODE_BIN_DIR/pnpm" ]] || exit 1`，后续调用 `"$NODE_BIN_DIR/pnpm"` 和 `"$NODE_BIN_DIR/node"`；不要让旧 PATH 兜底。

### M2 [MAJOR] 去掉 `caffeinate` 后，scheduler 的连续运行前提没有被机器检查

**Where**: `scripts/launchd/com.claude-web.backend.plist`

```22:26:scripts/launchd/com.claude-web.backend.plist
    Fix: keep /bin/bash as the launchd program (preserves macOS TCC permission
    for ~/Desktop access — switching to /pnpm would require fresh Full Disk
    Access grant), but drop -l and caffeinate.
    Tradeoff: lose caffeinate idle-sleep prevention; acceptable for personal
    Mac that's plugged in, plus KeepAlive=true respawns if Mac wakes.
```

**Lens**: 正确性 / 运维风险  
**Issue**: `KeepAlive=true` 只能在机器醒着时保活，不能防止系统 sleep，也不能补跑 sleep 期间错过的 scheduler tick。  
**Why major**: v0.4.0 dogfood Scheduler 依赖后台持续运行；这个 PR 修启动稳定性，但悄悄降低了运行期保障。  
**Suggested fix**: 二选一：要么加入 promote/preflight 检查 `pmset` 的 sleep 配置并把“必须禁止系统睡眠”变成明确前提；要么改成 sibling `caffeinate -w <backend_pid>` wrapper，让 `pnpm` 不再作为 `caffeinate` 的子进程。

### m1 [MINOR] `curl || echo "000"` 可能产生 `000000`

**Where**: `scripts/promote.sh`

```69:70:scripts/promote.sh
HEALTH=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/health || echo "000")
HARNESS=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/api/harness/config || echo "000")
```

**Lens**: 正确性  
**Issue**: curl 连接失败时通常也会按 `-w "%{http_code}"` 输出 `000`，随后 `echo "000"` 再输出一次，变量可能变成 `000000`。  
**Suggested fix**: 包一层函数，只保留一次 fallback，例如 `code=$(curl ... || true); echo "${code:-000}"`，或检查结果是否正好三位数字。

### m2 [MINOR] native rebuild 只覆盖 `better-sqlite3`

**Where**: `scripts/promote.sh`

```56:60:scripts/promote.sh
# Rebuild native bindings against current Node (prebuilt binaries cached against
# different NODE_MODULE_VERSION will load fine for shell-node but fail for
# launchd-node when versions diverge)
pnpm rebuild better-sqlite3 --reporter=silent 2>/dev/null || pnpm rebuild better-sqlite3
echo "  ✓ better-sqlite3 rebuilt against $(node --version)"
```

**Lens**: 简化 / 不可逆  
**Issue**: 当前修的是 `better-sqlite3`，但 release-flow 问题本质是“native deps 必须按 launchd Node rebuild”。以后加 `sharp`、`sqlite-vec` 还会漏。  
**Suggested fix**: 改成全量 `pnpm rebuild`，或维护一个 `NATIVE_REBUILD_PACKAGES=(better-sqlite3 ...)`，并在注释里说明新增 native dep 必须加入。

## False-Positive Watch

- D4 TCC “按 binary 授权”我没有验证，不能确认作者说法。当前保留 `/bin/bash` 入口是保守可接受的，但注释最好改成“observed locally”，不要写成确定机制。
- D2 `caffeinate` hang 根因未查清。直接移除可以作为 emergency fix，但长期最好补一个明确的 sleep 策略。

## What I Did Not Look At

- 没有实际执行 `launchctl`、`promote.sh` 或 curl probe。
- 没有读取作者 transcript、外部 verdict 或历史工具调用。
- 没有修改 `docs/reviews` 或 `LEARNINGS.md`，因为本次 prompt 的 hard stop 明确要求不修改文件。
