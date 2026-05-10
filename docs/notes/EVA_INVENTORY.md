# Eva Inventory（盘点）

> **Status**: v0-pre · 2026-05-09 · 覆盖 M0–M1C 路径上的核心模块（按 v5.4 P3 仲裁 B-P2 收缩，不强求全 src）
>
> **Source**: `/Users/yongqian/Desktop/claude-web` (codename: Eva, formerly claude-web)
>
> **Companion**: [`docs/design/EVA_TO_VESSEL_MAPPING.md`](../design/EVA_TO_VESSEL_MAPPING.md) — 每个模块的 Vessel 改造动作

---

## 1. 仓库结构 + 测试基础

### 1.1 Monorepo 拓扑

```
claude-web/
├── packages/
│   ├── backend/          # Hono HTTP + ws WebSocket（核心，~5400 行 TS）
│   ├── frontend/         # React + Vite + Zustand
│   ├── shared/           # Zod 协议 + DTOs（跨 TS/Swift/SQLite 单源）
│   └── ios-native/       # SwiftUI（59 Swift 文件 / 14,537 行）
├── scripts/              # eva-status / eva-hook / run-debate-phase 等
└── docs/                 # 11 ADR + HARNESS_* + retrospectives
```

包管理：**pnpm 9.0.0** workspace。

### 1.2 测试基础（v5.1 P3 / R-07 已定 "无框架标 unknown" 策略）

| 包 | 框架 | 命名 | Coverage 报告 |
|---|---|---|---|
| backend | `tsx --test`（Node native test runner） | `test-*.ts`（不是 `*.test.ts`） | ❌ unknown — Eva root 无 `test:coverage` script |
| shared | `tsx --test` | `*.test.ts`（在 `__tests__/`） | ❌ unknown |
| frontend | 无 | — | ❌ unknown |
| ios-native | XCTest + XCUITest | `*Tests.swift` | ❌ unknown — 仅协议 fixture + UI 抽样测试 |

Root scripts: `pnpm test:cli`（backend CLI 测）/ `pnpm test:protocol`（shared 协议测）。

**改造策略**（按 R-07 缓解策略）：
- 即将重构的核心模块（cli-runner / scheduler / permission）—— 重构前补 **characterization tests / golden tests**
- 暂时不动模块（inbox / notifications / iOS heartbeat / 等）—— 冻结接受，标 `coverage: unknown` 进 RISKS

---

## 2. Backend 核心模块（17 个，~5400 行）

> 按 M0–M1C 阶段分组。每条字段：路径 / 行数 / 职责 / 副作用 / 调用方 / 测试 / 改造估计。

### 2.1 M0 入口（process boot）

#### `packages/backend/src/index.ts`（507 行）

- **职责**：进程入口；Hono HTTP server + ws WebSocket upgrade + harness DB init + router 挂载
- **副作用**：监听 PORT/HOST；env 检查（CLAUDE_WEB_TOKEN / CLAUDE_WEB_ALLOWED_ROOTS）；ws upgrade；config watcher 启动
- **关键调用方**：进程启动脚本（`tsx src/index.ts` 或 `pnpm dev:backend`）
- **测试**：❌ 无
- **改造估计**：**+100–200 行**（高风险，Vessel 三层 boot：进程级 / Instance / Session 重构）—— 见 EVA_TO_VESSEL_MAPPING M0 §boot

### 2.2 M0.5 Coding Driver

#### `packages/backend/src/cli-runner.ts`（231 行）

- **职责**：spawn `claude` CLI；流式管理 JSON 行输出；处理 5 集成挑战（非交互 `--print` / hook auth via Bearer / stream-json stdout / 进程组 SIGTERM 5s / artifact 隔离 via `cwd`）
- **关键 export**：`interface RunSessionParams` + `async function runSession(p: RunSessionParams): Promise<void>`
- **副作用**：spawn 子进程；onMessage 回调；AbortSignal 监听
- **关键调用方**：`scheduler.ts`（spawnAgent 注入 runSessionFn）/ `index.ts`（WS handler）
- **测试**：✅ test-cli.ts / test-e2e.ts / test-stale-session.ts
- **架构债务**：STALE_SESSION_RE + TOO_LONG_RE 故障恢复是临时；KILL_GRACE_MS=5s 硬编码
- **改造估计**：**+30–50 行**（低风险，B-P1 决议：façade 不动内部）—— 见 ADR-016

