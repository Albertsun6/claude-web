# ADR-0015 — Schema 迁移策略

**状态**：Accepted（2026-05-03，M-1 启动期敲定）

**Decider**：用户 + reviewer-cross + reviewer-architecture（M-1 验收 ritual）

**关联**：[ADR-0010](ADR-0010-sqlite-fts5.md) · [HARNESS_DATA_MODEL.md](../HARNESS_DATA_MODEL.md) · [HARNESS_ROADMAP.md §1.2](../HARNESS_ROADMAP.md)

---

## Context

harness schema 在四个独立"端"出现，必须同步演化：

1. **SQLite schema** — `harness.db` 业务表 + 触发器 + 索引
2. **Artifact 文件格式** — `~/.claude-web/artifacts/<hash>.md` 的 frontmatter / 正文规约
3. **TS Zod schema** — `packages/shared/src/harness-protocol.ts`（backend ↔ web 共享）
4. **Swift 协议** — `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`（iOS）

任一端先行而其他端落后，会出现：
- iOS 老版本装包遇到新字段直接 decode 失败（一夜炸）
- backend 写新字段，web 读不到 → UI 静默漏字段
- 老 jsonl Artifact 在新 schema 下可能没 `storage` 字段 → reader 崩

四端同步是必需，且 iOS 同步是最贵的（要重装 / TestFlight）。

---

## Decision

四端 **同步迁移**，按 **major / minor / patch** 三档处理：

| 档 | 触发条件 | 兼容窗口 | 老客户端处理 |
|---|---|---|---|
| **major bump**（v1 → v2） | 删字段 / 改字段语义 / 改外键关系 / 改 enum 已有值 | **1 个 minor 窗口** | iOS / web 检测 `minClientVersion` 不满足 → 提示升级，回退打包内 fallback config |
| **minor bump**（v1.2 → v1.3） | 加列 / 加 enum 值 / 加表 | **永久兼容**（additive only） | 老客户端 graceful skip 未知字段 |
| **patch bump**（v1.2.0 → v1.2.1） | 改 index / 改注释 / 改触发器 | **永久兼容** | 无感知 |

### 版本号位置

- **DB**：`PRAGMA user_version` 存当前 schema major.minor（patch 不记，因为不影响兼容）
- **Zod / Swift**：`harness-protocol.ts` 顶部常量 `HARNESS_PROTOCOL_VERSION = "1.0"` + `MIN_CLIENT_VERSION = "1.0"`
- **Artifact 文件**：每个 `<hash>.md` frontmatter `schema: 1.0`

### 四端同步流程

每个 schema 变更：

1. 写新 migration `packages/backend/src/migrations/000N_<desc>.sql`（幂等：`CREATE TABLE IF NOT EXISTS` 等）
2. 更新 `packages/shared/src/harness-protocol.ts` Zod schema + bump `HARNESS_PROTOCOL_VERSION`
3. 更新 `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`
4. 更新 `packages/shared/fixtures/harness/*.json`（每实体的样例）
5. 跑 round-trip 测试：TS encode → Swift decode → Swift encode → TS decode 不丢字段
6. commit message 必须含 `schema migration N → N+1`

### 不允许的操作

- ❌ 直接改老 migration 文件（必须新建一份）
- ❌ 在 minor bump 里删字段或改语义
- ❌ iOS 单端先升而 backend 没升（违反 thin shell 原则——iOS 改一次锁很久）
- ❌ **iOS 端将 server-driven config 字段建模为 non-optional**——破坏 minor bump 双向兼容（v1.1 client + v1.0 server payload 会 keyNotFound decode 失败）。**所有 minor bump 加的字段在 iOS Codable struct 中必须是 optional**，store 层用 `?? bundleFallback().<field>!` 兜底（M0 permissionModes Round phase 3 BLOCKER 修复）

### Footnotes（mini-milestone 实测沉淀的边界条件）

