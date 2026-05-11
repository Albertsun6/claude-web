# 0B Engineering Retrofit — Phase 1 Risk Officer Review

- **Reviewer**: vessel-risk-officer (Claude subagent)
- **Phase**: 1 of 4-way review (lens = risk / security / data integrity / observability / failure modes)
- **Date**: 2026-05-10 00:33
- **Calibration**:
  - 5 interface stubs are type-defs — only flagged when the *signature* implies an unsafe lifecycle.
  - E2 log-defer policy honored: license / fixture-token findings are NOT BLOCKERs.
  - Real production secret would be a BLOCKER; none found.

---

## Summary

0B engineering retrofit artifacts are **substantially safer than v0-pre baseline**. ADR-013 §3 已锁方案 B（无 `rm -rf`）；migration 脚本默认 dry-run 且不删源；secrets / license 双 log 模板严谨；trace schema 已 cap 4KB + 强制 JSON-serializable + W3C TRACEPARENT 命名。

**0 BLOCKER**（无真实 production secret 泄漏；无破坏性数据丢失风险；无 symlink escape 漏洞；vessel-core 不会因 helper 死而崩 — 因为 5 接口和 ML worker types 都把 helper 隔离到 `boot()` / HTTP loopback）。

**3 MAJOR**（migration 脚本 partial-failure 不回滚；trace payload 内容脱敏未在 schema 中强制；env-check 触发即 `process.exit(1)` 阻断启动，没给出"自动改名 helper"或 grace period）。

**5 MINOR** 加固建议。

---

## Findings

### MAJOR

#### M-R1 · migration 脚本中途失败无回滚 / 无清单 / 无 manifest 校验

**File**: `/Users/yongqian/Desktop/Vessel/scripts/migrate-eva-to-vessel.ts`

**Issue**:
1. Loop at L160-170 一边 copy 一边 print。若 copy 第 5 项时磁盘满 / 权限错 / EIO，前 4 项已写入 `~/.vessel/`，第 5 项部分写入（`fs.copyFileSync` 不是原子的——大文件中途失败会留下半截目标文件）；脚本 throw 后 `~/.vessel/` 处于半迁状态。
2. SQLite 三件套（`memory.db` / `-wal` / `-shm`）按顺序单独 copy，无事务边界。如果 wal 已 flush 但 shm 没 copy，后续 vessel-core 启动时 SQLite 可能看到 inconsistent state。**正确做法**：在 copy 前对源 db 跑 `sqlite3 harness.db ".backup memory.db"`（或 `VACUUM INTO`），单文件 atomic 出 SQLite consistent snapshot；不要按 OS 文件 copy 三件套。
3. 无 final manifest（`migration-manifest.json` 记录哪些项 copied / sizes / sha256 / 时间戳），用户后期想验"我迁完了吗"没有 ground truth。

**Severity**: MAJOR（个人单机数据完整性 — 真把 harness.db copy 一半，下次启动 vessel-core 会读到 corruption）

**Fix**:
- L93-180 `main()` 改为：先 stat 全部 src + 估算空间 + `df` 检查 dest 可用空间 ≥ src size × 1.2 → 不够直接 fail-fast；
- SQLite 用 `.backup` 命令而非 raw copy；
- copy 阶段失败时进入 `cleanup()`：删除本次新写入的 dest 文件（保留 dest 上原本就存在的）→ 让用户从 clean state 重跑；
- 写 `~/.vessel/migration-manifest.json` 含 each item: `{ src, dest, size, sha256_src, sha256_dest, ts }`；
- 退出前再校验：每个 dest 重新 sha256 应等于 src 的 sha256（`memory.db` 走 SQLite backup，sha 不会等，但 `PRAGMA integrity_check` 应 OK — 改为校验这个）。

#### M-R2 · trace schema 没有强制内容脱敏（只 cap 4KB + JSON-serializable）

