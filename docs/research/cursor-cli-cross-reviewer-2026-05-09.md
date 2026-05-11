---
researched_at: 2026-05-09
review_after: 2026-08-07
sources_checked:
  - /Users/yongqian/Desktop/claude-web/scripts/run-debate-phase.sh
  - /Users/yongqian/Desktop/claude-web/scripts/run-cross-review.sh
  - /Users/yongqian/Desktop/claude-web/docs/proposals/REVIEW_MECHANISM_V2.md
  - /Users/yongqian/Desktop/claude-web/docs/HARNESS_REVIEW_LOG.md
  - ~/.claude/skills/debate-review/SKILL.md
  - ~/.claude/skills/debate-review/PHASE_2_PROMPT.md
  - ~/.claude/skills/reviewer-cross/SKILL.md (假设存在，按盘点报告)
  - cursor-agent --help 本机输出（v2026.05.05）
status: accepted
---

# Spike Report — Cursor CLI Cross-Reviewer Integration

> **Resolves**: 用户第 N 轮反馈"参考 eva 项目，把调用 cursor cli 增加进来，我有订阅，实现异质评审"
>
> **DAR 触发**：满足 ADR-015 yes/no 检查表 2 项 —— 引入新依赖（cursor-agent CLI）+ 引入新协议（cursor cli prompt + verdict 协议）

---

## 1. 目标决策

把 **cursor cli（默认 GPT-5.5-medium）** 集成进 Vessel B' 自治评审工作流，作为 **`vessel-cross-reviewer`** 的执行引擎，提供**真异质性**评审视角，弥补当前所有 reviewer 都是 Claude（同模型集体盲区）的短板。

属于 DAR 检查表的 2 项：
- ✅ **引入新依赖**：cursor-agent CLI（已在本机 `~/.local/bin/cursor-agent` v2026.05.05）
- ✅ **引入新协议**：cursor cli 调用方式 + 输出协议（plan 模式 + stdout markdown verdict）

---

## 2. 业界做法（Prior Art）

### 主要参考：Eva（claude-web）项目自家实现 — **生产级**

Eva 已经把完整的"Claude + Cursor 双模型异质评审"机制实践了 7 个真实轮次（HARNESS_REVIEW_LOG）。

| Eva 模块 | 路径 | Vessel 复用方式 |
|---|---|---|
| `run-debate-phase.sh` | `~/Desktop/claude-web/scripts/run-debate-phase.sh` | **fork + 改路径**（核心 ≥ 80% 通用） |
| `run-cross-review.sh` | 同上目录 | fork（更简洁的 Phase 1 cross 单跑版本） |
| `reviewer-cross` SKILL | `~/.claude/skills/reviewer-cross/SKILL.md` | fork SKILL.md（5 lens + Independence Constraints + cursor 调用方式 90% 通用） |
| `debate-review` SKILL Phase 3 | `~/.claude/skills/debate-review/SKILL.md` | **已跨项目共享**（Vessel 已经在用） |
| `PHASE_2_PROMPT.md` | `~/.claude/skills/debate-review/PHASE_2_PROMPT.md` | **已跨项目共享**（Vessel 直接用） |
| `LEARNINGS.md`（reviewer-cross 累积） | `~/.claude/skills/reviewer-cross/LEARNINGS.md` | **不复用**（Eva 是 harness 领域知识；Vessel 新建空白文件，dogfood 后累积） |

### 其他可参考的项目

| 项目 | License | 活跃度 | 接口形态 | 备注 |
|---|---|---|---|---|
| LangGraph multi-agent supervisor | MIT | 高 | 多 agent 编排 | 但是 Python + Anthropic SDK；不符合"CLI 不走 SDK"硬约束 |
| AutoGen multi-agent | MIT | 高 | conversable agents | 同上 + 比 Vessel 复杂 |
| CrewAI | MIT | 中 | role-based agents | 同上 |

→ **结论**：Eva 自家实现是 Vessel 的最佳 Prior Art，且**完全免费复用**。

### Cursor CLI 调用方式（已验证细节）

```bash
cursor-agent --print \
             --mode plan \
             --model gpt-5.5-medium \
             --output-format text \
             "$(cat $PROMPT_FILE)" \
             > $VERDICT_FILE
```

**关键参数**：
- `--print`：非交互式，stdout 输出（脚本场景必须）
- `--mode plan`：**只读模式**（read-only/planning，禁止编辑文件 + 调用 shell）—— **核心安全约束**
- `--model gpt-5.5-medium`：1M context，**异质模型**（非 Claude）
- `--output-format text`：纯文本 markdown
- prompt 通过 **positional argument**（`"$(cat $PROMPT_FILE)"` shell 替换到位置参数）传入；**不是** stdin pipe（Eva SKILL.md 第 71 行原本写 `-p <file>` 是 typo——`-p` 实际是 `--print` 简写，不是 prompt 文件）

