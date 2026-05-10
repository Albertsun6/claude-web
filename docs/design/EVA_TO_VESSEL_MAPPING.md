# Eva → Vessel Mapping（适配层映射）

> **Status**: v0-pre · 2026-05-09 · 基于 [`EVA_INVENTORY.md`](../notes/EVA_INVENTORY.md)
>
> **目的**：为每个 Eva 核心模块定义 Vessel 改造动作 + 落到哪个 milestone + 风险等级。**这是 D' 路线（Eva 原地演进 + Vessel 适配层）的核心产物**。

---

## 0. 改造原则（Vessel 优先复用）

按工程方法论原则 #8（Reuse before rewrite）+ ADR-016 C 路径：

| 原则 | 应用 |
|---|---|
| Eva 优先复用 | 任何 Vessel 概念落地前先查本表；能复用就**重构而非重写** |
| 接口先行 | M0–M1C 的接口契约（Driver / Skill / Agent / Tool / Memory / App）在 0A FRAMEWORK 锁定，Eva 模块按接口契约 wrap，不强求重构内部 |
| Eva 内部不动 | cli-runner.ts / scheduler.ts 等已踩坑模块内部 git diff 受限（cli-runner ≤ 5 行；scheduler 仅加 HITL 持久化字段） |
| Capacitor 排除 | `packages/frontend/ios/` / `packages/frontend/android/` 完全不复用 |
| Eva-specific 排除 | `eva-config.ts`（worktree orchestration）/ Eva 业务文案 / UI 视觉皮肤 不复用 |

---

## 1. 完整映射表（17 核心模块 + iOS + shared）

### 1.1 Backend 核心（M0–M1C 路径）

| # | Eva 模块 | Eva 路径 | Vessel 概念 | 重构动作 | 落到 milestone | 改造估计（LOC）| 风险 |
|---|---|---|---|---|---|---|---|
| 1 | `index.ts` | `packages/backend/src/index.ts` | **进程入口 + 三层 boot** | **拆三层 boot 函数完整骨架**（v0-pre 修订，architect B-A1）：① 进程级 `bootProcess()` = 加载内核服务 / 注册 Drivers / 加载 Capability —— **M0**；② Instance 级 `bootInstance()` = 加载 Instance 名（M0 默认 `"vessel-core"`）/ 初始化 Memory / 报 ready —— **M0 加最小骨架**（空 Instance 模式）+ **M2-Soul 扩展**（加 soul.md 解析 + 注入）；③ Session 级 `bootSession()` = 创建 session_id / 拉相关 Memory / 创建 trace span —— **M0 加骨架**（M1C+ 加 Memory 检索）；Vessel router 挂载（含 `/api/intent` Orchestrator endpoint） | M0（拆三层完整骨架）→ M2-Soul（Instance 级补 soul.md） | +100–200 | **高** |
| 2 | `cli-runner.ts` | `packages/backend/src/cli-runner.ts` | **Coding Driver**（ADR-016 C 路径） | 新建 `drivers/coding/claude-code.ts` adapter；implement `CodingDriver` interface（`submit / cancel / health`）；**cli-runner.ts 内部 git diff ≤ 5 行**（仅必要的 import / 类型导出） | M0.5 | +30–50 | **低** |
| 3 | `auth.ts` | `packages/backend/src/auth.ts` | **Permission 边界** | 沿用 + 加 Vessel-specific 路径白名单（`instance/workspace/<run_id>/`）；加 MCP scope schema | M1B | +20–40 | **低** |
| 4 | `routes/permission.ts` + `scripts/permission-hook.mjs` | 同 | **Permission 模块** | routes 加 MCP server 调用的 scope check；hook 签名兼容（保留 fail-open 但加 trace 日志） | M1B | +20–40 + +15–25 | **低** |
| 5 | `scheduler.ts` | `packages/backend/src/scheduler.ts` | **Workflow Engine（M1C-A）** | 新增字段：`workflow_state` 表（status='paused' 含序列化 stage state）；加 `workflow_resume(id)` API；保留 STAGE_SEQUENCE 但加 retry policy hook | M1C-A | +80–150 | **中** |
| 6 | `harness-store.ts` | 同 | **Memory 接口（KV + 长期）** | 加 migration 0004（schema_version=103）：`workflow_state` 表 + `embedding` 表（M1C-B 用，预留） | M1C-A（加 workflow_state） + M1C-B（加 embedding） | +10–30 | **低** |
| 7 | `harness-queries.ts` | 同 | **Memory 接口实现** | 加 Workflow 节点持久化 query（CRUD workflow_state）；加 Memory.search（M1C-B 时接 sqlite-vec） | M1C-A（节点）+ M1C-B（向量） | +100–200 | **中** |
| 8 | `routes/harness.ts` | 同 | **Workflow REST API** | 加 `POST /api/workflow/resume` endpoint；保留现有 CRUD | M1C-A | +50–80 | **低** |
| 9 | `context-manager.ts` | `packages/backend/src/context-manager.ts` | **Context Bundle / Memory 短期** | 沿用 + 加 trace_id 字段；TOTAL_CHAR_BUDGET 配置化（M1C-B 时 token-aware） | M1C-B | +80–150 | **高** |
| 10 | `run-registry.ts` | 同 | **Run / Workflow 状态共享** | 与 scheduler workflow_state 整合（统一 active run + paused workflow 视图） | M1C-A | +15 | **低** |

