# AISEP architecture stage 详细 spec（v0.1）

> Status: Draft (Phase 0 文档，2026-05-11)
> 这是 AISEP 整个 stage 链条里最关键的一个 stage——决定后续所有 stage 的 input 质量
> Source: 4 路 /survey 调研（DAG topology + 经典 SDLC + TOGAF/ArchiMate + architecture review readability）

## 1. 为什么 architecture 必须独立 stage

调研发现（4 路 survey 收敛）：

1. **RUP / V-Model / Boehm Spiral** 三大经典方法论都把架构作为独立 anchor stage（LCA / 架构设计层 / spiral 第 2-3 圈）
2. **XP / Scrum 纯 emergent 被业界共识否定**（Mountain Goat / Scott Ambler 等）——AI agent 缺记忆，每个 session 重做架构决策会反复 churn
3. **AI-driven SDLC 折叠 architecture 进 plan 是高搬迁成本陷阱**（Cursor Plan Mode / Devin / Spec Kit 都这么做，DB schema / wire protocol / runtime provider 一旦走错难改）
4. **AISEP 必须反其道显式拆出 architecture stage**

## 2. 为什么 stage 内部 2-phase + 增量 slice（而非"单 stage 出 5 件套"或"V-Model 拆 2 stage"）

调研发现（用户决策 Q8）：

| 候选方案 | human review 体验评分 | 拒绝理由 |
|---------|-------------------|---------|
| A. 单 architecture stage 出 5 件套 | **2/5** | AI 一次产 5 件套必然 > SmartBear/Cisco **200-400 LOC** 单次 review 上限；user 60 分钟内读不完，会 rubber-stamp（CodeRabbit 2025：AI-coauthored PR 含 1.7× more issues / Stack Overflow 2025：66% 修"差一点"AI 代码 / SycEval：58% sycophancy） |
| B. V-Model 拆 high-level + detail 两 stage | 4/5 | 合理但仍可能两份大文档；额外增加 stage 数 |
| **C. stage 内部 2-phase + 增量 slice（采纳）** | **5/5** | 保留 B 的分段批准 + 避免 detail 变成第二个巨型文档 + stage 总数不变 |

## 3. 2-phase 详细规格

### Phase A: architecture-brief（"方向 gate"，单次执行）

| 项 | 内容 |
|----|------|
| 输入 | `plan.md`（task DAG + risk register） + `requirements.yaml` |
| 输出 | `workspace.dsl`（C4 Context+Container）+ `decisions/0001-0003-*.md`（high-level MADR）+ `risks.yaml`（top risks）+ `requirements.yaml` 增量 |
| 硬上限 | ≤ 5 页 / ≤ 1800 字 / ≤ 3 ADR / ≤ 2 图（CI lint 卡） |
| 目标 | 判断"这件事值不值得这样做"——大方向对不对 |
| Gate | 用户 ack 大方向 + 7 问 anchor gate 通过（详见 §5） |
| AI 主导 | ✓（fan-out 3 候选 brief，详见 §4） |

**Phase A 不允许包含**：
- ❌ 完整 zod schema（这是 Phase B / contract stage 的事）
- ❌ Component / Module 级 C4
- ❌ 详细 API 字段
- ❌ DDL 完整 SQL（top-level 实体名可以，字段细节不行）

CI lint 检查规则（grep 卡住 Phase A 含禁止内容）：
```bash
# Phase A artifact lint
! grep -q 'CREATE TABLE.*(' architecture/workspace.dsl     # 完整 DDL 不允许
! grep -q 'z\.object({' architecture/workspace.dsl         # zod schema 不允许
! [ $(wc -l < architecture/workspace.dsl) -gt 200 ]        # 行数硬限
```

### Phase B: architecture-detail-slice（"每 slice gate"，可循环 N 次）

| 项 | 内容 |
|----|------|
| 输入 | Phase A 所有 artifact + 用户选定的 slice 范围 |
| 输出 | `workspace.dsl` 增量（C3 Component）+ `decisions/0004+-*.md`（slice-level MADR）+ `contracts-seed.ts`（slice 部分）+ `trace.yaml` 增量 |
| 硬上限 | ≤ 4 页 per slice / ≤ 1 Component 图 + zod contract-seed for slice |
| 目标 | 判断"这个 slice 怎么落地"——细节落地方案 |
| Gate | 每个 slice 独立 ack；**不能在 Phase B 改动 Phase A 的根决策**（要改回 Phase A） |
| AI 主导 | ✓；用户每 slice ack |

**Phase B slice 切分原则**（borrow from SAFe Enabler Story / Story slicing）：
- 一个 slice = 一个 feature 或一个 risk mitigation
- slice 之间 contract 不能互相依赖（否则就是 Phase A 范围）
- slice 顺序按 risk-driven（先做高 risk 的，验证后再做低 risk）

