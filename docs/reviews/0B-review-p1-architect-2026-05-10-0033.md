# vessel-architect Phase 1 verdict — 0B (2026-05-10 00:33)

## Summary
- Overall: **PASS-WITH-FIXES**
- BLOCKER count: **1**
- MAJOR count: **3**
- MINOR count: **3**

整体：5 接口 stubs 与 FRAMEWORK §2 签名一一对应，driver / ml-worker / observability 正确隔离在 5 接口外，Eva 改造确实走 adapter 而非 octopus 重写（ADR-016 路径 C 落实）。一个 BLOCKER 与跨文档一致性有关（trace env var 协议在 ADR 里和 trace.ts 里说的不一样），其余 MAJOR 是字段语义 / lifecycle 暧昧 / 类型链断裂。骨架本身没有架构层方向性问题。

---

## Findings

### BLOCKER-1: 子进程 trace 传播 env vars 协议在 ADR 与代码里冲突（架构层 single-source-of-truth 破坏）

- **File**:
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/observability/trace.ts:80-86`（说 W3C `TRACEPARENT` + `VESSEL_CONVERSATION_ID` + `VESSEL_RUN_ID`）
  - `/Users/yongqian/Desktop/Vessel/docs/adr/vessel/ADR-009-mcp-server-lifecycle.md:57`（仍说 `VESSEL_TRACE_ID` + `VESSEL_PARENT_SPAN_ID`）
  - `/Users/yongqian/Desktop/Vessel/docs/adr/vessel/ADR-016-coding-driver-interface.md:91`（example 仍写 `VESSEL_TRACE_ID: spec.trace_id`）
- **Issue**: v0A.1 cursor B1 修复把 env var 协议从自定义 `VESSEL_TRACE_ID/VESSEL_PARENT_SPAN_ID` 改成了 W3C `TRACEPARENT`，但只动了 `trace.ts` 和 FRAMEWORK §5.6；**ADR-009 (MCP server spawn 时 set 哪些 env)** 和 **ADR-016 (CodingDriver spawn CC CLI 时 set 哪些 env)** 仍写旧协议。这两个 ADR 是 M0.5 / M1B 实施的直接 spec — Skill / Driver / MCP 三条 spawn 路径都需要按此打 env vars 才能让 W3C `traceparent` 在子进程里被读到，否则跨进程 trace_id 就断了（NFR-O1 直接 fail）。
- **Why blocker**: 这是协议一致性问题。三条 spawn 路径如果按各自 ADR 实施，会得到三个不一致的 env var 命名（CC CLI 子进程拿 `VESSEL_TRACE_ID`、MCP server 拿 `VESSEL_TRACE_ID`、新写的 trace.ts 期望读 `TRACEPARENT`），跨进程 trace 在 M0.5 第一天就坏。0B 是"工程改造"阶段，single-source-of-truth 必须在 0B 内修复，不能拖到 M0.5 当 surprise。
- **Suggested fix**:
  1. 在 ADR-009 §5（spawn MCP server）改 `VESSEL_TRACE_ID/VESSEL_PARENT_SPAN_ID` → `TRACEPARENT`（W3C 格式 `00-<32hex>-<16hex>-<flags>`）+ `VESSEL_CONVERSATION_ID/VESSEL_RUN_ID`，并加一行注 "v0A.1 cursor B1 修订，与 trace.ts ENV_KEYS 对齐"。
  2. 在 ADR-016 §2 example 改 `env: { VESSEL_TRACE_ID: spec.trace_id }` → `env: { TRACEPARENT: buildTraceparent(spec.traceCtx), VESSEL_CONVERSATION_ID: spec.traceCtx.conversation_id, VESSEL_RUN_ID: spec.runId }`。
  3. 顺手在 `trace.ts` 加一个 `buildTraceparent(ctx: TraceContext): string` helper（FRAMEWORK §5.6 的 format 字符串），让所有 spawn 点用同一个 helper，杜绝硬编码。

---

### MAJOR-1: 5 接口 stubs 用 `type Intent = unknown` / `type Artifact = unknown` 局部 placeholder，破坏跨接口类型链

- **File**:
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/agent.ts:19-23`
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/skill.ts:23-24`
- **Issue**: 两个文件各自声明了 `type Intent = unknown` 和 `type Artifact = unknown`。这俩 `unknown` **不是同一个 nominal type**——`Skill.invoke(): Promise<Artifact>` 的 `Artifact` 跟 `AgentResult` 里 `success.artifact: Artifact` 的 `Artifact` 在 TS 编译器看来是不同符号，只是恰好都叫 `Artifact`。短期 stub 没问题，但 **0B-7（@vessel/shared 导出 Intent/Artifact/SessionId）必须在 0B 内完成**，否则 M0 编写第一个真实 EchoSkill 时会立刻发现 `Skill.invoke` 返回的 `unknown` 没法塞进 `AgentResult.success.artifact: unknown`（type assertion 满天飞），架构契约失去强制力。
- **Why major**: 不阻塞 stub 通过，但骨架"接口契约"的核心价值就是让 TS 编译器替你强制不变量；现在等于关掉了编译期检查。
- **Suggested fix**:
  - 选项 A（推荐）：在 0B 内补 `packages/shared/src/protocol.ts` 加 `Intent` / `Artifact` / `SessionId` 导出（FRAMEWORK §8 已有 schema），然后把 5 接口 import 切到 `@vessel/shared`。
  - 选项 B（spike 范围内）：在 `packages/backend/src/interfaces/index.ts` 顶层 re-export 一个本地 placeholder `export type Intent = unknown` 让两个文件共享同一符号，并标记 `// TODO 0B-7: replace with @vessel/shared.Intent`。
  - 在 `interfaces/agent.ts:19` 的 TODO 注释里写明 deadline ("0B-7 完成前必须切换") 并加进 0B acceptance checklist。