### 1.2 Backend M2+ Capability（先冻结，M2 阶段重构）

| # | Eva 模块 | Eva 路径 | Vessel 概念 | 重构动作 | 落到 milestone | 改造估计 | 风险 |
|---|---|---|---|---|---|---|---|
| 11 | `routes/inbox.ts` + `inbox-store.ts` | 同 | **Inbox Capability App** | 包成 Capability + Manifest（`packages/capability-inbox/manifest.yaml`）；保留 JSONL 但 v1+ 迁 harness.db | M2+（v0.1 不强求） | +30–50 + +50–100 | **低** |
| 12 | `notifications/index.ts + hub.ts + channels/*` | 同 | **Notification Capability App** | 包成 Capability + Manifest；channel 接口稳定（保留 ServerChan / Telegram） | M2+ | +100–150 | **中** |
| 13 | `routes/voice.ts` | 同 | **Voice Capability App + ML worker** | 包成 Capability + Manifest；spawn whisper-cli / edge-tts 走 ML worker（ADR-012）；保留 cleanup 流程 | M2-Voice | +100–200 | **中** |
| 14 | `heartbeat.ts` | 同 | **iOS-Mac 联通** | 沿用 + 加 mDNS Bonjour 服务发布（`_vessel._tcp.local.`）；snapshot 加 vessel-specific 字段 | M2-iOS | +20–40 | **低** |
| 15 | `telemetry-store.ts` | 同 | **Trace 协议（OpenTelemetry-lite）** | **in-place 重构**：当前字段（timestamp/level/event/conversationId/runId/props）扩展到 12 字段（trace_id / span_id / parent_span_id / event_type / component / session_id / status / duration_ms / payload[≤4KB] / artifact_refs / error）；新建 `observability/trace.ts` 作 client + 子进程环境变量传播协议（VESSEL_TRACE_ID / VESSEL_PARENT_SPAN_ID）；脱敏规则按 [`docs/design/trace-redaction-spec.md`](trace-redaction-spec.md) | 0A 设计 / M0 落 trace_id / M0.5 归档 CC CLI 输出 / M1A WS stream | +30–60 | **低** |

### 1.3 Shared Protocol（packages/shared/）

| # | Eva 文件 | Vessel 概念 | 复用 vs 扩展 vs 新增 | 落到 milestone | 改造估计 |
|---|---|---|---|---|---|
| 16 | `protocol.ts` | **Wire Protocol** | ✅ 复用（ClientMessage 7 kinds / ServerMessage 8 kinds 全保留）；🌟 **新增**：`intent` kind（ClientMessage） / `intent_response` kind（ServerMessage） / `trace_event` kind（ServerMessage）；扩展 HarnessEvent kinds（加 `workflow_paused` / `workflow_resumed` / `soul_loaded` / `capability_installed` / `capability_uninstalled`） | 0A 设计 / 增量落 | +100–150 |
| 17 | `harness-protocol.ts` | **Workflow / Stage / Initiative DTOs** | ✅ 大部分复用（13 entity DTOs / 15 enum）；⚠️ 重命名 `IssueStatus.wont_fix` → 保留（Vessel 也用）；⚠️ `MethodologyAppliesTo` 加 `vessel`（保留 claude-web/enterprise-admin 不删，避免 schema-rebuild）；🌟 **新增**：`SoulSpecSchema` / `AppManifestSchema` / `CapabilityManifestSchema` / `IntentSchema` | 0A 设计 / 增量落 | +200–300 |
| 18 | `eva-config.ts` | — | ❌ **不复用**（Eva 业务相关 worktree orchestration） | — | 0 |
| 19 | `model-registry.ts` | **Model 信息** | ✅ 复用（MODEL_HINTS / MODEL_ID_BY_HINT / 等）；🌟 v1+ 加 GPT / Gemini 模型 | M0+ | +20 |
| 20 | `version.ts` | **Semver 工具** | ✅ 直接复用 | M0+ | 0 |
| 21 | `canonical-json.ts` | **ETag 工具** | ✅ 直接复用 | M0+ | 0 |