### 2.3 M1A 多入口

#### `packages/backend/src/index.ts`（同上 §2.1）+ Hono routers

- WS upgrade handler 在 index.ts L294+
- `routes/sessions.ts`（session jsonl）
- `routes/projects.ts`（多项目状态）
- 改造估计：M1A 沿用，几乎零改

### 2.4 M1B 权限 + 认证

#### `packages/backend/src/auth.ts`（139 行）

- **职责**：Bearer token 验证；path allowlist（CLAUDE_WEB_ALLOWED_ROOTS）；WS upgrade auth；constant-time token 对比
- **关键 export**：`isAuthEnabled()` / `authMiddleware` / `verifyAllowedPath(absPath)` / `extractTokenFromRequest()`
- **副作用**：env 读取；warn log
- **关键调用方**：`index.ts`（全局 middleware）/ `cli-runner.ts`（cwd 守卫）
- **测试**：✅ test-auth.ts
- **改造估计**：**+20–40 行**（M1B 加 MCP scope schema）

#### `packages/backend/src/routes/permission.ts`（~90 行）+ `scripts/permission-hook.mjs`（73 行）

- **职责**：claude CLI PreToolUse hook；后端 registry/resolve；WS 推权限请求 + 收决策
- **关键 export**（routes）：`registerPermissionChannel(token, send)` / `resolvePermission(token, requestId, decision)` / `permissionRouter`
- **架构债务**：PENDING_TIMEOUT_MS=590s 硬编码（钉死 hook 600s）；fail-open 策略
- **测试**：✅ test-permission.ts
- **改造估计**：**+20–40 行**（routes，加 MCP scope）+ **+15–25 行**（hook，签名兼容）

### 2.5 M1C-A Workflow Engine

#### `packages/backend/src/scheduler.ts`（439 行）

- **职责**：Issue 状态机；Stage 序列编排（strategy → implement → done）；orphan stage 清理；agent spawn
- **关键 export**：`type RunSessionFn`（可注入）/ `class EvaScheduler` { initialize / tick / spawnAgent / computeNextStage }
- **副作用**：DB 事务（stage status / artifact / context bundle）；WS broadcast；fire-and-forget spawn
- **架构债务**：`STAGE_SEQUENCE` 硬编码两段；failed → blocked，无 retry policy；`computeNextStage` "blocked" 需 operator resolve
- **测试**：✅ test-scheduler-orphan-cleanup.ts / test-scheduler-failed-reasons.ts / test-e2e-pipeline.ts
- **改造估计**：**+80–150 行**（中风险，加 Workflow HITL 持久化 + resume）

#### `packages/backend/src/harness-store.ts`（201 行）

- **职责**：open `~/.claude-web/harness.db`；运行 migrations；schema_migrations 表；PRAGMA WAL + FK on
- **关键 export**：`interface HarnessDb` / `function openHarnessDb(opts)`
- **架构债务**：v0.4.5 引入 MIGRATION_MODE（FK off rebuild）；HARNESS_SCHEMA_VERSION=102 硬编码常量；无 rollback
- **测试**：✅ test-harness-schema.ts
- **改造估计**：**+10–30 行**（migration 新增）

#### `packages/backend/src/harness-queries.ts`（616 行）

- **职责**：13 entity CRUD（initiative / issue / stage / task / context_bundle / run / artifact / decision / retrospective / methodology / idea_capture / harness_project / review_verdict）；audit 日志（JSONL append）
- **架构债务**：audit fire-and-forget appendFile（无 batch）；`ContextBundleRow` 与 `Task` 字段冗余
- **测试**：✅ test-harness-schema.ts
- **改造估计**：**+100–200 行**（中风险，Workflow 节点持久化 + resume 字段）