**File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/observability/trace.ts`

**Issue**: `TraceEventSchema.payload` 只有两个 refine：（a）≤4KB（b）JSON-serializable。**完全没有引用 trace-redaction-spec 的黑名单字段（`payload.user_prompt` / `payload.headers.authorization` / `sk-ant-...` 正则等）**。这是把脱敏责任完全推给 caller 自己 redact，但 caller 拿的是同一个 schema —— 没人来拦"忘了 redact"的情况。

trace-redaction-spec §3 列了具体字段路径黑名单 + 正则模式，但 0B trace.ts 既没 import `fast-redact` 也没在 schema refine 里加正则探测。FRAMEWORK §11 acceptance C-3 说 "grep -q user_prompt trace 文件应 fail"——若 caller 拼了 `payload.user_prompt = "<full prompt>"` 直接走 schema 校验，这条 acceptance 会过不去。

**Severity**: MAJOR（observability 缺关键脱敏 — 用户 prompt / API key 会进 `instance/traces/` 长期保存，是 R-06a 风险面）

**Fix**: 至少加一条 refine 拦最常见漏洞：
```ts
.refine((v) => {
  if (!v) return true;
  const s = JSON.stringify(v);
  // 拦明显未 redact 的 token-like 模式
  if (/sk-ant-[A-Za-z0-9_-]{40,}/.test(s)) return false;
  if (/ghp_[A-Za-z0-9]{36}/.test(s)) return false;
  // 拦黑名单字段路径（最低限度）
  if (typeof v === 'object' && 'user_prompt' in (v as object)) return false;
  return true;
}, { message: 'payload contains unredacted secret/PII; run through redactor first' })
```
+ 把 fast-redact wrapper 落到 `observability/redact.ts`（trace-redaction-spec §9 已确定方案）+ TraceWriter 实现里强制调 redact 后再 schema parse。

#### M-R3 · startup-env-check 直接 `process.exit(1)` 阻断启动，无 grace period 也无 self-rename helper

**File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/startup-env-check.ts`

**Issue**: 用户从 Eva 升级 Vessel，旧的 `CLAUDE_WEB_TOKEN` 还在 launchd plist / shell profile / `.env.local` 里。当前实现：检测到 → 打 banner → `process.exit(1)`。这意味着：
1. 用户从 launchd 启动 vessel-core → backend 起不来 → iOS app 连不上 → **静默故障**（launchd 日志要去翻 `/Users/.../Library/Logs/com.vessel.backend.log`，对个人用户不友好）
2. 没告诉用户"你的旧值是什么"——只说"请改名"。如果用户记不清 token 原值，要去翻 keychain 或 reset；
3. 没有 `--auto-fix` 或 `pnpm vessel:fix-env` helper script 帮忙写新名（虽然 ADR-013 §2 说 "迁移脚本 alert 用户"，但脚本是 `migrate-eva-to-vessel.ts`，不是 startup-time check 的事——startup check 没有 alert + auto-help 路径）。
4. False-positive 风险：用户 shell profile 里有 `export CLAUDE_WEB_TOKEN=` (空值) ——  L30 `!== ''` 已防住空字符串 ✅；但 `export CLAUDE_WEB_TOKEN=" "`（带空格）会通过空值检查，`stale.push` 命中——虽然这是用户错配，但报错信息无法区分"真的是 stale 旧 token"还是"空白的环境噪音"。

**Severity**: MAJOR（env stale 处理生硬 → 用户旧配置静默失效后只能手翻日志，违反"帮用户找到旧配置"的初衷）

**Fix**:
- exit 前**打印旧值的脱敏摘要**（前 3 字符 + `...` + 后 3 字符 + 长度）让用户确认是哪个旧 token；
- 提供 `pnpm vessel:rename-env` script（读 user shell profile + .env.local + 当前 process.env，输出"以下行需要改"+ 可选 `--apply`）；
- 检测 `=` 号但值是 whitespace-only → 给"empty / whitespace value, treating as unset"提示而非 stale；
- 文档明示 launchd 用户：`launchctl unsetenv CLAUDE_WEB_TOKEN && launchctl setenv VESSEL_TOKEN <new>` + 重 load plist。

---

### MINOR

#### M-R4 · ADR-013 §3 备份目录路径碰撞

**File**: `/Users/yongqian/Desktop/Vessel/docs/adr/vessel/ADR-013-rename-strategy.md` L150-152

