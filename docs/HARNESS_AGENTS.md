# Harness Agents — 角色 / 模型策略 / 评审矩阵

> **状态**：v0.1（2026-05-01）。
>
> **导航**：[索引](HARNESS_INDEX.md) · [Architecture](HARNESS_ARCHITECTURE.md) · [Roadmap](HARNESS_ROADMAP.md) · [Data Model](HARNESS_DATA_MODEL.md)
>
> **同源**：本文是 [HARNESS_ROADMAP.md §2](HARNESS_ROADMAP.md) 的扩展版。

---

## 0. AgentProfile 抽象

```ts
type AgentProfile = {
  id: string;
  name: string;
  systemPromptTemplate: string;
  skillNames: string[];               // 复用 Claude CLI .claude/skills/ 自动激活
  toolAllowlist: string[];            // 限死能调的工具（如 "Bash(git *)"）
  modelHint: 'opus' | 'sonnet' | 'haiku' | 'auto-by-complexity';
  defaultPermissionMode: 'plan' | 'default' | 'acceptEdits';
  requiresWorktree: boolean;
  parallelizable: boolean;
  contextBudget: {
    maxArtifacts: number;
    maxTokens: number;
    mustInclude: string[];            // Artifact kind 列表
    mayInclude: string[];
  };
  reviewerRole?: 'cross' | 'compliance' | 'architecture' | 'code';
};
```

