# ADR-015: Research Before Design

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: methodology, governance, phase-0

## Context

Vessel 是个人长期项目，跨多个里程碑 + 大量决策（语言栈 / 依赖选型 / 协议设计 / 架构权衡）。**闭门造车**风险高——既容易重复造轮子，也容易踩业界已知的坑。前 5 轮 plan 评审已经多次出现"漏了 prior art"问题（第三轮 Trace 协议 / 第六轮 review mechanism 业界做法）。

业界对应方法论：
- **Spike**（XP/Agile）：写代码前的研究性技术验证
- **Trade Study**（系统工程 / 航天）：多方案前的技术调研
- **Prior Art**（学术 + 专利）：找已有做法
- **Build vs Buy Analysis**（产品管理）：调研开源/商业现状再决策

第七轮用户反馈 + 第六轮外部 AI 评审（v5.3-lite）共同要求：把调研做成评审工作流的**第一阶段**（Phase 0），不是闭门设计完再评审。

## Decision

**任何重大决策必须先做外部调研**（Phase 0），由 author（或召唤 `general-purpose` Agent）完成，产出 spike report 进 `docs/research/<topic>-<YYYY-MM-DD>.md`。

### DAR 触发 yes/no 检查表

**只要满足任一项 → 跑 Phase 0**：
- [ ] 引入新依赖（`package.json` / `pyproject.toml` 加新行）
- [ ] 引入新协议（如 MCP / Bonjour / WebRTC）
- [ ] 引入新存储（如换 SQLite 为 DuckDB / 加向量库）
- [ ] 引入新语言或 worker
- [ ] 引入新 Capability App
- [ ] 替换核心模块（cli-runner / Workflow / Permission 等）
- [ ] 影响隐私 / 权限 / 数据迁移
- [ ] 改变硬约束

**不跑**：命名调整 / 文案修改 / 测试补齐 / 内部小重构 / 已接受 ADR 的落地实现。

### Spike Report 模板

10 段必备（详见 [`docs/research/README.md`](../../research/README.md)）：
1. 目标决策
2. 业界做法（Prior Art）
3. 学术 / 标准参考
4. 对比表（按 Vessel 硬约束打分）
5. 成本估算
6. 迁移路径
7. 回退方案
8. 与 Vessel 硬约束兼容性
9. license / security 风险
10. 推荐 + 不确定的地方

### 引用规则（v5.4 改写）

- **重大外部选型**（DAR 检查表前 5 项：新依赖 / 新协议 / 新存储 / 新语言-worker / 新 Capability）：plan / ADR 草稿必须有 **「Prior Art」段** 引用 spike report
- **Vessel 特有设计**（如 Soul Spec 字段 schema、5 接口契约、Trace 字段表）：可能没合适 prior art —— 必须显式写：
  ```
  ## Prior Art
  No direct prior art found.
  Search keywords: ["<关键词1>", "<关键词2>", ...]
  Rationale for self-design: <为什么自研>
  ```
- 没有以上声明 → Phase 1 reviewer 抛 BLOCKER：「无调研基础」

### Staleness 规则

- 每份 spike report 顶部 frontmatter 必须有 `researched_at` / `review_after`（默认 +90 天）/ `sources_checked`
- 超过 90 天 + 仍要支撑新决策时 → 必须 refresh（重跑 Phase 0 或显式标 `status: stale-but-still-valid`）
- 长期不用的 stale report 不强制 refresh，但下次引用时必须重看

### Phase 0 → Phase 1 衔接

- Phase 0 输出（spike report）**必须进 Phase 1 reviewer 的输入**
- vessel-architect / vessel-pragmatist / vessel-risk-officer 评审 plan / ADR 时**必读对应 spike report**
- 否则"引用 prior art"会变成形式主义（plan 里写了，但 reviewer 没看，调研结果不能影响评审）

### 调研工具

`WebSearch` / `WebFetch` / `general-purpose` Agent（深度搜索）/ `Explore` Agent（仓库内）/ MCP server（如配了 GitHub MCP）。

**arxiv MCP / GitHub API MCP 不阻塞 0-meta-lite**——出现真实需求时再加。

## Consequences

### 正面

- ① **避免闭门造车**——重大决策都基于业界 prior art
- ② **降低返工成本**——前期 1-2 小时调研可省后期数天重写
- ③ **形成长期知识库**——`docs/research/` 里的 spike report 是 Vessel 的"集体记忆"
- ④ **跟评审工作流自然衔接**——Phase 0 是 Phase 1 的输入，调研结果直接影响评审视角

### 负面

- ① 增加每个重大决策的 lead time（调研需要 1-2 小时）—— **缓解**：DAR yes/no 检查表清晰区分需要调研 vs 不需要的
- ② spike report staleness 维护成本——**缓解**：90 天 review_after 规则 + 长期不用的 report 不强制 refresh
- ③ "无 prior art" 时仍需正式写 `No direct prior art found` 段——**理由**：避免漏调研伪装成"找不到"，搜索关键词暴露在 review 时可被挑战

### 中性

- 引入了"先调研再设计"的纪律性，但和工程方法论原则第 10 条一致
- 跟 ADR-014 的 B' 评审工作流绑定——调研变成评审流程的 Phase 0
