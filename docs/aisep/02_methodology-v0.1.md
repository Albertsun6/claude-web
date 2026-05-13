# AISEP Methodology v0.1 — 10-Stage DAG + Requirements 横切

> Status: Draft (Phase 0 文档，2026-05-11)
> Source: 4 路 /survey 调研（DAG topology + 经典 SDLC + TOGAF/ArchiMate + architecture review readability）
> Depends on: [ADR-018 aisep-vs-harness](../adr/vessel/ADR-018-aisep-vs-harness.md), [01_vision_scope](01_vision_scope.md)

## 1. 总览

```
                  ┌───────────────────────────────────────────────────────────────┐
                  │ requirements.yaml（横切，贯穿所有 stage，TOGAF Req Mgmt 启发） │
                  └───────────────────────────────────────────────────────────────┘
                            ↓ ref            ↓ ref           ↓ ref

  intake → research → plan → architecture → contract → implement → verify → review → integrate → retrospect
   (A)      (R)       (E)      (C+G-c)       (G-c)      (impl)     (G-v)    (G-r)    (G-i)      (H)
                                                                         ↑              ↓
                                                                         └──── cycle ───┘  (review→revise 回环 v3+)
```

字母对应 TOGAF ADM 借鉴度：A=Phase A Architecture Vision / R=Research / E=Phase E Opportunities / C=Phase C Information Systems / G=Phase G Implementation Governance / H=Phase H Architecture Change Management（详见 [04_global-memory-ontology.md](04_global-memory-ontology.md)）

## 2. 10 个 Stage 详细规格

每个 stage 都遵循 **`input → output → gate`** 三段式。每个 stage 都允许产出 `provenance.json`（execution trace，用于审计 + AlphaEvolve 学习）。

### 2.1 intake

| 项 | 内容 |
|----|------|
| 输入 | `seed.txt`（用户原始 prompt） + `requirements.yaml`（前序项目沉淀的横切，可选） |
| 输出 | `intake.yaml`（Statement of Work，TOGAF Phase A 启发） |
| Gate | scope 边界明确 + 不可逆决策列出（LCO-lite） |
| AI 主导 | ✓（草拟）；用户最终签字 |
| 硬上限 | `intake.yaml` ≤ 200 行 |

`intake.yaml` schema：
```yaml
project: <name>
seed: <原文>
scope:
  in: [<功能 1>, <功能 2>, ...]
  out: [<明确不做 1>, ...]
objectives: [<可衡量目标 1>, ...]
constraints: [<硬约束 1>, ...]
success_criteria: [<v0 验收标准 1>, ...]
irreversible_decisions: [<潜在不可逆 1>, ...]
```

### 2.2 research

| 项 | 内容 |
|----|------|
| 输入 | `intake.yaml` |
| 输出 | `research.md`（横评 + 反证 + 借鉴度排序） |
| Gate | ≥2 source 横评 + 反证 + 借鉴度排序（沿用 vessel `/survey` skill 工作流） |
| AI 主导 | ✓（用 vessel `/survey` skill） |
| 硬上限 | `research.md` ≤ 2000 字 |

### 2.3 plan

| 项 | 内容 |
|----|------|
| 输入 | `research.md` + `intake.yaml` |
| 输出 | `plan.md`（task DAG + risk register） |
| Gate | task DAG 边界明确 + risk 列出（LCO-style） |
| AI 主导 | ✓（用户审 DAG 拓扑） |
| 硬上限 | `plan.md` ≤ 1500 字 |

`plan.md` 包含：
- TaskGraph（mermaid 渲染）：节点 = 任务，边 = 依赖
- RiskRegister：基于 [risks.yaml schema](03_architecture-stage-spec.md)
- WorkPackage 切分（TOGAF Phase E 启发）

### 2.4 architecture（含 2 phase + 增量 slice）

**这是整个 AISEP 最关键的 stage**，详细 spec 见 [03_architecture-stage-spec.md](03_architecture-stage-spec.md)。

| 项 | 内容 |
|----|------|
| 输入 | `plan.md` + `requirements.yaml` |
| 输出 | `workspace.dsl`（C4-light）+ `decisions/NNNN-*.md`（MADR）+ `risks.yaml` + `contracts-seed.ts` + `trace.yaml` |
| Gate | Phase A: 用户 ack 大方向；Phase B per slice: 用户 ack 落地细节；最终: 7 问 anchor gate（详见下方）|
| AI 主导 | ✓（fan-out 3 候选 brief）；**用户必须做最终取舍 + LCA 7 问 sign-off** |
| 硬上限 | Phase A ≤ 5 页；Phase B per slice ≤ 4 页 |

