# Harness 文档索引

> **用途**：harness 演进的所有相关文件总入口。每次进 harness 话题先看这里，知道去哪里找想看的内容。
>
> **状态**：v0.2（2026-05-01）。新文件加入时同步追加。

---

## 推荐阅读顺序（第一次接触）

1. [HARNESS_ARCHITECTURE.md](HARNESS_ARCHITECTURE.md) — 看完整分层架构图 + 每层职责
2. [HARNESS_LANDSCAPE.md](HARNESS_LANDSCAPE.md) — 了解市场上同类工具的位置
3. [HARNESS_ROADMAP.md](HARNESS_ROADMAP.md) — plan v4 主文档：原则 + 里程碑 + 评审辩论流水
4. [HARNESS_DATA_MODEL.md](HARNESS_DATA_MODEL.md) — 数据模型实体定义
5. [HARNESS_AGENTS.md](HARNESS_AGENTS.md) — Agent 角色 + 模型策略 + 评审矩阵
6. [HARNESS_RISKS.md](HARNESS_RISKS.md) — 完整风险清单与缓解

---

## 完整文件清单

### 核心架构与 plan

| 文件 | 用途 | 状态 |
|---|---|---|
| [HARNESS_INDEX.md](HARNESS_INDEX.md) | **本文** — 所有 harness 文件总入口 | 维护中 |
| [HARNESS_ARCHITECTURE.md](HARNESS_ARCHITECTURE.md) | 完整分层架构图（6 层 + L7 横切）+ 每层职责 + 跨层数据流 + 关键不变量 | M-1 第 1 项交付物，已建首版 |
| [HARNESS_ROADMAP.md](HARNESS_ROADMAP.md) | plan v4 主文档：Context、20 条设计原则、里程碑（M-1 → M4，M4 终点）、Open Questions、§18 评审 skill 草案、评审辩论流水 | 待办路线图，单一文件 |
| [HARNESS_LANDSCAPE.md](HARNESS_LANDSCAPE.md) | 竞品全景图：hapi / Paseo / Multica / OpenHands 等横向对比 + 战略含义（L1/L2 不卷、L3+L7 集中投入）+ 代码搬运规则（个人自用情形）| 维护中 |

### 子主题（从 ROADMAP 拆分出的独立详档）

| 文件 | 用途 | 状态 | 对应 ROADMAP 段号 |
|---|---|---|---|
| [HARNESS_DATA_MODEL.md](HARNESS_DATA_MODEL.md) | 数据模型完整定义：Project / Initiative / Issue / Stage / Task / Run / Artifact / ContextBundle / Methodology / ReviewVerdict / Decision / Retrospective / IdeaCapture | 拆分自 §1 | §1 |
| [HARNESS_AGENTS.md](HARNESS_AGENTS.md) | Agent 角色（12 个 Profile）+ 模型策略（复杂度自适应）+ 多 AI 交叉评审矩阵 + 评审独立性约束 | 拆分自 §2 | §2 |
| [HARNESS_RISKS.md](HARNESS_RISKS.md) | 18 条完整风险清单与缓解策略，按重要性分组 | 拆分自 §7 | §7 |

### M-1 4 个核心契约（分阶段产出）

按 plan v4 §6.1 的窄腰策略，M-1 必产 4 个核心契约。Round 1 评审采纳 "M-1 分阶段"：每契约自己的 ritual gate，不一次性 lock-step。

| # | 文件 | 状态（2026-05-03，Round 1 后） | 守门 |
|---|---|---|---|
| #1 | [`HARNESS_DATA_MODEL.md`](HARNESS_DATA_MODEL.md) + [`adr/ADR-0010`](adr/ADR-0010-sqlite-fts5.md) + [`adr/ADR-0015`](adr/ADR-0015-schema-migration.md) + `migrations/0001_initial.sql` + `harness-store.ts` + `test-harness-schema.ts` | **Round 1 评审完成，正在落 fix**（B1+B2 + 12 MAJOR/MINOR） | `pnpm --filter @claude-web/backend test:harness-schema` |
| #2 | [`HARNESS_PROTOCOL.md`](HARNESS_PROTOCOL.md) + [`adr/ADR-0011`](adr/ADR-0011-server-driven-thin-shell.md) + `harness-protocol.ts` + `fixtures/harness/` + `HarnessProtocol.swift` + 测试 | **doc only**（contract #1 修复完成后开工） | `node scripts/verify-m1-deliverables.mjs` |
| #3 | `HARNESS_CONTEXT_PROTOCOL.md` + ADR-0014 | 未起步 | 同上 |
| #4 | `HARNESS_PR_GUIDE.md` + ADR-0013 + `.github/PULL_REQUEST_TEMPLATE.md`（已有，需 harness 段补充）+ `COMMIT_CONVENTION.md` + `branch-naming.md` + `git-guard.mjs` + `prod-guard.mjs` | 未起步 | 同上 + git-guard dev 拒绝场景测试 |