---

### MAJOR-2: `CapabilityApp` lifecycle 注释与 FRAMEWORK / ADR-007 描述不一致（install / enable / disable 缺接口方法）

- **File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/app.ts:7,18-35`
- **Issue**: 顶部注释写 lifecycle 为 `install() → boot() → enable() → ([disable() → enable()])* → uninstall()`，但接口本身只有 `boot()` / `uninstall()` / `health()` / `skills()` / `tools()`——`install` / `enable` / `disable` 都没有方法签名。这让 NFR-C1 "卸载彻底" + NFR-C3 "共享 worker TTS 回收"（理论上对应 disable）的接口落地点变得不可读：是 `boot()` 兼任 `install + enable`？是 `uninstall()` 兼任 `disable + uninstall`？还是 install/disable 在 0.1 不实现、留 v1+？
- **Why major**: 不是 BLOCKER 因为 0.1 个人单机用 boot/uninstall 二态可能就够了；但 lifecycle 注释跟接口签名不一致会直接误导 capability 实现者。FRAMEWORK §2.5 的注释也只写了 boot/uninstall/health/skills/tools 五个方法，跟接口对得上——是顶部 lifecycle 注释多嘴了。
- **Suggested fix**:
  - 选项 A（推荐，保接口最小）：把 `app.ts:7` 的 lifecycle 注释改成 `register (manifest discovery) → boot() → ([health()])* → uninstall()`，明确"install/enable/disable 在 v0.1 不暴露为接口方法，由 vessel-core 内部按 manifest 状态机实现"。
  - 选项 B（如果未来真要支持热禁用某个 capability）：在 0B 阶段补 `enable()/disable(): Promise<void>` 到接口（lifecycle 真八态）+ NFR-C3 acceptance 加测试。
  - 同步更新 ADR-007 / FRAMEWORK §2.5 与本接口注释保持一致。

---

### MAJOR-3: `CodingDriverArtifact` 与 `Artifact`（5 接口里 Skill 返回的）字段形状不一致，缺 adapter 边界

- **File**:
  - `/Users/yongqian/Desktop/Vessel/packages/backend/src/drivers/types.ts:41-47` (CodingDriverArtifact)
  - FRAMEWORK §8 ArtifactSchema discriminatedUnion (`type: 'file' | 'text' | 'binary' | 'reference'`)
- **Issue**: `CodingDriverArtifact` 形状是 `{ files: string[]; exitCode: number; stdoutPath?, stderrPath? }`——这是个**进程退出快照**，不是 5 接口里 `Artifact`（discriminated union with `type: file/text/...`）。M0.5 实施时 `CodingSkill` 必须把 `CodingDriverArtifact` **转**成 `Artifact[]`（一个 driver run 通常产生 N 个文件 + 1 个 stdout text），但当前两边接口都没暗示这个转换发生在哪、由谁负责。
- **Why major**: ADR-016 §2 例子里 `ClaudeCodeDriver.submit()` 直接返回 `CodingDriverArtifact`，但 `Skill.invoke()` 必须返回 `Artifact`（5 接口 schema）。这个 adapter 不存在的话，M0.5 实施时要么破坏 Skill.invoke 类型契约（返回 `CodingDriverArtifact`），要么写一段没经评审的 ad-hoc 转换。这正是 ADR-016 §「负面后果 ①」预警的"两条路径不一致"的早期征兆。
- **Suggested fix**:
  - 在 `drivers/types.ts` 顶部 doc comment 显式说明："`CodingDriverArtifact` 是 driver 内部协议，不是 5 接口的 `Artifact`；CodingSkill 负责把 `CodingDriverArtifact.files[]` 拍扁成 `Artifact[]`（每个 file 一个 `type: 'file'` artifact，stdoutPath 一个 `type: 'text'` artifact）"。
  - 0B-acceptance 加一条 "M0.5 实施时必须有 `coding-skill.adapter.ts` 单元测试覆盖该转换"。

---

### MINOR-1: `Memory` 接口三层 lifecycle 注释暧昧——`short` 是否跨进程持久化没说

- **File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/memory.ts:6,18,29`
- **Issue**: 注释说 short = "对话上下文，进程内 in-memory"，但 `ShortTermMemory.recent(sessionId, n?)` 接口语义看起来允许跨 session 查（按 sessionId 过滤）。M0 boot 后内核重启，short 是否清零？还是从 sessionKv 重建？这影响 NFR-O3 trace replay 行为。
- **Suggested fix**: 在 `memory.ts:18` 加注："short 跨进程**不**持久化；vessel-core 重启后 ShortTermMemory 为空。需要持久化的近期上下文请用 sessionKv。"