**7 问 anchor gate**（对应 RUP LCA + vessel CLAUDE.md "Layered Spiral Delivery"，Phase A 必过）：
1. **数据模型**：核心实体 schema 冻结（zod 表达）？
2. **协议**：进程间/网络/文件 wire protocol 冻结？
3. **兼容**：与既有 vessel/eva/HARNESS_* 兼容（R1-R10 不变量）？
4. **不可逆决策**：哪些决策走错搬迁成本高？写 ADR + 主要 risk 退化方案？
5. **权限**：fs/net/exec 权限边界清晰？
6. **资源争用**：并发/lockfile/SQLite 连接冲突？
7. **Rollback**：失败时如何回退到 LKG snapshot？

### 2.5 contract

| 项 | 内容 |
|----|------|
| 输入 | architecture stage 输出的 `contracts-seed.ts` |
| 输出 | `contracts/*.ts`（zod + tRPC）+ `contracts/json-schema.json` 导出 |
| Gate | tsc 编译通过 + zod runtime gate + 跨端 review（V-Model right-side mapping） |
| AI 主导 | ✓；**用户决定何时冻结**（contract 一旦冻结，implement stage 不允许改协议）|
| 硬上限 | 单 `.ts` 文件 ≤ 200 行；contract 包总 ≤ 2000 行 |

contract stage 的本质：把 architecture stage 的"草案"变成"frozen final"——TOGAF Phase G Architecture Contract 概念落地。

### 2.6 implement

| 项 | 内容 |
|----|------|
| 输入 | `contracts/*.ts` + `plan.md` task DAG |
| 输出 | `patch.diff` per stream（v1 fan-out 时多个 stream 并行） |
| Gate | 单 task DoD（static check pass + unit test pass） |
| AI 主导 | ✓ |
| 硬上限 | 单 patch ≤ 400 行（参考 SmartBear/Cisco code review 上限） |

### 2.7 verify

| 项 | 内容 |
|----|------|
| 输入 | `patch.diff` + `contracts/*.ts` |
| 输出 | `verify-report.json`（build/lint/unit/integration/e2e/security） |
| Gate | 全链路绑定 contract，machine-verifiable；任一项失败 → 回 implement |
| AI 主导 | ✓（无人工） |
| 硬上限 | verify 单次执行 ≤ 10 分钟（超时 = 失败） |

### 2.8 review

| 项 | 内容 |
|----|------|
| 输入 | `verify-report.json` + `patch.diff` |
| 输出 | `review-verdict.json`（cross-AI + human final） |
| Gate | double reviewer convergence（沿用 vessel `harness-review-workflow` skill） |
| AI 主导 | ✓ 2 reviewer agent（其中 1 个 cursor-agent 异构）；用户 final ack |
| 硬上限 | review 单轮 ≤ 60 分钟（参考 SmartBear/Cisco）；ping-pong 上限 2 轮 |

**review 输出固定四类**（aisep-protocol v0.2 起）：`pass` / `pass_with_comments` / `revise_required` / `request_reverify`。underscore form per schema（更新自 v0.1 dash form drift）。`request_reverify` 触发 + 强制 schema payload (`{checkId, reason}`) 见 [docs/proposals/aisep-protocol-v0.2-review-reverify-and-applies-to.md](../proposals/aisep-protocol-v0.2-review-reverify-and-applies-to.md)。

**logic-only review focus**（Anthropic Code Review 2026-03 实践）——reviewer 不看 style / grammar / 文档完整性，只看"会不会塞错"。

### 2.9 integrate

| 项 | 内容 |
|----|------|
| 输入 | `review-verdict.json` 为 `pass` 或 `pass_with_comments` + `patch.diff` |
| 输出 | `integration-log.json`（merge commit + tag + deploy + rollback note） |
| Gate | CI green + migration safe + rollback noted（IOC-lite） |
| AI 主导 | ✓（git operations）；**用户最终签发**（destructive action） |
| 硬上限 | 单次 integrate ≤ 5 分钟（超时 = 回滚） |

### 2.10 retrospect

| 项 | 内容 |
|----|------|
| 输入 | `integration-log.json` + 所有 upstream artifacts |
| 输出 | `retrospect.md` + `~/.aisep/governance-log/` 增量记录 |
| Gate | retrospective sealed + ship/drop/defer 决定（PRR-lite + TOGAF Phase H） |
| AI 主导 | ✓（草拟）；用户 final ack |
| 硬上限 | `retrospect.md` ≤ 1500 字 |

retrospect 输出关键字段：
- 解决的问题 / 没解决的问题
- ≥ 3 条非 obvious 发现
- AlphaEvolve fix 候选（如有失败 → 候选 promote 到 `~/.aisep/governance-log/evolution_log.json`）
- 下次 spiral 改进项

## 3. requirements.yaml 横切层

