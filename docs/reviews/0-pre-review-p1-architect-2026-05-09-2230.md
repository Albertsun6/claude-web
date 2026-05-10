# Phase 1 Verdict — vessel-architect

- **Artifact**: 0-pre 6 产物（EVA_INVENTORY / EVA_TO_VESSEL_MAPPING / ADR-000 / ADR-012 / ADR-013 / RISKS.md）
- **Phase**: 1 (isolated)
- **Role**: vessel-architect
- **Date**: 2026-05-09 22:30
- **Lens**: 架构纯度 / 模块边界 / 5 接口契约 / 长期演进 / Boot 三层 / Eva 改造保架构纯度

---

## BLOCKER（3 条）

### B-A1: Boot 三层「Instance 级」推到 M2-Soul 留下 M1A–M1C 时期的 boot 真空

**Where**: `EVA_TO_VESSEL_MAPPING.md` §1.1 #1 写 "M0（拆进程 + Session 骨架）→ M2-Soul（加 Instance 级）"

**Issue**: CONCEPTS §3.5 三层 boot 是**进程级 / Instance 级 / Session 级**。Vessel 0-pre plan 把 Instance 级（读 soul.md / 恢复 Memory / 加载 Instance 名）完全推到 M2-Soul。这意味着 M1A / M1B / M1C 期间 vessel-core 启动时**跳过整个 Instance 级**——没有 Instance 名 / 没有 Memory init / 没有"接 Intent 前 ready"信号。

**Why blocker**:
- M1C-A Workflow resume 必须知道当前 Instance（恢复哪个 Instance 的 paused workflow）
- M1A session_id 共享需要 Instance 上下文（不同 Instance 不应共享 session）
- 缺 Instance 级 boot 等于跳过 v0.3 架构核心的一层

**Suggested fix**: M0 阶段就加**最小 Instance 级 boot**（"空 Instance"模式）：
- Instance 名默认 `"vessel-core"`（M2-Soul 后用户改成 EVA / 等）
- 不读 soul.md（M2-Soul 才接），但 boot.ts 的 instance.boot() 函数已存在（空操作）
- Memory init 是 Instance 级（M0.5 时已经在用 SQLite session_kv，所以本质上 Instance 级 boot 已经隐式发生——只是没显式拆函数）
- M2-Soul 仅扩展 instance.boot() 加 soul.md 解析

EVA_TO_VESSEL_MAPPING #1 改：「M0（拆三层 boot 完整骨架，Instance 级仅初始化空 Instance + Memory）→ M2-Soul（Instance 级补 soul.md 解析 + Soul 注入）」

### B-A2: 5 接口契约的 stub 时机 + 落地路径全文都没明确

**Where**: 全部 4 份 0-pre 文档（EVA_INVENTORY / EVA_TO_VESSEL_MAPPING / ADR-000 / ADR-012）

**Issue**: 
- v5.4 plan 0B Acceptance 写"`import { Agent, Skill, Tool, Memory, App } from '@vessel/core/interfaces'` 不报错"
- 但 EVA_TO_VESSEL_MAPPING #2–#5 没列 `interfaces/` 目录的创建动作
- ADR-000 §2 提到"🌟 5 接口契约——0A 时落 `packages/backend/src/interfaces/`"——但 ADR-012 § 6 把 EmbeddingClient/AsrClient/TtsClient 放在 `ml-worker/types.ts` 不是 interfaces/，ADR-016 把 CodingDriver 放在 `drivers/types.ts` 不是 interfaces/

**Why blocker**: 0B 实际落 stub 时会出现：
- 路径 X：`interfaces/{agent,skill,tool,memory,app}.ts` 是哪些？哪些 export 哪些 type？
- 路径 Y：`drivers/types.ts` (CodingDriver) 跟 5 接口的关系？
- 路径 Z：`ml-worker/types.ts` (EmbeddingClient) 跟 Memory 接口的关系？

如果不在 0-pre 锁清楚，0A FRAMEWORK 写接口签名时这三套 types.ts 边界模糊。

**Suggested fix**: ADR-000 § 2 增订 "5 接口契约存放约定"：
- `packages/backend/src/interfaces/{agent,skill,tool,memory,app}.ts` = **5 接口主契约**（Vessel 顶级抽象）
- `packages/backend/src/drivers/types.ts` = **Driver 层内部契约**（不在 5 接口；CodingDriver 等）
- `packages/backend/src/ml-worker/types.ts` = **Memory 接口的内部 helper**（embedding-client 是 Memory 实现 detail，不是顶级接口）
- `packages/backend/src/capability-*/manifest.ts` = **App 接口的 manifest schema**