#### `packages/backend/src/routes/harness.ts`（~200 行）

- **职责**：scheduler/tick endpoint；initiative/issue/stage/decision CRUD REST API
- **架构债务**：所有 endpoint 返回 `{ok, data/error}` 但无统一错误分类；POST /scheduler/tick 无 lock
- **测试**：✅ test-e2e-pipeline.ts
- **改造估计**：**+50–80 行**（加 /workflow/resume endpoint）

### 2.6 M1B/M1C 辅助

#### `packages/backend/src/context-manager.ts`（419 行）

- **职责**：build context bundle（issue + artifact → markdown snapshot）；char budget allocation
- **架构债务**：TOTAL_CHAR_BUDGET=16000 硬编码；STAGE_SELECTORS 极简；线性扫描（无 RAG/index）
- **改造估计**：**+80–150 行**（高风险，Vessel context protocol 适配）

#### `packages/backend/src/run-registry.ts`（48 行）

- **职责**：全局 run Map（register/unregister/get/interrupt/listActive）；HTTP 路由可中断 run
- **改造估计**：**+15 行**（与 Workflow Engine 整合）

### 2.7 M2+ Capability 雏形（先冻结，M2 阶段重构）

| 模块 | 路径 | 行数 | 职责 | 改造估计 |
|---|---|---|---|---|
| inbox routes | `routes/inbox.ts` | ~100 | /api/inbox CRUD + triage | +30–50 |
| inbox-store | `src/inbox-store.ts` | 221 | JSONL append-only；O(N) 重写 triage | +50–100（迁 harness.db） |
| notifications hub | `notifications/index.ts + hub.ts` | ~150 | publishSessionCompletion / publishTaskNotification / publishPermissionPending | +100–150 |
| Server酱 channel | `notifications/channels/serverchan.ts` | ~50 | POST 推送 | +20 |
| Telegram channel | `notifications/channels/telegram.ts` | ~50 | POST 推送 | +20 |
| voice routes | `routes/voice.ts` | 656 | transcribe / tts / cleanup（spawn whisper-cli + edge-tts + claude） | +100–200（走 ML worker） |
| heartbeat | `src/heartbeat.ts` | 78 | spawn / completion 时间戳；snapshot | +20–40 |
| telemetry-store | `src/telemetry-store.ts` | 81 | append-only JSONL；rotation 10MB | +30–60（OpenTelemetry-lite 12 字段对齐） |

---

## 3. Shared Protocol（packages/shared/）

### 3.1 `protocol.ts` — Wire Protocol（Hono HTTP/WS 跨端协议）

**ClientMessage discriminated union（7 kinds）**：
- `user_prompt` / `permission_reply` / `interrupt` / `fs_subscribe` / `fs_unsubscribe` / `session_subscribe` / `session_unsubscribe`

**ServerMessage discriminated union（8 kinds）**：
- `sdk_message` / `permission_request` / `error` / `clear_run_messages` / `session_ended` / `fs_changed` / `session_event` / `harness_event`

**HarnessEvent kinds（10 values 内嵌于 ServerMessage）**：
- `config_changed` / `stage_changed` / `task_started` / `decision_requested` / `run_appended` / `review_complete` / `stage_started` / `stage_message` / `stage_done` / `stage_failed`

**Model & Permission**：
- `ModelId` = `"claude-opus-4-7" | "claude-sonnet-4-6" | "claude-haiku-4-5"`
- `PermissionMode` = `"default" | "acceptEdits" | "bypassPermissions" | "plan"`

**已存在 / 缺失（给 Vessel）**：
- ✅ 复用：ClientMessage / ServerMessage / ModelId / PermissionMode / ImageAttachment
- 🌟 **缺失（必须加）**：`Intent` / `Session`（DTO，跨端共享） / `Artifact`（运行时） / `TraceEvent`（OpenTelemetry-lite 12 字段） / `SoulSpec`（M2-Soul） / `AppManifest`（Capability） / `CapabilityManifest`