**统一抽象的好处**：不重新发明 LLM 调用层；profile 在 runtime 渲染成一次 [packages/backend/src/cli-runner.ts:159](../packages/backend/src/cli-runner.ts#L159) `runSession`。

**通过 server-driven config 注册**：所有 profile 写在后端 `agents/profiles.ts`，热调可用，iOS 不重装即可看到新 profile。

---

## 1. 12 个默认 Profile

> **v4 调整**：Coder 改"复杂度自适应"；Documentor 推 M3；Reviewer-architecture 与 Reviewer-cross 在 M2 改 risk-triggered。

| Profile | Stage | 默认模型 | 上 M | 复用 Skill | 需 worktree | 并行 | reviewer 角色 |
|---|---|---|---|---|---|---|---|
| Strategist | strategy | Sonnet（轻量 checklist 模式不需要 Opus） | M2 | — | 否 | 是 | — |
| PM | discovery / spec | Sonnet | M1 | — | 否 | 是 | — |
| Reviewer-compliance | compliance | Sonnet | M3 | `security-review` | 否 | 是 | 评 spec（仅高风险触发，否则跳过） |
| Architect | design | **Opus** | M2 | `borrow-open-source` | 只读 | 是 | — |
| Reviewer-architecture | design | **Opus**（独立 prompt） | M2（risk-triggered）/ M3（全量） | — | 只读 | 是 | 评 design_doc |
| Coder | implement | **复杂度自适应** | M2 | `init` | **必需** | 是 | — |
| Tester | test | Sonnet | M2 | — | 共用 Coder worktree | 串行于 Coder | — |
| Reviewer-code | review | Sonnet（普通）/ Opus（high-risk） | M2 | `review` | 只读 | 是 | 评 patch |
| Reviewer-cross | review | **Opus**（独立 prompt） | M2（risk-triggered）/ M3（全量） | `security-review` | 只读 | 是 | 评 patch（独立视角：安全/性能/边界） |
| Releaser | release | Sonnet | M2 | `update-manual` | — | 串行 | — |
| Observer | observe | Haiku | M3 | — | — | 是；按 cron 触发 | — |
| Documentor | 跨 Stage | Sonnet | **M3**（M1/M2 由各 Stage 自带产出） | `update-manual` | — | 是 | 持续维护 docs |

---

## 2. 模型策略（v4 修订：复杂度自适应优先）

| 模型 | 适用场景 | 角色 |
|---|---|---|
| **Opus** | 架构 / 设计 / 高风险 / 跨端协议 / 安全 / 数据迁移 | Architect, Reviewer-architecture, Reviewer-cross, Coder（高风险时） |
| **Sonnet** | CRUD / 文档 / 小 UI / 普通 patch / 测试 | PM, Strategist, Tester, Reviewer-code（普通）, Releaser, Documentor, Coder（默认） |
| **Haiku** | 摘要 / 通知 / Observer cron | Observer |

### 2.1 Coder 复杂度自适应规则

server-driven config，可热调；runtime 时按 Issue 标签 + 用户标记决定模型：

```yaml
# Opus 触发条件（任一即触发）：
- Issue.labels 含 "architecture" / "security" / "migration" / "cross-package"
- Issue.priority == "high" 或 "critical"
- 用户在 spec 阶段手动标 risk=high
- ContextBundle 包含 ADR 或 architecture_doc Artifact

# Sonnet 默认：
- 上述都不满足时

# Haiku 不用于 Coder（写代码错率高）
```

### 2.2 模型策略原则

- 模型选择写到 server-driven config，dogfood 期可热调
- M3 上线 IDEAS.md A1 自动路由
- **每条 Run 必须记录 cost**（tokens × 单价），Retrospective 汇总
- **成本是观察阈值不是硬退出门槛**（v4 评审反馈）：超预期时触发方法论调整 ritual，不直接 kill task

---

## 3. 多 AI 交叉评审矩阵

### 3.1 评审组合表

| 被评对象 | 评审者 1（建设性） | 评审者 2（独立验证） | 分歧处理 |
|---|---|---|---|
| spec.md | Reviewer-compliance | PM 自检（不同模型） | 升级人审 Decision |
| design_doc.md | Architect 自检 | **Reviewer-architecture**（独立 prompt + ultrareview 视角） | 升级人审 Decision |
| patch | **Reviewer-code** | **Reviewer-cross**（独立 prompt：安全/性能/边界） | 升级人审 Decision |
| release | Releaser 自检 | 用户人审 | 不允许跳过 |

### 3.2 实现机制

- 每个 reviewer 是**独立 spawn 的 `claude` 子进程**，不同 cwd（worktree 副本，只读），不同 system prompt
- **评审独立性约束（v4 关键修订）**：Reviewer 的 ContextBundle 严格只含 `spec.md + design_doc.md + patch + diff`，**不读 Coder 的 transcript / tool calls / 思考流**。Context Manager 强制 enforce；违反即 Run 失败
- 评分维度由 server-driven config 定义：`correctness, completeness, security, performance, maintainability, alignment_with_spec`，每维 1-5 分 + 结构化 notes
- 两个 reviewer 任一维度差距 ≥ 2 分自动升级人审
- 所有 ReviewVerdict 落库；Retrospective 阶段统计"分歧率"作为方法论健康度指标

### 3.3 触发策略（v4 evolutionary rollout）

| 阶段 | 策略 | 理由 |
|---|---|---|
| **M2** | 双 reviewer 仅在以下任一情况触发：Issue.priority=high、Issue.labels 含 `security/migration/cross-package`、用户在 spec 阶段手动标 risk=high。其他普通 Issue 用单 reviewer + 用户审 | 评审反馈"M2 双 reviewer 全量太早"，避免 token 成本爆炸 |
| **M3** | 扩到全量 design / patch（基于 M2 数据回看分歧率与漏检率证明双 reviewer 必要后再开闸） | 数据驱动决定 |
| **M4 远期（可选）** | 引入一个非 Claude 模型（OpenAI / Gemini / Kimi）做 read-only 终审，对抗集体盲区。个人自用不强制 | [HARNESS_ROADMAP.md §0 #18](HARNESS_ROADMAP.md) |

### 3.4 集体盲区防护（§0 #18）

多 AI 评审默认全是 Claude 系列，对同类盲点会一致漏看（如对 Anthropic 风格的偏好、对特定 prompt 模式的过敏）。M4 远期可选引入一个非 Claude 模型做 read-only 终审；个人自用不强制。

---

## 4. AgentProfile runtime 渲染

每次 spawn agent 时：

```
1. Scheduler 选定 Stage → 决定 AgentProfile id
2. ContextManager 按 profile.contextBudget 编排 ContextBundle
3. 复杂度自适应：根据 Issue 标签 + 用户标记决定 model
4. Renderer 把 profile 渲染成 cli-runner.ts 的 RunSessionParams：
   - cwd: profile.requiresWorktree ? worktree_path : project.cwd
   - systemPrompt: profile.systemPromptTemplate + 当前 Issue 上下文 + ContextBundle 摘要
   - skills: profile.skillNames (注入 .claude/skills/ 路径)
   - tools: profile.toolAllowlist
   - permissionMode: profile.defaultPermissionMode
   - extraSettings: { hooks: { PreToolUse: permission-hook, OnDecisionRequest: decision-hook } }
   - taskId: <task.id>
5. Spawn `claude --print --input-format=stream-json ...` 子进程
6. onMessage 回调里同步落 Run 记录到 SQLite
```

---

## 5. Skill 集与 Agent 的关系

每个 AgentProfile 引用一组 `.claude/skills/` skill。Claude CLI 原生机制按 description 自动激活，**harness 不做 skill 路由**。

| Profile | 默认 skill |
|---|---|
| Architect | `borrow-open-source` |
| Coder | `init` |
| Reviewer-code | `review` |
| Reviewer-cross | `security-review` |
| Reviewer-compliance | `security-review` |
| Releaser | `update-manual` |
| Documentor (M3) | `update-manual` |

新增 skill 走进化路径 2（[HARNESS_ROADMAP.md §16.2](HARNESS_ROADMAP.md)）：
- 触发：Issue 成功合并 + Retrospective 评分 ≥ 4.5/5 + 用户标记"该 pattern 可复用"
- 提炼：Documentor agent 读 patch + spec.md + design_doc.md，产出候选 SKILL.md
- 验证：Reviewer-cross + Reviewer-architecture 双审通过才落 `.claude/skills/`
- 自动激活：Claude CLI 原生机制（按 description 匹配）

---

## 6. 工具白名单原则

每个 profile 必须显式列工具白名单。**默认拒绝**，不在 allowlist 的工具被 PreToolUse hook 拦截。

| Profile | 允许的工具 | 不允许 |
|---|---|---|
| Coder | Read, Edit, Write, Bash(git, pnpm, npm, swift), Grep, Glob | `Bash(rm -rf)`, `Bash(git push -f)`, `Bash(curl)` |
| Tester | Read, Bash(pnpm test, npm test, swift test, tsc, eslint) | Edit, Write |
| Reviewer-* | Read, Grep, Glob | Edit, Write, Bash(git, npm, ...) |
| Releaser | Bash(gh pr merge), Bash(git push origin main with-protection), Bash(deploy.sh) | rm, force push, no-verify |
| Strategist / PM | Read, Grep | 任何写工具 |

[git-guard.mjs](../packages/backend/scripts/git-guard.mjs)（M-1 新增）守第二道；[prod-guard.mjs](../packages/backend/scripts/prod-guard.mjs)（M-1 新增）守不可逆操作。

---

## 7. 待 M-1 / M2 真正动手时补的

- [ ] 每个 profile 的 `systemPromptTemplate` 完整文本
- [ ] 每个 profile 的 `contextBudget` 量化值
- [ ] AgentProfile schema 在 `packages/shared/src/harness-protocol.ts`
- [ ] `agents/profiles.ts` 注册代码（M0 加 descriptor，M2 加 prompt 实体）
- [ ] Coder 复杂度自适应路由的具体阈值
- [ ] reviewer 评分维度的精确 prompt 模板
