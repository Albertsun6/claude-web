# Phase 1 Review — architecture-fit lens
> Reviewer: harness-architecture-review (Claude general-purpose, opus-4-7) · Date: 2026-05-04 · Phase 1 (independent)
> Artifact: `docs/proposals/TTS_SUMMARY_LENGTH.md`
> Files cross-checked: `packages/backend/src/routes/voice.ts`, `packages/ios-native/Sources/ClaudeWeb/TTSPlayer.swift`, `packages/frontend/src/hooks/useVoice.ts`, `docs/IDEAS.md`

## Summary verdict
ACCEPT-WITH-CHANGES — Stage 1 直觉是对的（prompt 偏短 + 0.85 检查是真问题），但 §1/§3 对 0.85 检查影响面的描述与代码事实不符；删除后真正受影响的是 **web 前端**而非 iOS。需要补一个 web-side 验收项，并修正 staged plan 的「叠加 vs 替换」语义。其余为 minor。

## Findings

### F1. §1 把 0.85 检查的真实影响路径搞反了 — [MAJOR]
**Where**: 提案 §1 第 18 行 / §3 第二行 / `voice.ts:395` / `TTSPlayer.swift:477` / `useVoice.ts:1175,1183`
**Issue**: 提案声称「`/summarize` 0.85 检查仅非 stream 路径生效，**但 iOS fallback 路径会触发**」。实测代码：
- iOS `streamSummaryAndSpeak` 失败 → `fallbackVerbatim` → `truncateForFallback`，**不**调用 `/api/voice/summarize`。`fetchSummary()` (TTSPlayer.swift:477) 在 iOS 全仓库 zero callers（grep 仅命中定义本身）。
- 真正调用 `/summarize` 并消费 `fallback:true` 标志的是 **web 前端** `useVoice.ts:1175-1183`：`if (body.summary && !body.fallback) summary = body.summary.trim();` —— fallback=true 时退回朗读 verbatim 全文。
**Why it matters**: Stage 1 删 0.85 检查改的不是 iOS 路径，而是 **web 前端的隐式契约**——现在 web 在 Haiku 没压缩时朗读全文（粗暴但确定），删检查后 web 会朗读 Haiku 复读出来的等长口语化版本。这可能更好，也可能踩 §9 OQ2 的「Haiku 复读原文」陷阱，且不再有自动降级。提案没把 web 列入受影响范围 → 用户验收会漏测，phase 2 / 用户决策也会基于错误模型。
**Suggested fix**:
1. §1 改为「0.85 检查路径：当前仅 web 前端 (`useVoice.ts`) 路径会触发；iOS 已走 stream，不调用 `/summarize` 非流式」。
2. §5 Stage 1「退出条件」补一条：「web `/voice` 模式 summary mode 在 200/1000/3000 字三档输入下听感无明显回归」。
3. §3 第二行降权或标 historical（对 iOS 用户实际无感）。
4. 顺带建议在 IMPROVEMENTS.md 闭环时记一笔「`fetchSummary()` 在 iOS 是 dead code，可在后续 PR 删除」——避免未来 Claude 继续把它当 fallback 路径推理。

### F2. Stage 1 → Stage 2 是「替换」不是「叠加」，应明示 — [MINOR]
**Where**: 提案 §5 Stage 1 / Stage 2
**Issue**: Stage 1 prompt 主张「长度由内容自然决定」(开放式)；Stage 2 引入按 sourceLen 三档分支 (硬约束 + 多档)。两者哲学相反——Stage 2 实际上是 **撤回 Stage 1 的核心主张**而非在其之上叠加。提案口径是「条件性触发」但没说清触发后是「Stage 1 prompt 上加分支」还是「整段替换为硬约束多档」。
**Why it matters**: 阶段化方案的价值在于可叠加 / 可灰度；这里实际是 A/B 路线选择。如果 Stage 1 退出条件不达标就要 Stage 2 替换 prompt，那 Stage 1 的 prompt 字符串就要回滚——回滚动作要在 Stage 1 PR 里就预埋好（保留旧 prompt 字符串或抽常量数组），不然 Stage 2 PR 又要重写一次，徒增 git churn。
**Suggested fix**: §5 Stage 2 标注 "**replaces** Stage 1 prompt"（而非 "extends"）；落地 Stage 1 时把候选 prompt 抽成命名常量集合，方便切换。