EVA_TO_VESSEL_MAPPING 加 #34 "interfaces/ 5 接口 stub" 行，落到 0B。

### B-A3: ADR-000 §3 排除清单 + EVA_TO_VESSEL_MAPPING 都漏了 `packages/frontend/`

**Where**: `ADR-000` §3 / `EVA_TO_VESSEL_MAPPING.md` §1 整张映射表

**Issue**: v5.4 dogfood m-P1 已经标过 "frontend 沿用模糊"，本轮 0-pre 应该在 ADR-000 / EVA_TO_VESSEL_MAPPING 显式回答：
- Eva `packages/frontend/` (React + Vite + Zustand) 是不是 Vessel 的 frontend？
- UI 视觉皮肤是 Eva-specific 的——M1A 时**保留** Eva UI 还是**重设计**？
- ADR-000 §3 排除清单只写"Capacitor iOS（DEPRECATED）"，没说 frontend 主体

**Why blocker**: M1A acceptance 写"Web 薄壳 + 多端共享 session_id"——但如果 frontend 是 Eva 的多项目 Tab UI（专为 Eva 业务设计），M1A 验证什么？

**Suggested fix**: 
- ADR-000 §2 加 "✅ 保留 `packages/frontend/`（React monorepo 部分）" 
- ADR-000 §3 加 "❌ 排除：Eva-specific UI 视觉皮肤（如 Eva 项目 brand color / logo），M1A 之后看用户需求决定是否重设计"
- EVA_TO_VESSEL_MAPPING 加 #35 "packages/frontend/" 映射行，落到 M1A："保留 Eva 多项目 Tab UI + 改 endpoint URL；UI 重设计推到 M1A 完成后由用户决定"

---

## MAJOR（4 条）

### M-A1: EVA_INVENTORY §7.1 cli-runner 调用链画错

**Where**: `EVA_INVENTORY.md` §7.1 "WS upgrade (index.ts) → routes/runs (新建 run) → cli-runner.runSession(params)"

**Issue**: Eva 实际没有 `routes/runs.ts` —— Backend Explore 报告说"WS handler routes run 请求"，是直接在 index.ts 的 WS handler 内调 cli-runner，不是经过 routes/runs.ts。

**Suggested fix**: §7.1 改成 "WS upgrade (index.ts WS handler) → cli-runner.runSession(params) → spawn claude CLI subprocess → permission-hook callback → /api/permission/ask → registerPermissionChannel via WS"。删除虚构的 routes/runs.ts 节点。

### M-A2: EVA_TO_VESSEL_MAPPING #16 Wire Protocol 扩展时机不清

**Where**: `EVA_TO_VESSEL_MAPPING.md` §1.3 #16 "0A 设计 / 增量落"

**Issue**: protocol.ts 的 "intent kind"（ClientMessage 新加）在 M0 就要用（Orchestrator endpoint）。但 #16 含糊写"增量落"——实际每个 kind 在哪个 milestone 落到 protocol.ts？

**Suggested fix**: 改成具体表格：
- `intent` kind (ClientMessage) → M0
- `intent_response` kind (ServerMessage) → M0
- `trace_event` kind (ServerMessage) → M0（Trace 协议 12 字段配套）
- `workflow_paused` / `workflow_resumed` HarnessEvent kinds → M1C-A
- `soul_loaded` HarnessEvent kind → M2-Soul
- `capability_installed` / `capability_uninstalled` HarnessEvent kinds → M0.5+

### M-A3: ADR-013 §3 Vessel/ 目录冲突 escalation 没标到 inbox

**Where**: `ADR-013` §3 "当前 Vessel/ 目录冲突处理（关键 ⚠️）" + § Escalation Notes #1

**Issue**: ADR 里写了 escalation 但**没真正写到 `instance/inbox/`**。0B 启动前需要 owner 拍板（A vs B 方案）但 owner 不会主动看 ADR-013 §3。

**Suggested fix**: 立即写一份 inbox 文件 `instance/inbox/2026-05-09-0b-rename-decision.md`，含 ADR-013 §3 + § Escalation Notes 全部内容；按 ADR-014 escalation 协议处理（owner 确认后归档到 _archived/）。

### M-A4: 总改造估计数字两处不一致（+1080–1900 LOC vs +820–1600 LOC）

**Where**: 
- `EVA_TO_VESSEL_MAPPING.md` §3 总改造估计 = **+1080–1900**
- pragmatist B-P2（v5.4 dogfood）= **+820–1600**
- ADR-000 / RISKS 引用其中之一不明

