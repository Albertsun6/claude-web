# AISEP 跨项目记忆库 ontology — `~/.aisep/` 四区设计

> Status: Draft (Phase 0 文档，2026-05-11)
> Source: TOGAF Architecture Repository（4 区映射）+ newaisep AlphaEvolve 双层记忆 + 用户 Q10 决策（架构方案库 + odoo-erp pattern 沉淀）

## 1. 为什么需要跨项目记忆库

调研发现：业界 AI coding tool（Cursor / Cline / Aider / Devin / OpenHands）的共同短板——**AI 单次会话产出无法跨工程沉淀**，每个新项目都从零开始。

AISEP 反其道而行：**沉淀**才是核心价值。借鉴：
- newaisep AlphaEvolve 双层记忆（workspace pending → global verified promote）
- TOGAF Architecture Repository（4 区分类 ontology）
- Anthropic Code Review tool 2026-03（patterns / failure-patterns 持久化）

## 2. 四区 ontology（TOGAF 直接映射）

```
~/.aisep/                  # AISEP 全局记忆库（per [R10] 红线，不进 vessel git）
│
├── landscape/             # 当前 active workspaces 盘点
│   └── (TOGAF "Architecture Landscape"）
│
├── reference-library/     # 通用模式 / pattern catalog
│   └── (TOGAF "Reference Library"）
│
├── standards-info-base/   # 工程标准（Standards Information Base）
│   └── (TOGAF "SIB"）
│
└── governance-log/        # 跨项目 retrospective + AlphaEvolve global fixes
    └── (TOGAF "Architecture Governance Log"）
```

`.gitignore` 兜底：
```
# vessel root .gitignore
~/.aisep/    # ← AISEP 全局记忆库，绝不进 git
.aisep/      # ← workspace-level tmp，也不进 git
```

R10 红线：`aisep-memory` 包不允许 commit 任何 `~/.aisep/` 内容到 git。

## 3. landscape/ — 当前 active workspaces 盘点

跟踪所有 AISEP 当前服务的项目（一台 Mac 可能有多个项目同时用 AISEP）。

```
~/.aisep/landscape/
├── vessel.yaml           # vessel 项目（dogfood）
├── my-erp.yaml           # 用户 Odoo ERP 项目
├── pilot-bugfix-1.yaml   # 一次性 pilot
└── archive/              # 归档的已完成 workspace
    └── ...
```

每个 `<workspace>.yaml` schema：
```yaml
id: <uuid>
name: vessel
cwd: /Users/yongqian/Desktop/Vessel
status: active | archived
domain: ai-platform        # 用于 reference-library 匹配
tech_stack: [typescript, pnpm-monorepo, swift]
created_at: 2026-05-11
last_active: 2026-05-11
current_stage_run: <stage_run_id>
ship_count: 0              # 已 ship 的 retrospective 数
adopted_patterns:          # 此 workspace 用了 reference-library 的哪些 pattern
  - architecture-patterns/ts-monorepo-pnpm
```

**用途**：
- AISEP CLI `aisep workspace list` 显示
- vessel Capability App 装回后，VesselCore 读 landscape/ 决定服务哪些项目

## 4. reference-library/ — 通用模式 / pattern catalog

这是 Q10 决策的核心——**架构方案库**，Phase A 检索 + fan-out 来源。

```
~/.aisep/reference-library/
├── architecture-patterns/        # ★ 架构方案库
│   ├── odoo-erp/                 # ★ 从 newaisep 借鉴
│   ├── ts-monorepo-pnpm/         # vessel 自己用的模式
│   ├── react-native-app/         # 未来添加
│   └── cli-tool/                 # 未来添加
├── stage-templates/              # 每 stage 的 prompt + checklist 模板
│   ├── intake.hbs
│   ├── research.hbs
│   ├── plan.hbs
│   ├── architecture-brief.hbs
│   ├── architecture-detail.hbs
│   ├── contract.hbs
│   ├── implement.hbs
│   ├── verify.hbs
│   ├── review.hbs
│   ├── integrate.hbs
│   └── retrospect.hbs
├── adr-templates/                # MADR 模板
│   └── madr-2-1-2.md
└── prompt-templates/             # agent profile 通用 prompt 模板
    ├── adversarial-self-review.hbs   # 反 sycophancy
    ├── gate-check-7-questions.hbs    # 7 问 anchor gate
    └── cross-reviewer.hbs            # cursor-agent 异构 review
```

