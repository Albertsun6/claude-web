# ADR-017: Cursor CLI Cross-Reviewer（异质评审引擎）

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: methodology, governance, autonomous-review, heterogeneity
- **Resolves**: 用户第 N 轮反馈"参考 eva 项目，把调用 cursor cli 增加进来"+ v5.4 dogfood 集体盲区风险（P3 arbiter "反向挑战" §1）
- **Depends on**: [ADR-014 review-workflow](ADR-014-review-workflow.md), [ADR-015 research-before-design](ADR-015-research-before-design.md)
- **Spike report**: [docs/research/cursor-cli-cross-reviewer-2026-05-09.md](../../research/cursor-cli-cross-reviewer-2026-05-09.md)

## Context

v5.4 dogfood 暴露真问题：4 个 reviewer prompt（architect / pragmatist / risk-officer / researcher）都由我（Claude 主会话）扮演，**同模型集体盲区**风险仍在。P3 arbiter 自己在「反向挑战」段已经标注："3 个 reviewer 都是同模型（Claude）共有偏见的可能"。

业界做法（从 Eva v2 review mechanism + Spike report §2 调研）：
- Eva 已经实践过 7 个真实轮次的"Claude + GPT-5.5 双模型异质评审"，证明可行
- cursor-agent CLI 默认走 GPT-5.5-medium（1M context，与 Claude 不同 training / bias / reasoning style）
- 用户 Cursor Pro 订阅边际成本 $0，符合"CLI 不走 SDK，订阅模式不走 token 计费"硬约束

## Decision

引入 **`vessel-cross-reviewer`** 作为 B' 评审工作流的**第 4 个 Phase 1 reviewer**，由 **`cursor-agent` CLI（GPT-5.5-medium，plan 模式）** 执行——跟其他 3 个 Claude reviewer（architect / pragmatist / risk-officer）真正异质。

### 1. cursor-agent 调用方式（已 Eva 实战验证）

```bash
cursor-agent --print \
             --mode plan \
             --model gpt-5.5-medium \
             --output-format text \
             "$(cat $PROMPT_FILE)" \
             > $VERDICT_FILE
```

**关键参数**：
- `--print`：非交互式 stdout 输出
- `--mode plan`：**只读模式**（read-only/planning，禁止编辑文件 + 调用 shell）—— 核心安全约束
- `--model gpt-5.5-medium`：1M context，异质模型
- `--output-format text`：纯 markdown 输出
- prompt 通过 `"$(cat $FILE)"` 替换到 positional argument（非 stdin pipe）

**Auth**：cursor-agent 自动继承本机 Cursor Pro 凭证（`~/.config/Cursor/`），不走 token 计费。

### 2. 文件结构（项目级）

```
Vessel/
├── .claude/
│   └── skills/
│       └── reviewer-cross/
│           ├── SKILL.md         # vessel-cross-reviewer 完整 prompt（5 lens + Independence Constraints + Activation）
│           └── LEARNINGS.md     # 累积的可复用规则（初始为空，dogfood 后增补）
├── scripts/
│   └── cursor-review.sh         # Phase 1 cross 单跑脚本（fork Eva 简化版）
└── docs/
    ├── reviews/                 # 已存在；cross verdict 落到这里
    └── research/                # 已存在；spike report
```

### 3. Vessel 特化的 5 lens

不直接复用 Eva 的 5 lens（它偏 harness DB schema），改成更适合 Vessel 的：

| # | Lens | 聚焦 |
|---|---|---|
| 1 | **正确性**（Correctness） | TypeScript 类型边界 / 状态机 / 接口契约 / off-by-one / 异常路径 |
| 2 | **跨端对齐**（Cross-End Alignment） | TS Zod ↔ Swift Codable ↔ SQLite schema ↔ Wire Protocol 三端字段一致 |
| 3 | **Eva 改造 + Vessel 硬约束兼容性** | EVA_TO_VESSEL_MAPPING 改造是否破坏 Eva 已踩过的坑；是否违反个人单机 / 不上 LLM Driver / TS 主栈 / ML worker 边界 |
| 4 | **安全 + 4 类硬触发** | secrets 扫描；license 风险（AGPL/SSPL 进依赖）；CVE 命中；破坏性数据迁移（drop column / table）|
| 5 | **集体盲区 + 同模型偏见检测** | **vessel-cross 的核心价值**：跟其他 3 个 Claude reviewer 不一样的视角；专找他们 over-cautious / 漏看非主流方案 / confabulate 不存在设计的地方；不强求每条都触发，但每次评审至少**尝试一条** |

### 4. Independence Constraints（HARD，从 Eva 复用）

调用 vessel-cross-reviewer 时**必须**满足：

1. **不读 author 的 transcript / 思考流 / 工具调用历史**——只读最终 artifact 文件
2. **Phase 1**：不读 architect / pragmatist / risk-officer 的 verdict——只读 artifact
3. **Phase 2**（如启用）：可读 sibling Round 1 verdict + own Round 1 verdict + artifact；不读 author counter
4. **不修改任何文件**（plan 模式硬保证）—— 不调用 shell 命令
5. **不读 LEARNINGS.md 之前的对话**——只读 LEARNINGS.md 文件本身（学过的规则）
6. **Phase 2 react 4 档硬约束**：每条 sibling finding 必须 `agree` / `disagree-with-evidence` / `refine` / `not-reviewed-with-reason`；至少 1 条 disagree/refine（防全 agree 退化）

违反任一条 → verdict 失效。

### 5. 在 B' 工作流中的位置