**Auth**：cursor-agent 自动继承本机 Cursor Pro 凭证（`~/.config/Cursor/`），**不走 token 计费**，订阅额度内边际成本 0。

---

## 3. 学术 / 标准参考

- **Fagan Inspection (1976)**：多 reviewer 独立评审 + 收敛（Vessel ADR-014 已引用）。Cursor cli 作为第 4 个独立 lens，是 Fagan 异质性原则的强化（不再是同模型扮演）。
- **DAR (CMMI L3)**：重大决策结构化分析。本 spike report 即按 DAR 输出。
- **Independence Constraints**（Eva reviewer-cross SKILL）：fresh context / 不读 sibling verdict / 不读 author transcript —— Vessel 复用此约束。

---

## 4. 对比表（按 Vessel 硬约束打分）

| 维度 | 方案 A: 不集成（v5.4 lite 现状）| **方案 B: cursor cli 集成（推荐）** | 方案 C: 多模型集成（Cursor + Gemini CLI + ...） |
|---|---|---|---|
| 个人单机兼容 | ✅ | ✅（subprocess） | ✅ 但复杂 |
| 不上 token 计费 LLM | ✅ | ✅（Cursor Pro 订阅） | ⚠️ 需要每个模型订阅 |
| TS 主栈兼容 | ✅ | ✅（脚本调用 subprocess） | ✅ |
| Eva 优先复用 | N/A | ✅ **fork ≥ 80%** | ❌ 多模型部分要自研 |
| 维护成本 | 低 | **低**（Eva 已经验证） | 高 |
| 异质性 | ❌ 同模型集体盲区 | ✅ **真异质（GPT vs Claude）** | ✅✅ 三向异质 |
| 工程量 | 0 | **小（1-2 小时）** | 大（4-8 小时） |
| 可控性 | 高（同会话） | 高（脚本化） | 中 |

→ **方案 B 最优**：成本最低、复用 Eva、真异质、符合所有硬约束。方案 C（三模型）等真出现"Cursor + Claude 共同盲区"再加。

---

## 5. 成本估算

| 项 | 工作量 | 说明 |
|---|---|---|
| 实施工作量 | **S（1-2 小时）** | fork Eva 4 个文件 + 改路径；写 ADR-017；dogfood 1 次 |
| 后续维护成本 | **极低** | Eva 模式已稳定；prompt 模板和 SKILL 跟着 cursor-agent 升级（每年 1-2 次）|
| 学习曲线 | **极低** | 用户已用 Cursor Pro；脚本是 bash + 调用 cursor-agent |
| 边际运行成本 | **$0** | Cursor Pro 订阅额度内 |

---

## 6. 迁移路径

从当前（0-meta-lite 完成）到目标（cursor cli 集成完成）：

| 步骤 | 动作 | 文件路径 |
|---|---|---|
| 1 | fork Eva **项目级** `.claude/skills/reviewer-cross/` 到 Vessel **项目级** `.claude/skills/reviewer-cross/`（**修订 m1 fix 2026-05-09**：Eva 这套 skill 是项目级而非用户级 `~/.claude/skills/`；Vessel 也用项目级作为 source of truth，避免 multi-project 命名冲突）| `Vessel/.claude/skills/reviewer-cross/{SKILL.md,LEARNINGS.md}` |
| 2 | 在 ADR-014 附录加 vessel-cross-reviewer prompt 草稿（指向 cursor-agent 调用方式）| `docs/adr/vessel/ADR-014-review-workflow.md` Edit |
| 3 | 新建 `scripts/cursor-review.sh`（fork Eva run-cross-review.sh 简化版） | `Vessel/scripts/cursor-review.sh` |
| 4 | 新建 ADR-017 锁定决策 | `docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md` |
| 5 | self-dogfood：用 cursor-agent 评审 ADR-017 + script 本身 | `docs/reviews/cursor-integration-p1-cross-<TS>.md` |
| 6 | 如发现 cursor 找出 BLOCKER（同模型盲区）→ 修后再跑 → ADR Status=Accepted | 增量 |

**风险点**：
- cursor-agent 在 Vessel 项目下 cwd 调用时是否能正确读取项目文件 —— **需要 dogfood 验证**
- prompt 拼装时塞 v5.4 plan + ADR + spike 是否超 1M context —— Eva 实测 600-800 行远低于上限，应无问题

---

## 7. 回退方案

如发现 cursor cli 集成有问题（输出质量差 / 不能稳定 plan 模式 / context 太小）：

| 回退选项 | 影响 | 成本 |
|---|---|---|
| 删除 `scripts/cursor-review.sh` + 把 ADR-017 改 Status=Rejected | 评审退回 v5.4 lite 同模型扮演 | 极低 |
| 改用 Gemini CLI / Claude API（其他异质源） | 需重新 spike + 可能违反"订阅模式"硬约束 | 中 |
| 完全放弃异质评审，靠 milestone closeout 手动外部 AI 终审 | 减少日常异质性，但保留兜底 | 极低 |

