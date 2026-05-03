# Harness Context Protocol

> **状态**：M-1 第 3 项核心契约 v1.0（2026-05-03）。
>
> **导航**：[索引](HARNESS_INDEX.md) · [Data Model](HARNESS_DATA_MODEL.md) · [Protocol](HARNESS_PROTOCOL.md) · [Roadmap §14](HARNESS_ROADMAP.md)
>
> **配套 ADR**：[ADR-0014](adr/ADR-0014-context-bundle-explicit.md)（显式 ArtifactBundle + 缺失即失败 + 不做语义检索）

---

## 0. 契约目标

harness 与玩具级 agent 工具的核心差距之一是 **agent 看到的输入由谁决定**：

- 玩具级：agent 自由 Glob / Grep / Read 整个 cwd，自由"想看什么看什么"
- 企业级 harness：agent 看到的输入 = **明确列举的 Artifact 集合**，Context Manager 服务按规则编排

本契约定义"明确列举"的协议、挑选规则、失败语义、可审计快照格式。

**核心不变量**（见 [HARNESS_ROADMAP §0 #9](HARNESS_ROADMAP.md)）：

1. agent 输入 = ContextBundle，**绝不是整个 repo**
2. 找不到必需 Artifact → **必须 fail，不允许脑补**
3. 每个 Bundle 落 SQLite + markdown snapshot 可审计
4. **不做向量语义检索**（M-1 ~ M3 的整个范围）——简单挑选规则 + 人工确认即可
5. agent profile 显式声明 `contextBudget`，超预算先削 `mayInclude` 再挑战 `mustInclude`

---

## 1. ContextBundle 数据模型映射

DB 表见 [HARNESS_DATA_MODEL.md §1.8](HARNESS_DATA_MODEL.md)：

```sql
CREATE TABLE context_bundle (
  id, task_id, artifact_refs_json, max_tokens,
  pruned_files_json, summary, snapshot_path, created_at
);
```

DTO 见 [packages/shared/src/harness-protocol.ts](../packages/shared/src/harness-protocol.ts) `ContextBundleDtoSchema`：

```ts
{
  id: string,
  taskId: string,
  artifactRefs: string[],     // Artifact id 列表（仅引用，不复制内容）
  maxTokens: number,
  prunedFiles: string[],      // budget 削掉的文件 path
  summary: string,            // markdown 摘要（人审用）
  snapshotPath: string,       // ~/.claude-web/bundles/<bundleId>.md 路径
  createdAt: number,
}
```

**关键设计**：`artifactRefs` 只存 Artifact id（间接引用），不复制内容。Bundle 永不修改；agent 通过 `Artifact.contentText` 或 `Artifact.contentPath` 间接拿内容。

**Round 1 arch MINOR-3 修正**：Artifact 一旦被 Bundle 引用即不可变（M-1 已对齐 [HARNESS_DATA_MODEL.md §1.10](HARNESS_DATA_MODEL.md) "Artifact 永不修改" + `superseded_by` 链）。即便文件被改写，Bundle markdown snapshot（`~/.claude-web/bundles/<id>.md`）已 inline content 保留旧内容副本，可复盘性不丢。M2 实施 [context-manager.ts](../packages/backend/src/context-manager.ts) 写 snapshot 时必须把 `Artifact.contentText`（或 `contentPath` 文件内容）拷贝进 markdown，不仅是 hash。

---

## 2. ContextBudget 协议（AgentProfile 字段）

每个 [AgentProfile](HARNESS_AGENTS.md) 必须声明 `contextBudget`：

```ts
type ContextBudget = {
  maxArtifacts: number;           // 硬上限：超过这个数 Context Manager 必须削
  maxBytes: number;               // 总字节预算（Round 1 arch M2 修正：避开 tokenizer 之争）
                                  // M3 真出问题再补 token-aware（不同 model tokenizer 不同）
  mustInclude: ArtifactKindGlob[]; // ["spec", "design_doc", "patch"] —— 找不到必须 fail
  mayInclude: ArtifactKindGlob[];  // ["test_report", "review_notes"] —— 缺也能跑，按预算削
};
```

> Round 1 arch M2 修正：原"maxTokens"+"SHA-256 后估算"语义不通——SHA 是 hash 不能反推 token。改用 `maxBytes` 作为 v1 锚点（与 `Artifact.sizeBytes` 对齐，可机器精确计算）。M3 后视 dogfood 反馈决定是否切 token-aware。

`ArtifactKindGlob` 形如 `"spec"`（精确）/ `"review_*"`（通配）/ `"current-issue.spec"`（结构化引用）。

**reviewer profile 特殊约束**（[HARNESS_AGENTS.md §3](HARNESS_AGENTS.md) 评审独立性）：reviewer 的 `mustInclude` **严格只含** `spec.md + design_doc.md + patch + diff`，不读 Coder transcript 或 sibling reviewer verdict。Context Manager 对 reviewer profile 强制 enforce。

---

## 3. 默认挑选规则（按 Stage kind）

Context Manager 按下表组织 Bundle。当 stage.kind 没在表里时，调用方必须显式提供 `mustInclude` / `mayInclude`。

**Selector schema**（Round 1 cross M1 修正：自然语言 → 形式化）：

```ts
type Selector = {
  kind: ArtifactKindGlob;       // "spec" / "review_*" / "current-issue.body" 等
  scope: "current-issue" | "current-project" | "global" | "ancestor-issues";
  source?: "telemetry" | "git_log" | "ideas_md" | "improvements_md" | "inbox";
  required: boolean;            // true = mustInclude (找不到 fail)；false = mayInclude
  requiredButMayBeEmpty?: boolean;  // Round 1 cross M2：为新项目首轮设计——字段名必须存在但内容可空
  maxItems?: number;            // 数组型 Artifact 削掉超额
  freshnessSec?: number;        // 仅取最近 N 秒内的 Artifact（如 telemetry）
};
```

下表是 Selector 实例（自然语言只是注释），M0 实施时由 [`packages/backend/src/context-manager.ts`](../packages/backend/src/context-manager.ts) 解析。

| Stage kind | mustInclude | mayInclude（按 budget 削） |
|---|---|---|
| `strategy` | Initiative.intent / 现状摘要 / KPI 历史 | 旧 Initiative retrospective |
| `discovery` | IDEAS.md / IMPROVEMENTS.md / git log 摘要 / telemetry summary | 旧 Issue 标题列表 |
| `spec` | Issue.body / methodology spec.md / 类似 Issue 的 spec.md | 业务实体既有清单 |
| `compliance` | spec.md / docs/ENGINEERING_GOVERNANCE.md 合规段 | 历史 compliance Decision |
| `design` | spec.md / 现有架构 ADR / 类似 design_doc | 重要源文件按 grep |
| `implement` | spec.md / design_doc.md / 相关源文件 grep / 测试样例 | 类似 patch 历史 |
| `test` | spec.md / patch / 现有测试 | coverage 历史 |
| `review` | spec.md / design_doc.md / patch / 现有 review 模板 | **`[]`（强制空，覆盖默认表）** — Round 1 arch MINOR-4 修正：reviewer mustInclude 严格 4 项（§2），mayInclude 不允许加 review_notes 等历史，避免间接被 sibling reviewer 判断模式污染 |
| `release` | merged PR / changelog / deploy 历史 | 失败 release 教训 |
| `observe` | telemetry / metrics / 用户反馈 | 现有 alerts 配置 |

挑选规则**简单 + 可解释**，不引入 ML 检索。M3 视方法论 v2 反馈再决定是否升级。

---

## 4. 缺失 Artifact 处理（Fail-Loud）

**绝对原则**：`mustInclude` 中 `required=true && requiredButMayBeEmpty=false` 的 Selector 在当前上下文（Issue / Stage 范围）找不到匹配 Artifact → Task 必须 fail，状态 `failed`，错误信息 `ContextBundleMissingMustInclude: <selector>`。

agent **不允许**：
- 跳过缺失 Artifact 继续生成
- 通过 Glob/Grep 主 cwd / worktree 自己补数据（Bundle materialized 目录之外不可读）
- 推理"应该有什么内容"

实操：Context Manager 在产 Bundle 前预检；不通过则 throw，永不送 agent prompt。

**Round 1 cross M2 修正：新项目首轮的"必填但可为空"语义**：
- 像 `telemetry` / `inbox` / 类似 spec / 历史 IDEAS 这类来源，新项目首轮可能确实为空
- 对应 Selector 标 `requiredButMayBeEmpty: true`：Bundle 必须包含**该字段**（即使内容是空数组 / null），agent 看到的 prompt 里有"telemetry: []"而不是字段缺失
- 对应字段缺失（如 telemetry source 路径不存在）→ fail；字段存在但内容空 → 允许，写到 `prunedFiles` 标 "empty source"
- `mayInclude` 缺失时静默跳过（写到 `prunedFiles`）— 不阻塞

---

## 5. Markdown Snapshot 格式

每个 Bundle 写一份人审可读 markdown 到 `~/.claude-web/bundles/<bundleId>.md`：

```markdown
# Bundle <id>

**Task**: <taskId>
**AgentProfile**: <profileId>
**Created**: <ISO timestamp>
**Budget**: maxArtifacts=<N>, maxTokens=<N>
**Pruned**: <list of pruned files with reason>

## Summary
<人审 1-2 段摘要：本 Bundle 喂了什么、为什么、与 Stage 目标的对应关系>

## Artifact Refs

### art-<id> — <kind> — <bytes>B
- ref: <path or PR#>
- hash: <sha256>
- inline content（仅当 storage='inline' 且 ≤ 4KB）:

  <content>

- 或 file: `<contentPath>`（仅当 storage='file'）

(每个 artifactRefs 一段)

## Verdict
（可选 — Bundle 用于 review 时填评分维度 + 分歧标识）
```

**用途**：M2 dogfood Retrospective 时人审"本任务给 agent 喂的对吗"；M3 进化体系做 anti-pattern 提炼时直接 grep snapshot。

---

## 6. 反例（绝对不做）

以下行为违反契约，应在 ADR-0014 显式禁止：

1. ❌ 把整个 `packages/` 作为输入丢给 agent
2. ❌ 让 agent 自由 `Glob/Grep` 在主 cwd 或 worktree（**Round 1 cross B1 修正**：grep 本身会返回匹配行内容 = 等价读非 Bundle 文件片段。M2 实施 Context Manager 时必须把 ContextBundle materialize 到独立只读目录 `~/.claude-web/bundles/<id>/files/`，agent 的 Read/Glob/Grep 只能作用于该目录；worktree 仅用于 Coder 写代码，不用于 ContextBundle 读取）
3. ❌ 复用前一 Run 的 transcript 作为下一 Run 的 context（除非显式作为 Artifact 列入）—— 长链路撞墙的主因
4. ❌ Reviewer Bundle 里包含 Coder transcript
5. ❌ Reviewer Bundle 里包含 sibling reviewer verdict（debate 阶段才合并）
6. ❌ M-1 ~ M3 期间 Context Manager 引入向量数据库 / 语义检索

每条反例如出现在 PR diff，[scripts/verify-m1-deliverables.mjs](../scripts/verify-m1-deliverables.mjs) 的反 lint 段（M2 引入）应自动捕获。

**实施细则**（Round 1 cross B1 修复）：
- M-1 阶段仅契约层面承诺；**M2 实施时**，[context-manager.ts](../packages/backend/src/context-manager.ts) 在产 Bundle 时把 mustInclude/mayInclude Artifact 复制到 `~/.claude-web/bundles/<bundleId>/files/<artifactId>.<ext>`
- agent spawn 时 `cwd = bundleFilesDir`，且 spawn env 限定 `BUNDLE_DIR=<path>` 不暴露其他文件系统位置
- 若 agent 还需要写 worktree（如 Coder），用 separate worktree path（**与 Bundle dir 物理分离**），写权限只对 worktree，read 权限只对 BundleDir

---

## 7. M-1 完工状态

- [x] [docs/HARNESS_CONTEXT_PROTOCOL.md](HARNESS_CONTEXT_PROTOCOL.md) — 本文
- [x] [docs/adr/ADR-0014-context-bundle-explicit.md](adr/ADR-0014-context-bundle-explicit.md)
- [x] 默认挑选规则表（每 Stage kind 一行）— §3
- [x] 反例段（≥3 反例）— §6 列了 6 条
- [x] context_bundle DDL 已在 [HARNESS_DATA_MODEL.md §1.8](HARNESS_DATA_MODEL.md)
- [x] ContextBundleDtoSchema 已在 [packages/shared/src/harness-protocol.ts](../packages/shared/src/harness-protocol.ts)
- [x] fixtures/harness/context-bundle.json

**留给 M0/M1**：Context Manager 服务实现（[`packages/backend/src/context-manager.ts`](../packages/backend/src/context-manager.ts)）—— M-1 仅契约，不实现。

**留给 M2**：实际跑 dogfood 时观察"reverse-query 频率" / "FTS 写延迟 p95" 等 metric（Round 2 arch + cross 加字段）。
