# Store Map

> **用途**：claude-web 所有持久化点的 source-of-truth 速查表。新增功能优先复用现有 store。
>
> **状态**：v0.1（2026-05-04，Meta-Freeze 启动批 P0-2a）。
>
> **维护规则**：新加 store 需写一行 ADR-lite 说明为什么不能复用现有 store；老 store 字段变更同步本表。

---

## 1. Backend stores（`~/.claude-web/`，单进程写）

| Path | Scope | 写入方 | Source-of-truth | 写锁 | 跨设备语义 |
|---|---|---|---|---|---|
| `projects.json` | cwd 注册（项目级） | [projects-store.ts](../packages/backend/src/projects-store.ts) | 是（cwd 唯一标识 + harness_enabled 标志） | promise-queue + atomic temp+rename + `.bak` | 跨设备共享（Tailscale 同 Mac 单进程） |
| `harness.db` (+ `-wal` `-shm`) | harness 13 实体主库 | [harness-store.ts](../packages/backend/src/harness-store.ts) (better-sqlite3 + FTS5) | 是 | SQLite WAL（更适合并发读） | 跨设备共享，跨设备同步友好（WAL ≥ jsonl） |
| `harness-audit.jsonl` | harness 写操作 append-only 审计 | harness-store.ts | 是（不可改写） | append-only file lock | 跨设备追加（顺序由 fsync 保证） |
| `inbox.jsonl` | 碎想 Inbox | [inbox-store.ts](../packages/backend/src/inbox-store.ts) | 是（计划 **P0-2b** 迁入 harness.db.idea_capture 表后转读侧只读 `.deprecated` 1 个月） | file lock + atomic temp+rename（`3d95b37`） | 跨设备追加，但不像 SQLite 跨设备同步友好 → P0-2b 迁移动机 |
| `work.jsonl` | conversation × worktree 历史 | [work-registry.ts](../packages/backend/src/work-registry.ts) | 是 | promise-queue + atomic temp+rename | 跨设备共享 |
| `notify.json` | 通知偏好（Telegram chatId / serverchan token / 静音窗口） | notify routes | 是 | atomic temp+rename | 跨设备共享 |
| `telemetry.jsonl` | 结构化事件日志（含 `methodology.debt` 类型） | [telemetry-store.ts](../packages/backend/src/telemetry-store.ts) | 是 | append-only + 10MB rotate `.1` | 单机（telemetry 不跨设备 sync） |
| `ios-build-counter` | iOS build 编号 | iOS deploy script | 是 | 单整数原子写 | 单机（用于 build 唯一标识） |

**RunRegistry**（[run-registry.ts](../packages/backend/src/run-registry.ts)）：进程级 in-flight Map，**不持久化**——重启清空。是 in-memory store，不属于本表，但写新功能时要意识到它存在以避免冗余。

## 2. 读侧引用（不可写但跨边界）

这些路径 backend 不写，但 backend 或其他端会读。新增功能不能往这些路径写，必须走对应的 owner。

| Path | Owner | 用途 |
|---|---|---|
| `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` | Claude CLI 自带 | 每次 `claude --resume` 的 transcript；backend [sessions.ts](../packages/backend/src/routes/sessions.ts) 读取展示历史 |
| iOS Application Support `Cache.swift` | iOS native（[Cache.swift](../packages/ios-native/Sources/ClaudeWeb/Cache.swift)）| `projects.json` 快照 + `conversations.json` 元数据 + `sessions/<convId>.json` ChatLine[]；LRU 50 文件；server 是 truth，本地是缓存 |
| `~/.claude/.credentials.json` | Claude CLI 自带 | OAuth 凭据；backend 永不读取（只让 spawn 子进程继承） |

## 3. iOS 端 cache 边界

iOS Cache.swift 是**只读 fallback**，不是 source of truth：
- 启动期 cache 先读，立即 fetch `/api/projects` 覆盖
- 装包后第一次启动（或缓存损坏）回退到打包内 fallback-config.json（HarnessConfig）
- decode 失败一律降级为 `[]`，由 server 端补正
- LRU 写入由 onConversationDirty 触发，磁盘失败不影响内存状态

## 4. 增加 store 的 ADR-lite 模板

新加任何持久化点前，先填这 5 行（不必单独写 ADR-NNNN.md，提交在 PR description 即可）：

```
- 为什么不能复用 harness.db / projects.json / telemetry.jsonl？
- 写入频率（次/秒）和单条 size：
- 是否需要跨设备 sync（决定 SQLite vs jsonl）：
- 是否需要全文索引（决定是否进 harness.db FTS5）：
- 写锁策略和回滚路径：
```

## 5. 元工作冻结期约定（Meta-Freeze v0.2）

`HARNESS_EVOLUTION_FROZEN=1` 是**自律性约束**，不在 runtime enforcement：
- 设置方法：launchctl 用户级 env（`launchctl setenv HARNESS_EVOLUTION_FROZEN 1`）或 plist `EnvironmentVariables` 段
- 检查方法：写新 ADR / proposal / methodology 前先 `echo $HARNESS_EVOLUTION_FROZEN`，等于 1 时自检是否属冻结启动批豁免（[HARNESS_META_FREEZE_v0.2 §1 P0-1](proposals/HARNESS_META_FREEZE_v0.1.md)）
- 解冻条件：M1 跑出 ≥1 个真 dogfood Issue（discovery → spec → awaiting_review → approve）

冻结期间 dogfood 暴露的方法论缺陷直接 append 到 `telemetry.jsonl` event=`methodology.debt`，**不新增 store**。