### 3.2 `harness-protocol.ts` — Workflow / Stage / Initiative DTOs

**Version**：`HARNESS_PROTOCOL_VERSION = "1.2"` / `MIN_CLIENT_VERSION = "1.0"`

**15 个枚举（按字母）**：
- `ArtifactKind`（14 值）：methodology / spec / design_doc / architecture_doc / adr / patch / pr_url / test_report / coverage_report / review_notes / review_verdict / decision_note / metric_snapshot / retrospective / changelog_entry
- `ArtifactStorage`（2 值）：inline / file
- `AuditOp`（4 值）：insert / update / delete / migrate
- `IdeaCaptureSource`（3 值）：voice / text / web
- `InitiativeStatus`（4 值）：draft / active / paused / done
- `IssuePriority`（4 值）：low / normal / high / critical
- `IssueSource`（6 值）：ideas_md / user_feedback / git_log / telemetry / inbox / manual
- `IssueStatus`（7 值）：inbox / triaged / planned / in_progress / blocked / done / wont_fix
- `MethodologyAppliesTo`（3 值）：claude-web / enterprise-admin / universal
- `PermissionModeId`（4 值，与 protocol.ts sync）：default / acceptEdits / bypassPermissions / plan
- `StageKind`（10 值）：strategy / discovery / spec / compliance / design / implement / test / review / release / observe
- `StageStatus`（8 值）：pending / dispatched / running / awaiting_review / approved / rejected / skipped / failed
- `StageWeight`（3 值）：heavy / light / checklist
- `TaskModel`（3 值）：opus / sonnet / haiku
- `TaskStatus`（5 值）：pending / running / completed / failed / cancelled

**13 业务实体 DTO**（精简版，全字段见 source）：
1. `ProjectDto`：id / cwd / name / defaultBranch / worktreeRoot / harnessEnabled / createdAt
2. `InitiativeDto`：id / projectId / title / intent / kpis / status / ownerHuman / methodologyVersion / created+updated
3. `IssueDto`：id / projectId / initiativeId? / source / title / body / labels / priority / status / retrospectiveId? / created+updated
4. `IdeaCaptureDto`：id / projectId? / body / audioPath? / transcript? / source / capturedAt / processedIntoIssueId?
5. `StageDto`：id / issueId / kind / status / weight / gateRequired / assignedAgentProfile / methodologyId / inputArtifactIds / outputArtifactIds / reviewVerdictIds / startedAt? / endedAt? / createdAt / **failedReason?**（v102） / **failedAt?**（v102）
6. `MethodologyDto`：id / stageKind / version / appliesTo / contentRef / approvedBy / approvedAt
7. `TaskDto`：id / stageId / agentProfileId / model / cwd / worktreePath? / prompt / skillSet / permissionMode / contextBundleId / runIds / status / created+updated
8. `ContextBundleDto`：id / taskId / artifactRefs / maxTokens / prunedFiles / summary / snapshotPath / createdAt
9. `RunDto`：id / taskId / sessionId? / exitCode? / model / tokensIn? / tokensOut? / cost? / transcriptPath / startedAt / endedAt?
10. `ArtifactDto`：id / stageId / kind / ref? / hash（sha256:64hex） / storage / contentText? OR contentPath? / sizeBytes / metadata / supersededBy? / createdAt（CHECK 互斥）
11. `ReviewVerdictDto`：id / stageId / reviewerProfileId / model / score（0..5） / dimensions / notes / agreesWithPrior? / createdAt
12. `DecisionDto`：id / stageId / requestedBy / options / chosenOption? / decidedBy? / rationale? / decidedAt? / createdAt
13. `RetrospectiveDto`：id / issueId / whatWentWell / whatToImprove / methodologyFeedback / costSummary / createdBy / createdAt

