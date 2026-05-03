# Harness Protocol Fixtures

每个文件 = 一个实体或 wire message 的 JSON 样例。用于 [`__tests__/harness-protocol.test.ts`](../../src/__tests__/harness-protocol.test.ts) round-trip 验证 Zod parse → 重编码 → deep-equal。

## 实体 fixtures (13)

| 文件 | 对应 Zod schema |
|---|---|
| `project.json` | `ProjectDtoSchema` |
| `initiative.json` | `InitiativeDtoSchema` |
| `issue.json` | `IssueDtoSchema` |
| `idea-capture.json` | `IdeaCaptureDtoSchema` |
| `stage.json` | `StageDtoSchema` |
| `methodology.json` | `MethodologyDtoSchema` |
| `task.json` | `TaskDtoSchema` |
| `context-bundle.json` | `ContextBundleDtoSchema` |
| `run.json` | `RunDtoSchema` |
| `artifact-inline.json` | `ArtifactDtoSchema` (storage='inline') |
| `artifact-file.json` | `ArtifactDtoSchema` (storage='file') |
| `review-verdict.json` | `ReviewVerdictDtoSchema` |
| `decision.json` | `DecisionDtoSchema` |
| `retrospective.json` | `RetrospectiveDtoSchema` |

## 系统 messages

| 文件 | 对应 Zod schema |
|---|---|
| `audit-log-entry.json` | `AuditLogEntrySchema` |
| `harness-event.json` | `HarnessEventSchema` (kind='stage_changed') |

## 跨端 round-trip 不变量

每个文件读出来后必须满足：
```
TS Zod.parse → re-encode → JSON.stringify → JSON.parse → Zod.parse → deep-equal 原对象
```

未来加 Swift 端时：
```
TS encode → Swift Codable.decode → Swift Codable.encode → JSON 字符串 → TS decode → deep-equal
```
