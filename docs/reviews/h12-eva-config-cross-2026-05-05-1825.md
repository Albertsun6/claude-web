我按 reviewer-cross 的 5 个 lens 做了静态 review。没有写 `docs/reviews/*` 文件，因为这个 prompt 自身的 hard stop 写着“不修改任何文件”。另外我尝试跑 `pnpm eva:status` / shared tests，但 Shell 调用被拒绝，未能执行验证。

## Summary
- Blockers: 1
- Majors: 4
- Minors: 2
- 总体判断：必须先修 `status` 语义，再小改后合并。

## Numeric Score
| Lens | Score |
|---|---:|
| 正确性 | 3.5 |
| 跨端对齐 | 3.5 |
| 不可逆 | 2.5 |
| 安全 | 4.0 |
| 简化 | 4.0 |

Overall score: 3.5，有 blocker 上限。

## Findings
### B1 [BLOCKER] `released` 状态语义自相矛盾
**Where**: `EvaWorktreeStatusSchema` in `packages/shared/src/eva-config.ts`, `released` entries in `eva.json`

`eva-config.ts` 注释把 `released` 写成“显式撤回”，但 `eva.json` 里 `released` 用来表示 PR ship 后实验代码 cleanup。这两个含义相反：一个是“发布/归档成功”，一个是“取消/撤回”。

这是 blocker，因为 `status` 是 schema v1 的公开枚举，一旦后续 H13 / ResourceLock / lifecycle hooks 依赖它，迁移成本会很高。

**Suggested fix**: 现在就拆清楚：要么把当前 `released` 改成 `archived` / `shipped`，另加 `cancelled`；要么只保留 `active | done | cancelled`，把已发布清理也归入 `done`，用 `note` 记录发布事实。

### M1 [MAJOR] CLI reader 没复用 schema，已经和 Zod 校验分叉
**Where**: `scripts/eva-status.mjs`, `packages/shared/src/eva-config.ts`

`eva-status.mjs` 只手写检查 `name/branch/path/status`，不会检查 `port` 范围、`owns` 类型、`dataDir` 类型、`since` 类型等。shared test 只测 `parseEvaConfig`，不保证 CLI 真实读文件时和 schema 一致。

**Suggested fix**: 如果继续保持 vanilla node，就把 CLI 的最小校验补到和 v1 schema 等价；更好是新增一个可被 Node 直接 import 的 built shared artifact，避免双 schema。

### M2 [MAJOR] v1 缺少 active 资源唯一性检查
**Where**: `EvaConfigSchema` in `packages/shared/src/eva-config.ts`, duplicated ports in `eva.json`

当前多个已完成 worktree 使用同一个 `port` 可以接受，但 active worktree 之间如果同 port / same path / same dataDir / same branch，`eva.json` 仍然 parse 通过。H12 的目标是把 markdown 漂移变成机器可检查结构，现在最容易出事故的资源冲突还没被 schema 捕获。

**Suggested fix**: 用 `superRefine` 至少检查 active entries 的 `name`、`branch`、`path`、`port`、`dataDir` 唯一性。`owns` overlap 可以先 warning，不一定 fail。

### M3 [MAJOR] `owns` 字符串格式过于自由，未来 ResourceLock 迁移会痛
**Where**: `owns` in `packages/shared/src/eva-config.ts`

`"file#symbol"` 现在只是自由字符串，未来要解析成 ResourceLock 时会遇到 `#` 转义、目录 vs 文件、symbol 是否存在、glob 是否允许等问题。这个字段正是 H12 给 M2 ResourceLock 铺路的核心字段，完全 free-form 会把歧义推迟到更难迁移的时候。

**Suggested fix**: v1 现在就定最小结构，例如 `{ "path": "...", "symbol": "computeNextStage" }`；如果觉得太重，至少给 string 加语法约束和测试：相对路径、非空、最多一个 `#`、禁止 `..`。

### M4 [MAJOR] `since` 不是 datetime
**Where**: `since` in `packages/shared/src/eva-config.ts`

注释说是 ISO timestamp，但 schema 是普通 string。状态排序、历史审计、后续 lifecycle hook 都会依赖时间字段，坏时间现在能进 repo。

**Suggested fix**: 改成 `z.string().datetime().optional()`，并加 bad timestamp 测试。

### m1 [MINOR] backend soft-fail 合理，但 status CLI 应该 hard-fail 已经做到一半
**Where**: `loadEvaConfig` in `packages/backend/src/eva-config-loader.ts`, `scripts/eva-status.mjs`

backend 启动 soft fail 合理，因为 v1 不依赖 eva.json。但 `pnpm eva:status` 是人用 gate，应当严格失败。目前 JSON parse/version/status 会 fail，但字段深度校验不足，和 M1 是同源问题。

### m2 [MINOR] `path` / `dataDir` 本机值进 git 的边界需要放进用户可见说明
**Where**: `WORKTREE_LOCK.md`, `eva-config.ts`

代码注释解释了 single-user local scope，但 `eva.json` 本身不能写注释。`WORKTREE_LOCK.md` 已经有说明，建议再明确一句：多机 clone 后先人工调整本机字段，v1 不保证跨机器可用。

## False-Positive Watch
- `--no-color` 不是问题：脚本里的 `color()` 已经用 `process.stdout.isTTY`，CI/pipe 下理论上不会输出 ANSI。
- migration SQL 不适用：本 artifact 没有 SQLite schema 改动；我没有把 `docs/HARNESS_DATA_MODEL.md` 当事实来源。

## What I Did Not Look At
- 没跑测试或 CLI，因为 Shell 命令被拒绝。
- 没检查 Swift 端，因为 H12 v1 当前没有 Swift DTO / Codable 变更。
- 没做动态行为验证，只做了 artifact + 当前实现静态 review。