### 1.4 iOS（packages/ios-native/）

| # | Eva 模块 | Eva 路径 | Vessel 概念 | 重构动作 | 落到 milestone | 改造估计 | 风险 |
|---|---|---|---|---|---|---|---|
| 22 | `BackendClient.swift` | 同 | **iOS WS Client** | 沿用 + 改 endpoint URL（vessel-core）+ 加 NWBrowser 服务发现 fallback；改名 `BackendClient` → 不改（通用名） | M2-iOS | +30–80 | 中 |
| 23 | `ProjectRegistry.swift` | 同 | **多 Instance / Project 注册** | 沿用 | M2-iOS | +0–30 | 低 |
| 24 | `Cache.swift` | 同 | **本地缓存** | 沿用（Bundle.bundleIdentifier 自动适配新 bundle ID） | M2-iOS | +0–10 | 低 |
| 25 | `InboxAPI.swift` + `InboxCaptureSheet.swift` + `InboxListView.swift` | 同 | **Inbox iOS** | 沿用（仅改 endpoint URL） | M2+ | +5–15 | 低 |
| 26 | `HarnessAPI.swift` + `HarnessProtocol.swift` + `HarnessStore.swift` + `HarnessBoardView.swift` | 同 | **Workflow iOS** | 沿用 + 加 workflow_resume UI；HarnessProtocol.swift 保持 Zod 镜像 | M1A+ / M2-iOS UI | +30–80 | 中 |
| 27 | `VoiceRecorder.swift` + `VoiceSession.swift` + `TTSPlayer.swift` + `RecordingHUD.swift` | 同 | **Voice iOS** | 沿用（ML 走 Mac 端 worker；iOS 仅录音上传 + 收音频流播放） | M2-iOS | +0–30 | 低 |
| 28 | `MacHeartbeatRow.swift` + `HeartbeatMonitor.swift` | 同 | **Heartbeat UI** | 沿用 + 加 Bonjour 状态显示 | M2-iOS | +20–50 | 低 |
| 29 | `PermissionSheet.swift` + `Telemetry.swift` + `HealthCheckView.swift` | 同 | **iOS UI 辅助** | 沿用 + 改 Telemetry endpoint URL | M2-iOS | +5–20 | 低 |
| 30 | `ClaudeWebApp.swift` | 同 | **App 入口** | **改名** `struct ClaudeWebApp` → `struct VesselApp`；改名是 ADR-013 范围 | M2-iOS | +5–10 | 低 |
| 31 | iOS 服务发现 | 无现有 | **Bonjour 自动发现** | **新建** `Sources/ClaudeWeb/ServiceDiscovery.swift`：Network.framework `NWBrowser` `_vessel._tcp` + 手填 IP fallback UI（M2-iOS Acceptance 要求） | M2-iOS | +80–150 | **中** |
| 32 | iOS 配置改名 | `Info.plist` + `project.pbxproj` | **Vessel 改名** | 按 ADR-013 改名 checklist：CFBundleDisplayName / PRODUCT_BUNDLE_IDENTIFIER / 权限描述 / Cache fallback / Xcode scheme | 0B（package.json 改名）/ M2-iOS（iOS 配置改名） | 配置层 | **中** |

### 1.5 SQLite Schema（migrations/）

| # | Eva 状态 | Vessel 改动 | 落到 milestone | 风险 |
|---|---|---|---|---|
| 33 | v102（13 表 / FTS5 / WAL + FK） | **v0-pre 修订（cursor M2 + risk-officer M-R3 + pragmatist m-P3）**：拆 4 个 migration 分别落各 milestone（**不**复用同一 v103，避免 schema 演进 bug）：<br>① `0004_workflow_state.sql`（schema_version=103）M1C-A：workflow_state 表（status='paused' / serialized_state JSON 按 trace-redaction-spec 脱敏 / paused_at）<br>② `0005_embedding.sql`（schema_version=104）M1C-B：embedding 表（向量列 + sqlite-vec ext）<br>③ `0006_soul_history.sql`（schema_version=105）M2-Soul：soul_history 表（soul.md 每次修订快照）<br>④ `0007_capability.sql`（schema_version=106）M2+：capability 表（已装 Capability App 注册） | 各 milestone | 中 |

