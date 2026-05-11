# vessel-architect verdict — M1A slicing proposal (2026-05-10 02:10)

## Overall: PASS-WITH-FIXES

切片本身合理且各段独立、不破坏 plan §M1A acceptance、不动 5 接口契约 / ADR-016 / D' / 单 CC CLI 等已锁决策。但需修两处 MAJOR（α 的 HTTP 路由命名 + γ 工作量识别）和一处 MINOR（CLI 增量的 Memory 接口规约）才能进 implementation。

## 4 questions answered

### Q1 切片独立性: 真独立，但有一处隐含耦合需显式说

α / β / γ 各自能 ship + verify：

- **α 独立**：HTTP 路由 + 极简 React 单页只用 `runIntent`（已存在）+ 内存里的 sessions 列表 + 直读 `~/.vessel/traces/<id>/*.json`。trace 文件读和 memory.db 读都已是同步、阻塞调用，不需要 β 的 WS 流。`/api/intent` 同步返回最终 `AgentResult` 即可（CodingDriver 的 stream 暂时丢给 trace 文件即可重放）。**Verify**：curl POST `/api/intent` 返 200 + 极简页面打开能看到至少一个 session。
- **β 独立**：在 α 之上加 WS multiplex（runId → ws.send 路由），不依赖 γ 的 Eva 现成 UI——一个 wscat 客户端 + α 的极简页加 WebSocket 就能 verify。**Verify**：开 N tab 拼 N 个不同 runId 的 user_prompt，trace 时间线全部在线流出。
- **γ 独立**：在 α + β 之上把 Eva 现成 store/App.tsx 接到 `/api/intent` + `/ws`。

**但有一个隐含序约束需写进 proposal**：plan §M1A acceptance 要求 "WS `/ws` 推送 ≥ N 条 trace 事件（含 intent.received / skill.invoked / skill.completed）"——α 不做 WS。**所以 α 单独不满足 plan acceptance，要 β ship 后才满足前两条 acceptance；γ 才满足第三条（Eva UI 用同 session_id）**。proposal 自己写"γ 完成时全部满足"是对的，但 α 单独 reviewer 不要按 plan §M1A acceptance 验，要按"α 自己的子 acceptance"验。这点需在 proposal 加一行 "α/β verify 用 sub-acceptance，γ 才对照 plan §M1A 全集 verify"——不然 4-way reviewer 可能直接 REJECT α 说"你没满足 acceptance"。**MAJOR 1**。

### Q2 5 接口契约暴露: 不泄漏，但路由命名要改

5 接口（[interfaces/](/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/index.ts)）= **Agent / Skill / Tool / Memory / App**。Trace 不在 5 接口内，run-registry 不在 5 接口内——这两个本来就是 internal observability 契约。

`/api/runs/list` 和 `/api/traces/<id>` 暴露 HTTP 路由**本身不算泄漏 5 接口**，但有两个细节：

1. **`/api/runs` 这个名字已经被 Eva 占用**（[runs.ts](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/runs.ts)）做"Eva 子进程 child run 的注册表 + interrupt"——含义是"WS 上正在跑的 cli-runner 子进程"。Vessel 的 `/api/runs/list` 含义是"memory.db 里的 skill_invocation 历史"。**两个 `runs` 语义完全不同**。M1A-α 复用这个名字会造成 Eva 用户从 web 看到"老 runs"和"新 runs"混在一起，且 γ 切换 Eva UI 时会撞表。**改名建议**：`/api/skill_invocations/list` 或 `/api/intent/runs`（更贴合 plan 里的"intent / skill_invocation"实体词汇）。**MAJOR 2**。
2. `/api/traces/<id>` 路由 OK——trace 是 plan §observability 已经暴露的实体（FRAMEWORK §5 trace_id / span_id / parent_span_id 是公开 schema），路由暴露这些字段不算 internal 泄漏。

但**反过来**：`/api/sessions/list` 这个名字 Eva 已用作"Claude CLI jsonl 历史"（[sessions.ts](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/sessions.ts) `/api/sessions/list?cwd=...`），Vessel `/api/sessions/list` 含义是"memory.db 里的 sessions 表"——同样撞名。M1A-α 至少要在 proposal 里说清楚：是直接覆盖 Eva 路由（M1A-γ 时整体替换），还是先用 `/api/vessel/sessions/list` 这种命名空间隔离（避免 α 和 Eva 路由冲突）？建议后者。

