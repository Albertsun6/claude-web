# Phase 3 Arbitration — Cursor Integration Self-Dogfood

- **Date**: 2026-05-09 22:10
- **Author**: Claude (debate-review SKILL)
- **Inputs**: 1 × cursor-agent verdict（vessel-cross-reviewer 第一次实跑）
- **Total findings**: 9（0 BLOCKER + 3 MAJOR + 4 MINOR + 2 F? Lens-5）

> **特殊说明**：本次 dogfood 只有 vessel-cross-reviewer（cursor-agent gpt-5.5-medium）一份 P1 verdict —— v5.4 lite 范围内 Phase 1 没强制 4 reviewer 都跑（只为验证 cursor 集成）。Phase 2 cross-pollinate 也跳过（无 sibling verdict）。所以本 P3 arbiter 直接对 cursor 的 P1 finding 做单边裁决。

---

## 仲裁矩阵

| ID | 主张概要 | 仲裁 | 落地动作 |
|---|---|---|---|
| **M1** | 验证段奖励 false positive | ✅ **accepted（高价值 finding）** | 立即修 ADR-017 §「验证」段：去掉"必须找出 BLOCKER/MAJOR"；改成"5 lens 都覆盖 + Lens 5 至少尝试 + findings 被正常分类" |
| **M2** | 🚨 prompt 外发前没本地脱敏门禁 | ✅ **accepted（安全风险）** | 立即修 `scripts/cursor-review.sh`：加 preflight gitleaks 扫 + 私人路径检测；命中拒绝外发，要求显式 `--allow-private-paths` |
| **M3** | 版本兼容只打印没真检查参数 | ⚠️ **partial accepted** | cursor-review.sh 加最小 preflight：grep `cursor-agent --help` 输出含 `plan` / `gpt-5.5-medium` 关键 flag；不通过输出警告（不强制退出，对 ADR-017 "缓解"承诺打折扣可接受） |
| m1 | project-level vs user-level SKILL 路径不一致 | ✅ accepted | 修 spike report §6：改成"Eva 项目级 SKILL（在 Eva `.claude/skills/`）作 Prior Art；Vessel 用项目级 `.claude/skills/` 是 source of truth" |
| m2 | research 写 stdin pipe 但脚本是 positional | ✅ accepted | 修 spike report §2：prompt 传入方式改"positional argument via `\"$(cat $FILE)\"`"，给出原因（Eva SKILL 第 71 行注："stdin pipe 未测试，推荐 -p；但实测 -p 是 --print 简写而非 prompt 文件，最终走 positional"） |
| **m3** | 🚨 `artifact-name` 没限制字符（路径注入） | ✅ **accepted（安全）** | 立即修脚本：限制 `ARTIFACT_NAME` 只允许 `[A-Za-z0-9._-]+`，不符合 exit 64 |
| m4 | Phase 2 硬约束 ≥1 disagree/refine 制造形式分歧 | ⚠️ **partial accepted** | 修 SKILL.md Independence Constraints #6：保留约束但加注"如真为全 agree（无形式分歧），允许显式声明 'no genuine divergence found' 而非强制制造 disagree" |
| F? M2 私人路径算不算 secrets | 🟡 **decided**（升级到必脱敏）| trace-redaction-spec.md 已经把"用户绝对路径除白名单外都遮蔽"列入黑名单 —— 跟 cursor-review.sh preflight 一致；不算 false positive |
| F? M3 假设 CLI 参数未来变化 | 🟡 **decided**（保留 partial accept）| 接受 "脚本失败即人工修复" 是 fallback，但 ADR 既然承诺了启动检查就实施最小版 |

**统计**：accepted 5 / partial 2 / 0 rejected / 0 hung / 2 F? 已决

## 修复落地（立即做）

按"M2 / m3 是安全 / M1 是 incentive 偏差"优先级，立即修 4 处：

1. ✅ **修 ADR-017 验证段**（M1）
2. ✅ **修 cursor-review.sh**（M2 + m3 + M3 partial）
3. ✅ **修 spike report**（m1 + m2）
4. ✅ **修 SKILL.md** Independence Constraints #6（m4 partial）

## 反向挑战（给 cursor / 下一轮）

1. **cursor 对 M1 的判断**：ADR 验证段确实有 incentive 偏差。但反方观点是"如果 cursor 永远找不到 BLOCKER/MAJOR，怎么知道异质性真有效，不是新瓶装旧酒"？—— **author 接受 cursor 立场**：异质性的证据应该是"独立评审过程跑通 + 5 lens 都覆盖 + Lens 5 真找出 collective blindspot"，不应该 reward 找出严重 finding 本身。
2. **cursor 对 M2 的判断**：spike report §9 已经写了风险但 script 没落实——这是 spec/impl 脱节。author 接受。
3. **cursor 对 m4 的判断**：很有力。Vessel ADR-014 + reviewer-cross SKILL 多处出现"硬约束 ≥ 1 disagree" —— 长期可能 reward gaming。author 接受 partial（保留约束 + 加显式 escape hatch）。
4. **cursor 没找出来的**：如果 cross-review 第一次跑就找出 7 finding，是不是其他 3 个 Claude reviewer（architect / pragmatist / risk-officer）也都该重跑这 4 个 artifact？—— **author 判断**：本次 dogfood 主要验证 cursor 集成跑通；4 reviewer 全跑放到后续真实 milestone（如 0-pre 完成时）。

## 异质性证明（self-dogfood 的核心结果）

cursor-agent 在其他 3 个 Claude reviewer 没机会评审的情况下找出：
- **incentive 偏差**（M1 = ADR 验证段 reward gaming）— Claude 自己写时不会注意
- **spec/impl 脱节**（M2 = ADR 提了风险但 script 没落实）— Claude 自己审会"信 ADR 已 say"
- **路径注入**（m3 = ARTIFACT_NAME 没字符限制）— Claude 写 bash 时常见盲区
- **Lens 5 over-cautious 痕迹**（m4 = Phase 2 硬约束 reward gaming）— **cursor 用 Lens 5 真找出 over-cautious**

**结论**：cursor-agent 作为 vessel-cross-reviewer 的异质性**已实证有效**。ADR-017 应保持 Status=Accepted。