- **F1（permissionModes Round phase 3 cross m1 + arch refine 修复）**：M0 permissionModes 当前**没有 enabled 字段**，因此 `isDefault` exactly-one 的 superRefine 检查是对所有项的约束。**未来加 enabled 字段时（minor bump）**，superRefine 必须同步改为 `isDefault && enabled` exactly-one——否则静默放过 0-default 配置。这条约束写在此处防遗漏

### Migrations 路径假设（Round 2 cross m3）

当前 backend 用 `tsx watch src/index.ts` 直接跑源码，**不打包，不复制 dist**。`harness-store.ts` 通过 `import.meta.url` 解析定位到 `packages/backend/src/migrations/`，路径稳定。

未来若引入打包（esbuild / rollup / bundler）：
- 必须把 `*.sql` 文件纳入 copy 清单（如 `esbuild --loader:.sql=copy`）
- 或改成 `MIGRATIONS_DIR` 环境变量显式配置
- 或改成把 SQL 内容 inline 进 TS（比如 build 时 codegen `migrations.gen.ts`）

当前选项：维持源码运行，不打包（[HARNESS_ROADMAP §0 #11](../HARNESS_ROADMAP.md) "不引入新基础组件"）。

### 工具链

**M-1 阶段**（手动验，本里程碑准入门槛）：
- `pnpm --filter @claude-web/backend test:harness-schema` → DDL + 重启回归
- `node scripts/verify-m1-deliverables.mjs` → 文件存在性守门（防 [x] 自报通过）

**M1+ 引入 CI**（Round 1 arch 里程碑#7 修正措辞，从"应该跑"改为"M1+ 引入"）：
- `pnpm --filter @claude-web/shared build` → Zod 编译
- iOS Xcode build → Swift 协议编译
- fixtures round-trip 脚本：TS encode → Swift decode → Swift encode → TS decode 不丢字段
- enum 字符串完全匹配测试（防语义漂移）
- 失败任一项不允许 merge

---

## Consequences

**Pros**：
- ✅ 协议演化可控，不会一夜炸
- ✅ 老 iOS 装包通过 fallback config + minClientVersion 拒绝兜底
- ✅ Audit log 的 `op="migrate"` entry 可追溯每次跳变
- ✅ 与 [ADR-0011 Server-driven thin-shell](ADR-0011-server-driven-thin-shell.md)（待建）协同：iOS 不重装就能跟新字段

**Cons**：
- ❌ 迁移流程繁琐（4 端必须手动同步）
- ❌ 大改时所有端同时升级，不能分批
- ❌ CI 强制 round-trip 检查在 M-1 阶段还没建（M1+ 引入）

---

## 替代方案及为何驳回

| 方案 | 驳回理由 |
|---|---|
| 不版本化，自由演化 | 第一次老 iOS 撞上新字段 decode 失败就一夜炸 |
| 单端版本化（只 iOS 检测） | backend 改了字段 web 不知道 → UI 静默漏 |
| 四端独立版本号 | 维护 4 套版本号笛卡尔积，复杂度爆炸 |
| 工具自动生成（`tsc-to-swift` 等） | 依赖第三方工具版本，工具炸时手动改更慢；且 Zod 与 Swift Codable 语义不完全 1:1 |

---

## 与 ADR-0011 的协作

[ADR-0011 Server-driven thin-shell](ADR-0011-server-driven-thin-shell.md) **当前状态：Proposed**（M-1 立项，M0 升级 Accepted）。规定 iOS 上的 stages / agentProfiles / decisionForms 等动态内容由 backend `GET /api/harness/config` 提供。这意味着：

- **minor bump** 添加新 stage / agentProfile → 老 iOS 不重装就能通过 server-driven config 显示新内容
- **major bump** 改 stage 字段语义 → iOS 必须重装；server config 检测 minClientVersion 后吐出 fallback config

合起来：90% 的 schema 演化是 minor，iOS 不重装；10% 的 major 才需要重装。

> ADR-0011 目前是 placeholder。本节描述的"协作语义"在 M-1 阶段是**意向声明**，具体 `/api/harness/config` payload schema、minClientVersion 检测路径、fallback 范围由 M0 ritual 敲定。
