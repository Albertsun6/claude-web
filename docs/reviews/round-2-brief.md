# Round 2 Brief — 8 Uncertain Items

> Round 1 留下 5 部分接受 + 2 反驳 + 1 挂起 = 8 项需要 Round 2 评审。
>
> 用户规则：每项最多 3 轮，仍分歧才升级人审。
>
> 本 Round 2 评审者**可以读** Round 1 verdicts 和我的 counter-proposals（这是 debate phase，不是 cold start）。

---

## 你的任务（reviewer）

对下面 8 项**逐项**给出立场：
- **agree-with-author**：counter-proposal 站得住，本项 close
- **still-disagree**：原 finding 仍成立，给具体反论据
- **new-proposal**：提出第三方案

每项不超过 100 字。**不要泛泛"建议加强"**。

---

## 项 #1 — weight enum schema CHECK（arch 架构#3）

**原 finding**：`stage.weight` enum 在文档说"design/implement/test/review/release 是 heavy；strategy/compliance 默认 checklist"，但 schema 没强制 → 漂移风险。

**Round 1 counter（作者）**：M-1 不加 schema CHECK；下沉到 `methodology.default_weight`，stage 创建时拷贝。**理由**：CHECK 把"轻量某 heavy stage"路径堵死，少留余地。M2 dogfood 时方法论会演化，schema CHECK 改起来比应用层贵。

**Round 1 同源 SQL**：`weight TEXT NOT NULL CHECK (weight IN ('heavy','light','checklist'))` —— enum **范围**已强制，但 enum **值与 stage.kind 的对应关系**未强制。

---

## 项 #2 — stage_artifact 中间表（arch 架构#4）

**原 finding**：`stage.{input,output,review_verdict}_artifact_ids_json` 三个 JSON 数组列违 §0 #9（上下文严格管理）。Context Manager 反查"这条 artifact 被哪些 stage 用过"要全表 scan。

**Round 1 counter（作者）**：M-1 不改 schema；ADR-0010 加段挂起到 M2 dogfood 报表查询频率信号决定。**理由**：现在拆增加 4 端同步成本，先观察。stage_artifact(stage_id, artifact_id, role) 是标准多对多，但 M-1 期没有报表压力。

---

## 项 #3 — Artifact.metadata_json typed schema（arch 垂直#8）

**原 finding**：企业管理系统 reviewer 抽业务实体/权限矩阵/审批流/报表口径 时，从 markdown 解析脆弱；建议加 `metadata_json` 列。

**Round 1 counter（作者）**：minor bump 加列了（已 ship），结构由 methodologies/01-spec.md 约定 + 不强制 typed schema。M2 dogfood toy 企业仓库后再视情况升级 typed。

**Round 1 同源 SQL**：`metadata_json TEXT NOT NULL DEFAULT '{}'`。

---

## 项 #4 — round-trip 防语义漂移（arch 风险#14）

**原 finding**：TS↔Swift round-trip 测试只测编码兼容，不测语义。如 `Stage.weight='heavy'` 在两端字符串相同但 UI 行为分裂。

**Round 1 counter（作者）**：HARNESS_PROTOCOL.md 加 "enum 锁" 段（M-1 已 ship 在 §1）；M-1 不实跑 Swift round-trip（Swift 文件还没建）；M1+ CI 引入 enum 字符串完全匹配测试。

---

## 项 #5 — M-1 必产 4 契约 vs #1/#2 异步推进（arch 里程碑#6）

**原 finding**：plan §6.1 "M-1 必产 4 个核心契约" 与 #1 完工 / #2 doc-only 现实矛盾。

**Round 1 counter（作者）**：HARNESS_INDEX.md 改 "M-1 分阶段"，每契约自己 ritual gate，不一次性 lock-step。**已 ship**。

---

## 项 #6 — M-1 4 项过多，砍 #3 #4 到 M0（arch Open Q #15，🚫 反驳）

**原 finding**：契约 #3 ContextBundle / #4 PR/worktree 纸上写出来容易过设计，建议合并到 M0 真业务驱动。

**Round 1 反驳论据（作者）**：
- ContextBundle 决定 agent 智商上限（[HARNESS_ROADMAP §0 #9](../HARNESS_ROADMAP.md)），M2 dogfood 第一个 Issue 就要喂 ContextBundle，没契约则 agent 自由 Glob/Grep 主 cwd
- PR/worktree 是 agent 改坏 main 的**最后防线**（git-guard.mjs 阻断 force push 等），M2 起 Coder agent spawn 必须有这层防护
- M0 准入条件已经包括 server-driven config + Inbox + 离线 fallback，加 #3 #4 会撑爆 M0

---

## 项 #7 — F? migrations 路径生产可能找不到（cross，🚫 反驳）

**原 F?**：harness-store.ts 用 `dirname(fileURLToPath(import.meta.url))` 解析 migrations 目录，生产构建后可能找不到。

**Round 1 反驳论据（作者）**：
- CLAUDE.md 已规定 backend 用 `tsx watch src/index.ts` 跑，无构建步骤
- launchd plist `~/Library/LaunchAgents/com.claude-web.backend.plist` 直接指 `tsx`，路径稳定
- 个人自用永不上 production bundle（[HARNESS_ROADMAP §0 #13](../HARNESS_ROADMAP.md)）
- 如果未来真要打包，加 `__dirname` 兼容封装即可，不是当前问题

---

## 项 #8 — FTS5 大批写入性能（arch 风险#13，🟡 挂起）

**原 finding**：M2 dogfood 5 任务集 × 10 stage × 5 artifact 量级 OK，但 M3 量级膨胀时 FTS5 trigger 写延迟值得观察。

**Round 1 处理**：挂起到 M2 Retrospective 加观察项；M3 视情况换 `fts5 + content` 内嵌（vs 当前 external-content 模式）。

---

## 输出格式

```markdown
# Round 2 Verdict — <reviewer name>

## 项 #1
立场：agree-with-author / still-disagree / new-proposal
论据：<≤100 字>

## 项 #2
...

(共 8 项)

## 总体
- agree-with-author 数：N
- still-disagree 数：M
- new-proposal 数：K
- 升级建议（≥M2 时再回看 / 立即修 / 接受 author counter）：1 句话
```
