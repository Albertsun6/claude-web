# Harness Review Learnings

本文件记录“项目方向 / 架构评审”中沉淀下来的可复用判断规则。每次使用 `harness-architecture-review` 后，只追加经过本次评审验证、以后还能复用的经验。

## 2026-05-01

### 1. Server-driven iOS 的第一风险不是 UI，而是 schema 锁定

- 来源：`workflow-expressive-canyon.md` 中 M0 要把 iOS 变成 thin shell，并要求之后业务靠后端配置热更。
- 触发场景：计划把移动端改成 server-driven shell，且之后希望少重装或不重装。
- 规则：M0 必须先固定 schema version、minClientVersion、fallback 行为、未知字段处理、旧客户端展示策略；否则后端配置一扩展，iOS 会变成“看似 thin，实际到处兼容分支”的负债。
- 边界：如果只是下发文案或模型列表，不需要完整 schema renderer；如果要下发表单、Board、Decision flow，就必须先设计协议。

### 2. 多 AI 评审必须先限定“评什么”，再限定“几个 reviewer”

- 来源：`workflow-expressive-canyon.md` 把双 reviewer 放进 design / implement / review / release gate。
- 触发场景：计划用多个模型或多个 agent 交叉评审。
- 规则：先定义每个 reviewer 的独立视角、输入 Artifact、评分维度、分歧升级阈值；如果两个 reviewer 读同一份长上下文、用近似 prompt，分歧率指标没有意义，只会增加成本。
- 边界：高风险设计、迁移、安全相关 patch 值得双 reviewer；普通 CRUD 和文档改动应允许单 reviewer 或抽样复核。

### 3. “全链路 MVP”可以保留，但每个 Stage 需要最小不可作假的产出

- 来源：`workflow-expressive-canyon.md` 要 MVP 打通 strategy 到 observe 的完整 SDLC。
- 触发场景：用户要求第一版覆盖完整生命周期，而不是只做一两个阶段。
- 规则：可以让早期 Stage 是 stub，但每个 Stage 至少要产生一个可追溯、可验收、能被后续 Stage 消费的 Artifact；否则 Stage 会变成 UI 进度条，无法验证方法论。
- 边界：M1 可以 stub implement/test/release，但 discovery/spec/review 至少要跑真实数据和真实人审。

### 4. 里程碑指标要防止 agent 刷通过率

- 来源：`workflow-expressive-canyon.md` 用成功率、评审分歧率、人审次数、cost 作为 M2 退出门槛。
- 触发场景：计划用量化指标判断 agent workflow 是否成熟。
- 规则：成功率必须绑定任务难度、失败分类、返工次数和用户接受度；否则 agent 可以通过选择简单 Issue、少报分歧、跳过测试来刷指标。
- 边界：dogfood 早期可以用小样本指标，但必须要求固定任务集或难度分层。

### 5. Context Manager 的第一版应是协议和审计，不是智能选择器

- 来源：`workflow-expressive-canyon.md` 把 Context Manager 作为核心抽象，并要求按 Stage 自动挑选最小 Artifact bundle。
- 触发场景：计划做上下文管理、ArtifactBundle、最小输入快照。
- 规则：M-1/M1 先把输入显式化、可复盘化、可失败化；自动挑选策略应先用简单规则和人工确认，不要一开始追求“智能最优上下文”。
- 边界：当同类 Issue 累积足够多、retrospective 能证明上下文选择影响成功率后，再升级选择策略。