受 TOGAF Requirements Management（ADM 中心圆贯穿所有阶段）+ ArchiMate Motivation Layer 启发：

```yaml
# requirements.yaml
goals:
  - id: G1
    name: <一句话目标>
    success_criteria: <可衡量>

drivers:
  - id: D1
    name: <推动因素>

requirements:
  - id: R1
    realizes: G1
    description: <具体要求>

constraints:
  - id: C1
    description: <硬约束>

principles:
  - id: P1
    description: <设计原则>

stakeholders:
  - id: S1
    role: <角色>
```

**贯穿规则**：
- intake stage 生成 `requirements.yaml` 初稿（基于 seed.txt）
- architecture stage 引用并 trace_id 链接（REQ-001 → ADR-002 → ZOD-X → RISK-003）
- 任何下游 stage 想新增需求 → 必须**回溯**改 requirements.yaml 而非新增 inline 需求

## 4. DAG topology 分阶段实施（v0/v1/v2/v3）

| 版本 | 周期 | DAG 能力 | 新增产物 | 验证标准 |
|------|------|---------|---------|---------|
| **v0** | 2 周 | **线性**（单 predecessor / 单 successor） | DAG schema（SQLite stage_run / artifact / attempt 表）；artifact freshness（content-hash） | 跑通 1 个 trivial pilot（10 stage 全过一遍）|
| **v1** | 4 周 | **静态 fan-out** | `.parallel([impl_backend, impl_frontend, impl_tests])`；ready queue（dep 满足即 runnable，并发上限 4）；architecture Phase A fan-out 3 候选 | 跑通 1 个含并行 implement 的 pilot |
| **v2** | 6 周 | **fan-in + partial recovery** | parallel output 按 stage id 装入下一 stage `inputSchema`（Mastra 思想）；input-hash + artifact-snapshot；fan-in 失败只重跑失败分支；golden baseline + escape hatch | 跑通 1 个含 multi-reviewer 并行 fan-in 的 pilot |
| **v3** | 8 周 | **cycle + dynamic subgraph + self-host 双轨** | review→revise cycle；agent 提 graph patch（proposal gate）；stable graph 执行 + candidate graph 沙盒试跑 | 跑通 1 次 AISEP 改 AISEP self-host 演化，无 regression |

## 5. SQLite 持久化 schema（v0 最小可用）

```sql
-- v0 持久化（无 daemon，SQLite + 文件）

CREATE TABLE workspace (
  id TEXT PRIMARY KEY,           -- UUID
  name TEXT NOT NULL,
  cwd TEXT NOT NULL,             -- 项目根目录
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL           -- 'active' | 'archived'
);

CREATE TABLE stage_run (
  id TEXT PRIMARY KEY,           -- UUID
  workspace_id TEXT NOT NULL,
  stage TEXT NOT NULL,           -- 'intake' | 'research' | ... | 'retrospect'
  predecessor_id TEXT,           -- v0 单 predecessor；v2 改 JSON 多 predecessor
  successor_id TEXT,             -- v0 单 successor
  status TEXT NOT NULL,          -- 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  input_hash TEXT,               -- 上游 artifact 合并 hash
  started_at INTEGER,
  ended_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id)
);

CREATE TABLE artifact (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  stage_run_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'intake' | 'research' | 'plan' | 'workspace.dsl' | 'adr' | 'risks' | 'contract' | 'patch' | 'verify-report' | 'review-verdict' | 'integration-log' | 'retrospect'
  ref_key TEXT NOT NULL,         -- 'adr/0001-use-zod.md' 等
  content_hash TEXT NOT NULL,    -- artifact freshness 决定下游是否需要重跑
  content_uri TEXT NOT NULL,     -- 'file://workspaces/<name>/<path>' 或 'sqlite://artifact_blob/<id>'
  produced_at INTEGER NOT NULL,
  FOREIGN KEY (stage_run_id) REFERENCES stage_run(id)
);

CREATE TABLE attempt (
  id TEXT PRIMARY KEY,
  stage_run_id TEXT NOT NULL,
  attempt_n INTEGER NOT NULL,    -- 第几次尝试
  agent_profile TEXT NOT NULL,   -- 'ba' | 'architect' | 'coder' | 'reviewer' | 'tester'
  agent_invocation TEXT NOT NULL, -- JSON: { cmd, cwd, model, prompt_hash }
  output_artifact_ids TEXT NOT NULL, -- JSON array of artifact ids
  exit_code INTEGER NOT NULL,
  stdout_uri TEXT,
  stderr_uri TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  FOREIGN KEY (stage_run_id) REFERENCES stage_run(id)
);

CREATE INDEX idx_stage_run_workspace ON stage_run(workspace_id);
CREATE INDEX idx_stage_run_status ON stage_run(status);
CREATE INDEX idx_artifact_stage_run ON artifact(stage_run_id);
CREATE INDEX idx_artifact_content_hash ON artifact(content_hash);
```

