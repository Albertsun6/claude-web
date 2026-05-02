# Harness Protocol

> **状态**：M-1 第 2 项核心契约 v1.0（2026-05-03）。覆盖 13 实体 DTO + audit log entry；不含 WS 事件 / `/api/harness/*` 端点（M0 时再敲）。
>
> **导航**：[索引](HARNESS_INDEX.md) · [Data Model](HARNESS_DATA_MODEL.md) · [Roadmap](HARNESS_ROADMAP.md)
>
> **配套 ADR**：[ADR-0011](adr/ADR-0011-server-driven-thin-shell.md)（server-driven thin-shell）· [ADR-0015](adr/ADR-0015-schema-migration.md)（迁移策略）
>
> **唯一权威**：[`packages/shared/src/harness-protocol.ts`](../packages/shared/src/harness-protocol.ts)（Zod）。本文是说明，DTO 字段以 ts 文件为准。

---

## 0. 目标与范围

harness 的协议层有 4 个出口：

1. **跨端 DTO**：backend ↔ web ↔ iOS 共享的 13 实体 + audit log entry 序列化
2. **WS 事件**：`harness_event { kind, ... }`（M0 引入，本契约定义骨架）
3. **REST 端点**：`/api/harness/*`（M1 起逐步引入）
4. **server-driven config**：`/api/harness/config` payload（M0 引入）

**M-1 范围**（本文）：仅 #1 + #2 骨架。后两项各自里程碑再定。

---

## 1. 命名与编码约定

| 维度 | 约定 |
|---|---|
| 字段命名 | **wire camelCase**（`createdAt`, `projectId`），DB snake_case（`created_at`, `project_id`），转换由 store 层负责 |
| 时间戳 | **epoch ms**（数字），不传字符串，不用 ISO 8601。和 `~/.claude-web/telemetry.jsonl` 一致 |
| ID | UUIDv4 字符串；客户端生成 / backend 生成都允许，但**写入前必须 unique** |
| JSON 字段 | DB 里以 `*_json` 列存原始 JSON 字符串；wire DTO 里展开成 typed 结构 |
| 可选字段 | wire 上 **完全省略**（不发送 `null`）。Zod `.optional()` |
| 枚举 | 全部小写、下划线分词（`in_progress`），不用驼峰 / 大写 |

**枚举值锁**：
- `Issue.status`: `inbox | triaged | planned | in_progress | blocked | done | wont_fix`
- `Stage.kind`: `strategy | discovery | spec | compliance | design | implement | test | review | release | observe` （**固定顺序**）
- `Stage.status`: `pending | running | awaiting_review | approved | rejected | skipped | failed`
- `Stage.weight`: `heavy | light | checklist`
- `Task.status`: `pending | running | completed | failed | cancelled`
- `Task.model`: `opus | sonnet | haiku`
- `Initiative.status`: `draft | active | paused | done`
- `Issue.priority`: `low | normal | high | critical`
- `Issue.source`: `ideas_md | user_feedback | git_log | telemetry | inbox | manual`
- `IdeaCapture.source`: `voice | text | web`
- `Methodology.appliesTo`: `claude-web | enterprise-admin | universal`
- `Artifact.kind`: `methodology | spec | design_doc | architecture_doc | adr | patch | pr_url | test_report | coverage_report | review_notes | review_verdict | decision_note | metric_snapshot | retrospective | changelog_entry`
- `Artifact.storage`: `inline | file`

枚举增减按 [ADR-0015](adr/ADR-0015-schema-migration.md) 管理：加 enum 值 = minor bump；删 / 改语义 = major bump。

---

## 2. 13 个实体 DTO

DTO 字段直接映射 [HARNESS_DATA_MODEL.md §1](HARNESS_DATA_MODEL.md) 的 SQL schema，但：

- snake_case → camelCase
- `*_json` 列展开成对应 typed 结构
- `created_at` / `updated_at` 等时间戳字段保持 epoch ms

字段细节以 [`harness-protocol.ts`](../packages/shared/src/harness-protocol.ts) 为准。

### 实体清单

| 实体 | Zod schema | DB table | 备注 |
|---|---|---|---|
| Project | `ProjectDto` | `harness_project` | 复用 projects.json 的 id |
| Initiative | `InitiativeDto` | `initiative` | KPI 数组展开 |
| Issue | `IssueDto` | `issue` | labels 数组展开 |
| IdeaCapture | `IdeaCaptureDto` | `idea_capture` | 30 秒入口 |
| Stage | `StageDto` | `stage` | input/output/verdict 数组展开 |
| Methodology | `MethodologyDto` | `methodology` | (stageKind, version) 唯一 |
| Task | `TaskDto` | `task` | runIds 数组展开 |
| ContextBundle | `ContextBundleDto` | `context_bundle` | artifactRefs 数组展开 |
| Run | `RunDto` | `run` | session_id 可选 |
| Artifact | `ArtifactDto` | `artifact` | inline/file 联合 |
| ReviewVerdict | `ReviewVerdictDto` | `review_verdict` | dimensions 对象展开 |
| Decision | `DecisionDto` | `decision` | options 数组展开 |
| Retrospective | `RetrospectiveDto` | `retrospective` | costSummary 对象展开 |

---

## 3. Audit Log Entry

