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
| ID | **opaque stable string**，推荐 `<type>-<ULID>` 前缀（如 `proj-01HJK5...` / `iss-01HJK5...`）；**不强制 UUIDv4**；客户端不应解析 ID 内容；后端可任意生成形式但同 Issue 范围内必须稳定 unique（M0 modelList Round phase 3 cross M2 修复 §1 vs §8 自相矛盾） |
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

## 8. 契约 #2 完工状态（v1.0 ship 后真实状态）

> 契约 #2 evaluation Round 1（2026-05-03）已完成。下面是当前真实交付状态。
>
> Round 1 评审 BLOCKER：原 §8 在交付物 ship 后仍说 "doc-only"，与现实不符（同 Round 1 BLOCKER-1 的反向）。现已更新。

| 交付物 | 状态 | 文件 |
|---|---|---|
| Zod schemas (13 实体 + AuditLogEntry + HarnessEvent + 版本常量) | ✅ ship | [`packages/shared/src/harness-protocol.ts`](../packages/shared/src/harness-protocol.ts) |
| 16 fixtures（13 实体 + Artifact inline + file + audit + event） | ✅ ship | [`packages/shared/fixtures/harness/`](../packages/shared/fixtures/harness/) |
| Swift Codable 镜像 | ✅ ship | [`packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`](../packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift) |
| TS round-trip 测试 (42/42 绿) | ✅ ship | [`packages/shared/src/__tests__/harness-protocol.test.ts`](../packages/shared/src/__tests__/harness-protocol.test.ts) |
| ADR-0011 server-driven thin-shell | ✅ Proposed | [`adr/ADR-0011-server-driven-thin-shell.md`](adr/ADR-0011-server-driven-thin-shell.md)（M0 升级 Accepted） |

**enum 值锁**（已交付，见 §1）：HARNESS_PROTOCOL.md §1 把所有枚举值固定列出，下游 Zod / Swift 实现 1:1 对齐。

**自动化守门**：[scripts/verify-m1-deliverables.mjs](../scripts/verify-m1-deliverables.mjs) 检查文件存在性，**不读 [x]**。

**ID 格式契约**（Round 1 cross M1 修正）：本协议中所有 `id` / `*Id` 字段是 **opaque stable string，推荐 `<type>-<ULID>` 前缀**（如 `proj-01HJK5...`、`iss-01HJK5...`）。**不强制 UUIDv4**。客户端不应解析 ID 内容；后端可任意生成形式但同 Issue 范围内必须稳定 unique。

**Swift round-trip 覆盖（Round 1 cross M3 / arch M1 留给 M1+）**：
- M-1 范围：人工抽样验证（已对齐字段名、enum、optional 处理）
- M1+ 必产 Swift 自动化测试，覆盖以下高风险点：
  - `AuditLogEntry.before / after` null 编码（TS Zod 保留 null vs Swift 默认丢 nil-key 的语义差）
  - `Artifact.metadata` 任意 JSON via `AnyCodable` 递归
  - `HarnessEvent` discriminated union 手写 encode/decode
  - 长整数（Int64） 边界与 JS Number 精度（< 2^53）的兼容
- 当前 manual sampling 结果记录在 `docs/reviews/contract-2-*.md`

**M0 引入**：`/api/harness/config` payload schema、`harness_event` 实际 payload 字段、iOS HarnessStore + SchemaRenderer、ADR-0011 升级为 Accepted。

**M1 引入**：`/api/harness/*` REST 端点 schema（initiative / issue / stage / decision CRUD），Swift round-trip 自动化测试，CI 接 enum 锁。
