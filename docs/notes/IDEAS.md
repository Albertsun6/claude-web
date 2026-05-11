# Vessel Ideas（灵感库）

> **目的**：随手记录灵感 / 待决策 / 已升格的想法。低门槛追加，定期回看。
>
> **配套**：按 plan v5.4 §「步骤 0B 待新建」 + ADR-014 §「评审工作流」。
>
> **3 类标签**：
> - 💡 **灵感**（可能做）—— 还没决定是否做
> - ❓ **Open Question**（要决策的）—— 需要 owner 拍板
> - ✅ **已升格**（进 ROADMAP / ADR / RISKS）—— 升格后保留作历史

---

## 写作规范

每条灵感 1 段，含：
- **标签**（💡 / ❓ / ✅）
- **来源**（哪轮调研 / 哪次会话 / 谁提的）
- **简述**（1-2 句话核心想法）
- **对接点**（如已升格，链到 ROADMAP / ADR / RISKS 行）

按时间倒序追加，旧灵感保留作历史（不删）。

---

## 2026-05-10 — iOS Eva-only 功能 audit (M2-iOS 剪枝起点)

### ❓ I1: iOS native 14,537 行有疑似 Eva-only 功能，M2-iOS 时一次性 audit

**来源**：M0 4-way review 后用户主动观察「很多 iOS 功能重叠或无用」(2026-05-10 conversation)

**判断**：现在不动（iOS 不在 M0–M1C 关键路径；缺 Vessel 端契约 = 盲剪；M2-iOS 反正要全测，剪+换+测一次完成）。但记录 audit 起点清单避免到 M2-iOS 时遗忘。

**疑似 Eva-only（M2-iOS 默认剪）**：
- `WorktreeAPI.swift` + `Views/WorktreeFinalizeSheet.swift` (278+100 行) — Eva harness worktree orchestration，Vessel 不复用 (ADR-000 §3 排除)
- `HarnessConfigAPI.swift` + `Views/Harness/*` — Eva harness 配置面板
- `HeartbeatMonitor.swift` + `Views/MacHeartbeatRow.swift` — Mac-iOS 联通监测，**部分逻辑 M2-iOS Bonjour 升级会替换**（不是全删，是改 NWBrowser 实现）
- `NotesSession.swift` — Eva 内部 notes 功能，Vessel 未规划
- `ProjectsAPI.swift` + `ProjectRegistry.swift` (Eva 多项目模型) — M2-iOS 是否保留多 Instance UI 待定（plan §「还有哪些」#11 已标 v1+）
- `Views/Harness/` 子目录全部 — Eva harness 专属

**确认 Vessel 仍要保留**：
- `BackendClient.swift` (WS 协议)、`Protocol.swift` / `HarnessProtocol.swift` (改名后保留)
- `VoiceRecorder.swift` + `VoiceSession.swift` + `Views/RecordingHUD.swift` (M2-Voice 用)
- `TranscriptParser.swift`、`Cache.swift`、`Settings.swift` (基础设施)
- `Views/Chat/*`、`Views/Drawer/*`、`Views/PermissionSheet.swift`、`InboxAPI.swift` + `Views/InboxListView.swift` (Capability 装入)

**对接点**：M2-iOS milestone 起点参考此清单 + `EVA_TO_VESSEL_MAPPING.md` iOS 行；先做 audit pass 再决定砍哪些 / 改哪些 / 留哪些。

---

## 2026-05-10 — v0A.1 完善 sprint Phase 0 调研

### 💡 C1: OpenPersona 4+5+3 架构（Body / Faculty / Skill 分层语义）

**来源**：[Phase 0 spike report](../research/0A-completion-sprint-prior-art-2026-05-09.md) §1.5

