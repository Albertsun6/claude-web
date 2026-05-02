---
name: harness-architecture-review
description: Review claude-web / Seaidea direction, architecture, milestone, SDLC harness, multi-agent workflow, server-driven iOS, Context Manager, enterprise-admin vertical fit, and risk plans. Use when the user asks to 评审, review, challenge, critique, 审架构, 审方向, or evaluate a plan for the AI Software Engineer Harness.
---

# Harness Architecture Review

用于评审 claude-web 从个人 Claude CLI 远程控制台演进为 AI Software Engineer Harness 的方向、架构和实施计划。

## Activation

用户要求"评审 / review / 挑战 / 审架构 / 审方向 / 看这个 plan"时：

1. 先读本技能。
2. 再读 [LEARNINGS.md](LEARNINGS.md)。
3. 读用户给的 plan / diff / 设计文档。
4. 按下面流程输出评审。
5. 评审后把新发现的、可复用的判断规则追加到 `LEARNINGS.md`。不要记录一次性的个人偏好。

## Independence Constraints (HARD)

为防止评审被作者推理污染（参见 [HARNESS_ROADMAP.md §0 #18 集体盲区防护](../../../docs/HARNESS_ROADMAP.md)），调用本 skill 时必须满足：

1. **不读 author 的 transcript / 思考流 / 工具调用历史**——只读最终 artifact 文件。
2. **不读 `reviewer-cross` 的 verdict**——直到 debate-review 阶段才合并。
3. **不修改任何文件**——纯读 + 出 verdict markdown（用 plan 模式或 read-only Agent）。
4. **fresh context**——上层应在独立 sub-agent / 子进程里跑，不复用作者的对话历史。

违反任一条 → verdict 失效，需要重新跑。

实操：
- Claude 端通过 Agent tool（`subagent_type=general-purpose`）spawn fresh context 跑本 skill
- 与 `reviewer-cross` 配对时，两位 reviewer 必须并行启动且互不可见（启动时间相同 / verdict 文件分别落盘）

## Verdict Output Format

输出写到 `docs/reviews/<artifact>-arch-<YYYY-MM-DD-HHmm>.md`，顶部标头固定：

```markdown
# Architecture Review — <artifact name>

**Reviewer**: harness-architecture-review
**Model**: <claude-opus-4-7 | claude-sonnet-4-6 | ...>
**Date**: <YYYY-MM-DD HH:MM>
**Files reviewed**:
- path/to/file1
- path/to/file2

## Summary
- Blockers: N
- Majors: M
- Minors: K
- 总体判断：建议合并 / 建议小改后合并 / 必须先修 / 必须重做
```

每条 finding 用以下层级（与 `reviewer-cross` 对齐，便于 debate-review 合并）：
- **[BLOCKER]**：必须先修；rebuttal 需用户显式 approve
- **[MAJOR]**：明确缺陷，建议修
- **[MINOR]**：观察项

每条必须含：Where（文件:行 / 段号）、Lens（4 维之一）、Issue、Why blocker（仅 BLOCKER 必填）、Suggested fix。

末尾必须有 `## What I Did Not Look At` 段，明列本次未覆盖范围。

## Review Stance

- 目标是挑战取舍，不是证明 plan 正确。
- 优先指出会导致返工、成本失控、安全事故、长期维护困难的设计。
- 明确区分“现在必须改”和“以后观察即可”。
- 不要用泛泛的 best practice。每个判断都要回到 claude-web 当前约束：Hono + WS + spawn Claude CLI、iOS native thin shell、单用户优先、禁止 Anthropic Agent SDK、worktree + PR、server-driven config。
- 对用户已经明确敲定的硬约束，只评估后果和执行边界，不反复劝退，除非它与安全或可交付性冲突。

## Evidence Gathering

最低证据：

1. 用户给的 plan / 文档。
2. `CLAUDE.md` 中的当前架构和 invariants。
3. 与 plan 直接相关的现有文件或 docs。
4. 如涉及 iOS，检查 `packages/ios-native/` 相关约束；不要回到 deprecated Capacitor 路线。

如果 plan 已按段号编号，引用段号；否则引用文件路径和小标题。不要制造不存在的行号。

## Required Review Dimensions

默认按这 4 个维度评：

1. **架构可行性**：server-driven shell、状态机、AgentProfile、多 AI 评审、Context Manager、SQLite/FTS5、worktree/PR 这套组合能不能撑住；哪些抽象可能变成负债。
2. **里程碑裁剪**：M-1/M0/M1/M2 是否切得对；入口/出口条件是否可执行；验收指标是否会诱导错误行为。
3. **企业管理系统垂直贴谱性**：Stage、Profile、方法论模板是否服务 CRUD、表单、审批、报表、权限；哪些 Stage 会空跑。
4. **风险遗漏**：安全、成本、不可逆操作、多 agent 资源争抢、Context Manager 失效、进化体系反向恶化、CLI 子进程稳定性、数据迁移与回滚。

如果用户给了 Open Questions，优先回答有强意见的，不必每条平均用力。

## Output Format

使用中文，先给结论，再给风险。

推荐结构：

```markdown
## 总体判断
一句话结论：建议推进 / 建议收缩后推进 / 暂不建议开工。

## 必须先改
- P0/P1 发现：影响、证据、建议。

## 四维评审
### 架构可行性
200-400 字，带关键引用。

### 里程碑裁剪
200-400 字，带关键引用。

### 企业管理系统贴谱性
200-400 字，带关键引用。

### 风险遗漏
200-400 字，带关键引用。

## Open Questions 强意见
只回答有强判断的问题。

## 建议的下一版改动
3-7 条可执行改法。
```

严重问题要放在前面。没有严重问题时直接说“没有发现必须阻断的问题”，再列观察项。

## Scoring

可选打分，只有用户要求或 plan 很大时使用：

- 架构可行性：1-5
- 里程碑可执行性：1-5
- 垂直贴合度：1-5
- 风险控制：1-5
- 当前开工成熟度：1-5

3 分以下必须给出收缩方案；4 分以上仍要列出最脆弱假设。

## Self-Improvement

评审后更新 `LEARNINGS.md`：

1. 只记录跨评审可复用的规则，例如“某类验收指标会诱导刷分”“某类 iOS server-driven 改造应先固定 schema 版本”。
2. 每条包含：日期、来源、触发场景、规则、反例或边界。
3. 不记录用户私密信息、一次性结论、尚未验证的猜测。
4. 如果新经验和旧经验冲突，保留两条并写明适用条件；不要静默覆盖。
5. 每次最多追加 3 条，避免经验库膨胀。

## Hard Stops

- 不建议引入 Anthropic Agent SDK。
- 不建议把移动端新功能转回 Capacitor/PWA/RN/Flutter。
- 不建议绕过 worktree/PR/人审去自动改主分支。
- 不建议让 agent 直接操作生产数据库、三方付费 API、真实部署环境，除非有显式 sandbox、dry-run、allowlist 和人审。