**重要约束**（按 ADR-006 + ADR-014 硬触发 #8）：
- ✅ 全部新增字段是 nullable（O(1) ADD COLUMN）
- ❌ **不 drop column / drop table**（违反 4 类硬触发 #8）
- ✅ enum CHECK 扩展是向后兼容（`IssueStatus` 加值不破坏现有行）
- ❌ enum CHECK 收窄需 schema-rebuild（违反硬触发，避免）

---

## 2. Eva → Vessel 一次性数据迁移（0B 阶段，`scripts/migrate-eva-to-vessel.ts`）

### 2.1 数据迁移触发条件

仅在用户**首次跑 vessel-core**且检测到 Eva 老路径数据时触发：

```bash
# 自动检测顺序（vessel-core 启动时）
1. 检查 ~/.vessel/memory.db 是否存在 → 跳过迁移
2. 检查 ~/.claude-web/harness.db 是否存在 → 触发迁移
3. 跑 dry-run + 备份 → 用户确认 → 实迁
```

### 2.2 迁移操作（**全部非破坏性**）

| Eva 路径 | Vessel 路径 | 操作 |
|---|---|---|
| `~/.claude-web/harness.db` | `~/.vessel/memory.db` | **复制**（保留 Eva 原文件，不删） |
| `~/.claude-web/inbox.jsonl` | `~/.vessel/inbox.jsonl` | 复制 |
| `~/.claude-web/artifacts/` | `~/.vessel/artifacts/` | 复制 |
| `~/.claude-web/eva.json` | — | **不迁**（Eva worktree orchestration，不复用） |
| `~/.claude-web/projects.json` | `~/.vessel/projects.json` | 复制 |
| `~/.claude-web/telemetry.jsonl` | `~/.vessel/traces/telemetry-legacy.jsonl` | 复制 + rename |

**dry-run 模式**：`--dry-run` flag 仅检查 + 输出迁移计划，不实际改文件（0B Acceptance 必跑）。

### 2.3 迁移后 schema_version 升级

migration 0004（v103）在 vessel-core 首次启动时自动跑（按 ADR-006 schema 演进策略），不需要用户介入。

---

## 3. 总改造估计

按 milestone 分组：

| Milestone | 累计改造 LOC | 高风险点 |
|---|---|---|
| **0B**（建仓 + 改名 + 数据迁移）| +50–100 | 改名错漏 |
| **M0**（boot 三层 + Orchestrator + EchoSkill） | +200–300 | index.ts boot ordering（高风险） |
| **M0.5**（Coding Driver + Capability） | +50–80 | cli-runner adapter（按 ADR-016 受限） |
| **M1A**（HTTP/WS + Web 薄壳 + session 共享） | +50–100 | session 共享语义（沿用 Eva 多项目） |
| **M1B**（MCP + 权限边界）| +80–120 | MCP client 集成 |
| **M1C-A**（Workflow 挂起恢复） | +150–250 | scheduler workflow_state（中风险） |
| **M1C-B**（向量记忆 + ML worker） | +200–350 | context-manager 重构（高风险） + ML worker（中风险） |
| **M2-Soul**（soul.md 注入） | +50–100 | systemPromptPrefix 链路 |
| **M2-Voice**（Capability + ML worker） | +100–200 | voice routes 重构 |
| **M2-iOS**（Bundle ID 改名 + Bonjour + 手填 fallback） | +150–300 | iOS 改名（中风险）+ Bonjour 集成 |
| **总计** | **+1080–1900** | — |

**vs pragmatist B-P2 估计**（820–1600 LOC）：略高，因为我加了 iOS 改名 + 数据迁移 + protocol.ts 扩展。

---

## 4. 风险登记（feed 给 RISKS.md）

| 风险 | 影响范围 | 缓解 |
|---|---|---|
| `index.ts` boot ordering 改造引入回归 | M0 | 改造前补 characterization tests（Eva 已有 e2e）；改造按 §3.5 三层 boot 严格独立 |
| `scheduler.ts` workflow_state 序列化失败 | M1C-A | 单元测试覆盖 paused → resume 全状态；JSON schema 验证 |
| `context-manager.ts` 重构破坏 Eva 已通过的 e2e-pipeline | M1C-B | 改前补 golden tests（input/output 录制） |
| iOS 改名导致 TestFlight 重审 2-3 天 | M2-iOS | 0-pre 早确认 R-09；按 ADR-013 准备 checklist |
| Eva → Vessel 数据迁移破坏现有 Eva 用户数据 | 0B | dry-run + 不删源文件 + 默认 read-only 迁移 |
| `protocol.ts` Wire Protocol 扩展 break iOS Codable round-trip | M1A+ | 沿用 Zod fixture 测试模式；Swift 端先编译验证 |
| ML worker 启动失败（fastembed/whisper/Piper） | M1C-B / M2-Voice | 健康检查 + capability 自动 disable + inbox 通知 owner |