**Audit & Events**：`AuditLogEntrySchema`（ts/actor/op/table/id/before/after/rationale）/ `HarnessEventSchema`（discriminated union）

**Server-driven Config（HarnessConfigSchema v1.2）**：`protocolVersion` / `minClientVersion` / `etag` / `modelList` / `permissionModes`（v1.1+） / `agentProfiles`（v1.2+）

### 3.3 其他 shared 文件

- `eva-config.ts`（worktree orchestration） — Eva 业务相关，**Vessel 不复用**
- `model-registry.ts`（MODEL_HINTS / MODEL_ID_BY_HINT / MODEL_DISPLAY_NAME_BY_ID） — 复用 + 扩展
- `version.ts`（`compareVersion(a, b)`） — **直接复用**（通用 semver）
- `canonical-json.ts`（`canonicalize` / `computeEtag`） — **直接复用**

### 3.4 Test Coverage（shared）

- `__tests__/protocol.test.ts`（23 protocol fixtures）
- `__tests__/harness-protocol.test.ts`（18 DTO fixtures）
- `__tests__/eva-config.test.ts`
- `__tests__/m0-permission-modes.test.ts`
- `__tests__/m0-agent-profiles.test.ts`
- `__tests__/model-registry.test.ts`（fixture drift lock）

---

## 4. iOS 端（packages/ios-native/）

### 4.1 完整 iOS 配置（ADR-013 改名 strategy 依据）

| 项 | 当前值 | 位置 |
|---|---|---|
| **CFBundleDisplayName** | `Seaidea` | `Sources/ClaudeWeb/Info.plist` line 8 |
| **CFBundleIdentifier** | `$(PRODUCT_BUNDLE_IDENTIFIER)` → `com.albertsun6.claudeweb-native` | `Info.plist` line 12 + `ClaudeWeb.xcodeproj/project.pbxproj` 多处 |
| **DEVELOPMENT_TEAM** | `V84XLAQ28F` | `project.pbxproj` |
| **NSLocalNetworkUsageDescription** | "Seaidea connects to your Mac running the backend on the local network." | `Info.plist` line 29 |
| **NSMicrophoneUsageDescription** | "Seaidea needs your microphone for voice input." | `Info.plist` line 31 |
| **UIBackgroundModes** | ["audio"] | `Info.plist` line 34 |
| **NSAppTransportSecurity** | `NSAllowsLocalNetworking = true` | `Info.plist` line 26 |
| **UISupportedInterfaceOrientations** | Portrait only | `Info.plist` line 43 |
| Test target | `com.albertsun6.claudeweb-native.tests` | `project.pbxproj` |
| UITest target | `com.albertsun6.claudeweb-native.uitests` | `project.pbxproj` |
| App struct name | `struct ClaudeWebApp: App` | `Sources/ClaudeWeb/ClaudeWebApp.swift` line 10 |
| Cache bundle ID fallback | `"com.albertsun6.claudeweb-native"` | `Cache.swift` line 40 |
| Xcode scheme | `ClaudeWeb` | `*.xcodeproj` UI |

### 4.2 核心 Swift 文件（M0–M2-iOS 路径）