`cp -r ~/Desktop/Vessel ~/Desktop/Vessel-backup-$(date +%Y-%m-%d-%H%M)` —— 如果用户 1 分钟内重跑两次（hooked retry / shell history up arrow），第二次 `cp -r` 会**写进第一个备份目录里**（`Vessel-backup-...M/Vessel/...`），不是覆盖，造成嵌套备份。建议改用 `+%Y-%m-%d-%H%M%S`（精确到秒）+ `-n`（no-clobber）+ if-exists fail。同样适用 §3 Stage 1.3 archive rename。

#### M-R5 · trace ENV_KEYS 不在子进程 spawn 时强制清理

**File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/observability/trace.ts` L80-86

`ENV_KEYS` 只导出名字，但没规定子进程 spawn 时**必须清理 parent 的 TRACEPARENT** 防止跨 run 污染。如果 vessel-core 内 spawn CC CLI 没显式 pass-through new TRACEPARENT，子进程会继承 parent 残留值 → trace 错挂到上一次 run 的 span。Driver `submit()` 实现侧需要明示规则；现在 ENV_KEYS 只是命名，没文档化"spawn 必须用 pickEnv white-list 而非 inherit-all"。

#### M-R6 · CodingDriverArtifact 缺取消语义 + 无 SIGKILL 回执字段

**File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/drivers/types.ts` L29-30

`cancel(runId): Promise<void>` 注释提到 "SIGTERM + 5s SIGKILL" —— interface 签名上看 OK ✅，但缺：
- 无 `cancel(runId, opts?: { gracePeriodMs?: number })` 让 caller 调（M0 acceptance 可能要求 1s 测试用 grace）；
- 无返回 `{ killed: 'sigterm' | 'sigkill'; exitCode: number }`，caller 没法知道是 graceful 还是被 SIGKILL（影响 cleanup 决策——SIGKILL 后 stdoutPath 可能不完整）；
- 无 `Promise<void>` reject 协议（如果 5s 都没杀掉怎么办？应该 throw with `process-zombie` error code）。

interface stub 阶段标 MINOR，落地时建议补成 `Promise<{ killed: 'sigterm' | 'sigkill' | 'zombie'; exitCode: number | null }>`。

#### M-R7 · ML worker types 缺 health-check polling 节奏 + 缺 readiness vs liveness 区分

**File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/ml-worker/types.ts` L17-50

3 个 client interface 都有 `health()`，但 interface stub **没暗示** vessel-core 应如何使用：
- 启动时阻塞等 readiness？timeout 多久？
- 运行时怎么 liveness probe（每 N 秒一次？）
- helper 死了后 vessel-core 行为：降级 capability OR 重启 worker？哪一边？

CLAUDE.md 项目硬约束写明 "ML / MCP / CC CLI 都是受控 helper subprocess（生命周期由主进程管理，failover 仅降级对应 capability，不影响 core）"。但这条约束**没有**通过 interface 签名 enforce。建议把 lifecycle hook 加进来：
```ts
export interface MlWorkerLifecycle {
  startTimeoutMs: number;        // 多久等不上 health() = ok 算启动失败
  livenessIntervalMs: number;
  onHealthFail: 'degrade-capability' | 'restart-worker' | 'restart-with-backoff';
}
```
在 `EmbeddingClient` / `AsrClient` / `TtsClient` 之外加 `MlWorkerLifecycle`，让 caller 在 `boot()` 里显式声明，避免每个 capability 自己拍脑袋。

#### M-R8 · CapabilityApp.boot() 失败 → vessel-core 行为没在 interface 强制

**File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/app.ts` L24, 28

`boot()` 和 `health()` 都签名 `Promise<...>`，但 interface 里没规定：
- boot() reject 时，vessel-core 是 **fail-fast 不启动** 还是 **continue without this capability**？
- HelperHandle.shutdown() 如果 5s 内没退干净，行为是 throw / SIGKILL / 静默？