```
[决策点 / 设计任务]
        ↓
Phase 0 (auto): vessel-researcher 调研（DAR 触发条件下）
        ↓
[plan / ADR / milestone 草稿]
        ↓
Phase 1 (auto): 4 reviewer 隔离评审 → 4 份 verdict.md
   ├─ vessel-architect (Claude in main session)
   ├─ vessel-pragmatist (Claude in main session)
   ├─ vessel-risk-officer (Claude in main session)
   └─ 🌟 vessel-cross-reviewer (cursor-agent gpt-5.5-medium)  ← v5.4.1 加
        ↓
Phase 2 (manual v5.4 lite): 4 reviewer 互看 + react verdict
   v5.4 lite 暂时只手动 + 主会话扮演；v1+ 加 scripts/run-debate.sh 自动化
        ↓
Phase 3 (auto): debate-review SKILL 仲裁 → 4 档矩阵
        ↓
Verify Gate 5 项 + Escalation
```

### 6. v5.4 lite 收缩边界（避免重新膨胀）

**做**：
- ✅ `.claude/skills/reviewer-cross/SKILL.md`（fork Eva 简化版）
- ✅ `.claude/skills/reviewer-cross/LEARNINGS.md`（初始空）
- ✅ `scripts/cursor-review.sh`（Phase 1 cross 单跑）
- ✅ ADR-017 本文件（决策锁定）
- ✅ 1 次 self-dogfood（评审 ADR-017 + SKILL + script）

**不做**（推到 future iteration）：
- ❌ Phase 2 自动 cross-pollinate 脚本（继续手动 4-way cross-pollinate）
- ❌ Phase 1 4 reviewer 并行触发脚本（手动一个一个跑）
- ❌ inbox 自动 escalation（继续 v5.4 lite 手动写 inbox）
- ❌ verdict 自动索引（手动维护 docs/reviews/README.md 索引）

## Consequences

### 正面

- ① **真异质性**：cursor-agent gpt-5.5-medium 跟 Claude 不同模型，能抓到 Claude 集体盲区
- ② **订阅模式**：用户 Cursor Pro 订阅边际成本 $0，符合"CLI 不走 SDK"硬约束
- ③ **Eva 模式生产验证**：Eva 7 轮真实使用过，风险已经被 Eva 自己 dogfood 暴露并解决
- ④ **可控性**：脚本化调用，不依赖 owner 手动复制粘贴
- ⑤ **Phase 1 能并行触发**：4 个 reviewer 隔离评审，cursor 跑的同时主会话能跑其他 3 个
- ⑥ **scope 局限**：cursor-agent 只用于 SDLC 评审，不是 vessel-core 运行时——不违反"v0.1 不上 LLM Driver"

### 负面

- ① **多了一个工具依赖**：cursor-agent 必须装 + 用户必须有 Cursor Pro 订阅
- ② **prompt 内容会发到 Cursor 服务器**：评审 plan / ADR 时内容流到 Cursor → GPT。**缓解**：① v5.4 plan + ADR + spike 已经过 gitleaks 扫 clean；② 未来如评审涉及敏感字段，按 trace-redaction-spec 同等规则脱敏
- ③ **cursor-agent 版本兼容性**：参数 `--mode plan` / `--model gpt-5.5-medium` 在新版本可能改名 → 缓解：脚本启动时 `cursor-agent --version` 检查；如检测到不兼容版本，输出警告
- ④ **5 lens 适配性**：Eva 5 lens 偏 harness DB；Vessel 微调到偏架构 + 改造 + 集体盲区。dogfood 之后可能要再改 → 缓解：LEARNINGS.md 累积调整规则

### 中性

- 跟 ADR-014 B' 工作流绑定；如未来 ADR-014 演进，本 ADR 可能要同步修订
- 跟 Eva 模式高度一致；Eva 升级 SKILL 时可考虑同步

## Prior Art

参考 [docs/research/cursor-cli-cross-reviewer-2026-05-09.md](../../research/cursor-cli-cross-reviewer-2026-05-09.md) §2。主要 Prior Art = **Eva 自家实现**（生产级 7 轮验证）：
- `~/Desktop/claude-web/.claude/skills/reviewer-cross/SKILL.md`（241 行）
- `~/Desktop/claude-web/scripts/run-debate-phase.sh`（122 行）
- `~/Desktop/claude-web/docs/proposals/REVIEW_MECHANISM_V2.md`

Vessel 复用 ≥ 80%，主要改：5 lens 适配 / 路径 / Vessel 特化（Eva 改造视角 + 集体盲区检测）。

## 实施时机

**0-meta-lite 阶段（即刻）**：本 ADR 已 Accepted；落 SKILL.md / LEARNINGS.md / cursor-review.sh / self-dogfood。

**0-pre / 0A 阶段**：每次评审 plan / ADR / EVA_INVENTORY 时，cursor-review.sh 作为 Phase 1 第 4 reviewer 跑。

**v1+**：考虑加 Phase 2 自动 cross-pollinate（4-way）+ inbox 自动 escalation。

## 验证

- ADR-017 Status = Accepted（**已**）
- self-dogfood 完成（不看严重度）：
  - ✅ `cursor-review.sh` 跑通 + cross verdict 文件存在
  - ✅ 5 个 lens 都被覆盖（verdict 包含每个 lens 的 score 或 finding）
  - ✅ Lens 5（集体盲区检测）至少尝试一条（即使最终判 false-positive 也算）
  - ✅ findings 被 Phase 3 arbiter 正常 4 档分类
  - ❌ **不要求** cursor 必须找出 BLOCKER/MAJOR —— 这会 reward gaming（fixed by self-dogfood M1 finding 2026-05-09）
- Verify Gate 5 项通过（finding 闭环 / 修复落地 / 链接完整 / 调研引用 / N/A 项明确标）