| 文件 | 行数 | 职责 |
|---|---|---|
| `ClaudeWebApp.swift` | 294 | App 入口；Settings/Cache/Registry/Telemetry 绑定 |
| `BackendClient.swift` | 689 | WS + 多会话路由 + RunRouter；watchdog 8min；@MainActor @Observable |
| `ProjectRegistry.swift` | 302 | 项目元数据协调（server/cache/in-memory）；offline fallback |
| `Cache.swift` | 217 | Application Support JSON 缓存 LRU 50（projects/conversations/sessions/harness-config） |
| `InboxAPI.swift` | 147 | /api/inbox CRUD（capture/list/markProcessed/triage）；source="ios" |
| `VoiceRecorder.swift` | 150+ | PTT 录音（AVAudioRecorder → m4a，16k AAC）；state machine |
| `HeartbeatMonitor.swift` | 100+ | /api/health/heartbeat 5s polling；status enum |
| `HarnessProtocol.swift` | 100+ | TS harness-protocol.ts 镜像（Swift Codable） |
| `HarnessAPI.swift` | 80+ | /api/harness CRUD 薄客户端 |
| `HarnessStore.swift` | 80+ | 服务驱动 harness config；优先级 cache→Bundle fallback→server fetch + etag 304 |
| `PermissionSheet.swift` | 57 | 权限确认弹窗；autoAllowThisTurn toggle |
| `InboxCaptureSheet.swift` | 60+ | 30s Idea 捕捉表单；voice+text 混合 |
| `MacHeartbeatRow.swift` | 50+ | 心跳 UI |
| `TTSPlayer.swift` | 50+ | AVPlayer TTS 播放控制 |
| `Telemetry.swift` | 50+ | log() / warn() / error()；conversationId/runId context |
| `RecordingHUD.swift` / `HarnessBoardView.swift` / `SettingsView.swift` / `HealthCheckView.swift` / 等 | 各 50–200 | UI 视图 |

**总计**：59 Swift 文件 / 14,537 行

### 4.3 服务发现 + 网络

- **当前**：硬编码或手填 IP（Settings.swift `backendURL`），**无 mDNS / NWBrowser**
- **协议**：`ws://<backendURL>/api/ws?token=<authToken>` + `http://<backendURL>/api/<path>`
- **端口**：3030（dev/test 约定）
- **TLS**：`NSAllowsLocalNetworking = true`（明文 http 允许）

### 4.4 测试

- `ClaudeWebTests/ProtocolFixtureTests.swift`（XCTest，~50 行，protocol fixture decode）
- `ClaudeWebUITests/HarnessBoardUITests.swift`（XCUITest，~50 行，看板 E2E drill-down）
- 框架：XCTest + XCUITest（无第三方）
- Coverage：**unknown**（无 xcodebuild test --enableCodeCoverage 报告）

### 4.5 资源

- `Assets.xcassets`（icon + colors，未深读）
- `UILaunchScreen` dict（Info.plist line 36–40，仅 UIColorName 空值）
- `fallback-config.json`（Bundle 内，xcodegen 复制自 `packages/shared/fixtures/harness/`）

---

## 5. 数据库 Schema（harness.db）

### 5.1 Migration 文件（`packages/backend/src/migrations/`）

| 文件 | 行数 | TARGET_VERSION | 关键变化 |
|---|---|---|---|
| `0001_initial.sql` | 310 | 100 | 13 表初建 + FTS5 + PRAGMA WAL/FK |
| `0002_stage_status_dispatched.sql` | 90 | 101 | stage.status 加 'dispatched'（schema-rebuild mode：FK OFF→DROP→INSERT→RENAME） |
| `0003_stage_failed_reason.sql` | 27 | 102 | stage 加 `failed_reason` / `failed_at`（nullable，O(1) ADD COLUMN） |

**PRAGMA**：`foreign_keys = ON` / `journal_mode = WAL`

**当前 schema_version**：**102**（v1.2）

### 5.2 13 核心表（精简 DDL）