## 4. Phase A 候选架构 fan-out（v1+，Q10 决策）

```
aisep architecture suggest <intake.yaml>
```

执行流程：
1. **retrieve top-3 patterns** from `~/.aisep/reference-library/architecture-patterns/`，匹配 `intake.constraints` / `domain` / `tech-stack`
2. **AI fan-out 3 candidate briefs**（2 from retrieved patterns + 1 from-scratch）
3. **reviewer agent 推荐**（基于 7 问 anchor gate 预演 + risks.yaml 评估）
4. **用户选 1 个**进入 Phase B；其他 2 个归档到 `architecture/alternatives/`

**示例**：用户 intake.yaml `domain: erp` + `tech-stack: odoo` → retrieve `odoo-erp/` pattern → AI 改造为针对当前需求的 brief + fan-out 1 个 from-scratch → reviewer 推荐 → 用户选 odoo-erp 变体。

## 5. 7 问 anchor gate（Phase A 必过）

对应 RUP LCA + vessel CLAUDE.md "Layered Spiral Delivery"：

| # | 问题 | 必须证据 |
|---|------|---------|
| 1 | **数据模型** | 核心实体 schema 冻结（zod 表达），at least 3 个核心实体 + 字段类型 + 关系；不允许"待定" |
| 2 | **协议** | 进程间 / 网络 / 文件 wire protocol 冻结（JSON Schema or zod or OpenAPI）；包含 happy path + error path |
| 3 | **兼容** | 列出与既有 vessel/eva/HARNESS_* 兼容性矩阵（不破坏现有 invariant R1-R10）；如果有 break 必须列 migration plan |
| 4 | **不可逆决策** | 列出 3 项以上不可逆决策，每项有 ADR + 主要 risk 退化方案 |
| 5 | **权限** | fs / net / exec 权限边界清晰；列出 AISEP 需要的最小权限集 |
| 6 | **资源争用** | 并发 / lockfile / SQLite 连接 / pnpm workspace 冲突点全部识别 + 解决方案 |
| 7 | **Rollback** | 列出失败回退路径（LKG snapshot / git reset / config rollback）；至少描述 1 个"AISEP 改 AISEP 失败时如何回退"场景 |

**Gate 检查方式**：
- 自动：CI lint 检查 risks.yaml 是否包含 7 个对应 risk_id（risk_id 命名 `Q1` ~ `Q7`）
- 半自动：reviewer agent 用 prompt template `gate-check.hbs` 评估每项是否充分
- 手动：用户最终 ack（在 CLI 里 `aisep architecture approve --gate` 触发）

## 6. 修订循环约束（反 sycophancy + 防 AI slop）

调研依据：
- CodeRabbit 2025-12: AI-coauthored PR 含 1.7× more issues
- Stack Overflow 2025: 信任度 40%→29%；66% 开发者修"差一点"AI 代码
- SycEval: 58.19% 谄媚率
- Anthropic Code Review 2026-03: logic-only review focus

**约束 1：producer-reviewer ping-pong 上限 2 轮**

```
draft v1 → reviewer comments → revise v2 → reviewer comments → revise v3 (终止)
                                                                    ↓
                                                       第 3 轮必须 cut scope
                                                       （不允许第 3 轮 ping-pong）
```

CI 强制：`aisep-core` 内 attempt 表 `attempt_n > 2 && stage='architecture' → raise`。

**约束 2：状态机 `draft → fact-checked → approved`**

```
draft       # AI 初稿
  ↓
fact-checked # AI adversarial self-review（argue 最强反方案，反 sycophancy）
  ↓
approved    # 用户最终 ack
```

每个状态都写入 `stage_run.status` + `attempt` 表。

**约束 3：adversarial self-review prompt**

AI 在 draft → fact-checked 转换时必须：
1. 列出本方案最强 3 个反对意见
2. 对每个反对意见给出"我为什么仍坚持本方案"
3. 如果有任何反对意见无法反驳 → 退回 draft 修订

prompt template 存 `~/.aisep/reference-library/prompt-templates/adversarial-self-review.hbs`：
```hbs
你刚刚产出 architecture brief 草案。现在切换角色为对抗性 reviewer——
请列出本方案最强 3 个反对意见（特别是非 Anthropic 生态的替代方案 / 训练数据后出现的新工具）。

对每个反对意见：
1. 反对者会说什么？
2. 我（producer）为什么仍坚持本方案？
3. 如果无法反驳，是否应该退回修订？

⚠️ 不允许 "我觉得这个意见有道理但..." 之类的谄媚回答。要么有理有据反驳，要么承认退回。
```

**约束 4：logic-only review focus**

reviewer agent prompt 明确禁止 review：
- ❌ style / grammar / 拼写
- ❌ 文档完整性（如"§3 应该写得更详细"）
- ❌ 命名风格

