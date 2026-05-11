# Phase 1 Verdict — vessel-pragmatist

- **Artifact**: 0-pre 6 产物
- **Phase**: 1 (isolated)
- **Role**: vessel-pragmatist
- **Date**: 2026-05-09 22:40
- **Lens**: YAGNI / Eva 优先复用 / 个人单机 / 工程可行 / 阶段拆分

---

## BLOCKER（1 条）

### B-P1: ADR-013 改名 4 Stage 工程量被低估 + 30+ 项漏一项就 break

**Where**: `ADR-013` §2 整张 checklist

**Issue**: 改名 30+ 项（仓库 / 多包 package.json / pnpm import 替换 / data dir / env var / iOS bundle id / Cache fallback / 文档链接 / 等）—— 任何一项漏掉都可能 break 编译或 runtime。pragmatist 视角：
- 一次性 big-bang 改名风险高
- "Stage 1-3 在 0B 做"——0B 工作量现有估 +50-100 LOC，但改名实际涉及 grep-replace 50-100 个文件
- 缺中间 checkpoint（每 Stage 完成后跑 `pnpm install + pnpm test:cli` 验证）

**Why blocker**: 0B 是关键瓶颈——如果改名出错，前面所有 0-pre 产物作废，需要回退。

**Suggested fix**: 
- ADR-013 §2 加 "Stage 间 checkpoint" 段：每 Stage 完成跑 `pnpm install + pnpm test:cli + pnpm test:protocol`，全过才能进下一 Stage
- 加 "改名验证脚本" `scripts/verify-rename.sh`：grep `claude-web` / `Eva` 残留 → 排除合法引用（eva-legacy ADR / 注释）→ 输出 diff
- 给改名工程量重新估：30+ 项 grep-replace 至少 +200-300 LOC（不是 +50-100）

---

## MAJOR（4 条）

### M-P1: env var 双名 fallback 留长期维护债

**Where**: `ADR-013` §2 Stage 2 "保留旧名作为 fallback：env var 不存在时检查旧名"

**Issue**: 写 TS 代码时要 `process.env.VESSEL_TOKEN || process.env.CLAUDE_WEB_TOKEN`——这种双名 fallback 一旦不删，永远删不掉（用户已经习惯老名）。YAGNI 视角：用户是 owner 自己（个人单机），跑迁移脚本时**强制改 env 文件**比留 fallback 清爽。

**Suggested fix**: ADR-013 §2 改：迁移脚本启动时检测 `CLAUDE_WEB_*` env vars，**alert 用户改 env 后再跑**（不留代码侧 fallback）。owner 个人单机，一次改完即可。

### M-P2: protocol.ts 扩展 +100-150 LOC 估计偏低

**Where**: `EVA_TO_VESSEL_MAPPING.md` §1.3 #16 "+100-150"

**Issue**: 实际 protocol.ts 扩展涉及：
- 5-7 个新 kind（intent / intent_response / trace_event + Workflow / Soul / Capability HarnessEvent kinds）
- Soul / Capability / Intent / TraceEvent / AppManifest 的完整 Zod schema（每个 ~30-80 行 schema 定义）
- iOS Swift Codable 镜像（按 cursor M1 finding，每个新 schema 同步到 Swift）
- 测试 fixture（每个新 schema 至少 1 个 fixture）

**Why this matters**: 总估计 +200-400 LOC（vs 100-150）。如果 0A FRAMEWORK 时按低估写工时，会拖延。

**Suggested fix**: §1.3 #16 改成 +200-400；并加备注 "含 Swift Codable 同步 + fixture 测试 + Zod schema"。

### M-P3: Eva-specific UI 排除清单含糊

**Where**: `ADR-000` §3 "Eva-specific UI 视觉皮肤——M1A 之后看用户需求"

**Issue**: "Eva-specific UI" 不明确：
- 多项目 Tab 是 Eva 业务还是通用 IDE 模式？（Vessel 也可能要多项目）
- harness 看板是 Eva-specific 还是 Vessel Workflow Engine 通用？
- React + Vite + Zustand 整套 stack 不算 Eva-specific（通用前端）—— 沿用没问题
- Eva logo / brand color 算 Eva-specific（明确改）

**Suggested fix**: ADR-000 §3 加细化清单：
- ✅ 沿用：React stack / 多项目 Tab UI（通用模式）/ Harness 看板（M1A 时改成 Workflow Engine UI）/ Inbox UI / Voice UI
- ❌ 改：Logo / Brand color / "Eva" 字样（按 ADR-013 改 "Vessel"）/ App 图标
- ⚠️ 视情况：默认主题色 / 字体——M1A 时由 owner 决定

### M-P4: ML worker capability "unavailable" 状态如何显示给用户？

