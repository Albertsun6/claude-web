# M1A slicing arbiter verdict — 2026-05-10 02:10

> B-级 review (1 architect + 1 cursor cross)，对象：[M1A α/β/γ 切片 + 2 CLI 增量提案](M1A-slicing-proposal-2026-05-10-0210.md)。
> Phase 2 react skipped（两位 reviewer 无 contested finding，结论一致 PASS-WITH-FIXES）。

## Phase 1 inputs

| Reviewer | Verdict | BLOCKER | MAJOR | MINOR | File |
|---|---|---|---|---|---|
| vessel-architect | PASS-WITH-FIXES | 0 | 2 | 2 | [`architect`](M1A-slicing-architect-2026-05-10-0210.md) |
| cursor cross | PASS-WITH-FIXES | 0 | 3 | 2 | [`cross`](M1A-slicing-cross-2026-05-10-0210.md) |

## 异质性确认 ✅ 第 8 次 cursor 抓 Claude 视角盲区

- architect 和 cursor 在「3 切方案最优 + α/β/γ 真独立」上一致 → 高置信度
- **cursor 独家关键 finding**：C-MAJOR-1 — γ **不是 grep-replace**。架构 reviewer 没具体读 frontend store/App，cursor 实测 Eva `byCwd` 在 11 文件 / 107 处 cwd 引用，且有 localStorage 持久化。这让 γ scope 从 architect 估的"轻 rewire"修正为"双层身份模型 + 一次性 localStorage migration"
- cursor 独家 C-MAJOR-3：跨进程 SQLite busy_timeout —— 与 M0 migration 编号冲突 BLOCKER 同形（跨边界状态泄漏）
- 重复确认 ADR-017 cross-reviewer 价值（log.jsonl 累计 8 次抓 Claude 集体盲区）

## 4 档分类矩阵

### ✅ 接受（已落 proposal patch）

| Finding | Source | proposal 修复点 |
|---|---|---|
| **A-MAJOR-1** α 单独不满 plan §M1A acceptance | architect | proposal Part 1 加 sub-acceptance 表 (α/β/γ 各自子验收 + γ 完成时对齐 plan 全集) |
| **A-MAJOR-2 + C-MINOR-1** API 路由名撞 Eva (`/api/runs` `/api/sessions` 语义不同) | both | proposal 改用 `/api/vessel/*` namespace（`/api/vessel/intent`, `/api/vessel/sessions`, `/api/vessel/runs`, `/api/vessel/traces/<id>`），Eva 老路由 γ 时再 deprecate |
| **C-MAJOR-1** γ 不是 grep-replace；Eva `byCwd` 在 11 文件 107 处 + localStorage migration | cursor | γ scope 重写：双层身份模型（projectsByCwd 保留 + conversationsById 新增）+ 一次性 localStorage migration；ProjectTab 仍 cwd-keyed，conversation switcher 在 tab 内 |
| **C-MAJOR-2** β WS 协议缺 vesselSessionId/conversationId | cursor | β shared protocol 加 `vesselSessionId` + `conversationId` 字段；`resumeSessionId` 严格留给 Claude CLI 续跑 |
| **C-MAJOR-3** 跨进程 memory.db 缺 busy_timeout | cursor | proposal Part 2.5 新增；session-store openMemoryDb 加 `db.pragma('busy_timeout = 5000')`；α 加并发写集成测试 |
| **A-MINOR-1** vessel-core list 直读 SQL 加 ADR-002 注释 | architect | proposal Part 2 表更新："M1A stub — direct SELECT, replaced by Memory interface in M1C-B per ADR-002" |
| **A-MINOR-2** 极简 React 单页路径明示 | architect | proposal Part 1 改为 `/vessel/min/` 子路径，不污染 Eva 主 App.tsx |
| **C-MINOR-2** trace replay/list 加 --limit 默认 | cursor | proposal Part 2 list `--limit` 默认 20；replay 单 trace 不需要 |

### ⚠️ 部分接受 / Defer

无重大 defer。所有 5 MAJOR + 4 MINOR 都已落 proposal patch。

### 🚫 反驳

无。两位 reviewer 的 findings 全部站得住脚。

### 🟡 挂起

无。

## 关键 scope 调整：γ 不再是简单 rewire

cursor C-MAJOR-1 让 γ 工作量比 architect 估的重。但 **architect 明确 3 切是甜蜜点（4 切过细）**，所以**不再拆 γ**，而是 proposal 把 γ scope 写明确：
- 双层模型：Project (cwd) + Conversation (session_id)
- 共存 not replace
- localStorage migration 一次性脚本
- ProjectTabs 仍 cwd-keyed，Conversation switcher 在 tab 内

architect + cursor 协调一致：γ scope 显式化即可，不需要再拆。

## Phase 3 行动汇总

- ✅ proposal doc 加 8 处 patch（5 MAJOR + 4 MINOR fix —— 含 1 项重叠）
- ✅ Sub-acceptance 表写入 proposal
- ✅ /api/vessel/* namespace 锁定
- ✅ 双层身份模型 (projectsByCwd + conversationsById) γ scope 写明
- ✅ WS 协议字段 (vesselSessionId/conversationId) β scope 写明
- ✅ busy_timeout = 5000 + 集成测试 α 内一并做

## 决策

✅ **PASS** — 立即开始 M1A-α 实施（CLI + HTTP routes + minimal panel + busy_timeout + 集成测试）。M1A-α 完成后跑 4-way review + Verify Gate。

## debate-review log entry

```json
{"date":"2026-05-10","planFile":"/Users/yongqian/Desktop/Vessel/docs/reviews/M1A-slicing-*","totalClaims":9,"accepted":9,"partial":0,"rejected":0,"hung":0,"biggestInsight":"cursor 第 8 次抓 Claude 集体盲区: γ 'rewire Eva App.tsx' 在 architect 估为'grep-replace'但 cursor 实测 byCwd 在 11 文件 107 处引用 + localStorage 持久化 —— γ scope 从轻量重写为双层身份模型。教训: 架构 reviewer lens 需要被强制读关键代码 (store.ts/App.tsx) 才能避免基于文档抽象的低估","biggestMistake":"我设计 M1A-α/β/γ 切片时假设 γ 是 'rewire' (架构层面)，未具体读 Eva frontend 代码量；这是 'doc-based 估算 vs code-based 估算' 经典差距","newPrinciplesAdded":0,"newRisksAdded":0,"reviewerSkippedQuestions":[],"counterChallenges":[],"contract":"M1A slicing B-level review (architect + cursor cross)","mechVersion":"v2-lite-B"}
```
