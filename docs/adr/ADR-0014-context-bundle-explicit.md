# ADR-0014 — ContextBundle 必须显式 + 缺失即失败 + 不做语义检索

**状态**：Accepted（2026-05-03，M-1 第 3 项核心契约）

**Decider**：用户 + reviewer-cross + reviewer-architecture（M-1 ritual）

**关联**：[HARNESS_CONTEXT_PROTOCOL.md](../HARNESS_CONTEXT_PROTOCOL.md) · [HARNESS_ROADMAP §0 #9 / §14](../HARNESS_ROADMAP.md) · [.claude/skills/harness-architecture-review/LEARNINGS.md #5](../../.claude/skills/harness-architecture-review/LEARNINGS.md)

---

## Context

agent 看到的输入决定其智商上限。harness 与 Devin / Cursor BugBot / 各类玩具级 agent 工具的核心差距：是否**显式管理 agent 输入**。

LEARNINGS.md #5 已沉淀经验：**Context Manager 第一版应是协议和审计，不是智能选择器**。原因：
- 智能挑选（向量检索 / re-rank / RAG）需要大量 dogfood 数据才知道"什么是相关"
- 个人自用规模下，简单规则（按 Stage kind 列 mustInclude/mayInclude）+ 人工确认效果足够
- 智能化引入隐式行为，违背 §0 #9 "上下文严格管理 + 可复盘"

---

## Decision

ContextBundle 满足 4 条：

### 1. 显式 ArtifactBundle（不是隐式上下文）

agent 输入 = `ContextBundle.artifactRefs[]` 中**明确列举**的 Artifact id。Context Manager 按 Stage kind + AgentProfile.contextBudget 编排。

不做：
- 不引入向量数据库（M-1 ~ M3 整个范围）
- 不做 cosine 相似度 / re-rank / RAG
- 不让 agent 自由 Glob/Grep 主 cwd（agent 只能 grep 自己的 worktree 副本，且只能命中 ContextBundle 列出的文件）

### 2. 缺失 Artifact 即失败（Fail-Loud）

`mustInclude` 中任一 glob 找不到匹配 Artifact → Task 状态置 `failed`，错误 `ContextBundleMissingMustInclude: <glob>`。

agent 不允许：
- 跳过缺失继续生成
- 自己补 Glob/Grep
- 推理"应该有什么"

`mayInclude` 缺失时静默跳过（写 `prunedFiles`）。

### 3. Markdown Snapshot 永久落盘

每 Bundle 写 `~/.claude-web/bundles/<bundleId>.md`。Retrospective / debate / anti-pattern 提炼直接 grep。Bundle 永不修改；新 Bundle 产生新 id。

### 4. 简单挑选规则（按 Stage kind 一表）

[HARNESS_CONTEXT_PROTOCOL.md §3](../HARNESS_CONTEXT_PROTOCOL.md) 给出 10 个 Stage kind 的默认挑选表。budget 削只影响 `mayInclude`，不动 `mustInclude`（不通过则 fail）。

---

## Consequences

**Pros**：
- ✅ agent 输入完全可复盘 + 可审计（Round 2 arch 加挂起项 metric 可记录）
- ✅ 避免 LEARNINGS.md #5 警告的"先做智能选择器" 反 pattern
- ✅ 个人自用规模下规则演化成本低（改 §3 表 + reload）
- ✅ Reviewer 独立性约束（[HARNESS_AGENTS.md §3](../HARNESS_AGENTS.md)）通过 `mustInclude` 严格限定来 enforce — Context Manager 是单点约束
- ✅ 不引入新基础组件（[§0 #11](../HARNESS_ROADMAP.md)）

**Cons**：
- ❌ 简单规则在量级膨胀（M3 后）时可能精度不够 — 需要方法论迭代
- ❌ `prunedFiles` 削掉的内容如果实际有用，agent 不会自己拿回 — 这是设计意图的代价
- ❌ M2 dogfood 第一版规则可能粗糙，需要按 Retrospective 信号调整

**永不做的事**：
- 不引入 vector DB（chroma / qdrant / pinecone / lancedb 等）
- 不引入 RAG framework（langchain / llamaindex / haystack 等）
- 不让 Context Manager 自己跑 LLM 做 re-rank

---

## 替代方案及为何驳回

| 方案 | 驳回理由 |
|---|---|
| RAG / 向量检索 | M-1 ~ M3 没有足够 dogfood 数据训练 retrieval；隐式行为违 §0 #9 |
| 自由 Glob 主 cwd | 玩具级；上下文撞墙 + 无可复盘性（参见 LEARNINGS.md #5） |
| Best-effort（缺也跑） | reviewer / Coder 在缺 spec 时会脑补，导致 review 失真 / patch 偏离 |
| Bundle 复用前 Run transcript | LEARNINGS.md 已点出："长链路撞墙的主因"。除非显式作为 Artifact 列入 |

---

## Risk-Triggered Migration

如果 M3 后 Retrospective 显示**简单挑选规则精度不够**（如 reviewer 漏检率上升 / Coder 主动反映 context 不足）：
- 优先调整 [§3 默认挑选表](../HARNESS_CONTEXT_PROTOCOL.md) + 方法论 v2
- 仅当方法论调整后仍无效，才进入 vector DB 立项 ritual
- 立项需新 ADR 推翻本 ADR §"永不做的事" 段

---

## 与其他 ADR 的关系

- [ADR-0010](ADR-0010-sqlite-fts5.md)：Bundle 元数据落 SQLite，markdown snapshot 落文件
- [ADR-0011](ADR-0011-server-driven-thin-shell.md)：iOS 通过 server-driven config 拿到挑选规则；可热更
- [ADR-0013](ADR-0013-worktree-pr-double-reviewer.md)（待建）：reviewer Bundle 严格独立性 = 本 ADR §"#1 显式 ArtifactBundle" 的特殊化