### 4.1 architecture-patterns/ 每个 pattern 的结构

```
architecture-patterns/<pattern-name>/
├── PATTERN.md           # 方案描述 + 适用条件 + 何时选用 + 何时不选用
├── workspace.dsl        # C4 模板（Phase A 起点）
├── adr-template/        # 该 pattern 推荐的 ADR 起步集
│   ├── 0001-tech-stack.md
│   └── 0002-data-model.md
├── contract-seed.ts     # zod schema 模板
├── handlebars-templates/  # 代码生成模板
│   ├── model.hbs
│   ├── view.hbs
│   └── ...
├── risks.yaml           # 该 pattern 的已知风险（Fairbanks risk-driven）
└── examples/            # 该 pattern 实际项目示例（可选）
    └── ...
```

### 4.2 PATTERN.md schema

```markdown
# Pattern: <name>

## When to use
- domain: <ERP / SaaS / CLI / mobile-app / ...>
- tech_stack: [<typescript>, <python>, ...]
- scale: <small / medium / large>
- 典型场景: <一句话>

## When NOT to use
- ❌ <场景 1>
- ❌ <场景 2>

## Architecture summary
<C4 Context 简述 + 关键决策清单>

## Provenance
- 来源: <newaisep / vessel / 公开开源 / ...>
- 引入日期: <YYYY-MM-DD>
- 实战覆盖: <N 个 workspace>

## Known risks
（链接到 risks.yaml 的关键 risk_id）

## 检索关键词
- domain: erp
- tech_stack: odoo, python
- pattern_type: monolith / microservice / event-driven / ...
```

### 4.3 检索 API（Phase A 用）

```bash
aisep architecture suggest <intake.yaml>
```

执行：
1. 解析 `intake.yaml` 的 `constraints` / `domain` / `tech-stack`
2. 在 `~/.aisep/reference-library/architecture-patterns/*/PATTERN.md` 里**全文 + 关键词匹配**
3. 评分 + ranking，top-3 输出
4. AI agent 改造 top-3 + 自由生成 1 个 from-scratch → fan-out 3-4 个 candidate brief

匹配算法（v0 简版）：
```typescript
// aisep-context/src/pattern-retrieval.ts (示意)

function rankPatterns(intake: Intake, patterns: Pattern[]): Ranked[] {
  return patterns
    .map(p => ({
      pattern: p,
      score:
        (p.domain === intake.domain ? 3 : 0) +
        intake.tech_stack.filter(t => p.tech_stack.includes(t)).length +
        keywordOverlap(p.keywords, intake.objectives) * 2,
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
```

v1+ 可升级为 embedding-based retrieval（如借用 vessel `packages/backend` 的 fastembed worker，受 [ADR-002](../adr/vessel/ADR-002-embedding-fastembed-via-python-worker.md) 启发）。

### 4.4 odoo-erp pattern（从 newaisep 借鉴的首个 pattern）

`~/.aisep/reference-library/architecture-patterns/odoo-erp/` 详细内容见 [borrowed/newaisep-extraction-plan.md](borrowed/newaisep-extraction-plan.md)。

简言之：
- newaisep `templates/` 下 Jinja2 模板 → `odoo-erp/handlebars-templates/`（j2 → hbs 移植）
- newaisep `src/aisep/models/` Pydantic schema → `odoo-erp/contract-seed.ts`（zod 等价）
- newaisep `M3` 校验规则（`FieldType(StrEnum)` 等）→ `odoo-erp/risks.yaml`（Odoo ORM 幻觉拦截规则）
- newaisep `M7 TestRunner Dependency Graph` 概念 → `odoo-erp/adr-template/0005-test-fixture-graph.md`

**关键约束**：odoo-erp pattern 是**可选**——AISEP core 不锁死 Odoo。用户开发其他类型软件（如 vessel 自身）时，AISEP 不会自动套用 odoo-erp。