---

## 5. 0-pre Acceptance 检查（v5.4 plan 5 条，2026-05-09 22:55 完成）

- [x] EVA_INVENTORY 覆盖核心模块 ✅（17 backend + iOS + shared + DB schema）
- [x] EVA_TO_VESSEL_MAPPING ≥ 12 个核心 Eva 模块映射 ✅（**33 行映射 + #34 interfaces stub + #35 frontend 沿用 = 35 行**）
- [x] ADR-000 + ADR-012 Status=Accepted ✅（额外加 ADR-013 = 3 份 ADR Accepted）
- [x] M0–M1C 实施相关决策不留 TBD ✅（4-way Phase 1 评审已跑：3 Claude reviewer + 1 cursor cross；Phase 3 仲裁 27 项 finding 都有裁决；2 项 escalation 已写 inbox）
- [x] RISKS ≥ 11 条 ✅（实际 14 条：R-01~R-13 + 拆出 R-06b + 加 R-14/R-15）

**4-way Phase 1 评审 + Verify Gate 已跑**（详见 [P3 arbiter](../reviews/0-pre-review-p3-arbiter-2026-05-09-2255.md) + [escalation inbox](../../instance/inbox/2026-05-09-2255-0-pre-escalations.md)）。

**待 owner 处理 inbox 3 项 escalation**（E1 rm -rf 已修 / E2 license 已加 Stage 6 / E3 frontend hung）后，进 0A。

---

## 实际实施 vs plan 偏差校正（2026-05-11 补）

> 闭合 M1C-A closeout MINOR-arch-1。原 plan §6/§17/§33 假设 Vessel 自有数据落
> Eva 既有 `harness.db`（schema_version=103+），实际实施时为了"Eva path 0 影响"
> 把 Vessel 表落到独立的 `memory.db`。

| 原 plan 假设 | 实际实施（M1C-A / M1C-B） | 原因 |
|---|---|---|
| `harness.db` schema_version=103 加 `workflow_state` 表（行 33–35）| **`memory.db` migration 0003** (`workflow_state`)，schema_version=3 | 不污染 Eva harness.db；Vessel 自有 db 由独立 `MIGRATIONS` 数组管 [packages/backend/src/memory/session-store.ts](../../packages/backend/src/memory/session-store.ts) |
| `harness.db` schema_version=104 加 `embedding` 表（行 35 / 行 81 ②）| **`memory.db` migration 0004** (`memory_records` + sqlite-vec `vec_memory` 虚拟表)，schema_version=4 | 同上 — Vessel embedding store 完全独立于 Eva harness |
| `0006_soul_history.sql` (schema_version=105) M2-Soul（行 81 ③）| **暂未实现**：M2-Soul 现阶段仅 `~/.vessel/soul.md` 单文件，无 history 表 | YAGNI；如果未来要 audit 修订史再加（M2-Soul 段已识别）|
| `0007_capability.sql` (schema_version=106) M2+（行 81 ④）| **暂未实现**：M2-Voice defer 后 capability runtime loader 未做 | 待 capability runtime 实施时一起加 |

`memory.db` schema 版本序列（独立于 harness.db v100+）：
| version | migration | milestone |
|---|---|---|
| 1 | `0001_m0_sessions.sql` | M0 (sessions / intents / skill_invocations) |
| 2 | `0002_m1_lessons.sql` | L1-minimal (lessons + FTS5) |
| 3 | `0003_m1c_workflows.sql` | M1C-A (workflow_state) |
| 4 | `0004_m1c_memory.sql` | M1C-B (memory_records + sqlite-vec runtime) |

**校正生效后**：
- 数据迁移脚本（`migrate-eva-to-vessel.ts`）只复制 Eva harness.db / inbox.jsonl，**不**期待 Vessel 表已在 harness.db 里；vessel-core 启动时独立创建 memory.db schema v4。
- 文件路径校正：`packages/backend/src/migrations-memory/` 是 Vessel migration 文件夹（不是原 plan 提的 `migrations/`）。