| 表 | 主键 | 关键字段 + CHECK | 索引 |
|---|---|---|---|
| `harness_project` | id | cwd UNIQUE / harness_enabled (0,1) | — |
| `initiative` | id | status (draft/active/paused/done) / FK project | idx_initiative_project(project_id, status) |
| `issue` | id | source (6 值) / priority (4 值) / status (7 值) / FK initiative? + retrospective? | idx_issue_project_status / idx_issue_initiative + **FTS5 issue_fts(title,body)** |
| `stage` | id | kind (10 值) / status (8 值) / weight (3 值) / gate_required (0,1) / failed_reason / failed_at | idx_stage_issue_kind / idx_stage_running (status='running') / **UNIQUE(issue_id, kind)** |
| `task` | id | model (opus/sonnet/haiku) / status (5 值) / FK stage + context_bundle | idx_task_stage |
| `context_bundle` | id | task_id（无 FK 反指——环依赖应用层 enforce） | — |
| `run` | id | exit_code? / tokens_in? / cost? / FK task | idx_run_task / idx_run_session WHERE NOT NULL |
| `artifact` | id | kind (14 值) / storage (inline/file) / hash (sha256:64hex) / **CHECK(inline⟺content_text + storage⟺content_path)** / supersededBy 自引用 | idx_artifact_stage(stage_id, kind) / idx_artifact_hash + **FTS5 artifact_fts(content_text)**（仅 inline） |
| `review_verdict` | id | score 0..5 / dimensions_json | idx_verdict_stage |
| `decision` | id | options_json / chosen_option? | idx_decision_pending WHERE chosen_option IS NULL |
| `retrospective` | id | what_went_well / what_to_improve / cost_summary_json | idx_retrospective_issue |
| `methodology` | id | stage_kind / version / applies_to (3 值) / **UNIQUE(stage_kind, version)** | idx_methodology_stage(stage_kind, version DESC) |
| `idea_capture` | id | source (voice/text/web) / processedIntoIssueId? | idx_idea_unprocessed WHERE NOT NULL |

### 5.3 FTS5 + Triggers

- `issue_fts`（contentless）+ trigger: ai/ad/au（每个 INSERT/DELETE/UPDATE）
- `artifact_fts`（仅 inline）+ trigger: ai/ad/au with `WHEN content_text IS NOT NULL` guard

---

## 6. Eva 已知架构债务（v0-pre 必须显式登记）

### 6.1 backend

| 模块 | 债务 | 风险 |
|---|---|---|
| `index.ts` | boot ordering 复杂（router 挂载在 router build 后；config watcher 启动顺序） | 中 |
| `cli-runner.ts` | STALE_SESSION_RE / TOO_LONG_RE 临时方案；KILL_GRACE_MS 硬编码 | 中 |
| `scheduler.ts` | STAGE_SEQUENCE 硬编码两段；failed→blocked 无 retry；computeNextStage "blocked" 需手动 resolve | 高（M1C-A 必处理） |
| `harness-store.ts` | HARNESS_SCHEMA_VERSION=102 硬编码常量；MIGRATION_MODE FK off rebuild；无 rollback | 中 |
| `harness-queries.ts` | audit JSONL appendFile 无 batch（10k+ 卡） | 中 |
| `routes/permission.ts` | PENDING_TIMEOUT_MS=590s 钉死 hook 600s | 中 |
| `routes/voice.ts` | WHISPER_TAIL_HALLUCINATIONS 硬编码后缀；EDGE_TTS_VOICE 写死 | 低 |
| `inbox-store.ts` | JSONL O(N) 全文件重写 triage（10k+ 卡） | 低 |
| `notifications/*` | per-run cooldown 60s 硬编码；no-op hub 用对象字面量 | 低 |
| `context-manager.ts` | TOTAL_CHAR_BUDGET=16000 硬编码；线性扫描；无 RAG | 高（M1C-B 影响） |
| `telemetry-store.ts` | rotation 仅保留 .1；MAX_SIZE 10MB 硬编码；OpenTelemetry-lite 12 字段差距 | 中（M0 必对齐） |

### 6.2 ios-native

- 无 mDNS / NWBrowser（M2-iOS 必加 Network.framework）
- 服务发现仅 Settings `backendURL` 手填（M2-iOS UI 必加 fallback）
- ClaudeWebApp 命名 / Bundle ID / Display Name 全 Eva-specific（M2-iOS 改名）

### 6.3 shared

- `eva-config.ts`（worktree orchestration） Eva 业务，**Vessel 不复用** —— 排除
- `harness-protocol.ts` 13 entity DTOs 直接复用度高，但 `IssueStatus.wont_fix` / `MethodologyAppliesTo.claude-web` Eva-specific 需重命名

### 6.4 Capacitor 残留

- `packages/frontend/ios/`（标 DEPRECATED.md）—— **明确不复用**（CLAUDE.md L28-30）
- `packages/frontend/android/` 同上

