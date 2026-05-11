# Phase 1 Verdict — vessel-risk-officer

- **Artifact**: Vessel M0 implementation
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/observability/trace-writer.ts`
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/observability/trace.ts`
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/cli/vessel-core.ts`
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/orchestrator.ts`
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/memory/session-store.ts`
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/migrations/0004_m0_sessions.sql`
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/startup-env-check.ts`
- **Phase**: 1 (isolated review)
- **Role**: vessel-risk-officer
- **Date**: 2026-05-10 01:00
- **Lens**: 安全 / 失败模式 / 4 类硬触发 / SIGINT / 数据破坏 / 可观测性脱敏
- **Spec**: `docs/design/trace-redaction-spec.md` byte-by-byte 对照 + ADR-014 escalation #5/#8 + NFR-F1

---

## BLOCKER（4 条）

### B-R1: 🚨 0004_m0_sessions.sql 与 harness-store 共享同一 migrations/ 目录 → harness.db 被污染（数据破坏，4 类硬触发 #8）

**位置**：
- `packages/backend/src/migrations/0004_m0_sessions.sql`（target_ver=200）
- `packages/backend/src/harness-store.ts:40` `MIGRATIONS_DIR = join(__dirname, "migrations")`，runner `readdirSync(migrationsDir).filter(f => /^\d{4}_.*\.sql$/.test(f))`
- `packages/backend/src/index.ts:122` `_harnessDb = openHarnessDb()` 在 backend 启动时无条件跑一遍

**问题**：harness-store 是按 *目录扫描* 的 schema-migration runner，会把所有 `\d{4}_*.sql` 当作 harness.db 的 migration 应用。0004_m0_sessions.sql 落在同一目录、文件名匹配同一 regex —— **下次 `pnpm dev:backend` 启动时，harness-store 会把它套到 `~/.vessel/harness.db` 上**：
1. `db.exec(sql)` 在 harness.db 里执行 `CREATE TABLE IF NOT EXISTS sessions / intents / skill_invocations`（对 harness.db 而言是全新表，IF NOT EXISTS 不报错）
2. `INSERT INTO schema_migrations(file='0004_m0_sessions.sql', target_ver=200, applied_at=now)`
3. `PRAGMA user_version = 200`

后果：
- harness.db 的 user_version 被推到 200，越过 harness 自身 `HARNESS_SCHEMA_VERSION = 102`（harness-store.ts L31）
- 任何后续 harness 真正的 migration（例如 `0005_<harness>.sql` target_ver=103）在 runner 里会"看似成功"应用，但 user_version 会 *倒退* 到 103 —— schema state machine 错乱
- harness.db 多了 3 张 phantom tables `sessions/intents/skill_invocations`，名字与 harness 的 0001 schema 没冲突（0001 用 `task` / `stage` / `decision` 等），但污染 schema namespace；未来 harness 想用 `sessions` 表名时 IF NOT EXISTS 静默撞表
- session-store.ts 自己的 mini-runner（L42-48）只读 user_version + 硬编码读 `0004_m0_sessions.sql`，所以反向（memory.db 被 0001/0002/0003 污染）不会发生 —— **但 harness.db → 被 0004 污染是真实路径**

**4 类硬触发命中**：#8 数据破坏（harness.db 被静默写入 phantom schema + user_version 错位）→ ADR-014 §「Escalation 触发器」必停 owner 确认。

**Fix（M0 必做，二选一）**：
- 选项 A（推荐）：把 0004 移到 `packages/backend/src/migrations-memory/` 独立目录；session-store 用独立目录；harness-store regex 不变。文件命名也可以重新从 `0001_m0_sessions.sql` 起编号（两个 runner 各自维护 user_version 序列）
- 选项 B：在 harness-store runner 加一个 ignore-list（`if (file === '0004_m0_sessions.sql') continue`）—— 脏 hack，不推荐

无论选项 A/B，必须在 `packages/backend/src/test-harness-schema.ts` 加一条断言："harness.db 不会包含 sessions/intents/skill_invocations 表"。

**Severity 升 BLOCKER 理由**：M0 上线那一刻就触发，不是潜在问题；harness.db 是 Eva 已运行的 prod DB（schema v102，含 stage/task/decision 实数据），被污染后 cleanup 麻烦。

---

### B-R2: 🚨 redaction wrapper M0 缺失 → user_prompt 全文流入 trace（4 类硬触发 #5 secrets）

**位置**：
- `trace.ts` L96-99 注释："**v0A.1 risk-officer M-R2**：M0 落地时必须在 write() 内强制做 redaction"
- `trace-writer.ts` L8-9 自承："v0A.1 risk-officer M-R2 reminder：当前实现 NOT yet do redaction"
- 实际 `FileTraceWriter.write()` L41-50 只做 `TraceEventSchema.parse()` + `writeFileSync(file, JSON.stringify(event))`

**问题**：trace-redaction-spec §11 实施 checklist 第 1 条明确"把 §2/§3/§4/§5/§6 写入 FRAMEWORK.md，0A FRAMEWORK 必落"——而 M0 的 trace-writer.ts 完全没有 redaction wrapper。orchestrator.ts L60 `payload: { intent_id, text_len }` 当前看似只写元数据没暴露 user_prompt 全文 —— **但**：

1. M0 echo 测试：`pnpm vessel-core "echo my-secret-token-sk-ant-01ABC..."` —— 当前 orchestrator 不直接写 text，OK
2. 但 spec §3a 明确 `payload.user_prompt` 字段路径黑名单是"防御性"约束 —— 没 wrapper 意味着 M0.5 加 Coding Driver 时如果某个 contributor 写了 `payload: { prompt: input.text }`，spec 没机制阻止
3. spec §3b 内容模式黑名单（sk-ant-* / AKIA / email / `/Users/<other>/...`）M0 *无法实施*，依赖 caller 自觉
4. 触发器：spec §M0 acceptance C-3 `grep -q "user_prompt" instance/traces/<trace_id>/*.json && exit 1` —— M0 现在能过 C-3 是因为 caller 没写这个 key，不是因为 wrapper 拦了
5. spec §M0 acceptance C-1 / C-2（mode 0700 / 0600）trace-writer 落了，C-3 是软落（depend on caller）

**4 类硬触发命中**：#5 secrets 检测 → ADR-014 §「Escalation 触发器」必停 owner 确认。

**Fix（M0 必做）**：
- M0 加最小 redaction wrapper：在 `FileTraceWriter.write()` 入口跑 `payload = redactPayload(payload)`，按 spec §3a 字段路径黑名单 + §3b 正则匹配（最小四条：`sk-ant-*` / `sk-*` / `AKIA*` / 路径白名单外的 `/Users/[^/]+/...`）。spec §9 推荐 `fast-redact`（npm，MIT），M0 直接装（owner 已批准 M-R2 在 0B 标 M0 必须做）
- error.stack 字段也要走 redaction —— schema L52-55 允许 `error.stack` 可选；若 caller 把 `Error.stack` 灌进来，stack 含完整文件路径，路径白名单外的会泄露用户 home 结构。当前 orchestrator catch 块（L107-111）只取 `err.message` 没取 stack，**但 schema 没拦着**。M0 wrapper 要么删 schema 里的 `stack`（最小 surface），要么 redaction 覆盖 stack
- vessel-core.ts L120 fatal 路径 `process.stderr.write('vessel-core fatal: ${err.stack}')` —— stderr 不进 trace 文件不算 BLOCKER，但 launchd 场景下 stderr 会进系统日志，是 leakage 副通道。MAJOR 级。

**Severity 升 BLOCKER 理由**：M0 即"vessel-core" 单进程闭环，echo skill 不写 prompt 是 M0 的偶然；redaction 是 spec 明确要求的 M0 deliverable，缺失即 spec 违约。Owner 在 0B 决议明确"M0 必须做"。

---

### B-R3: payload 4KB 上限 schema-only enforcement → 错误模式是 `throw`，不是切到 artifact_refs

**位置**：
- `trace.ts` L43-49 schema：`payload.refine((v) => !v || JSON.stringify(v).length <= 4096, { message: 'payload > 4KB; use artifact_refs' })`
- spec §1 + §5 要求 **超过 4KB 时切到 artifact_refs**（写文件 + payload 留摘要），不是丢错
- trace-writer.ts L42 `TraceEventSchema.parse(event)` 直接抛 ZodError

**问题**：
- 当 caller 写大 payload，当前路径是 `parse()` throw → orchestrator try/catch → 报 SkillError → 用户看到 trace 写失败 → `skill_invocations` 表的状态变 error
- spec §5 期望的是 trace-writer 自动接管：`if (size > 4KB) { writeFile(`${span_id}.stdout`, output, mode 0600); payload = { summary: redact(output.slice(0, 200)) + '...[truncated]' }; artifact_refs = [path]; }`
- 这是 spec §5 明确的 M0 行为（包括 mode 0600 的 artifact 文件）

**额外副作用**：M0.5 Coding Driver 接 CC CLI stdout 时输出动辄 >4KB —— 目前实现会 *崩 trace 写* 而不是优雅切 artifact，等于把可观测性 break 在第一个真实大 skill 上。

**4 类硬触发命中**：不直接命中，但 BLOCKER 因为 spec §5 是 M0 必落、当前实现把"必落"做成"必崩"。

**Fix（M0 必做）**：
- `FileTraceWriter.write()` 改为：先检查 `JSON.stringify(payload).length`，超过 4KB → `writeFileSync(`${dir}/${span_id}.stdout`, JSON.stringify(payload), { mode: 0o600 })`；event.artifact_refs = [path]；event.payload = { summary: redact(slice(200)) + '...[truncated]' }；然后 `parse()` 不会再触发 4KB refine
- schema 的 4KB refine 保留作为最后防线（caller 直接写超大对象的 bug-catcher），但实际路径走 wrapper
- 更新 spec C-3 acceptance：增加"payload >4KB 时存在 `${span_id}.stdout` 文件 mode=0600 + event.artifact_refs 非空"

---

### B-R4: ~/.vessel/ 目录默认 0755 → memory.db 文件可被同机用户读取

**位置**：
- `session-store.ts` L34 `if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });` —— 没 `mode`
- `data-dir.ts` resolve 出 `~/.vessel`
- better-sqlite3 默认创建 db 文件 mode 0644（unix umask）

**问题**：
- spec §6 仅约束 `instance/traces/<trace_id>/` 0700 + 子文件 0600 —— 但 memory.db 不在 traces/ 下，落在 `~/.vessel/` 顶层，没被 spec 覆盖
- macOS 单用户场景"看似没事"，但：
  - 多用户 mac mini（owner CLAUDE.md 规划的 dedicated 部署）→ 其他 user 能 `sqlite3 ~yongqian/.vessel/memory.db` 读 sessions/intents 全文 + skill_invocations.artifact_json
  - intents.text 列存的是用户原始 prompt（FK 来自 orchestrator.ts L48-52 `writeIntent({ text: input.text })`） → user_prompt 全文持久化在 DB（spec §3a 黑名单的内容）
  - DB 里没做 redaction（DB 不是 trace，spec 不约束）—— DB 内容靠 OS 文件权限保护，权限不到位即泄露
- ADR-014 §「Escalation 触发器」#5 secrets：DB 含 user_prompt 全文，权限弱即等于持久化 secret leak path

**4 类硬触发**：#5 secrets（弱形式）—— DB 文件权限不限，等于把 user prompt 暴露给同机 user。

**Fix（M0 必做）**：
- session-store.ts L34 改 `mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })`
- 打开 DB 后立刻 `chmodSync(dbPath, 0o600)`（better-sqlite3 没 mode option，需手动）
- WAL 文件 `memory.db-wal` / `memory.db-shm` 也要在创建后 chmod 0o600（better-sqlite3 第一次写时创建，需在 PRAGMA journal_mode=WAL 后 chmod）
- 在 spec §6 增订一段 "memory.db 同样 0600，DATA_DIR 0700"，更新 acceptance C-1/C-2 覆盖 memory.db

**Severity 升 BLOCKER 理由**：spec 没覆盖不代表风险不存在；spec 本身是 0A 前置笔记，M0 实施时发现 spec 漏洞应该补回去而不是按 spec 字面交付。Owner 决议"M0 必须做 redaction"的精神延伸到 DB 文件权限。

---

## MAJOR（5 条）

### M-R1: SIGINT handler 不处理 in-flight runIntent，进程立即 exit 130 可能截断 SQLite WAL

**位置**：`vessel-core.ts` L80-87
```ts
const onSigint = (): void => {
  if (sigintHandled) return;
  sigintHandled = true;
  process.stderr.write('\nvessel-core: SIGINT — shutting down...\n');
  try { closeMemoryDb(); } catch { /* ignore */ }
  process.exit(130);  // ← 立即退出
};
process.on('SIGINT', onSigint);
const result = await runIntent(...)
```

**问题**：
- runIntent 正在 await 中（trace.write / writeIntent / writeSkillInvocation）—— SIGINT 来时 onSigint 立刻 closeMemoryDb + exit 130
- closeMemoryDb 关 db，但 runIntent 持有的 prepared statement 此时可能在 transaction 里 —— `dbInstance.close()` 在有未 finalize 的 statement 时 better-sqlite3 抛错 → catch swallow → exit 130
- 后果：WAL 文件未 checkpoint，下次启动 better-sqlite3 自动 recover —— 单 user 场景"通常没事"，但：
  - WAL recovery 期间 `~/.vessel/memory.db-wal` 可能 0644 mode（B-R4 关联）
  - skill_invocations 表的 `completed_at` 列没写入 → 行 status=running 永久残留 → 下次列表 sessions 时混淆"已 cancel"和"还在跑"
- M0.5 Coding Driver 会 spawn CC CLI 子进程 —— vessel-core.ts 的 SIGINT handler **不传播 SIGTERM 到子进程**，子进程会孤儿化（被 launchd / shell 收养）。owner 关注 #5 SIGINT 正是此点。
- `process.exit(130)` 调用时 Node 不 flush 异步 stdout/stderr —— 用户可能看不到"shutting down" 消息

**Fix（建议 M0 收紧，最迟 M0.5 必收紧）**：
```ts
let sigintHandled = false;
const cancelToken = { cancelled: false };

