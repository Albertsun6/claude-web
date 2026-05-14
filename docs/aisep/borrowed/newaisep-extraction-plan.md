# newaisep 文件抽取清单 + Odoo Pattern 搬运计划

> Status: Draft (Phase 0 文档，2026-05-11)
> Source: `~/Desktop/newaisep`（用户 v1.0 MVP，Python + Pydantic + Jinja2 + Gemini，实战 7 workspaces）
> 修订：原 plan 说"删除 newaisep Odoo 特化代码"是错的——按 Q10 决策**Odoo 特化部分搬进 reference-library/architecture-patterns/odoo-erp/** 作为可选 pattern

## 1. 抽取原则

| 类别 | 处置 |
|------|------|
| **架构思想 / pattern** | 借鉴 → 重写为 TS（不直接搬 Python 代码） |
| **Odoo 特化代码** | 搬进 `~/.aisep/reference-library/architecture-patterns/odoo-erp/`（不删） |
| **Gemini Antigravity Agent 调用** | 丢弃，AISEP 改用 `claude --print` 子进程 |
| **Jinja2 模板** | 移植为 Handlebars（newaisep `*.j2` → AISEP `*.hbs`） |
| **Pydantic schema** | 翻译为 zod schema |
| **JSON 数据** | 直接搬（evolution_log.json 等） |
| **workspaces 实战数据** | 选 1-2 个作为 AISEP odoo-erp pattern 的 `examples/` |
| **dashboard-ui** | 不搬（v0/v1 CLI only；v2+ 再考虑） |
| **tests** | 不直接搬（AISEP 重新写 TS 测试） |
| **docs/aisep/** | 部分参考（架构思想），不直接搬 markdown |

## 2. 详细抽取映射

### 2.1 核心思想 → AISEP TS 重写

| newaisep 源文件 | AISEP 目标位置 | 处置 | 说明 |
|----------------|--------------|------|------|
| `src/aisep/core/orchestrator.py` | `packages/aisep-core/src/orchestrator.ts` | 借鉴 → 重写 | M1-M7 stage chain 通用化为 10-stage DAG state machine |
| `src/aisep/core/prompt_manager.py` | `packages/aisep-agents/src/prompt-compiler.ts` | 借鉴 → 重写 | Native Agent Compiler 范式：模板渲染 → task.md → spawn 子进程 |
| `src/aisep/core/state_evaluator.py` | `packages/aisep-core/src/state-machine.ts` | 借鉴 → 重写 | stage_run status 状态机评估 |
| `src/aisep/core/step_handlers*.py` | `packages/aisep-core/src/stage-executor.ts` | 借鉴 → 重写 | 每 stage 的 input/output/gate 执行逻辑 |
| `src/aisep/core/evolution_memory.py` | `packages/aisep-memory/src/local.ts` | 借鉴 → 重写 | Workspace pending memory |
| `src/aisep/core/evolution_global.py` | `packages/aisep-memory/src/global.ts` | 借鉴 → 重写 | Global verified memory + promote 机制 |
| `src/aisep/core/evolution_models.py` | `packages/aisep-protocol/src/memory-types.ts` | Pydantic → zod | MemoryRecord schema |
| `src/aisep/core/ir_models.py` | （Odoo 特化）→ `~/.aisep/reference-library/architecture-patterns/odoo-erp/contract-seed.ts` | 搬进 reference-library | Odoo ORM IR schema，作为 odoo-erp pattern 一部分 |
| `src/aisep/core/snapshot_manager.py` | `packages/aisep-core/src/snapshot.ts` | 借鉴 → 重写 | Golden snapshot + LKG 兜底（Q5 self-host 关键） |
| `src/aisep/core/sprint_planner.py` | `packages/aisep-core/src/dag-scheduler.ts` | 借鉴 → 重写 | DAG ready queue 调度（v1+） |

### 2.2 Validators / Schema → 通用化

| newaisep 源 | AISEP 目标 | 处置 |
|------------|----------|------|
| `src/aisep/validators/engine.py` | `packages/aisep-core/src/gate-engine.ts` | 借鉴 → 重写为通用 gate 框架 |
| `src/aisep/validators/schema_validator.py` | （依赖 zod 内置） | 不直接搬，zod 替代 |
| `src/aisep/validators/semantic_rules.py` | `packages/aisep-core/src/semantic-rules.ts` | 借鉴 → 重写（去 Odoo 特化） |
| `src/aisep/validators/m5_validator.py` | `~/.aisep/reference-library/architecture-patterns/odoo-erp/validators/` | 搬进 reference-library（Odoo 特化） |
| `src/aisep/validators/registry.py` | `packages/aisep-core/src/validator-registry.ts` | 借鉴 → 重写 |
| `src/aisep/validators/yaml_parser.py` | （用 npm `yaml` 包） | 不搬 |
| `src/aisep/validators/report.py` | `packages/aisep-core/src/verify-report.ts` | 借鉴 → 重写 |
| `src/aisep/models/odoo_schema.py` | `~/.aisep/reference-library/architecture-patterns/odoo-erp/contract-seed.ts` | **搬进 reference-library**（核心 Odoo schema！） |

### 2.3 Agents → 通用 stage executor + Odoo 特化部分搬

| newaisep 源 | AISEP 目标 | 处置 |
|------------|----------|------|
| `src/aisep/agents/m6_verifier.py` | `packages/aisep-core/src/stages/verify.ts` | 借鉴通用部分 → 重写；Odoo 特化（如 Odoo registry init）搬进 odoo-erp pattern |
| `src/aisep/agents/m7_test_generator.py` | `~/.aisep/reference-library/architecture-patterns/odoo-erp/test-generator.hbs` | 搬进 reference-library（Dependency Graph fixture 思想 + Odoo TransactionCase 特化） |
| `src/aisep/agents/m8_bdd_verifier.py` | `~/.aisep/reference-library/architecture-patterns/odoo-erp/bdd-verifier.md` | 搬进 reference-library（Odoo 前端 BDD 验证特化） |
| `src/aisep/agents/test_compiler.py` | 部分通用 → `packages/aisep-core/src/test-compiler.ts`；Odoo 特化 → odoo-erp pattern |  |
| `src/aisep/agents/test_runner.py` | 同上 |  |

### 2.4 Templates → Handlebars 移植

| newaisep 源 | AISEP 目标 | 处置 |
|------------|----------|------|
| `src/aisep/templates/m2_system_architect.j2` | `~/.aisep/reference-library/architecture-patterns/odoo-erp/handlebars-templates/m2-architect.hbs` | **j2 → hbs 移植**，搬进 odoo-erp pattern |
| `src/aisep/core/prompts/*.j2` | 通用部分 → `~/.aisep/reference-library/prompt-templates/*.hbs`；Odoo 特化 → odoo-erp pattern | 逐个评估 |

### 2.5 Schemas → JSON Schema / zod

| newaisep 源 | AISEP 目标 |
|------------|-----------|
| `schemas/domain_model.schema.json` | `~/.aisep/reference-library/architecture-patterns/odoo-erp/schemas/domain-model.json`（Odoo 特化保留 JSON Schema 格式） |
| `schemas/components/*` | 同上，按需 |
| `schemas/examples/*` | 同上 |

### 2.6 Workspaces 实战数据 → odoo-erp pattern 的 examples

newaisep 有 7 个实战 workspaces。选 1-2 个有代表性的搬进 odoo-erp pattern 作为 `examples/`：

| workspace | 处置 |
|-----------|------|
| `parking_final/` | **搬**（最完整的 ship 案例，作为 odoo-erp pattern 标杆 example） |
| `wms_v3/` | **搬**（最新版本 WMS，体现 odoo-erp 复杂场景） |
| `wms_v2/` | 不搬（被 v3 取代） |
| `phone_repair/` | 不搬（与 parking_final 相似） |
| `warehouse_stress/` | 不搬（实验性） |
| `parking_v1/` | 不搬（被 final 取代） |
| `archive/` | 不搬 |

每个搬进来的 workspace 简化为：
```
~/.aisep/reference-library/architecture-patterns/odoo-erp/examples/<name>/
├── seed.txt           # 原始用户输入
├── srs.md             # M1 BA 产出
├── models.yaml        # M2 Architect 产出
├── workspace.dsl      # 用 AISEP C4-light 重画（手动 + AI 协助）
└── retrospect.md      # 该案例的关键学习点
```

### 2.7 全局数据 → 直接搬

| newaisep 源 | AISEP 目标 |
|------------|-----------|
| `global_evolution_log.json` | `~/.aisep/governance-log/evolution_log.json` | **直接搬**（schema 通用化：domain/tech_stack 标签从 Odoo-only 改为可扩展） |

搬运后 schema 升级脚本（一次性）：
```typescript
// scripts/migrate-newaisep-evolution-log.ts
function migrate(oldRecord: NewaisepFix): MemoryRecord {
  return {
    id: oldRecord.id,
    stage: mapM1M7ToAisepStage(oldRecord.phase),  // M1→intake / M2→architecture / M5→implement / M6→verify / M7→verify
    failure_pattern: oldRecord.failure_pattern,
    fix: oldRecord.fix,
    source: 'newaisep/' + oldRecord.workspace,
    verified_by: 'human',
    applies_to: {
      domain: ['erp'],          // 原 newaisep 都是 erp
      stage: [mapM1M7ToAisepStage(oldRecord.phase)],
      tech_stack: ['odoo', 'python'],
    },
    ship_count: oldRecord.ship_count ?? 1,
    promote_count: 1,
  };
}
```

### 2.8 不搬的内容

| 内容 | 不搬理由 |
|------|---------|
| `dashboard-ui/` | v0/v1 CLI only；v2+ 再考虑借鉴（不直接搬代码） |
| `tests/` | TS 全栈，重新写 vitest |
| `scripts/` | newaisep 工具脚本（audit_ai_context.py / sync_to_wiki.sh）—— 用 vessel 已有工具或写 TS 等价 |
| `voice_logs/` | newaisep 私人语音日志，与 AISEP 无关 |
| `.gemini/` / `GEMINI.md` | Gemini 特定，AISEP 不用 |
| `.geminiignore` | 不需要 |
| `.venv/` | Python 虚拟环境，AISEP 是 TS |
| `.ruff_cache/` / `.pytest_cache/` | Python 工具 cache |
| `pyproject.toml` / `uv.lock` | Python 依赖描述，AISEP 用 pnpm |

### 2.9 文档参考（不直接搬）

| newaisep 源 | 参考用途 |
|------------|---------|
| `README.md` | 参考定位描述风格 |
| `docs/api_reference.md` | 参考 CLI 命令命名（`memory show/stats/promote`） |
| `docs/directory_guide.md` | 参考 `.agents/` 目录约定 → AISEP `.aisep/` |
| `docs/ai_context_standard.md` | 借鉴 Token 效率铁律到 AISEP `standards-info-base/token-efficiency.md` |
| `docs/aisep/01_vision_scope.md` | 参考定位段落结构（AISEP 自己的 `01_vision_scope.md` 已重写） |
| `docs/aisep/03_methodology_engine.md` | 参考方法论文档结构 |
| `docs/aisep/07_evolution_aiops.md` | 参考 AlphaEvolve 详细机制 |

## 3. 执行清单（Phase 0 完成后逐项做）

### 阶段 1：搬全局数据（30 分钟）
- [ ] 创建 `~/.aisep/{landscape,reference-library,standards-info-base,governance-log}/` 目录
- [ ] 写 schema 升级脚本 `packages/aisep-memory/scripts/migrate-newaisep-evolution-log.ts`
- [ ] 跑脚本：`global_evolution_log.json` → `~/.aisep/governance-log/evolution_log.json`（含 schema 升级）

### 阶段 2：创建 odoo-erp pattern 骨架（半天）
- [ ] `~/.aisep/reference-library/architecture-patterns/odoo-erp/PATTERN.md`（写 when to use / when NOT / provenance）
- [ ] `~/.aisep/reference-library/architecture-patterns/odoo-erp/workspace.dsl`（C4 模板，手画 + AI 协助）
- [ ] 搬 `src/aisep/models/odoo_schema.py` → `odoo-erp/contract-seed.ts`（Pydantic → zod 翻译）
- [ ] 搬 `src/aisep/core/ir_models.py` → `odoo-erp/contract-seed.ts`（合并到一个文件）
- [ ] 搬 `src/aisep/templates/m2_system_architect.j2` → `odoo-erp/handlebars-templates/m2-architect.hbs`（j2 → hbs）
- [ ] 搬 `src/aisep/validators/m5_validator.py` 的规则 → `odoo-erp/risks.yaml`（Odoo ORM 幻觉拦截）
- [ ] 搬 `src/aisep/agents/m7_test_generator.py` 思想 → `odoo-erp/handlebars-templates/test-generator.hbs`

### 阶段 3：搬 workspaces 实战 example（2-4 小时）
- [ ] 搬 `parking_final/` 简化版 → `odoo-erp/examples/parking-management/`
- [ ] 搬 `wms_v3/` 简化版 → `odoo-erp/examples/wms/`
- [ ] 每个 example 写 `retrospect.md` 总结学习点

### 阶段 4：借鉴 newaisep 思想写 aisep-core（属于 Phase 2，不在 Phase 0）
- 不展开，见 plan 文件 Phase 2 步骤

### 阶段 5：清理桌面 newaisep（最后一步）
- [ ] 确认 `~/.aisep/` 数据齐全
- [ ] 确认 odoo-erp pattern 5 件套齐全
- [ ] 备份 `~/Desktop/newaisep` 到 `~/Desktop/newaisep-archive-<YYYY-MM-DD>.tar.gz`
- [ ] 删除 `~/Desktop/newaisep/`（per Q6 决策）

## 4. 验收标准（Phase 0 阶段 1-3 验收）

- [ ] `~/.aisep/` 四区目录建立
- [ ] `evolution_log.json` 含 newaisep 历史记录，schema 通过 zod 校验
- [ ] `odoo-erp` pattern 包含 PATTERN.md + workspace.dsl + contract-seed.ts + handlebars-templates/ + risks.yaml（5 件套齐全）
- [ ] 至少 1 个 example（parking-management）含 seed + srs + models + workspace.dsl + retrospect.md
- [ ] AISEP CLI 能 `aisep memory show --global` 显示借鉴来的 fix 记录

## 5. 风险

| 风险 | 缓解 |
|------|------|
| Pydantic → zod 翻译漏字段 | 单独 review checklist；diff `odoo_schema.py` 和 `contract-seed.ts` 字段名 1-1 对照 |
| Jinja2 → Handlebars 语法差异 | newaisep `j2` 主要用 `{{ var }}` + `{% if %}` + `{% for %}`，Handlebars 等价；复杂宏可能要拆分 |
| Odoo 18 语法时效性 | `<list>` vs `<tree>` 等规则可能过期——searate ADR 记录 Odoo 版本，pattern 升级时同步 |
| newaisep 私人 workspaces 含 secret | 搬 example 前 grep 检查 API key / DB connection string |

## 6. 关键参考

- newaisep 源仓库：`~/Desktop/newaisep`
- AISEP plan 完整文档：`~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md`
- 上游：[04_global-memory-ontology.md](../04_global-memory-ontology.md)
- ADR：[ADR-018 aisep-vs-harness](../../adr/vessel/ADR-018-aisep-vs-harness.md)
