# 项目健康度检查 — 2026-05-12 (S 快速版)

**Backlog ID**: `project-health-check-2026-05-12`
**Scope**: 3 dimensions (Git/repo · CI/tests · Infrastructure)
**Branch HEAD**: `dev @ 7ddf29b` (post merge of PR #53/#54/#55 + 即时代办 commit)
**Total runtime**: ~15 min

---

## TL;DR

| 维度 | 状态 | 关键 finding |
|---|---|---|
| Git / 仓库 | ⚠️ | 4 个 worktree 未登记进 `eva.json`；`Vessel-aisep` 4 个 untracked review 文件未提交 |
| CI / 测试 | 🔴 | `pnpm test:cli` **稳定失败**（2/2 retry）—— `cli-runner.ts` cleanup race；protocol + typecheck 全绿 |
| 基础设施 | ⚠️ | 3 个 launchd backend 同时 loaded（com.vessel.backend + 2 个 com.claude-web.* legacy）；端口/服务正常但有配置债务 |

**最痛的 1 个**：`test:cli` 失败暴露 `cli-runner.ts` 的 cleanup race —— 主功能（CLI 子进程 + system prompt 注入）的 dev HEAD 失败，影响任何想跑后端测试或 CI 的尝试。

---

## Dim 1 — Git / 仓库

### Findings

**F1.1 — eva.json 与现实 worktree 漂移**（MAJOR）

`eva.json` 的 active 列表是空（所有都 done）。但 `git worktree list` 显示 5 个 worktree 在地，其中 **4 个不在 eva.json**：

| 实际 worktree | branch | 在 eva.json？ |
|---|---|---|
| `~/Desktop/Vessel` (主) | `dev` | ✅ (隐式) |
| `~/Desktop/Vessel-aisep` | `feat/aisep-bootstrap` | ❌ |
| `~/Desktop/Vessel-track2` | `wip/eva-track2-dogfood` | ❌ |
| `~/Desktop/claude-web-prod` | (detached `a0b448d`) | ❌ |
| `~/Desktop/claude-web/.claude-worktrees/3e6ad3f6-…` | `wt/3e6ad3f6-…` | ❌ |

**Impact**：违反 ADR-019 的 owns 申明假设（eva.json 应是单一 source of truth 描述谁在改什么）。`pnpm eva:sessions` 看见这些 worktree 跑了 Claude 但读不到 owns，dispatch 推荐无法判断冲突。

**Suggested fix**：每个未登记的 worktree 要么补 eva.json 条目（active），要么收掉（git worktree remove）。

**F1.2 — Vessel-aisep 有 4 个 untracked review 文件**（MINOR）

```
?? docs/reviews/aisep-protocol-v0.2-arch-2026-05-12-0246.md
?? docs/reviews/aisep-protocol-v0.2-cross-2026-05-12-0246.md
?? docs/reviews/aisep-protocol-v0.2-react-arch-2026-05-12-0246.md
?? docs/reviews/aisep-protocol-v0.2-react-cross-2026-05-12-0246.md
```

应该是某个评审流程的输出，待 commit 或 discard。Vessel-aisep 上次 commit (`0cb5081`) 是 Phase 2.D #15 → 这些 review 文件是 v0.2 评审 artifact，可能就是要进下一个 commit 的。

**Suggested fix**：进 Vessel-aisep 窗口检查 + commit 或 discard。

**F1.3 — `~/Desktop/Vessel` 本地 3 个 untracked**（MINOR）

```
?? build/
?? installer/
?? scripts/build-pkg.sh
```

整个 session 里这 3 项一直在，无人认领，可能是 pkg 打包实验的残留。

**Suggested fix**：定位来源 → 决定 commit 进 backlog 项 / .gitignore / 删除。

**F1.4 — 15 个本地 branch**（INFO）

```
chore/eva-M1-experiment-cleanup-and-retro
dev
docs/eva-as-jarvis-vision
docs/eva-provider-runtime-and-architecture
feat/aisep-bootstrap
feat/eva-M1-context-stage-aware-prompts
feat/eva-M2-3-2a-context-rich-prompt
feat/eva-M2-eva-config
feat/eva-M2-lifecycle-hooks
feat/per-project-conversations
... (后 5 个)
```

没有 `[gone]` 标记的（remote 都还在），但很多 M1 分支应该已经 merged 完可以 `branch -d` 删本地。

**Suggested fix**：跑 `git branch --merged dev | grep -v '^*\|dev$\|main$'` 找出已 merge 可删的本地 branch。

### Open PRs

✅ 0 open PR（PR #53 / #54 / #55 都已 merged + delete-branch）。状态干净。

---

## Dim 3 — CI / 测试

### Findings

**F3.1 — `pnpm test:cli` 失败（BLOCKER on dev HEAD）**

```
Error: claude CLI exited 1: Error: Append system prompt file not found:
/var/folders/.../T/vessel-append-system-prompt-14886-1778527782636-ntsy5n.txt
```

2/2 retry 失败 → 稳定可复现，**不是 flaky race**。

**Root cause（基于读源码 [packages/backend/src/cli-runner.ts:217-227](packages/backend/src/cli-runner.ts#L217-L227)）**：

```ts
child.once('spawn', () => {
  for (const f of tempFiles) cleanupAppendSystemPromptFile(f);
});
```

注释说"Claude CLI loads the file synchronously at startup, so we can unlink shortly after spawn"——但 Node.js 的 `spawn` 事件**只表示**子进程已 fork，**不**意味着它已经读到 `--append-system-prompt-file` 参数指向的文件。Claude CLI 启动到读 flag 之间的窗口里，temp file 被 unlink 了。

**Impact**：
- 任何后端集成测试想真发 prompt 给 CLI 都失败
- 生产 prod backend 跑的也是同一代码，**只要 spawn event 早于 CLI 读文件就会触发**——目前生产可能侥幸侥幸过（disk I/O 时序）
- M2-Soul 引入的 deferred MINOR fix 是这个 bug 的源头（注释里写了）

**Suggested fix candidates**（不在本次健康检查范围，需独立 task）：
1. **Defer cleanup to child exit** — 把 cleanup 改到 `child.once('exit')` 那条；temp file mode 0o600 不会泄漏，OS 也会清 tmpdir
2. **setTimeout buffer** — `setTimeout(() => cleanupAppendSystemPromptFile(f), 5000)` 给 CLI 5 秒读取时间
3. **CLI 端 inline-stream** — 不写 temp file，直接通过 `--append-system-prompt` 内联（如果 CLI 支持）

**F3.2 — protocol + typecheck 全绿**（INFO）

```
pnpm test:protocol → 125 tests passed (7 files)
tsc --noEmit (backend / shared / frontend) → all pass
```

---

## Dim 5 — 基础设施

### Findings

**F5.1 — 3 个 launchd backend 同时 loaded**（MAJOR）

```
launchctl list:
1924  com.vessel.backend           ← 现役（state=running，绑 :3030）
1224  com.claude-web.backend.dev   ← legacy（state=running 但端口不明）
1226  com.claude-web.backend       ← legacy（state=running 但端口不明）
```

**Actual port listeners (lsof)**:
- PID 3642 (node) → `127.0.0.1:3030` ✅
- PID 3663 (node) → `127.0.0.1:3031` ✅

3 个 launchd 都 state=running，但只有 2 个 node 进程在监听。说明：
- 至少 1 个 launchd 入口的 bash wrapper 在跑但其 node 未起来（端口冲突 fail-silent）
- `~/Library/LaunchAgents/com.claude-web.backend.plist` 文件还在（May 5 mtime）

**Impact**：
- 配置债务：legacy plist 未清理，launchd 表混乱
- 每次开机都会试启 3 个，2 个失败浪费资源
- 未来如果用户切回老 plist 可能误启

**Suggested fix**：
```bash
launchctl unload ~/Library/LaunchAgents/com.claude-web.backend.plist
launchctl unload ~/Library/LaunchAgents/com.claude-web.backend.dev.plist
rm ~/Library/LaunchAgents/com.claude-web.backend.plist
rm ~/Library/LaunchAgents/com.claude-web.backend.dev.plist
```

CLAUDE.md 已建议 `com.claude-web.backend.plist` 是默认 launchd label，但实际现役是 `com.vessel.backend`，需要同步 CLAUDE.md 或反过来用回旧 label（不建议）。

**F5.2 — HTTP `/` returns 404，但 `/api/projects` 正常**（INFO）

预期行为（backend 是 API + dist 静态服务，根 `/` 没单独路由配，但 SPA 加载会走 `/index.html`）。不是 bug。

**F5.3 — Tailscale serve 正确双口暴露**（INFO）

```
https://mymac.tailcf3ccf.ts.net (443) → :3030
https://mymac.tailcf3ccf.ts.net:8443  → :3031  (dev backend)
```

✅ iPhone 在 tailnet 内能访问。

**F5.4 — `~/.claude-web/` + `~/.vessel/` 持久化层健康**（INFO）

- `~/.claude-web/projects.json` + `.bak`：✓（atomic-rename + version=1）
- `~/.claude-web/harness.db` (WAL mode)：✓
- `~/.claude-web/ios-build-counter`：✓
- `~/.vessel/memory.db` (2.5MB) + WAL (4MB)：✓
- `~/.vessel/spawn-done/`：空（R1 部署后还没真实 dogfood）

---

## 优先级建议（按 ROI）

1. **🔴 F3.1 — 修 cli-runner cleanup race**：生产风险，建议立刻新 backlog 条目修。size=S（~30min），可在 main session 跑。
2. **⚠️ F1.1 — eva.json drift**：影响 Steward dispatch 推荐准确性。size=S，可顺手补 4 个 worktree 条目。
3. **⚠️ F5.1 — launchd 清 legacy plist**：destructive 操作，需 ack；不紧但留着就是债。
4. **MINOR F1.2 — Vessel-aisep untracked**：进那个 worktree 决定即可，本主 session 不便操作。
5. **MINOR F1.4 — 删 merged 的本地 branch**：cosmetic。

---

## 决策待 user

- [ ] 把 F3.1 加进 backlog 立刻修？还是 ship 健康检查报告后单独决定
- [ ] eva.json drift 现在补 4 个条目？还是先去 Vessel-aisep / Vessel-track2 看那里是不是真在用
- [ ] launchd legacy plist 现在清？还是等下次重启时一并

---

## 报告 metadata

- 本检查跑 read-only 命令（git, gh, curl, lsof, launchctl, pnpm test:*）
- 未做修改、未 commit
- 后续修复建议要走独立 backlog 项 + 各自 dispatch 流程
- 完整工具调用列表：见对话上下文（不在报告里复述）