### Q3 CLI 增量正当性: 合理 stub，但加 1 行注释

`vessel-core list` 直接 SELECT memory.db **是合理的**，理由：

- M0.5 EchoSkill 和 CodingSkill 调用时，[orchestrator.ts:106](/Users/yongqian/Desktop/Vessel/packages/backend/src/orchestrator.ts#L106) `memory: {} as never` 已经显式声明 "M0.5 不接 Memory full surface（M1C+）"。Memory 接口定义的 `short / sessionKv / longTerm` 三层（[memory.ts:17-26](/Users/yongqian/Desktop/Vessel/packages/backend/src/interfaces/memory.ts#L17-L26)）M1A 都不会有真实实现，longTerm 还要等 M1C-B spike 通过。
- 所以现在让 `vessel-core list` "走 Memory 接口"等于让它走一个空接口——纯做 ceremony。**OK 让它直读 memory.db 表**，跟 EchoSkill 绕过 Memory 是同一档"M0/M0.5/M1A 阶段所有 component 都直读 sqlite，等 M1C 引 Memory full surface 时一起重构"的偷懒。
- **但要加 1 行注释**：`// M1A stub — direct SELECT, will be replaced by Memory interface in M1C-B per ADR-002`。免得未来 M1C-B 重构时漏改 CLI。**MINOR 1**。

注意：`vessel-core trace replay <trace_id>` 完全没问题，trace replay 本来就是 plan §observability 设计的开发者工具（FRAMEWORK §5 末尾"`vessel-core trace replay <trace_id>` 重放"——proposal 在还原 plan 已设计的 CLI，不是新发明）。

### Q4 更好的切法: 不切更糟，2 切勉强可行，3 切是甜蜜点

考虑过 4 个备选方案：

1. **0 切（直接整段做完）**：plan v5.4 默认。问题是 Eva App.tsx + store 有 **107 处 cwd 引用，11 个文件**（grep 实测）——γ 不是 grep-replace，是要重新设计 ProjectTabs 的概念映射（"项目 cwd" vs "session_id" 两个根 key 模型不同）。打包做就是一个 4-5 天的大块，dogfood 反馈延迟最大化。否定。
2. **2 切（α+β 合，γ 单独）**：把 HTTP + WS 一起做，再单独做 Eva rewire。可行但反 dogfood——HTTP 入口和极简看板不依赖 WS 也能用，混做就推迟了"用户能看面板"的时点。所以 α / β 拆开比合更优。
3. **3 切（α / β / γ）**：proposal 当前方案。每段都有显著用户价值且独立 verify。**这是甜蜜点**。
4. **4 切（α 再拆 HTTP-only / 极简 React 看板）**：过细，HTTP 没看板用户摸不到，没必要拆。

**结论：3 切方案是最优。** 唯一需要补的就是 Q1 提到的"α/β 用 sub-acceptance verify、γ 对齐 plan §M1A 全集 acceptance"的明示。

## Findings

### MAJOR

- **MAJOR-1** ([proposal §M1A-α](/Users/yongqian/Desktop/Vessel/docs/reviews/M1A-slicing-proposal-2026-05-10-0210.md):25): α 单独不满足 plan §M1A acceptance（缺 WS 推送 trace 事件那条），但 proposal 没说清"α 用 sub-acceptance 验"。需要补一段 sub-acceptance 表，给每段（α / β / γ）独立的 verify 条目，明示"plan §M1A 全集要 γ 完成才对齐"。否则 4-way reviewer 看 α 时会以为 acceptance 不达标 REJECT。
- **MAJOR-2** ([proposal §M1A-α](/Users/yongqian/Desktop/Vessel/docs/reviews/M1A-slicing-proposal-2026-05-10-0210.md):25): `/api/runs/list` 和 `/api/sessions/list` 路由名都和 Eva 现存的 [packages/backend/src/routes/runs.ts](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/runs.ts) 和 [packages/backend/src/routes/sessions.ts](/Users/yongqian/Desktop/Vessel/packages/backend/src/routes/sessions.ts) 同名但语义不同——Eva 的"runs"是"WS 子进程注册表"、"sessions"是"jsonl 历史"，Vessel 的指 memory.db。M1A-α 需要（a）显式选定命名策略（建议 `/api/vessel/intent/runs/list` + `/api/vessel/sessions/list` 命名空间隔离）；或（b）显式宣布"M1A-γ 一并替换 Eva 老路由，α 阶段并存——并写迁移 deprecation note"。proposal 不写清，γ 时撞表的 bug 是必然的。

### MINOR

- **MINOR-1** ([proposal §Part 2 vessel-core list](/Users/yongqian/Desktop/Vessel/docs/reviews/M1A-slicing-proposal-2026-05-10-0210.md):36): `vessel-core list` 直读 memory.db 表合理，但需在实现里加注释 `// M1A stub — direct SELECT, replaced by Memory interface in M1C-B per ADR-002`。否则未来 M1C-B 重构 Memory full surface 时 CLI 会被漏改。
- **MINOR-2** ([proposal §Part 1 表](/Users/yongqian/Desktop/Vessel/docs/reviews/M1A-slicing-proposal-2026-05-10-0210.md):25): "极简 React 单页（不接 Eva 现成 App.tsx）"应明确路径——是 `packages/frontend/src/vessel-min.tsx` 单独入口、route 挂在 `/vessel` 子路径，还是替换主 App.tsx？建议前者（路径挂 `/vessel/min/`，避免污染 Eva 主入口；γ 时再决定 main app 是替换还是合并）。否则 α 实现时容易"先动主 App.tsx 一点点"导致 γ 时回滚不干净。

### BLOCKER

- 无。

## Counter-proposals

无 counter，3 切方案最优。补 MAJOR-1 / MAJOR-2 修复后即可 ship。两处建议补丁：

**Patch A**（针对 MAJOR-1）：proposal Part 1 表后加一段：

> **Sub-acceptance**（每段独立 verify，γ 完成时对齐 plan §M1A 全集 acceptance）：
> - α: `curl POST /api/vessel/intent` 返回 200 含 AgentResult；极简页打开能看到 ≥ 1 session 和 ≥ 1 trace span 树
> - β: 拼 3 个不同 runId 的 user_prompt 经 WS，trace 时间线 ≥ 3 路独立 stream，不串路由
> - γ: 全部 plan §M1A acceptance 三条全过

**Patch B**（针对 MAJOR-2）：proposal Part 1 表后加一段命名说明：

> **路由命名策略**：M1A-α / β 用 `/api/vessel/*` 命名空间（`/api/vessel/intent`, `/api/vessel/sessions/list`, `/api/vessel/intent/runs/list`, `/api/vessel/traces/<id>`），与 Eva 现存 `/api/runs` / `/api/sessions`（Eva-cwd-based）并存不冲突。M1A-γ 完成时根据 dogfood 决定：（a）保留 namespace 永久双轨；或（b）把 Eva 老路由打 deprecation 标签，v0.5+ 删。该决策延迟到 γ 末尾，不在本 proposal 内 lock。

## Positive observations

1. **切片选取贴合 dogfood 反馈节奏**：α 给"立刻能看面板"是用户在本次 closeout 后明确诉求点，最高 ROI；β 给并行；γ 才动 Eva UI（最大风险点）。先解锁价值再啃硬骨头，符合 layered spiral 螺旋圈的 "本圈风险 → 最小切片 → 机器验证 → dogfood" 节奏。
2. **守边界守得紧**：proposal §Part 3 显式列出"不做"清单（不接 voice/inbox/harness/telemetry、不动 5 接口 stub / ADR / harness.db / capability runtime、不改 ROADMAP 顺序），是高质量 scope 控制。M0.5 closeout 后第一个 reorder 把 "不做的事" 写下来本身比"做什么"更值钱。
3. **CLI 增量是 plan 已设计内容回填，不是偷塞抽象**：`vessel-core trace replay` 在 plan v5.4 §observability 末尾已经写明"vessel-core trace replay <trace_id> 重放"。proposal 把它从 plan 文字搬到 0.5h 实施任务里，是"补 plan 已设计但 M0.5 漏做"的良性 gap-fill，非 scope creep。

---

## Stdout summary (≤200 字)

PASS-WITH-FIXES。3 切方案最优——0/2/4 切都更糟。α/β/γ 真各自独立 ship/verify，5 接口契约不漏。两处 MAJOR 必须修：(1) α 单独不满 plan §M1A acceptance，需补"sub-acceptance"表；(2) `/api/runs/list` `/api/sessions/list` 撞 Eva 现存路由，建议用 `/api/vessel/*` 命名空间隔离。CLI 增量合理（trace replay 是 plan 已设计回填，list 直读 memory.db 与 EchoSkill 绕 Memory 同档"M1C-B 前阶段性 stub"），加 1 行注释即可。补 2 patch 后可 ship。