const onSigint = async (): void => {
  if (sigintHandled) return;
  sigintHandled = true;
  process.stderr.write('\nvessel-core: SIGINT — shutting down (5s budget)...\n');

  cancelToken.cancelled = true;  // runIntent 检查 token，主动 abort

  // M0.5+ Coding driver 子进程：把 child PID 注册到全局，这里 SIGTERM 全部
  for (const child of activeChildren) child.kill('SIGTERM');

  // 5s budget — 给 runIntent finish 当前 await + flush WAL
  const timer = setTimeout(() => {
    process.stderr.write('vessel-core: 5s budget exhausted, forcing exit\n');
    try { closeMemoryDb(); } catch { /* ignore */ }
    process.exit(130);
  }, 5000);
  timer.unref();  // 不阻塞优雅退出
};
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigint);  // launchd stop 用 SIGTERM
```
runIntent 主路径在每个 await 后 `if (cancelToken.cancelled) throw new CancelledError()` → catch 写 status=cancelled → return → main() 自然 closeMemoryDb + exit 130（统一 exit）。

**Severity MAJOR 理由**：M0 echo skill 没真实长任务，问题不爆；但 SIGINT shape 一旦定下，M0.5 加 Coding Driver 时改 shape 等于改 contract。owner 关注的"长任务取消不影响"明确把这个标到 M0 review focus。

---

### M-R2: SIGTERM 未注册 → launchd stop 走另一条路径

**位置**：`vessel-core.ts` L87 `process.on('SIGINT', onSigint)`

**问题**：
- launchd 默认 stop signal 是 **SIGTERM**（不是 SIGINT），不在用户 Ctrl-C 路径上
- mac mini 部署场景（CLAUDE.md 规划）launchctl unload → 发 SIGTERM → vessel-core 默认行为 = Node 默认（直接退出 + 不跑 listener）→ closeMemoryDb 不被调用 → WAL 残留更严重
- ADR-014 NFR-F1 "5 秒 SIGTERM 预算" —— 但 SIGTERM handler 完全缺失，5s 预算无从执行

**Fix**：M-R1 同一处加 `process.on('SIGTERM', onSigint)`。最小改动一行。

**Severity MAJOR 理由**：launchd 是 owner 部署目标（Mac mini migration plan），SIGTERM 不接 = launchd stop 永远不优雅。

---

### M-R3: error.stack 流入 trace event 的潜在通道

**位置**：
- `trace.ts` L51-55 schema：`error: z.object({ type, message, stack: z.string().optional() }).nullable().optional()`
- `orchestrator.ts` L107-111 catch：`{ type: err.constructor.name, message: err.message }` —— 当前**没**取 stack
- `vessel-core.ts` L120 fatal：`err.stack ?? err.message` 写到 stderr（不进 trace，但泄露副通道）

**问题**：
- 当前 orchestrator 不写 stack，OK；但 schema 允许 stack 字段 → 任何 contributor 看 schema 觉得"加上 stack 帮助 debug"就直接加上
- Error.stack 含完整 stacktrace 文件路径：`/Users/yongqian/Desktop/Vessel/packages/backend/src/...` —— 路径白名单内，OK；但若 stack 来自 npm 模块或 home 下其他路径就泄露
- stack 还可能包含闭包变量值（V8 在某些 stack-trace 增强场景），属边缘但存在
- vessel-core L120 stderr 输出 stack：launchd 部署 stderr 进 `~/Library/Logs/...`，是 secret-adjacent leakage path（stderr 不在 spec §6 mode 0600 覆盖范围）

**Fix（M0 建议）**：
- schema 删 `stack`（最小 surface 原则）—— M0 echo skill 没复杂 stack 价值
- 或保留 schema 但 redaction wrapper 强制 strip stack（白名单只保 type/message）
- vessel-core L120 fatal 写 stderr 改成只写 `err.message`，stack 走 trace 文件（被 redaction 处理过）

**Severity MAJOR 理由**：M0 看似没问题，但 schema 留口子 + stderr leak channel 都属于 spec 漏防的次级路径。

---

### M-R4: trace-writer 用 sync I/O，与 interface async 契约错位

**位置**：
- `trace.ts` L101 `write(event: TraceEvent): Promise<void>`
- `trace-writer.ts` L41-50 实际 `writeFileSync(...)`，async fn 实质同步

**问题**：
- 接口说 Promise，实现用 sync —— M0 测试看似 OK，但：
  - 跑测试时 SIGINT 来 → sync write 期间不可中断 → SIGINT handler 排队，5s budget 被 sync I/O 吃掉
  - runIntent 调链 `await trace.write(...)` 期间 event loop 不让出 → 任何并发（M1+ 多 session）排队
- spec §5 大 payload 切 artifact 时也 sync `writeFileSync(path, output, mode 0600)` —— 文件越大越长 block
- 直接修 `fs.promises.writeFile(...)` 即可，零 API 变化

**Fix（M0 建议）**：trace-writer 改 `await fs.promises.mkdir(...)` + `await fs.promises.writeFile(...)`。session-store 的 better-sqlite3 是 sync 这没办法，但 trace 是纯文件 IO，没理由 sync。

**Severity MAJOR 理由**：与 SIGINT 5s budget 协同，目前 sync I/O 是预算执行的盲点。

---

### M-R5: env check fixture 误判 + bypass 字符串比较过严

**位置**：`startup-env-check.ts` L31-32 + L61

**问题**：
- L32 `if (process.env[oldName] !== undefined && process.env[oldName] !== '')` —— 检测"非空"。但 fixture 测试场景（vitest / e2e）若 `.env` 里残留旧名 → vessel-core 直接 exit 1，测试无法开发期 bypass
- L61 `process.env.VESSEL_ENV_CHECK_BYPASS === '1'` —— 严格只匹配 `'1'`；`true` / `yes` / `TRUE` 都不行。owner 注释说 "M-R3：launchd 启动若 stderr 静默用户看不到 alert" —— 但 launchd plist 写 `<string>1</string>` OK，shell `export VESSEL_ENV_CHECK_BYPASS=true` 就翻车
- launchd 场景另一坑：launchd plist 里 `EnvironmentVariables` 通常不会带 `CLAUDE_WEB_*` 旧名（除非用户手动 carry over）—— 但用户 shell profile（zshenv）的 export 会污染 launchd（如果 launchctl setenv 用了），需要 owner 手动清理
- 整体路径稳定，但 fixture / dev 体验有粗糙

**Fix（M0 建议）**：
- bypass 接受 `1|true|yes`（小写化后比较）
- 加 `VESSEL_ENV_CHECK_DEV_FIXTURE=1` 让 vitest fixture 自动跳过（fixture 残留 stale 不该 break test）
- README / migration 文档加一行"launchctl setenv 的环境清理步骤"

**Severity MAJOR 理由**：不是安全问题，是 dev / launchd 部署体验拉胯，会让 owner 在 launchd 启动失败时浪费排错时间（dev = me = owner）。

---

## MINOR（6 条）

### m-R1: trace_id / span_id 格式校验只在 schema parse，没有 caller helper 防护

trace-writer.ts 的 `newTraceId() = randomBytes(16).toString('hex')` 始终生成 32 hex，OK。但 schema parse 失败时 message 是 ZodError，不利 debug。建议 newTraceId/newSpanId 用 const + tag type 或加运行时 invariant。

### m-R2: TraceEvent.timestamp 用 ISO datetime，没在 schema 强制 ms 精度

`z.string().datetime()` 接受 `2026-05-10T01:00:00Z` 也接受 `2026-05-10T01:00:00.123Z`。orchestrator 用 `new Date().toISOString()` 总带 ms，OK；但 schema 没强制 → 未来 caller 如果传秒精度，trace timeline replay 会错乱。建议 regex 强制 `\.\d{3}Z` 后缀。

### m-R3: 黑名单字段 `payload.cli_args.path` / `payload.headers.*` 没 enforce

spec §3a 列了 6 条黑名单字段路径，trace-writer 不实施（B-R2 同根）。M0 redaction wrapper 加上时一并落。

### m-R4: artifact_refs 路径 schema 是 `z.string()`，没限制必须在 instance/traces/ 内

caller 写 `artifact_refs: ['/etc/passwd']` schema 允许 → trace replay 时被读取 → 信息混淆。建议 schema 加 `.refine(p => p.startsWith('instance/traces/'))`。

### m-R5: writeFileSync json indent=2 → trace 文件比必要大，4KB 上限更易触

trace-writer.ts L49 `JSON.stringify(event, null, 2)` 美化输出。debug 友好但单文件大小翻倍，spec §1 4KB 限制更易达。建议默认 compact，加 `VESSEL_TRACE_PRETTY=1` env 开关。

### m-R6: closeMemoryDb 忽略错误 → WAL 残留无可观测性

vessel-core.ts L84 `try { closeMemoryDb(); } catch { /* ignore */ }`。better-sqlite3 close 失败的常见原因（active statement / iterator）值得 stderr 一行警告，让 owner 知道 SIGINT 路径不干净。

---

## 总结（必读，≤200 字）

M0 实施总体 spec 对齐度合格，但有 4 条 BLOCKER 必须 M0 收：

1. **B-R1 数据破坏（4 类硬触发 #8）**：0004_m0_sessions.sql 与 harness-store 共用 migrations/ 目录 → backend 启动会污染 harness.db。fix = 拆独立 migrations-memory/ 目录。
2. **B-R2 secrets（4 类硬触发 #5）**：trace redaction wrapper 完全缺失，spec §3 / §M-R2 owner 决议 M0 必落。fix = 加 fast-redact wrapper 在 write() 入口。
3. **B-R3 4KB 处理错误**：当前是 throw 而不是切 artifact_refs，违反 spec §5。fix = wrapper 自动写 .stdout 文件 mode 0600。
4. **B-R4 secrets 弱形式**：~/.vessel/ 默认 0755 + memory.db 0644 → 同机 user 可读 user_prompt 全文。fix = mkdir mode 0700 + chmod db 0600。

SIGINT 路径（owner #5 关注点）M0 echo 不爆，但 shape 有 2 条 MAJOR（M-R1 不传播子进程 + 阻塞式同步 close、M-R2 SIGTERM 未注册）必须在 M0.5 Coding Driver 进场前收敛，否则长任务 cancel + launchd stop 都会孤儿/截断。env check 整体稳定，1 条 MAJOR (M-R5) 是 dev 体验糙。

**验收建议**：B-R1/B-R2/B-R3/B-R4 全部 M0 内 fix；M-R1/M-R2 在 M0 内 fix（成本低 + shape 锁定收益高）；M-R3/M-R4/M-R5 列入 M0.5 入场 ticket。