**Issue**: 数字不一致会让阅读者困惑。1080-1900 比 820-1600 多 ~260-300 LOC——按 EVA_TO_VESSEL_MAPPING 的注释是因为加了 iOS 改名 + 数据迁移 + protocol.ts 扩展。**应该明确写出来**。

**Suggested fix**: EVA_TO_VESSEL_MAPPING §3 顶部加"vs v5.4 dogfood 估的 820-1600 LOC：本表多 +260-300 LOC，原因 = iOS 改名（150-300）+ 数据迁移脚本（50-100）+ protocol.ts 扩展（100-150）；这三块在 v5.4 dogfood 时未细化"。

---

## MINOR（3 条）

### m-A1: 5 接口 + 枚举 canonical 顺序 v5.4 dogfood 已要求按字母序，本轮没强制

**Where**: `EVA_INVENTORY.md` §3.2 IssueStatus 顺序 / 各 ADR 引用

**Issue**: v5.4 dogfood m-A2 finding 已写"5 接口字母序"。本轮 0-pre 文档里 IssueStatus / 各 enum 顺序仍是 Eva 原顺序——技术上不算错（Eva 已生产），但 0A FRAMEWORK 写时应该锁定 canonical 顺序。

**Suggested fix**: 0A FRAMEWORK 写时锁定 canonical 顺序；0-pre 不强制改 EVA_INVENTORY（保留 Eva 原顺序作为现状参考）。

### m-A2: EVA_INVENTORY §3 没列 packages/shared 当前 package name

**Where**: `EVA_INVENTORY.md` §3 全部

**Issue**: ADR-013 §2 Stage 1 写"`@claude-web/X → @vessel/X`"——但 EVA_INVENTORY §3 没列 packages/shared 当前 package name（盘点应该是 `@claude-web/shared`，但没确认）。

**Suggested fix**: §3.0 加 "package names: `@claude-web/backend` / `@claude-web/frontend` / `@claude-web/shared` / `@claude-web/ios-native`（Swift package？需确认）" 来源 = `pnpm ls --depth=0` 或读 package.json `name` 字段。

### m-A3: RISKS R-06 标记策略待统一

**Where**: `RISKS.md` R-06 "可能性 ~~高~~ 已 mitigation（gitleaks clean）"

**Issue**: 风险登记表 R-06 用 strikethrough 标"已缓解"——这种 in-line 修订符号在长期维护时会越积越多。建议统一用 `Status` 列（active / mitigated / closed）或 RISKS 顶部加"已缓解"小节。

**Suggested fix**: RISKS.md 加 `Status` 列；R-06 Status="mitigated (2026-05-09 gitleaks clean)"；其他 active；v0.1 release 前已缓解的项可移到 § "已缓解归档" 子节。

---

## Decision-required（3 项）

按 ADR-014 escalation #1 软触发，标 owner 决策：

1. **B-A3**：`packages/frontend/` 是否保留 Eva UI（仅改 endpoint URL）vs UI 重设计？影响 M1A 范围。**推荐**：M1A 保留 Eva UI，重设计推到 v0.1 release 之后由用户决定。
2. **M-A3 → ADR-013 escalation #1**：Vessel/ 目录与 claude-web/ 合并方案 A（mv + 恢复 docs）vs B（rsync + cp .git）？**推荐**：B（更稳）。
3. **ADR-013 escalation #2**：iOS App Store Connect 新 record（Apple 政策强制）—— 实际**不是 decision-required**，是 Apple 强制 A 方案；可在 ADR-013 改成 "A 方案锁定，因 Apple 政策"。

## Risk Callouts

无 4 类硬触发命中（除 R-06 secrets 已 mitigated 之外）。

## What I Did Not Look At

- 没读 ADR-014 / ADR-015 / ADR-016 / ADR-017 全文（Phase 1 范围限于 6 个 0-pre 产物）
- 没跑 cursor cross-reviewer（并行后台跑，等结果）
- 没真实跑 `pnpm ls --depth=0`（m-A2 验证 package name）

## 总结

3 BLOCKER + 4 MAJOR + 3 MINOR + 3 decision-required。最关键的 B-A1（boot 三层缺 Instance 级骨架）影响 M1A 启动 + M1C-A workflow resume；B-A2（5 接口 stub 时机）影响 0A FRAMEWORK 写作 + 0B 落地；B-A3（frontend 排除清单遗漏）影响 M1A 范围。0-pre 主体方向对，但 0A 之前必须解决这 3 条。