只 review：
- ✓ 7 问 anchor gate 是否满足
- ✓ trace_id 链是否完整（REQ→ADR→ZOD→RISK）
- ✓ 反方案考虑是否充分
- ✓ machine-verifiable artifact 是否齐全

**约束 5：comment 必须绑定 artifact + trace_id**

review verdict 中的 comment 必须形如：
```yaml
- target: decisions/0002-stage-dag.md
  trace_id: ADR-002
  severity: critical | major | minor
  comment: "<具体问题>"
  suggested_action: "revise" | "accept-with-followup" | "drop"
```

不允许"整体感觉不对"这种不可执行反馈。

## 7. machine-verifiable trace_id 链

```
REQ-001 (requirements.yaml)
  ↓ realized by
ADR-002 (decisions/0002-stage-dag.md)
  ↓ contracts
ZOD-StageRun (contracts-seed.ts)
  ↓ mitigates
RISK-Q1 (risks.yaml)
```

`trace.yaml` schema：
```yaml
chains:
  - id: trace-001
    requirement: REQ-001
    adrs: [ADR-002]
    contracts: [ZOD-StageRun]
    risks: [RISK-Q1]
    artifacts:
      - workspace.dsl#Container.AISEPCore
      - decisions/0002-stage-dag.md
      - contracts-seed.ts:StageRun

orphans:        # 没有上游 requirement 的 artifact（必须填补，不允许 orphan）
  - artifact: <path>
    reason: <why orphan>
```

CI 检查：`aisep architecture verify-trace` 命令扫描 trace.yaml，任何 orphan = 失败。

## 8. 产物物理结构（最终）

```
docs/aisep/projects/<name>/architecture/
├── brief.md                       # Phase A 主文档（≤ 5 页）
├── workspace.dsl                  # C4-light（Phase A: Context+Container；Phase B: +Component）
├── workspace.json                 # structurizr export 派生（下游 agent query）
├── decisions/
│   ├── 0001-tech-stack.md         # Phase A 出 0001-0003（high-level）
│   ├── 0002-data-model.md
│   ├── 0003-protocol.md
│   ├── 0004-impl-backend.md       # Phase B slice 出 0004+（slice-level）
│   ├── 0005-impl-frontend.md
│   └── ...
├── contracts-seed.ts              # 草案（contract stage 才冻结）
├── risks.yaml                     # Fairbanks risk-driven + Arc42 §10 子集（含 Q1-Q7 anchor gate 对应 risk）
├── trace.yaml                     # REQ→ADR→ZOD→RISK trace_id 链
└── alternatives/                  # fan-out 落选的候选 brief（归档）
    ├── alt-1-from-scratch.md
    └── alt-2-react-native.md
```

## 9. agent profile 调用方式

architecture stage 用到 3 个 agent profile：

| Profile | 阶段 | 模型 | 工作 |
|---------|------|------|------|
| `architect` | Phase A draft | claude opus | 生成 3 候选 brief + Phase A artifact |
| `architect` | Phase B draft per slice | claude opus | 生成 slice detail + ADR + contract-seed |
| `reviewer-cross` | fact-check + review | cursor-agent (gpt-5.5-medium, plan mode) | 异构 review，adversarial self-review，反 Claude 集体盲区 |

调用范式（详见 [02_methodology-v0.1.md §6](02_methodology-v0.1.md)）：
- `claude --print` for `architect`
- `~/.claude/skills/survey/run-cursor-agent.sh` 模板 for `reviewer-cross`

## 10. 完成态检查表（v0 验收用）

- [ ] Phase A artifact 5 件套（workspace.dsl + decisions/0001-0003 + risks.yaml + requirements.yaml 增量 + brief.md）齐全
- [ ] Phase A hard limit 全部通过（≤ 5 页 / ≤ 1800 字 / ≤ 3 ADR / ≤ 2 图）
- [ ] 7 问 anchor gate 全部通过（risks.yaml 含 Q1-Q7 + 用户 CLI ack）
- [ ] adversarial self-review 完成（fact-checked 状态）
- [ ] Phase B 至少 1 个 slice 通过
- [ ] trace.yaml 无 orphan
- [ ] ping-pong ≤ 2 轮

## 11. 关键参考

- 完整 plan：`~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md`
- 上游：[02_methodology-v0.1.md](02_methodology-v0.1.md)
- 下游：[04_global-memory-ontology.md](04_global-memory-ontology.md)（reference-library 检索）

调研依据：
- SmartBear/Cisco 200-400 LOC review 上限
- Bacchelli & Bird ICSE 2013（reviewer 真瓶颈是理解负担）
- TC39 Stage 0-4 maturity stage 切分
- Mozilla 5 mini-stage architecture review
- Anthropic Code Review tool 2026-03（logic-only + multi-agent + 三级 severity）
- Fairbanks Risk-Driven Architecture（"做多少架构"元规则）
- Effective Architecture Reviews Ledwith 2025（async 48-72h + 1-page）