## 5. standards-info-base/ — 工程标准（SIB）

跨项目共享的工程规范，每个 stage executor 拉取相关 SIB 作为 context。

```
~/.aisep/standards-info-base/
├── coding-conventions/
│   ├── typescript.md
│   ├── python.md
│   └── swift.md
├── git-workflow.md
├── security-checklist.md         # 4 hard triggers 之类
├── ai-collaboration-guidelines.md # 反 sycophancy / adversarial review 等
└── token-efficiency.md           # 文件尺寸约束 / SSOT / 冷热分层
```

每个 SIB 文件：
- markdown 格式
- 顶部 YAML frontmatter 含 `applies_to: [typescript, python, ...]` 用于 stage executor 选择性注入
- 内容简洁（≤ 3KB per file，遵守 token efficiency 自身规则）

## 6. governance-log/ — 跨项目 retrospective + AlphaEvolve

这是 **newaisep AlphaEvolve 全局免疫记忆引擎**的搬运 + 通用化。

```
~/.aisep/governance-log/
├── evolution_log.json         # ← AlphaEvolve global verified fixes（核心数据）
├── retrospectives/            # 所有 workspace 的 retrospective 归档
│   ├── vessel/
│   │   ├── pilot-01.md
│   │   ├── pilot-02.md
│   │   └── ...
│   ├── my-erp/
│   │   └── ...
│   └── ...
└── failure-patterns/          # 失败模式分类（按 stage / domain）
    ├── architecture-anti-patterns.md
    ├── contract-design-pitfalls.md
    └── verify-flaky-tests.md
```

### 6.1 evolution_log.json schema

```json
{
  "version": 1,
  "records": [
    {
      "id": "fix-001",
      "stage": "architecture",
      "failure_pattern": "Phase A 7 问 anchor gate 漏 Q7 Rollback",
      "fix": "Phase A artifact 必须显式包含 Q7 rollback path（risks.yaml Q7 risk_id 非空）",
      "source": "vessel/pilot-01",
      "verified_by": "human",
      "verified_at": 1715459000,
      "applies_to": {
        "domain": ["*"],
        "stage": ["architecture"],
        "tech_stack": ["*"]
      },
      "ship_count": 3,
      "promote_count": 1
    },
    {
      "id": "fix-002",
      "stage": "contract",
      "failure_pattern": "Odoo ORM 字段类型 string vs char 幻觉",
      "fix": "用 zod enum FieldType { char, text, integer, ... }，禁止裸 string",
      "source": "newaisep/parking_final + my-erp/v1",
      "verified_by": "human",
      "applies_to": {
        "domain": ["erp"],
        "stage": ["contract", "architecture"],
        "tech_stack": ["odoo", "python"]
      },
      "ship_count": 7,
      "promote_count": 1
    }
  ]
}
```

### 6.2 Pending → Promote 流程

```
workspace 失败 → 写入 <workspace>/.aisep/evolution_log.json (Pending)
                    ↓
            retrospect stage 用户 ack
                    ↓
        promote 到 ~/.aisep/governance-log/evolution_log.json (Global)
                    ↓
       新 workspace 跑同 stage → retrieveContext() 自动注入 global fix → AI agent 提前规避
```

CLI 命令：
```bash
# 查看本 workspace pending fixes
aisep memory show <workspace>

# 查看 global verified fixes
aisep memory show <workspace> --global

# 跨 workspace 失败 / 修复统计
aisep memory stats <workspace>

# 手动 promote
aisep memory promote <workspace> --stage architecture --fix "<人工 verify 后的修复说明>"
```

完全沿用 newaisep CLI 命名（详见 [borrowed/newaisep-extraction-plan.md](borrowed/newaisep-extraction-plan.md)）。

### 6.3 retrieveContext() 注入逻辑

```typescript
// aisep-context/src/retrieve.ts (示意)

async function retrieveContext(
  stage: Stage,
  inputs: StageInputs,
): Promise<MemoryRecord[]> {
  const globalLog = await readGlobalEvolutionLog();
  const intake = inputs.intake as Intake;

  return globalLog.records
    .filter(r => r.stage === stage)
    .filter(r =>
      r.applies_to.domain.includes('*') ||
      r.applies_to.domain.includes(intake.domain)
    )
    .filter(r =>
      r.applies_to.tech_stack.includes('*') ||
      r.applies_to.tech_stack.some(t => intake.tech_stack.includes(t))
    )
    .sort((a, b) => b.ship_count - a.ship_count)   // 实战次数多的优先
    .slice(0, 5);   // 注入 top-5 避免 prompt 膨胀
}
```

