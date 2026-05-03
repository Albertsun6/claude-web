# Round 2 Verdict — harness-architecture-review

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7[1m]
**Date**: 2026-05-03 02:29
**Lens**: 架构可行性 / 里程碑裁剪 / 垂直贴谱性 / 风险遗漏

---

## 项 #1 — weight enum schema CHECK

**立场**：agree-with-author

**论据**：counter 站得住。`weight` 与 `stage.kind` 的对应关系本就是方法论决定的策略，而非物理约束；CHECK 在 schema 上锁死会让 M2 dogfood 时"轻量跑某个 heavy stage"或反向需求要靠 ALTER + rebuild table 才能松动，比应用层贵一个量级。SQL 已经强制了 enum **值范围**（heavy/light/checklist），方法论层下沉 `default_weight` 拷贝到 stage 创建时就够了。漂移由 methodology spec 评审兜底，不是 schema 的责任。本项 close。

## 项 #2 — stage_artifact 中间表

**立场**：agree-with-author

**论据**：M-1 不拆 OK，但 counter 缺一条退出门槛。建议 ADR-0010 挂起段落里写明：**M2 Retrospective 必须输出 "stage→artifact 反查频率 + 单次反查耗时" 数据点**，否则 M3 依然没有信号决定。光"挂起观察"会自然遗忘——挂起项必须挂可验收的观测，不然就是无限延期。这不是新提案，是给 counter 补一颗钉子。本项 close on author counter + 观测项落 ADR。

## 项 #3 — Artifact.metadata_json typed schema

**立场**：agree-with-author

**论据**：minor bump 加列 + methodology 约定结构是当前最便宜的解。M-1 强加 typed schema 会把"企业管理系统垂直"和"通用 harness"耦合死，违反 §0 #11 不引入新基础组件的精神。dogfood toy 企业仓库后再决定是否 typed 是对的；列已加，结构滑入 methodologies/01-spec.md，reviewer 解析 metadata 路径已通。本项 close。

## 项 #4 — round-trip 防语义漂移

**立场**：agree-with-author

**论据**：技术正确性问题，主要是 reviewer-cross 的 lens。架构角度只补一条：HARNESS_PROTOCOL.md "enum 锁" 段必须把 `Stage.weight / Stage.kind / Issue.priority / AgentProfile.modelHint` 这种**直接驱动 UI 行为分裂**的 enum 显式列入 M1+ CI 必跑测试矩阵；否则 enum 锁名存实亡。Swift 文件不存在的现状下，M-1 不实跑是合理的。本项 close。

## 项 #5 — M-1 必产 4 契约 vs #1/#2 异步推进

**立场**：agree-with-author

**论据**：HARNESS_INDEX.md 改"M-1 分阶段"已 ship，每契约自己 ritual gate 完全对齐 §0 #13 门槛而非时钟。原 finding 的根因（"必产"语义僵化）已经被结构性解决。剩下的执行风险（每个 sub-gate 真的会跑 verify-m1-deliverables 吗）属于 ritual 纪律问题，不是文档问题。本项 close。

## 项 #6 — M-1 4 项过多，砍 #3 #4 到 M0

**立场**：agree-with-author（撤回原 finding）

**论据**：作者反驳论据成立。ContextBundle 是 §0 #9 的物理实现——M2 dogfood 第一个 Issue 没契约，agent 会自由 Glob/Grep 主 cwd，违反"严格管理上下文"硬约束。PR/worktree 是 §0 #7 + §0 #16 的最后防线，M2 起 Coder spawn 没这层等于裸奔。M0 准入条件已含 server-driven config + Inbox + 离线 fallback，再压 #3 #4 进 M0 会撑爆且失去 M-1 "纯契约奠基"的窄腰意义。撤回。

## 项 #7 — F? migrations 路径生产构建

**立场**：agree-with-author

**论据**：技术正确性 lens 主要归 reviewer-cross。架构角度补一条：CLAUDE.md `tsx watch src/index.ts` + launchd plist 直指 tsx 的运行模型是 §0 #11 "不引入新基础组件"的延伸——**永不打包**就是个人自用的核心架构假设。如果未来真要 bundle，那是触发架构 ADR 的级别事件，不是当前问题。F? 反驳成立。本项 close。

## 项 #8 — FTS5 大批写入性能

**立场**：agree-with-author

**论据**：挂起到 M2 Retrospective 是对的处理——M-1 没数据 benchmark 不出来。但补一条架构观测项：M2 Retrospective 模板必须包含 "FTS5 触发器写延迟 p50/p95" 字段（HARNESS_DATA_MODEL.md §1.10 触发器列表为基准），否则 M3 量级膨胀时仍然无据可依。和项 #2 一样，挂起必须挂观测，不挂等于忘。本项 close on 观测项落 retrospective 模板。

---

## 总体

- agree-with-author 数：8
- still-disagree 数：0
- new-proposal 数：0
- 升级建议：**全部接受 author counter**——8 项里 5 项已 ship 的修复方向正确，2 项挂起需要补观测钉子（项 #2、#8）但不阻塞放行，1 项（#6）原 finding 撤回。M-1 契约 #1+#2 可以 close，进入契约 #3 ContextBundle。

---

## Round 2 反向挑战 reviewer

1. **挂起项的纪律风险**：项 #2（stage_artifact 中间表）和项 #8（FTS5 写延迟）都挂到 M2 Retrospective，但 Retrospective 模板目前没有任何"M-1 挂起项观测清单"段。如果不在 Retrospective methodology 里把这两条钉死成必填字段，到 M2 真出报表时大概率被遗漏，又会变成"再挂到 M3"。这是流程层面的盲区，不在本 8 项里但跨项暴露。

2. **项 #6 撤回不等于原 finding 没价值**：M-1 4 项过多的担忧虽然论据被反驳了，但揭示了 M-1 ritual 的真实风险——**4 个契约的退出门槛实际复杂度差异很大**（#1 数据模型可机械验证；#3 ContextBundle 验证靠 dogfood 真业务）。HARNESS_INDEX.md 分阶段后，每个 sub-gate 应该明确写 verifiable 准入条件，而不是统一一句"ritual gate"。这是项 #5 close 之后留下的尾巴。