NFR-C2 提到 "30 秒内"，但 interface 不强制。建议 `boot(): Promise<void>` 改 `boot(): Promise<{ status: 'ready' } | { status: 'degraded'; reason: string }>` 让 capability 显式声明降级；或在 NFR 里要求 "boot reject = capability disabled, NOT vessel-core crash"。否则 CodingCapability boot 里 spawn ML worker 失败 throw → 顶到 vessel-core 死 → R-06a 的 "helper 失败不拖垮 core" 约束破功。

---

## Positive observations

1. ✅ **migration 脚本默认 dry-run** — `DRY_RUN = !ARGS.has('--apply')` (L26) 默认无害；冲突默认 skip 并要求 `--force-overwrite` 才覆盖 (L134-138)；显式排除 `eva.json` (L50)。R-08 数据迁移硬触发 #8 已合规。
2. ✅ **不删源** — L173 print "Source preserved (not deleted)"；脚本全程没有 `fs.unlinkSync` / `fs.rmSync`。ADR-013 §3 "禁止 rm -rf" 落地。
3. ✅ **ADR-013 §3 已锁方案 B** — owner E1 决议后破坏性方案 A 已删除，全文 §3 + escape hatch 写明"如确实需要删，必须 mv 到 archive + 14 天观察期"。risk-officer v0-pre 4 类硬触发 #8 命中已闭环。
4. ✅ **trace_id / span_id 用 OTEL hex 格式** — 32 hex / 16 hex 强制 regex (trace.ts L16-18)，不是任意 string；W3C TRACEPARENT env var 标准命名 (L82) — 跨子进程传播规范。
5. ✅ **payload 4KB cap + JSON-serializable** — 超出 → `artifact_refs` (trace.ts L43-49 + trace-redaction-spec §5)；artifact 文件 mode 0600 / 目录 0700 已在 spec 中明确。
6. ✅ **startup-env-check 不静默 fallback** — pragmatist M-P1 决议"不维护双名债务"已落地（L43 注释 "Code does NOT fall back"），exit-1 后用户必须显式改 env，避免长期债务。
7. ✅ **PermissionScope HARD RULES 已写明** — tool.ts L39-53 列出 7 条（realpath canonicalize / symlink escape / ~ expand / case-insensitive FS / 测试覆盖 ../ + symlink + bind mount + UNC）。stub 阶段 M1B 实施时这 7 条是 hard reference。
8. ✅ **AgentResult discriminated union** — agent.ts L49-53 强制每个 status 必带对应字段（success → artifact / paused → resumeToken / cancelled → reason / failed → error），caller 漏分支 TS 编译失败。
9. ✅ **secrets / license 双 log 模板严谨** — 字段定义清晰、release gate grep 检查命令具体（exit code 0/1）、real-production hard-stop 协议（写 inbox → 立即 escalation owner → filter-repo + force push + mirror）写明。
10. ✅ **gitleaks 0B 扫描结果 clean** — SECRETS log §"0B Stage 5 扫描结果"明示 241 commits 0 leaks；license-checker 7 个生产依赖全 MIT/BSD-2-Clause，无 AGPL/SSPL/BUSL 命中。R-06a / R-06b 当前状态绿。
11. ✅ **HelperHandle.pgid + shutdown 协议** — app.ts L88-92 显式声明 process group id（NFR-C2 SIGTERM 整组用），shutdown = SIGTERM + 5s SIGKILL —— 是 interface 层面**仅有**写明 SIGKILL 兜底的契约。

---

## Verdict

**Status**: APPROVED-WITH-CHANGES（0 BLOCKER / 3 MAJOR / 5 MINOR）

3 MAJOR 都属"加固"类（不阻塞 0B closeout，但 M0 实施前必落）：
- M-R1：migration manifest + SQLite `.backup` 单原子 snapshot —— M0 进入前修复（涉及真实数据）
- M-R2：trace schema 加最低限度 redaction refine + fast-redact wrapper —— M0 acceptance C-3 测试前必修
- M-R3：env-check 加脱敏摘要 + helper script —— 非阻塞，但用户体验欠佳，0B closeout 前修复

5 MINOR 是 lifecycle 契约加固，建议在 0B → M0 衔接窗口或 M0 实施开头补全 interface 注释。
