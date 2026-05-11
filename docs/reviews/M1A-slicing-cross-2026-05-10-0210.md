# cursor cross-reviewer verdict — M1A slicing proposal (2026-05-10)

## Overall: PASS-WITH-FIXES

M1A 拆成 α/β/γ 是可 ship 的，且没有因为切片小或 stub 边界产生 BLOCKER。需要在实施前修正两类低层机制风险：前端身份模型不是 grep-replace；`session_id` 语义必须拆清，不能把 Eva 的 cwd、Claude CLI session、Vessel memory session、UI conversation 混成一个字段。

## 5 questions answered

### Q1. Eva App.tsx byCwd → bySessionId 适配代价

结论：不是 grep-replace。当前 `byCwd` 是“打开的项目 tab”状态，不只是 key 名。

证据：
- `packages/frontend/src/store.ts:39` `ProjectSession` 同时持有 `cwd/name/sessionId/messages/busy/currentRunId`，其中 `cwd` 是文件、Git、权限、history 查询的根。
- `packages/frontend/src/store.ts:153-159` localStorage key 是 `sessions/open-cwds/allowed-tools-by-cwd`，迁移会影响持久化数据。
- `packages/frontend/src/store.ts:207-210` sessionId 按 cwd 持久化，说明当前模型是 cwd -> latest Claude session。
- `packages/frontend/src/App.tsx:34-75` `ProjectTabs` 遍历 `openCwds` 并用 cwd 做 tab key/title/close 参数。
- `packages/frontend/src/components/ProjectPicker.tsx:65-89` 项目列表用 cwd 判断 open/active/busy。
- `packages/frontend/src/ws-client.ts:24-25` 明确是 `runId -> cwd`，不是 `runId -> sessionId/conversationId`。
- `packages/frontend/src/components/FilesPanel.tsx` / `GitPanel.tsx` / `FileTree.tsx` 等通过 `activeCwd` 驱动文件和 Git 面板。

因此 γ 需要概念重映射：`Project` 仍应 cwd-keyed；`Conversation/Session tab` 才能 session_id-keyed。否则会把“工作目录”和“对话身份”绑死，无法表达同一项目多会话，或同一会话跨入口恢复。

### Q2. memory.db 锁竞争

结论：单个 backend 进程内，多 session WS 并发不会因为 better-sqlite3 single connection 死锁；同步 API 在 Node event loop 内串行执行。`runIntent` 只有在 `await skill.invoke(...)` 前后各做同步写入，写入段不会被另一个 JS continuation 打断。

证据：
- `packages/backend/src/memory/session-store.ts:31-62` 是模块级单例 connection。
- `packages/backend/src/orchestrator.ts:66-89` boot session + writeIntent 在 await 前同步完成。
- `packages/backend/src/orchestrator.ts:100-145` skill 完成后再同步 writeSkillInvocation。
- `packages/backend/src/memory/session-store.ts:71-82` bootSession 的 SELECT/UPDATE/INSERT 在同一次同步函数调用内完成。

但跨进程仍有 MAJOR 风险：M1A acceptance 要“CLI 和 Web 都能查询同 session_id 上下文”，CLI `packages/backend/src/cli/vessel-core.ts:107-112` 会作为另一个进程打开同一个 `memory.db`。当前没有 `busy_timeout`，如果 CLI 与 HTTP backend 同时写，SQLite 单 writer 可能返回 `SQLITE_BUSY`，不是死锁，但会失败。建议 α 前加 `db.pragma('busy_timeout = 5000')`，并给 CLI+HTTP 并发写一个集成测试。

### Q3. trace 文件 dir 无限增长

结论：100+ runs 本身不是 α blocker；按 trace_id 读取单个目录不会因为根目录 100 个 trace 子目录明显变慢。α 不必先做复杂 retention。

证据：
- `packages/backend/src/observability/trace-writer.ts:42-70` 每个事件写到 `DATA_DIR/traces/<trace_id>/<span_id>.json`，读单 trace 只需要列一个小目录。
- `packages/backend/src/drivers/cli-runner-driver.ts:93-96` stdout 也落到同一个 trace_id 目录。
- 现有 `packages/backend/src` 没有 `/api/traces/<id>` route；proposal 的 replay/list 还未实现，不存在当前 readdir root 的性能证据。