注入到 prompt 模板的 ContextBundle 字段：
```handlebars
{{#if memoryHits}}
## 跨项目经验（AlphaEvolve global memory）
{{#each memoryHits}}
- **{{this.failure_pattern}}** → {{this.fix}}（实战 {{this.ship_count}} 次）
{{/each}}
{{/if}}
```

## 7. Workspace 内 `.aisep/` 子目录

每个 workspace 内有局部 `.aisep/` 目录（不进 vessel git，但跟 workspace 同 cwd）：

```
<workspace_cwd>/.aisep/
├── tmp/                   # 临时文件（task.md / scratchpad / ...）
├── stage_runs.sqlite      # 本 workspace 的 stage_run / artifact / attempt 表
├── evolution_log.json     # Pending fixes（未 promote）
└── workspace.yaml         # 本 workspace 元数据（与 ~/.aisep/landscape/ 同步）
```

写到 `.gitignore`：
```
.aisep/
```

`.aisep/tmp/` 防 macOS 沙箱权限弹窗（newaisep `.agents/tmp/` 经验）。

## 8. 跨项目数据隔离与安全

- `~/.aisep/` 永远不进 vessel git（R10 红线 + .gitignore 兜底）
- 跨项目数据不混入 vessel 仓库（防止 vessel 公开时泄漏 my-erp 数据）
- `evolution_log.json` 中 `failure_pattern` / `fix` 字段不允许出现 secret（API key / password / 数据库连接串）
- AISEP CLI `aisep memory promote` 前自动 scan secret pattern，发现 → 拒绝 promote

## 9. AISEP 自身 self-host 时的兜底

AISEP 改 AISEP（Q5 决策）时，`~/.aisep/` 也是被修改对象之一（`reference-library/` 可能被 AISEP 自己加 pattern）：
- **金本位快照**：`tar -czf ~/.aisep/backup/aisep-lkg-<ts>.tgz ~/.aisep/`（每次 self-host 前自动）
- **回滚**：`aisep --bypass memory restore <ts>` 恢复 LKG 状态

## 10. v0/v1/v2/v3 引入节奏

| 区 | v0 | v1 | v2 | v3 |
|----|----|----|----|----|
| **landscape/** | 单 vessel workspace | 多 workspace 切换 | 多 workspace 并发 | 多 workspace + dynamic discovery |
| **reference-library/architecture-patterns/** | ts-monorepo-pnpm + odoo-erp（从 newaisep 搬） | + 检索 API + Phase A fan-out | + embedding-based retrieval | + AISEP 自动产 new pattern |
| **reference-library/stage-templates/** | 10 个 stage 基础模板 | 模板 versioning | 模板 fan-out | 模板 self-improving |
| **standards-info-base/** | typescript + git workflow + security | + python（为 odoo-erp）+ swift | + AI collab guidelines | + 用户自定义 |
| **governance-log/evolution_log.json** | 手动 promote（newaisep CLI 同款） | 自动 retrieve 注入 prompt | 自动 promote 候选 | 自动失败模式聚类 |

## 11. 关键参考

完整 plan：`~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md`

调研依据：
- **TOGAF Architecture Repository** 4 区分类
- **newaisep AlphaEvolve** 双层免疫记忆（v1.0 MVP 7 workspace 实战）
- 用户 Q10 决策（架构方案库 + odoo-erp pattern 沉淀）

相关 ADR / doc：
- [ADR-018 aisep-vs-harness](../adr/vessel/ADR-018-aisep-vs-harness.md)
- [02_methodology-v0.1.md](02_methodology-v0.1.md)
- [03_architecture-stage-spec.md](03_architecture-stage-spec.md)
- [borrowed/newaisep-extraction-plan.md](borrowed/newaisep-extraction-plan.md)