---

## 7. 关键调用链（改造影响范围）

### 7.1 cli-runner 调用链

```
WS upgrade (index.ts)
  → routes/runs (新建 run)
    → cli-runner.runSession(params)
      → spawn claude CLI subprocess
        → permission-hook.mjs callback to /api/permission/ask
          → registerPermissionChannel via WS
```

改造影响：cli-runner.ts 不动 + 新建 `drivers/coding/claude-code.ts` adapter（ADR-016 C 路径）

### 7.2 scheduler tick 调用链

```
POST /api/harness/scheduler/tick
  → scheduler.tick(projectId?)
    → harness-queries.listIssues({status: in_progress|planned})
    → for each: scheduler.computeNextStage(stages)
      → if stage to spawn: scheduler.spawnAgent(issue, stage, taskId, cwd)
        → context-manager.buildContextBundle()  
        → harness-queries.createTask + createContextBundle
        → cli-runner.runSession (fire-and-forget)
        → on completion: harness-queries.setStageStatus + broadcast
```

改造影响（M1C-A）：scheduler 加 HITL 持久化字段 + resume API

### 7.3 iOS → backend 调用链

```
iOS ClaudeWebApp.swift
  → BackendClient.swift WS connect (with token)
    → backend index.ts WS upgrade handler
  → BackendClient HTTP requests
    → backend Hono routers
  → HeartbeatMonitor 5s poll → /api/health/heartbeat
```

改造影响（M2-iOS）：
- 加 NWBrowser 自动发现（Bonjour `_vessel._tcp`）
- 手填 IP fallback UI
- Bundle ID 改名 → Cache 自动迁移到新 bundleIdentifier path

---

## 8. Coverage 报告 / 风险登记

按 R-07 缓解策略分两类：

### 8.1 即将重构核心模块（重构前补 characterization tests）

- `cli-runner.ts`（M0.5）— 已有 test-cli/test-e2e/test-stale-session ✅
- `scheduler.ts`（M1C-A）— 已有 test-scheduler-orphan/failed-reasons/e2e-pipeline ✅
- `auth.ts`（M1B）— 已有 test-auth ✅
- `routes/permission.ts`（M1B）— 已有 test-permission ✅
- `harness-store.ts`（M1C-A）— 已有 test-harness-schema ✅

→ 全部已有 characterization tests，可放心改造。

### 8.2 暂时不动模块（冻结接受，标 unknown）

- frontend/*（不在 M0–M1C 路径）— **coverage: unknown** → R-07
- ios-native（59 文件，仅 protocol fixture + UI 抽样测试）— **coverage: unknown** → R-07
- inbox-store / notifications / heartbeat / voice / telemetry-store / run-registry / context-manager — **coverage: partial-or-unknown** → R-07

---

## 9. 总结

**Eva 现状**（M0–M1C 范围）：
- 17 个 backend 核心模块（~5400 LOC TS）
- 14 类 Zod schema + 13 entity DTOs（packages/shared）
- 13 表 SQLite v102 schema（FTS5 + WAL + FK）
- 59 Swift 文件 / 14,537 行 iOS（XCTest 抽样）
- 11 ADR + retrospective + HARNESS_INDEX 完整设计文档库

**Vessel 改造影响范围估计**：**+820–1600 LOC**（高风险点：index.ts boot / context-manager / scheduler）

**关键事实供 EVA_TO_VESSEL_MAPPING 使用**：
- ADR-016 C 路径：cli-runner.ts 内部 git diff ≤ 5 行（不动）
- M1C-A：scheduler 加 HITL 持久化（关键风险点）
- M2-Soul：cli-runner 加 systemPromptPrefix 注入点（ADR-004）
- M2-iOS：Bundle ID 改名 6-7 处 + NWBrowser 自动发现 + 手填 IP fallback
- 0B：schema migration 0004（新增字段）+ Eva → Vessel 数据迁移脚本（不 drop）