**Where**: `ADR-012` §4 "主进程检测 worker exit 后：标 capability unavailable / 通知用户"

**Issue**: "标 capability unavailable" 实际怎么标？通知在哪？
- `vessel-core --health` 命令报告？✅（已写）
- inbox 写 escalation 文件？（未写）
- Web UI 显示 "memory disabled" badge？（未写）
- iOS push notification？（未写）

owner 不会主动跑 `vessel-core --health`——需要被动通知机制。

**Suggested fix**: ADR-012 §4 加 "Capability unavailable 通知策略"：
- 短期（M1C-B / M2-Voice）：写 inbox 文件（手动 escalation）
- 中期（M1A 后）：Web UI 显示 capability status badge
- 长期（v1+）：iOS push notification

---

## MINOR（4 条）

### m-P1: 0-pre 工作量没标在 plan v5.4 / 任何文档

**Where**: 全部 0-pre 文档

**Issue**: 这次 0-pre 写完 6 文档约 2-3 小时密集工作（+EVA_INVENTORY 约 350 行 + EVA_TO_VESSEL_MAPPING 约 200 行 + 3 ADR 各 100-200 行 + RISKS 约 80 行 = ~1100 行 markdown）。但 plan v5.4 0-pre 段 Acceptance 没标"工作量预估"。pragmatist 担心 0A / M0 也低估。

**Suggested fix**: 实际不阻塞 0-pre acceptance；但下次评审 plan 时建议 milestone 加"实际投入工时"日志（不是预估，是事后回填——给后续 milestone 校准）。

### m-P2: RISKS.md 风险等级标记不一致

**Where**: `RISKS.md` 风险登记表

**Issue**: 顶部图例写 🔴 高 / 🟠 中 / 🟢 低，但表格内只有 R-06 标 🔴；其他 12 条都没填等级符号。pragmatist 视角：要么全标，要么全删图例（不要半吊子）。

**Suggested fix**: 表格"可能性"+"影响"列已经有数字（高/中/低），不需要符号；删除图例段。或者补全所有 12 条的符号。

### m-P3: cursor verdict M2 同意（migration 0004 应拆 0004/0005/0006/0007）

**Where**: `EVA_TO_VESSEL_MAPPING.md` §1.5 "新增 migration 0004（schema_version=103）：含 4 表"

**Issue**: cursor cross-reviewer 已找出此 BLOCKER（M2）—— pragmatist 完全同意。SQLite migration 不能按 milestone 重复填同一个版本号；应该拆成 0004（M1C-A workflow_state）/ 0005（M1C-B embedding）/ 0006（M2-Soul soul_history）/ 0007（M2+ capability）。

**Suggested fix**: EVA_TO_VESSEL_MAPPING §1.5 改成 4 个 migration 文件 + 4 个 schema_version（v103/v104/v105/v106）。

### m-P4: ADR-016 Driver layer 跟 ADR-000 §2 「5 接口契约不变」声明的兼容性已经在 ADR-016 解释了——但 ADR-000 没反向引用

**Where**: `ADR-000` §2 / `ADR-016`

**Issue**: ADR-000 §2 写"🌟 5 接口契约（Agent / App / Memory / Skill / Tool）—— 0A 时落 packages/backend/src/interfaces/"。ADR-016 解释 Driver 不在 5 接口里——但 ADR-000 没反向引用 ADR-016。

**Suggested fix**: ADR-000 §2 加 "Driver 层（CodingDriver / EmbeddingClient / 等）属于内部实现契约，不在 5 接口主契约——见 ADR-016"。

---

## Decision-required（1 项）

按 ADR-014 escalation #1：
- **M-P3**：Eva-specific UI 排除清单细化（多项目 Tab / harness 看板 / 主题色）—— owner 决策。**推荐**：M1A 之前保留全部 Eva UI（仅改 logo / brand color / "Eva" 字样），UI 重设计推到 v0.1 release 之后。

## Risk Callouts

无 4 类硬触发命中（pragmatist lens 不直接抓硬触发）。

## What I Did Not Look At

- 没读 cursor verdict（隔离评审，但事后看到 cursor 已找出 ADR-013 §3 rm -rf BLOCKER + migration 0004 复用 BLOCKER）—— **真异质性证明**，pragmatist 视角没看到这两条 SQLite + bash 安全 finding
- 没跑 `pnpm install + pnpm test:cli`（dogfood scope）

## 总结

1 BLOCKER + 4 MAJOR + 4 MINOR。最关键 B-P1（改名工程量低估，需 Stage 间 checkpoint）+ M-P3（UI 排除清单含糊）。整体 0-pre 方向对，但 0B 实施前必须解决 B-P1（每 Stage checkpoint）+ cursor B1 / M2 / M4。
