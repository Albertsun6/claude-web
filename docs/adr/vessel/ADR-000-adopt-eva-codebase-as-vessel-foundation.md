# ADR-000: Adopt Eva Codebase as Vessel Foundation（D' 路线锁定）

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: foundation, fork, eva-evolution, methodology
- **Resolves**: v4 第四轮外部 AI 评审 escalation E1 / D' 路线决策
- **Sequence**: 这是 0-pre 阶段第一份 ADR（编号 000，因为奠基性）
- **Spike report**: 无（决策由前 6 轮辩论 + Eva 项目盘点驱动，不是新依赖选型；Vessel 特有架构决策）

## Context

Vessel 项目最初规划是 Python 重写（v3.1 plan）。v4 阶段用户带来 Eva 项目（`/Users/yongqian/Desktop/claude-web` codename Eva，formerly claude-web）的盘点 —— Eva 已经实现了 Vessel 计划要做的约 70% 功能：

- Backend：cli-runner / scheduler / permission / inbox / harness / notifications / heartbeat / voice / telemetry（17 个核心模块，~5400 LOC）
- Shared：13 entity Zod DTOs + 14 类协议 schema（HARNESS_PROTOCOL_VERSION=1.2）
- iOS：59 Swift 文件 / 14,537 行（BackendClient / Inbox / Harness Board / Voice / Heartbeat 全实装）
- DB：v102 SQLite schema（13 表 / FTS5 / WAL + FK）
- 文档：11 ADR + retrospectives + HARNESS_INDEX 完整设计

第四轮外部 AI 评审在 4 个选项（A=Python 重写 / B=新仓 TS / C=混合 / D=Eva 演进）中选 D 并升级到 **D'**（Eva 原地演进 + Vessel 适配层 / 先冻结 Eva 现状 + 列映射表 + 渐进重命名）。第五轮评审确认"v5 可作为执行版"。

## Decision

**Vessel 起点 = Eva 仓库（fork-rename 路径）**。具体：

### 1. 保留 Eva 全部 TS 代码 + 文档资产

- ✅ 保留 `packages/backend/`（17 核心模块）
- ✅ 保留 `packages/shared/`（Zod DTOs + 协议）
- ✅ 保留 `packages/ios-native/`（59 Swift 文件）
- ✅ 保留 `docs/`（11 ADR + retrospectives + 设计文档库）—— 移到 `docs/adr/eva-legacy/`，**不 renumber**（按 v5.1 评审决定）
- ✅ 保留 git 历史（gitleaks 扫过 clean，可放心保留）

### 2. 增量加 Vessel 特有

- 🌟 **5 接口契约（Agent / App / Memory / Skill / Tool）—— 0A 时落 `packages/backend/src/interfaces/`**（v0-pre 修订，architect B-A2 + pragmatist m-P4）。**5 接口契约存放约定**：
  - `packages/backend/src/interfaces/{agent,skill,tool,memory,app}.ts` = **5 接口主契约**（Vessel 顶级抽象，跨端共享类型）
  - `packages/backend/src/drivers/types.ts` = **Driver 层内部契约**（不在 5 接口；CodingDriver 等 —— 见 [ADR-016](ADR-016-coding-driver-interface.md)）
  - `packages/backend/src/ml-worker/types.ts` = **Memory 接口的内部 helper**（embedding-client / asr-client / tts-client 是实现 detail，不是顶级接口 —— 见 [ADR-012](ADR-012-language-typescript-with-ml-worker.md)）
  - `packages/capability-*/manifest.yaml` = **App 接口的 Manifest schema**
- 🌟 Soul Spec 系统（`soul/parser.ts` / `injector.ts`） M2-Soul
- 🌟 Capability 装卸语义（`packages/capability-*/manifest.yaml`） M0.5+
- 🌟 ML worker 边界（`ml-workers/` 顶层 + `packages/backend/src/ml-worker/` TS manager） M1C-B+
- 🌟 ADR-000 ~ ADR-017 + future ADR
- 🌟 自治评审工作流（B' lite + cursor cross-reviewer，已 0-meta-lite 落地）

### 3. 沿用 + 排除清单（**v0-pre 修订 2026-05-09，owner E3 决策"a 方案"**）

#### ✅ 沿用（M1A 阶段保留 Eva UI，仅改 brand）

- `packages/frontend/`（React + Vite + Zustand 整套）
- 多项目 Tab UI（通用 IDE 模式）
- Harness 看板 UI（M1A 时改为 Workflow Engine UI，保留视觉 + 数据源切换）
- Inbox UI / Voice UI / Permission Sheet / 等所有 Eva 现有视图

#### ❌ 排除（明确不复用）

- Capacitor iOS（`packages/frontend/ios/` 已 DEPRECATED）
- Capacitor Android（同）
- `packages/shared/eva-config.ts`（worktree orchestration，Eva 业务相关）

#### 🌟 改 brand（按 ADR-013 改名 Stage 1-3）

- Logo / brand color / "Eva" 字样 → "Vessel"
- App icon / launch screen → 重做（M2-iOS 阶段）
- 文档内部链接 / 显示文案 → "Vessel"

#### ⏸️ 推到 v0.1 release 之后（owner 决定）

- UI 重设计（如不满意 Eva 多项目 Tab UI 想换布局）
- 视觉风格大调（主题色 / 字体 / 设计系统）
- M1A 不因 UI 重设计延期

### 4. ADR 共存策略（Eva 旧 ADR 不 renumber）