### MINOR-2: `VerifyAllowedPathFn` 类型导出位置错位

- **File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/tool.ts:54-56` + `interfaces/index.ts:15`
- **Issue**: `VerifyAllowedPathFn` 是一个 `permission middleware` 帮助函数签名，不属于 `Tool` 接口契约本身。它被 export 出 `interfaces/index.ts` 与 5 接口主类型混在一起，会让外部 import 误以为这是契约的一部分。
- **Suggested fix**: 把 `VerifyAllowedPathFn` 移到 `packages/backend/src/permission/types.ts`（M1B 创建该目录时），从 5 接口 export 中拿掉。`interfaces/index.ts:15` 删掉 `VerifyAllowedPathFn`。

### MINOR-3: ml-worker types 与 FRAMEWORK §4.2 签名差一处可选性

- **File**: `/Users/yongqian/Desktop/Vessel/packages/backend/src/ml-worker/types.ts:28-31, 44-47`
- **Issue**: `transcribeStream?` / `synthesizeStream?` 在 stub 里是**可选方法**（`?:`），FRAMEWORK §4.2 写的是必选（无 `?`）。stub 选 optional 更宽松，但意味着 M2-Voice 实现时可以"不实现 streaming"也通过 type check——而 Voice 低延迟需求基本上要求 streaming，optional 会让骨架失去强制力。
- **Suggested fix**: 跟 FRAMEWORK §4.2 对齐改成必选；或反过来在 FRAMEWORK §4.2 加注 "v0.1 streaming optional, M2-Voice 必落"。任选其一但两边一致。

---

## Positive observations

1. **5 接口契约存放约定严格执行（ADR-000 §2 / FRAMEWORK §1）**。`interfaces/index.ts:7-10` 注释明确警告 "Driver / ML Worker 不在 5 接口里"，并指向 `drivers/types.ts` + `ml-worker/types.ts`。这是个很容易随手破坏的不变量，stub 阶段就把守门约定写进 export 文件顶部注释，是高质量信号。

2. **CodingDriver 走 adapter 路径而非 octopus 重写（ADR-016 路径 C 严格落实）**。`drivers/types.ts:8` 明确写 "v0A.1 路径 C：cli-runner.ts 内部不动，新建 ClaudeCodeDriver adapter wrap"——0B 没有任何 cli-runner.ts 的修改（验证 `git diff cli-runner.ts` 行数 == 0），完全保住 Eva 已踩过的 5 集成挑战（非交互模式 / auth 复用 / stdout 解析 / 进程组终止 / 工作目录隔离）。

3. **三层 boot 重入语义在 FRAMEWORK §9 已写清（"改 soul.md 只触发 ②，新会话只触发 ③"）**，虽然 `boot.ts` 文件 0B 阶段还没创建，但 `bootProcess/bootInstance/bootSession` 三函数签名已经在 FRAMEWORK 里固定，M0 实施时直接照写即可。三层独立可重入是架构层硬需求，0B 在文档层先锁住是正确顺序。

4. **migrate-eva-to-vessel.ts 默认 dry-run + 不删源**（scripts/migrate-eva-to-vessel.ts:25, 173）—— ADR-013 §2 Stage 2 数据迁移的两条 owner 决议（不删源 + 显式 --apply）都在代码里执行了；脚本里 `EXCLUDE: ['eva.json']` 也跟 ADR-000 §3 排除清单对得上。

5. **startup-env-check.ts 实施 fail-loud 而非静默 fallback**（startup-env-check.ts:38-57）。pragmatist M-P1 / 0-pre E2 owner 决议要求"代码不留 CLAUDE_WEB_X || VESSEL_X fallback"，避免双名长期债务——这是个非常容易被新人"为了向后兼容"加回来的反模式，stub 实现就把检测 + exit(1) 写死，长期维护意图非常清晰。