`~/.claude-web/harness-audit.jsonl`（独立 JSONL，不进 SQLite，详见 [HARNESS_DATA_MODEL.md §1.14](HARNESS_DATA_MODEL.md)）。

每行一条 `AuditLogEntryDto`：

```ts
{
  ts: number,          // epoch ms
  actor: string,       // "user" | "agent:<profileId>" | "system" | "migration"
  op: "insert" | "update" | "delete" | "migrate",
  table: string,       // entity table name
  id: string,          // entity id
  before: object | null,
  after:  object | null,
  rationale?: string,  // 可选人审注释
}
```

`before` / `after` 字段直接是 DTO 实例（不是 SQL row）。`migrate` op 时 `id="<from-version>->" + to-version`。

---

## 4. WS 事件骨架（M-1 仅定义类型，不定义 payload）

backend → 客户端的 `harness_event` 顶层结构（实际 payload 字段 M0 时再细化）：

```ts
type HarnessEvent =
  | { type: "harness_event"; kind: "stage_changed";       stageId: string; status: string }
  | { type: "harness_event"; kind: "task_started";        taskId: string }
  | { type: "harness_event"; kind: "task_completed";      taskId: string; success: boolean }
  | { type: "harness_event"; kind: "decision_requested";  decisionId: string }
  | { type: "harness_event"; kind: "run_appended";        runId: string; lineCount: number }
  | { type: "harness_event"; kind: "review_complete";     verdictId: string }
  | { type: "harness_event"; kind: "config_changed";      protocolVersion: string };
```

字段名锁住，结构留给 M0 调整。

---

## 5. 版本协商

```ts
export const HARNESS_PROTOCOL_VERSION = "1.0";  // major.minor
export const MIN_CLIENT_VERSION       = "1.0";  // 客户端低于此版本时拒绝服务
```

iOS / web 在握手时上报自己的 version；backend 检测：
- `clientVersion >= MIN_CLIENT_VERSION` → 正常
- 否则 → 推 `harness_event { kind: "config_changed", ... }` + 提示升级，回退 fallback config

升级规则见 [ADR-0015](adr/ADR-0015-schema-migration.md)。

---

## 6. 跨端 round-trip 不变量

每个 DTO 必须满足：

```
TS encode → JSON → Swift decode → Swift encode → JSON → TS decode == 原始对象
```

具体测试：
- TS 端：[`packages/shared/src/__tests__/harness-protocol.test.ts`](../packages/shared/src/__tests__/harness-protocol.test.ts) 用 fixture 验证 Zod parse + 重编码 deep-equal
- Swift 端：iOS 单元测试解码 fixture，重编码与 TS 端结果对比（M-1 Phase 7 引入）

fixture 位置：`packages/shared/fixtures/harness/<entity>.json`。

---

## 7. 与 packages/shared/src/protocol.ts 的关系

老的 `protocol.ts` 处理 **claude-web 实时控制台**（user_prompt / sdk_message / permission_request 等 spawn `claude` CLI 的协议）。

`harness-protocol.ts` 处理 **harness 流水线**（13 实体 DTO + audit + harness_event）。

两者 **不互相依赖**，但共享：
- `ImageAttachment`（已在 protocol.ts）
- 时间戳约定（epoch ms）
- runId / sessionId 概念

所有 harness Run 的 transcript 仍然是 Claude CLI 自己写的 jsonl（路径存在 `Run.transcriptPath`），harness 不复制。

---

## 8. 契约 #2 进度状态

> **本契约 doc-only 阶段**（2026-05-03）。下面 5 条交付物**未起步**。
>
> Round 1 评审捕获了"§8 [x] 撒谎"问题（HARNESS_REVIEW_LOG.md Round 1 #1 BLOCKER-1）；现修正为待办清单 + verify 脚本守门。

- [ ] [`packages/shared/src/harness-protocol.ts`](../packages/shared/src/harness-protocol.ts) 13 实体 DTO + AuditLogEntry + HarnessEvent + 版本常量
- [ ] [`packages/shared/fixtures/harness/`](../packages/shared/fixtures/harness/) 每实体的 JSON 样例
- [ ] [`packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`](../packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift) Swift Codable 镜像
- [ ] [`packages/shared/src/__tests__/harness-protocol.test.ts`](../packages/shared/src/__tests__/harness-protocol.test.ts) Zod parse + round-trip 测试
- [ ] [ADR-0011 server-driven thin-shell](adr/ADR-0011-server-driven-thin-shell.md) — 当前为 Proposed status，决定推到 M0

**enum 值锁**（M-1 已交付，见 §1）：HARNESS_PROTOCOL.md §1 已经把所有枚举值固定列出，下游 Zod / Swift 实现必须 1:1 对齐；CI 应该跑 enum 字符串完全匹配测试（M1+ 引入）。

**自动化守门**：[scripts/verify-m1-deliverables.mjs](../scripts/verify-m1-deliverables.mjs) 检查上面 5 条文件是否存在；M-1 验收时跑一次，缺哪个挂哪个，不允许"靠 [x] 自报通过"。

**M0 引入**：`/api/harness/config` payload schema、`harness_event` 实际 payload 字段、iOS HarnessStore + SchemaRenderer、ADR-0011 升级为 Accepted。

**M1 引入**：`/api/harness/*` REST 端点 schema（initiative / issue / stage / decision CRUD）。