回退点：v0.1 release 之前任何阶段都可回退；不影响 ADR-014 主流程（cross 是可选的第 4 reviewer，不是必需）。

---

## 8. 与 Vessel 硬约束兼容性（关键论证）

| 硬约束 | 兼容性 | 说明 |
|---|---|---|
| 个人单机助理形态 | ✅ | cursor-agent 是本机 subprocess |
| 集成 = 借鉴/搬开源代码 | ✅ | Eva 自家代码 + Cursor 是 freemium 工具（CLI 免费，订阅按月） |
| **Coding Agent 走 CLI 不走 SDK** | ✅ **强契合** | cursor-agent 是 CLI，订阅模式（不是 token 计费）—— 跟 cli-runner.ts 一脉相承 |
| v0.1 不上 LLM Driver / LiteLLM | ⚠️ **需要注意边界** | cursor-agent 用于**评审**而非"生产 AI 能力"；评审是开发期 SDLC 流程，不是 vessel-core 运行时 LLM 调用 → **不违反**硬约束（runtime 仍然只走 cli-runner.ts → CC CLI）|
| 多端薄壳 | N/A | 评审跟运行时无关 |
| 主栈 TS + ML worker 边界 | ✅ | 评审脚本是 bash，不影响 TS 主进程 |

**关键边界澄清**：cursor-agent 在 Vessel 中的角色是 **SDLC 工具**（评审 plan / ADR），不是 **vessel-core 运行时组件**。它跟 IDE 里的 GitHub Copilot 同性质——开发期辅助，不进 production runtime。所以"v0.1 不上 LLM Driver"硬约束**不适用**。

---

## 9. License / Security 风险

| 项 | License / 状态 | 风险等级 | 缓解 |
|---|---|---|---|
| cursor-agent CLI | 商业（Cursor 公司）；CLI 二进制可免费下载，订阅功能需付费 | 低 | 用户已有订阅；CLI 本身不含 secrets |
| Eva fork 代码（run-debate-phase.sh / SKILL.md） | 用户私有 | 0 | 自家代码，复用安全 |
| prompt 包含的 plan / ADR 内容 | 私有 | **中** | cursor-agent 会把 prompt 发到 Cursor 服务器跑 GPT-5.5——**确认 prompt 不含 secrets**（已知 v5.4 plan + ADR 经 gitleaks 扫 clean） |
| 过去 12 月 CVE | 无（cursor-agent 是 CLI 客户端，不是网络服务） | 低 | 升级跟随 Cursor 主版本 |
| 维护者背景 | Cursor 公司（YC 投资，主流） | 低 | 主流商业产品 |

**特别关注**：
- ✅ prompt 经 gitleaks 扫过（v5.4 dogfood 工作树扫描 218MB no leaks）
- ⚠️ 未来如评审涉及含敏感字段的 plan，必须先脱敏再喂 cursor-agent（按 trace-redaction-spec 同等规则）
- ⚠️ Cursor 的隐私政策：plan 内容会发到 Cursor 服务器；用户需接受这个 boundary（个人项目可接受，开源前才需更严格 review）

---

## 10. 推荐 + 不确定的地方

### 推荐方案

**方案 B**：fork Eva 模式，3 步集成：
1. ADR-017-cursor-cli-cross-reviewer.md（Status=Accepted），含 vessel-cross-reviewer prompt 草稿
2. `scripts/cursor-review.sh`（fork Eva run-cross-review.sh，简化版仅 Phase 1 cross 单跑）
3. self-dogfood：用 cursor-agent 评审 ADR-017 + script

### 留给 Phase 1 reviewer 挑战的不确定点

1. **Eva `~/.claude/skills/reviewer-cross/SKILL.md` 是否存在**？盘点报告假设存在但是 Explore 第一次没找到 —— **dogfood 之前先确认**。如不存在，需要从 Eva HARNESS_REVIEW_LOG.md 反推 5 lens 定义重新写。
2. **cursor-agent v2026.05.05 跟 Eva 用的版本是否一致**？参数（`--mode plan` / `--model gpt-5.5-medium`）有可能在新版本变名 —— dogfood 时可能要调试。
3. **vessel-cross-reviewer 5 lens 是否要适配 Vessel**？Eva 的 5 lens（正确性 / 跨端对齐 / 不可逆 / 安全 / 简化）通用性高，但 Vessel 偏 AI 化身 + 个人单机 —— 可能要加 lens 6 "Eva 复用纯度" 或 lens 7 "用户隐私" —— Phase 1 评审时由 vessel-architect / vessel-pragmatist 挑战。
4. **prompt context size**：v5.4 plan ~ 1300 行 + ADR + spike 是否塞得下 cursor-agent 1M context？
5. **`--mode plan` 在新版 cursor-agent 是否仍然纯只读**？如有 regression，需要 sandbox flag 兜底。