建议 α 只做 `--limit` 和单 trace 读取；retention 可作为 MINOR：记录 TODO 或实现非常小的“按 mtime 删除超过 N 天/数量”的 helper，但不要阻塞 panel-first。

### Q4. WS runIdToConversation race

结论：当前 Web 不是完整 runIdToConversation，而是 runIdToCwd；iOS 才有 per-conversation invariant。β 若直接“沿用 Eva 协议”但把 session_id 当 tab identity，会有路由 race。

证据：
- `packages/frontend/src/ws-client.ts:24-25` `runToCwd` 是唯一 client-side routing table。
- `packages/frontend/src/ws-client.ts:239-255` sendPrompt 生成 runId 后绑定 cwd，并发送 `resumeSessionId: sess.sessionId`。
- `packages/frontend/src/ws-client.ts:197-205` session_ended 通过 runId 找 cwd，再清该 cwd 的 busy/currentRunId。
- `packages/frontend/src/store.ts:39-50` 一个 ProjectSession 只有一个 `currentRunId`，所以同 cwd 内不能表达多 conversation 并发。
- `packages/shared/src/protocol.ts:19-30` WS user_prompt 只有 `cwd` 与 `resumeSessionId`，没有 Vessel `session_id` 或 `conversation_id` 字段。
- `packages/backend/src/index.ts:413-478` backend 的 Eva WS 只知道 cwd / resumeSessionId / runId，并不持久化 Vessel memory session。

推荐规则：M1A-β 里 `conversation_id` 与 Vessel `session_id` 应 1:1；`run_id` 对它是 1:N；`cwd/project_id` 是独立属性。不要复用 Claude CLI 的 `session_id` 字段名承载 Vessel memory session，至少在 wire 上命名成 `vesselSessionId` 或 `conversationId`，Claude resume 用 `claudeSessionId` / `resumeSessionId` 保持分离。

### Q5. Claude 这次最可能漏看的

结论：最可能漏看的是“身份字段同名但语义不同”，其次是“side-effect 模块或新增 CLI 命令没接到入口”的老问题。

来自历史盲区：
- `~/.claude/skills/debate-review/log.jsonl:8` 记录过 startup-env-check 定义但未在 entry 调用，3 个 Claude lens 漏掉。
- `~/.claude/skills/debate-review/log.jsonl:9` 记录过 migrations 目录共享导致 harness-store glob 误吞，属于跨 runner 低层目录边界问题。
- `~/.claude/skills/debate-review/log.jsonl:10` 记录过 redaction leaf-only 被 schema evolution 绕过，说明 Claude 容易低估“字段形状变化后旧保护失效”。

映射到本提案：`session_id` 同时可能指 Claude CLI jsonl session、Vessel memory session、UI conversation，会在 γ/β 的 WS 路由、history 查询、permission scope、CLI replay/list 输出里制造隐性错路由。

## Findings

### MAJOR M1 — γ 不能把 `byCwd` 直接改成 `bySessionId`

**Where**: `packages/frontend/src/store.ts:39-50`, `packages/frontend/src/store.ts:153-159`, `packages/frontend/src/App.tsx:34-75`, `packages/frontend/src/ws-client.ts:24-25`

**Issue**: `byCwd` 承载的是项目 tab + cwd 相关资源，而 `sessionId` 当前只是该 cwd 下最近的 Claude CLI resume id。直接改 key 会破坏 ProjectTabs、ProjectPicker、文件/Git面板、allowed-tools-by-cwd、history transcript 查询和 localStorage 迁移。

**Suggested fix**: γ 设计成两层：`projectsByCwd/openProjectCwds/activeCwd` 保留；新增 `conversationsById/openConversationIds/activeConversationId`。Conversation 持有 `cwd`, `vesselSessionId`, `claudeSessionId?`, `messages`, `busy`, `currentRunId`。写一个一次性 localStorage migration，把旧 `cwd -> sessionId` 转成每个 cwd 一个默认 conversation。

### MAJOR M2 — β 的 WS 协议缺少 Vessel session/conversation 身份字段