### F3. §3 失败模式表漏「Haiku 输出 markdown 噪音」一条 — [MINOR]
**Where**: 提案 §3
**Issue**: 当前 prompt 写死「一两句」时 Haiku 输出比较干净；放开成「概述就好」这种开放式指令后，Haiku 倾向于输出 markdown 列表 / "总结："话头 / 多换行。iOS 端 `stripForSpeech` (useVoice.ts) 对 fenced code 转「代码块」，但普通项目符号 `-` `*` 朗读出来会变成「星号」「破折号」。
**Why it matters**: 不是 blocker（用户能听出来再迭代 prompt），但 §3 应该枚举此项；当前清单偏「长度」维度，缺「格式」维度。提案 prompt 草案已含「不要"总结："等前缀」，但没显式禁列表/换行。
**Suggested fix**: §3 加一行；§5 Stage 1 prompt 草案补一句「不要使用列表 / 项目符号 / 换行符」。

### F4. §6 不变量 #5「不重试」与 §9 OQ2「Haiku 复读原文怎么办」逻辑相冲 — [MINOR]
**Where**: §6 #5 vs §9 OQ2
**Issue**: §6 显式禁止「重试 if too short」循环；§9 OQ2 又问删 0.85 检查后 Haiku 复读原文有没有降级机制——既然禁止重试，answer 只能是「不降级，直接朗读」。这是已决策项，不是 open question。留在 OQ 列表会误导 reviewer/用户在不存在的选项上消耗注意力。
**Suggested fix**: §9 OQ2 改写为「删 0.85 后若 Haiku 复读原文，朗读时长 ≈ 原文 verbatim，是否可接受？(预设：可接受，因为 §6 #5 禁重试；Stage 2 引入硬长度上限作为 v2 兜底)」。

### F5. §7「与 IDEAS B7 正交」判断成立 — [FALSE-POSITIVE-CANDIDATE / 验证通过]
**Where**: 提案 §7
**Check**: B7 改的是 mp3 传输/播放层（后端 chunked + iOS AVPlayer），本提案改的是文本压缩层 prompt。两层无 coupling。本条不是问题，标 false-positive 表示「主动确认通过，保留」。

## Strong points
1. 不可逆度评估准确（改 prompt + 删一行检查，git revert 即可）。
2. §10 phase 2/3 skip 的 trigger check 合理：单决策点 + <10 行 + 高可逆，phase 1 双独立评审已足够。
3. §6 不变量 #1（120 字 verbatim 阈值不动）和 #3（markdown stripping 留在 iOS）正确识别了范围蔓延的诱因。
4. §4 自识到「无回归测试覆盖精简长度」+「telemetry 没 outputLen」——是这块代码长期短板，作者没掩盖。
5. Stage 3 用「用户明确说想要更详细才做」做触发条件，符合 CLAUDE.md「server-driven config / 不无端加 settings」精神。

## Open questions for the user
1. F1 修复后，**web 前端是否也要在 Stage 1 范围内验收**？还是先只看 iOS 听感、web 留作 follow-up？（影响 PR 测试矩阵——以及 CLAUDE.md「iOS 优先」的 framing 是否覆盖这种共享后端 prompt 的改动）
2. F2：要不要把 Stage 2 显式重命名为「Stage 1-rollback-with-tiered-prompt」（替代而非叠加）？还是保留「阶段」叙事？
3. iOS `fetchSummary()` 是 dead code（F1 第 4 点）——顺手在 Stage 1 PR 删掉，还是单独 cleanup PR？