**简述**：[OpenPersona / acnlabs](https://github.com/acnlabs/OpenPersona) 提出"灵魂的容器"分 4 层（Soul / Body / Faculty / Skill）+ 5 系统概念（Evolution / Economy / Vitality / Social / Rhythm）+ 3 gates（Generate / Install / Runtime）。Vessel 5 接口（Agent/Skill/Tool/Memory/App）现在平铺，没有"哪些是身体哪些是灵魂"的语义分层。

**对接点**：v1+ 议题。如果 Vessel 进入"机器人 / 桌面宠物 / 多 embodiment"形态时，这种"身体观"分层比当前接口更适合表达"灵魂在不同身体里"。

### 💡 C2: AutoGen 反例 — typed graph 而非 implicit GroupChat

**来源**：[spike report §2.3](../research/0A-completion-sprint-prior-art-2026-05-09.md#23-autogen--microsoft-agent-framework2026-大变化)

**简述**：AutoGen 走过的弯路 —— implicit "Manager Agent decides who speaks next" / GroupChat 不可预测、难调试。2026 大重构后改用 **explicit Graph-based Workflows with typed nodes/edges + checkpointing**。

**对接点**：Vessel multi-agent 设计（v1+ 多 Capability 协作时）必须**直接走 typed graph + checkpointing**，不要重蹈"agent manager 神秘自决"覆辙。M1C-A scheduler 已经偏 typed graph，这个原则巩固。

### 💡 C3: Pipecat frame-based pipeline（voice agent framework）

**来源**：[spike report §4.5](../research/0A-completion-sprint-prior-art-2026-05-09.md#45-pipecat)

**简述**：[Pipecat](https://github.com/pipecat-ai/pipecat) BSD-2-Clause，frame-based async pipeline（frames = 数据包，processors = transformer worker）。20+ STT / 20+ LLM / 30+ TTS 集成。Pipecat Subagents = 分布式多 agent + shared message bus。Pipecat Flows = 显式状态机。

**对接点**：M2-Voice 实施时考虑直接吃 Pipecat（不要自拼 STT→LLM→TTS）。Frame + processor 抽象比 Vessel 的 Capability 接口更适合 streaming 场景。需要时跑 Phase 0 spike（Pipecat vs 自家 voice routes）。

### 💡 C4: Pi by Inflection 反例总结

**来源**：[spike report §1.4](../research/0A-completion-sprint-prior-art-2026-05-09.md#14-pi-by-inflection-ai反例)

**简述**：Pi 固定人格 + 100 turn 失忆 + 强 guardrails 切对话 = 死路。团队大部被 Microsoft 收编。**反例验证 Vessel 方向**：用户可写 soul.md + 三层 memory + 弱 guardrail 都是对的。

**对接点**：Vessel 0A REQUIREMENTS §A.2 Non-Goals 已经标 "❌ Pi by Inflection 模式"。本灵感作为长期反例参考，写 demo / 文档时引用。

### ❓ C5: MCP 双向兼容（Vessel Capability ↔ MCP server）何时做？

**来源**：[spike report §3 横向 findings](../research/0A-completion-sprint-prior-art-2026-05-09.md#横向-findings)

**简述**：MCP 已成事实标准（10000+ public server / Claude Code / Cursor / Goose / LM Studio / Open WebUI 全部 MCP 化；Anthropic 已捐 Linux Foundation）。Vessel 当前 M1B 计划仅作为 **MCP client**（消费 MCP server）。是否应**双向兼容**——既能 expose Vessel Capability 成 MCP server（让外部 agent 反向调 Vessel）？

**对接点**：v0.1 owner 一个用户无外部 agent 需求 → 暂推 v1+。但"接入生态"是 Vessel 长期价值锚点。**Owner 决策点**：v0.1 做 client only 是否足够？如果决定 v0.1 也要 expose，应该在 M1B 同步做（不阻塞但加工作量）。

---

## 模板（用此格式追加新灵感）

```markdown
### 💡/❓/✅ <标签短描述>

**来源**：<出处>

**简述**：<1-2 句>

**对接点**：<如已升格，链到 ROADMAP/ADR/RISKS 行；如灵感，写未来可能在哪 milestone 升格>
```

---

## 升格历史（已 ✅ 进 ROADMAP/ADR/RISKS 的灵感）

待第一次升格时填。

---

## 索引

按 milestone 关联（已升格灵感）：

- M0: —
- M0.5: —
- M1A: —
- M1B: —
- M1C-A: —
- M1C-B: —
- M2-Soul: —
- M2-Voice: —
- M2-iOS: —
- v1+: C1, C5（v0.1 → v1+ 决策）

按主题分类：

- 架构 / 分层语义: C1
- multi-agent 设计: C2
- voice / streaming: C3
- 反例 / 验证方向: C4
- 生态 / MCP: C5