按 v5.1 评审决议：
- Eva 旧 ADR（如 ADR-0011-server-driven-thin-shell.md / ADR-0015-schema-migration.md）放到 `docs/adr/eva-legacy/`，原编号保留作为历史证据
- Vessel 新 ADR 在 `docs/adr/vessel/`，从 ADR-000 起新编号
- ADR README 加 supersede 矩阵：标注哪些 Eva ADR 仍有效 / 哪些被 Vessel ADR 取代

### 5. 改造受限（Eva 已踩坑模块内部不动）

按 ADR-016（Coding Driver C 路径）+ EVA_TO_VESSEL_MAPPING：
- `cli-runner.ts` 内部 git diff ≤ 5 行（仅 import / 类型导出）
- `scheduler.ts` 仅加 workflow_state 持久化字段，不重构 STAGE_SEQUENCE 内部
- `auth.ts` / `routes/permission.ts` 沿用，加 MCP scope schema
- `harness-store.ts` / `harness-queries.ts` 仅加新 query，不重写现有

### 6. 数据迁移

按 EVA_TO_VESSEL_MAPPING §2：
- Eva → Vessel 一次性迁移脚本 `scripts/migrate-eva-to-vessel.ts`（0B 阶段）
- **全部非破坏性**：复制不删源；dry-run 必跑
- migration 0004（v103）自动跑 schema 升级
- 不 drop column / drop table（按 ADR-014 硬触发 #8）

## Consequences

### 正面

- ① **v0.1 立刻有 70% 功能**——cli-runner / permission / inbox / harness / iOS 三件套都不需要重写
- ② **Eva 已踩过的坑已经修过**——5 集成挑战（非交互模式 / auth / stdout / 进程组 / artifact 隔离）有 characterization tests（test-cli / test-e2e / test-stale-session）保护
- ③ **改造影响范围可控**——总改造估计 +1080–1900 LOC（vs 全 Python 重写预估数月）；EVA_TO_VESSEL_MAPPING 33 行映射明确每模块改造动作
- ④ **架构纯度可在 Eva 上重构达成**——每个 ADR 是 git 操作记入；Vessel 5 接口契约 + Soul Spec + Capability 装卸是增量加，不破坏 Eva
- ⑤ **gitleaks 扫描 clean**——Eva 仓库 secrets 无 leaks（工作树 218MB clean / 历史 201 commits clean），可放心保留 git 历史

### 负面

- ① **需要重构期处理改名 + 接口抽象**——0B 改名 + Bundle ID 切换（ADR-013 范围）；M0 加 Orchestrator wrap Eva router；M0.5 加 Driver adapter wrap cli-runner
- ② **Eva 旧 ADR 与 Vessel ADR 共存**——目录分开（`docs/adr/eva-legacy/` + `docs/adr/vessel/`）；ADR README 加 supersede 矩阵；不 renumber 旧 ADR（历史决策编号是证据）
- ③ **iOS 改名 → TestFlight 重审 2-3 天**（按 ADR-013）——M2-iOS 时安排，不阻塞前面 milestone
- ④ **helper subprocess 不等于多服务架构**——vessel-core 仍是唯一常驻主服务进程；ML/MCP/CC 都是受控 helper（生命周期由主进程管理），符合"个人单机不要企业级"硬约束
- ⑤ **Vessel 特化点必须显式标注**——Soul Spec 作用范围（仅 cli-runner 注入）、ML worker 边界（仅 Python 子进程）、iOS 改名（M2-iOS 才做）—— 这些已通过 ADR-004 / ADR-012 / ADR-013 / ADR-016 / RISKS R-12 锁定

### 中性

- 跟 ADR-001 (pnpm) / ADR-012 (TS+ML worker) / ADR-013 (rename) / ADR-014 (review-workflow) / ADR-015 (research-before-design) / ADR-016 (coding-driver) / ADR-017 (cursor-cross-reviewer) 高度耦合 —— 这些 ADR 共同构成 D' 路线的完整骨架

## Prior Art

No direct prior art found.

Search keywords: `["fork-rename codebase methodology", "evolutionary architecture refactoring", "eva-to-vessel monorepo migration", "TS monorepo rebrand strategy"]`

Rationale for self-design：
- D' 路线（原地演进 + 适配层）是综合 Eva 项目特性 + Vessel 5 接口契约 / Soul Spec / Capability 装卸需求的特化决策
- 决策依据来自 6 轮外部 AI 评审 + 8 轮用户反馈（详见 plan v5.4 评审辩论流水）
- 最接近 prior art：传统 fork-rename + adapter pattern + Strangler Fig pattern（Martin Fowler）—— 但 Vessel 是 fork-rename 同时**保留双工运行**（Eva 现有调用方继续直调 cli-runner，Vessel 新代码经 CodingDriver adapter）

## 验证

- ADR-000 Status = Accepted（**已**）
- EVA_INVENTORY.md 覆盖 17 backend + iOS + shared + DB schema（**已**）
- EVA_TO_VESSEL_MAPPING.md ≥ 12 模块映射（**实际 33 行**）
- gitleaks 扫描 Eva 仓库无 high-severity finding（**已**，2026-05-09 工作树 + 历史都 clean）
- ADR-013 rename strategy 起步（同步落地）

## 后续依赖的 ADR

- ADR-001-package-manager-pnpm（沿用 Eva pnpm）
- ADR-006-schema-evolution（Eva schema_version=102 → Vessel 加 0004 migration）
- ADR-012-language-typescript-with-ml-worker（主栈锁定）
- ADR-013-rename-strategy（改名 runbook）
- ADR-016-coding-driver-interface（cli-runner 不动）
- ADR-014-review-workflow / ADR-015-research-before-design / ADR-017-cursor-cross-reviewer（评审基建）