**Where**: `packages/shared/src/protocol.ts:19-30`, `packages/frontend/src/ws-client.ts:239-255`, `packages/backend/src/index.ts:413-478`

**Issue**: 现有 Eva WS 消息只有 `cwd` + `resumeSessionId`。M1A-β 如果要把 runIntent 接进 WS，并支持多 session 并行，必须让 server 和 client 都能按 `runId -> conversation/session` 路由。只靠 cwd 会把同项目多会话混到一个 ProjectSession；只靠 Claude `resumeSessionId` 又会和 Vessel `memory.db.sessions.id` 混名。

**Suggested fix**: β 的 shared protocol 增加 `conversationId` 或 `vesselSessionId`，backend 在 `runs` handle 中保存它，所有 `trace_event/sdk_message/session_ended/error/permission_request` 都带回同一个 id。`resumeSessionId` 仅保留给 Claude CLI 续跑，名字不要复用。

### MAJOR M3 — CLI + Web 同写 memory.db 缺少 busy_timeout

**Where**: `packages/backend/src/memory/session-store.ts:39-41`, `packages/backend/src/cli/vessel-core.ts:107-112`

**Issue**: 单 backend 进程内 better-sqlite3 同步写是串行 OK；但 CLI 和 HTTP backend 是两个进程，会各自打开 `memory.db`。WAL 仍是 single writer，当前没有 `busy_timeout`，并发写可能直接 `SQLITE_BUSY`。

**Suggested fix**: `openMemoryDb()` 加 `db.pragma('busy_timeout = 5000')`；α/β gate 加一个小测试：启动 backend 写 `/api/intent` 的同时跑 `pnpm vessel-core --session=s1 --skill=echo hi`，确认不会 SQLITE_BUSY。

### MINOR m1 — endpoint 命名与现有 runs route 不一致

**Where**: `docs/reviews/M1A-slicing-proposal-2026-05-10-0210.md:25`, `packages/backend/src/routes/runs.ts:15-20`

**Issue**: proposal 写 `/api/runs/list`，现有 Eva route 是 `GET /api/runs`。这不是 blocker，但实施 α 时容易新旧 endpoint 并存。

**Suggested fix**: α 采用 `GET /api/runs`，如需要兼容再加 `/api/runs/list` alias，但文档先统一。

### MINOR m2 — trace retention 不应阻塞 α，但要给 replay/list 加 limit

**Where**: `packages/backend/src/observability/trace-writer.ts:42-70`, `docs/reviews/M1A-slicing-proposal-2026-05-10-0210.md:35-36`

**Issue**: 每 run 一个 trace dir 可以先接受；真正风险是未来 list/replay 默认全量扫 root 或无限打印。

**Suggested fix**: `vessel-core trace replay <trace_id>` 只读指定 dir；`vessel-core list --limit N` 默认 20；HTTP list 默认 50。retention 放 M1A 后续或 M1C observability cleanup。

## Counter-proposals

1. M1A-α 保持 panel-first，但只接 Vessel-native `/api/intent` + `/api/runs` + `/api/traces/:traceId`，不要提前接 Eva App shell。
2. M1A-β 先做“conversationId/vesselSessionId-aware WS thin protocol”，不要先改全量 React UI。
3. M1A-γ 再把 Eva UI 分层迁移：Project 是 cwd，Conversation 是 session，Run 是单次执行。这样能复用文件/Git/ProjectPicker，同时避免 session-keyed grep-replace。

## Positive observations

- α/β/γ 顺序把“用户先看到状态”放在前面，同时没有推翻 plan v5.4 的 M1A acceptance，方向合理。
- trace writer 已经是 `0600` 文件 + `0700` dir，并在 write entry 做 redaction/spillover，M1A panel-first 可以直接复用，不需要先重做 observability。
- M0.5 的 orchestrator `runIntent` 已经有清晰的 `sessionId` 参数和 `runId`，β 接 WS 时有可复用核心，不需要重写 driver。

## 异质性确认

Claude 视角容易看到“Eva 已有 byCwd，多项目并发已验证”，但不一定会立刻看到 Web 实际是 `runId -> cwd`，而不是 iOS 那套 `runId -> conversation`。这个低层差异会让 M1A-β 在同项目多 session 并发时静默错路由；它比“前端改字段名”更危险。