**M-1 验收**（脚本驱动，非自报）：
- `node scripts/verify-m1-deliverables.mjs` 必须 0 missing
- 所有 contract 通过 Round N 评审（每契约至少一轮 arch + cross verdict）

### 待相应 Stage 进入时再写（占位）

按 plan §6.1，这些文件 M-1 时只留大纲 + TBD 标记，进入对应 Stage 时由方法论 ritual 补完：

| 文件 | 状态 |
|---|---|
| `docs/HARNESS_DIRECTORY.md` | TBD（占位） |
| `docs/HARNESS_REVIEW_MATRIX.md` | TBD（占位）—— review matrix 草案在 [HARNESS_AGENTS.md §3](HARNESS_AGENTS.md) |
| `docs/HARNESS_MODEL_POLICY.md` | TBD（占位）—— 简版在 [HARNESS_AGENTS.md §2](HARNESS_AGENTS.md) |
| `methodologies/00-discovery.md` | TBD（M-1 必产） |
| `methodologies/01-spec.md` | TBD（M-1 必产，企业字段必填段） |
| `methodologies/02..10` | TBD（进 Stage 时再敲，占位） |

### 关联资源（不在项目仓库内）

| 路径 | 用途 |
|---|---|
| `~/.claude/plans/workflow-expressive-canyon.md` | plan v4 原始副本（自动保存于 plan mode）；与 HARNESS_ROADMAP.md 同步维护 |
| `~/.claude/skills/debate-review/SKILL.md` | 评审辩论 skill 实现 — 每次外部评审都用 |
| `~/.claude/skills/debate-review/log.jsonl` | 辩论历史日志（≥5 条触发 SKILL.md 自我完善） |
| `~/.claude/projects/-Users-yongqian-Desktop-claude-web/memory/MEMORY.md` | 长期会话 memory（用户工作风格、不做时间估算等元 feedback） |

---

## 跨文档关键约束（贯穿所有 harness 文件）

这些约束在多份 doc 里被重复强调；任何修改都必须同步检查所有文档保持一致：

1. **永不调用 Anthropic Agent SDK** — 所有 LLM 工作走 spawn `claude` CLI（HARNESS_ARCHITECTURE.md L4 + HARNESS_ROADMAP.md §0 #2）
2. **iOS thin shell + server-driven** — iOS 改一次锁死（HARNESS_ARCHITECTURE.md L1 + HARNESS_ROADMAP.md §0 #1）
3. **不做日历时间估算** — 用准入/退出条件推进（HARNESS_ROADMAP.md §0 #13 + §6）
4. **L1/L2 不与已有强对手卷** — hapi/Paseo 已成熟，集中预算到 L3+L7（HARNESS_LANDSCAPE.md §2 + HARNESS_ROADMAP.md §0 #19）
5. **纯个人自用，永不分发** — Seaidea 不分发、不商业化、不团队化；AGPL 等 copyleft license 的代码可直接搬运，保留版权声明即可（HARNESS_ROADMAP.md §0 #13、§0 #20 + HARNESS_LANDSCAPE.md §3）

---

## 维护规则

### 何时更新本文

- 新增 harness 相关文件 → 加入相应分组
- 文件状态变化（占位 → 已建首版 → M-1 完工 → M2 完工）→ 更新状态列
- ROADMAP 拆分新章节出去 → 加到"子主题"分组

### 阅读建议

- 第一次接触：按"推荐阅读顺序"
- 找具体设计：用文件清单表的"用途"列定位
- 找某条原则：用"跨文档关键约束"段
- 想知道还没写什么：看"待 M-1 创建"和"待相应 Stage 时再写"段