## 6. Stage executor 范式（spawn `claude --print`）

每个 stage 的 agent 调用走以下范式（受 newaisep Native Agent Compiler 启发）：

```typescript
// aisep-agents/src/spawn-claude.ts (示意)

async function executeStage(
  stage: Stage,
  inputs: StageInputs,
  workspace: Workspace,
): Promise<StageOutputs> {
  // 1. 渲染 prompt（Handlebars 模板从 ~/.aisep/reference-library/prompt-templates/<stage>.hbs）
  const prompt = renderTemplate(stage, inputs);

  // 2. 注入 AlphaEvolve memory（~/.aisep/governance-log/evolution_log.json 中匹配 stage 的 fix 候选）
  const contextBundle = await retrieveContext(stage, inputs);

  // 3. 写 task.md 到 workspace/.aisep/tmp/
  await workspace.writeFile('.aisep/tmp/task.md', prompt + contextBundle);

  // 4. spawn claude --print（subscription 模式，不调 SDK）
  const result = await spawn('claude', [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--system-prompt', renderSystemPrompt(stage),
  ], {
    cwd: workspace.cwd,
    stdin: prompt,
  });

  // 5. 解析 stream-json output → artifact + attempt log
  return parseStreamJson(result.stdout);
}
```

**关键约束**：
- 永远 `claude --print`，不用 `claude --bare`（违反订阅模式）
- 永远不调 `@anthropic-ai/claude-agent-sdk`（按 token 计费）
- 失败时自动重试 1 次（无 `--resume`，避免 stale session）
- 5 秒后 SIGKILL（vessel `cli-runner.ts` 模式）

## 7. AlphaEvolve 跨项目记忆（从 newaisep 借鉴）

每个 stage 失败 → 写入 `<workspace>/.aisep/evolution_log.json`（Pending）；
retrospect stage 用户 ack 后 → promote 到 `~/.aisep/governance-log/evolution_log.json`（Global）；
新 workspace 跑同 stage 时 → `retrieveContext()` 自动注入 global fix 候选 → AI agent 提前规避。

详见 [04_global-memory-ontology.md](04_global-memory-ontology.md)。

## 8. Self-host 兜底机制（Q5 决策落地）

允许 AISEP 改 AISEP 自身（v0 day 1 不禁止），但必须有：

- **金本位快照**：每次 AISEP 修改 `packages/aisep-*` 前自动 `git tag aisep-lkg-<timestamp>`
- **双轨执行**：self-host 改动先在 worktree 跑通（独立工作目录），主仓库 merge 前需 reviewer ack
- **escape hatch**：`aisep --bypass` flag 禁用 self-host 路径，强制用户手动介入
- **AISEP 不能自动 commit 自己的改动**：必须人工签发

## 9. 关键不变量（红线）

| ID | 红线 | 检测方式 |
|----|------|---------|
| M1 | stage_run 表 status 流转必须遵守状态机（pending → running → succeeded\|failed\|cancelled） | aisep-core 内 assertion |
| M2 | artifact 一旦写入，content_hash 不可变（不可重写已有 artifact） | SQLite UPDATE 触发 raise |
| M3 | architecture stage Phase A 未通过 → Phase B 不允许启动 | aisep-core 强制 |
| M4 | contract stage 冻结后 → implement stage 不允许改 contract 文件 | dependency-cruiser + git pre-commit hook |
| M5 | review stage `revise_required` ∪ `request_reverify` 累计 2 次（同 `stageRunId`）→ 必须 cut scope（不允许第 3 轮 ping-pong） | aisep-core 强制（v0.2 standby — actual enforcement deferred to Phase 2.E baseline + v3 cycle，见 [proposal §6b carve-out](../proposals/aisep-protocol-v0.2-review-reverify-and-applies-to.md)） |
| M6 | retrospect stage 未跑 → 不允许启动新 workspace 同 stage（强制学习闭环） | CLI 检查 |

## 10. 参考依据

完整 plan：`~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md`

调研依据：
- **DAG topology**：Mastra builder + Inngest durable + Dagster SDA + Bazel 增量构建
- **stage 切分**：RUP LCO/LCA/IOC/PRR + Boehm Spiral + V-Model + TOGAF ADM 6 子集
- **requirements 横切**：TOGAF Requirements Management + ArchiMate Motivation Layer
- **architecture stage 2-phase**：SmartBear/Cisco 200-400 LOC 上限 + TC39 maturity stage + Mozilla mini-stage + Anthropic Code Review 2026-03 logic-only focus
- **AlphaEvolve memory**：newaisep v1.0 MVP 实战（7 workspaces）

详见各文档头部 `Source` 章节。
