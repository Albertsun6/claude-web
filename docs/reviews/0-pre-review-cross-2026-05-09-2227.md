# Cross Review — Vessel Phase 1 Eva Foundation

**Reviewer**: vessel-cross-reviewer  
**Model**: gpt-5.5  
**Date**: 2026-05-09 22:27  
**Files reviewed**:
- `docs/notes/EVA_INVENTORY.md`
- `docs/design/EVA_TO_VESSEL_MAPPING.md`
- `docs/adr/vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md`
- `docs/adr/vessel/ADR-012-language-typescript-with-ml-worker.md`
- `docs/adr/vessel/ADR-013-rename-strategy.md`
- `docs/design/RISKS.md`

---

## Summary

- Blockers: 1
- Majors: 4
- Minors: 3
- Lens 5 findings: 1
- 总体判断：必须先修

## Numeric Score

| Lens | Score (0..5) |
|---|---|
| 正确性 | 3.5 |
| 跨端对齐 | 3.4 |
| Eva 改造 + Vessel 硬约束 | 3.4 |
| 安全 + 4 类硬触发 | 3.1 |
| 集体盲区检测 | 3.6 |

**Overall**：3.4（有 BLOCKER，上限 3.9）

## Findings

### B1 [BLOCKER] Rename runbook 仍保留破坏性 `rm -rf` 路径

**Where**: `docs/adr/vessel/ADR-013-rename-strategy.md:100-112`  
**Lens**: 5, 4  
**Issue**: ADR-013 的方案 A 只备份 `docs/`，随后执行 `rm -rf ~/Desktop/Vessel`，会删除当前 Vessel 目录里的非 docs 内容、隐藏目录和未来可能新增的本地状态。  
**Why this is a blocker**: 这是可执行 runbook，且 ADR 已是 Accepted；一旦 0B 照做，可能造成不可恢复的数据丢失。即使后面推荐 B，A 仍作为合法方案存在。  
**Suggested fix**: 删除方案 A，或改成“完整目录快照 + `rsync --dry-run` + 冲突清单 + 人工确认”。不要在 runbook 中保留 `rm -rf ~/Desktop/Vessel` 作为可选路径。

### M1 [MAJOR] TS 协议扩展没有对应 Swift Codable 落点

**Where**: `docs/design/EVA_TO_VESSEL_MAPPING.md:54-55`, `docs/design/EVA_TO_VESSEL_MAPPING.md:65-75`, `docs/notes/EVA_INVENTORY.md:270-294`  
**Lens**: 2  
**Issue**: Mapping 明确新增 `intent` / `intent_response` / `trace_event` / 新 HarnessEvent / 新 Schema，但 iOS 映射只写了 endpoint、Bonjour、workflow_resume UI，没有写 `HarnessProtocol.swift` / `BackendClient.swift` / fixture decode 的同步更新。  
**Why this matters**: Eva 当前有 Swift 协议镜像和 fixture 测试；TS Zod 新增枚举或消息 kind 后，如果 Swift 端不同时更新，iOS WS decode 会直接失配。  
**Suggested fix**: 在 iOS mapping 中新增一行：`HarnessProtocol.swift + BackendClient.swift` 同步新增所有 Wire/Harness DTO；Acceptance 加 TS fixture 生成、Swift fixture decode、unknown kind 降级策略。

### M2 [MAJOR] `0004` migration 被多个 milestone 复用，schema version 语义不稳定

**Where**: `docs/design/EVA_TO_VESSEL_MAPPING.md:34`, `docs/design/EVA_TO_VESSEL_MAPPING.md:81`, `docs/design/EVA_TO_VESSEL_MAPPING.md:117-119`, `docs/adr/vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md:72`  
**Lens**: 1, 3  
**Issue**: 文档把 `workflow_state`、`embedding`、`soul_history`、`capability` 都放进 migration `0004/v103`，但这些表分属 M1C-A、M1C-B、M2-Soul、M2+。  
**Why this matters**: SQLite migration 版本不能“按 milestone 逐步填同一个 0004”。如果 M1C-A 已跑 v103，后续再补同版本表会失效；如果提前建未来表，又会把未来依赖和未定 schema 提前冻结。  
**Suggested fix**: 拆成顺序 migration：`0004_workflow_state`、`0005_embedding`、`0006_soul_history`、`0007_capability`；每个 migration 只包含该 milestone 已锁定的 schema。

### M3 [MAJOR] Scheduler “内部不动”约束和 retry policy hook 冲突

**Where**: `docs/design/EVA_TO_VESSEL_MAPPING.md:17`, `docs/design/EVA_TO_VESSEL_MAPPING.md:33`, `docs/adr/vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md:61-65`, `docs/notes/EVA_INVENTORY.md:101-108`  
**Lens**: 1, 3  
**Issue**: 原则和 ADR-000 都说 `scheduler.ts` 仅加 `workflow_state` 持久化字段，不重构内部；但 mapping 又要求“保留 STAGE_SEQUENCE 但加 retry policy hook”。  
**Why this matters**: retry policy 会改状态机语义，正好触碰 Eva 已验证但脆弱的 scheduler 边界。  
**Suggested fix**: M1C-A 只做 paused/resume 持久化；retry policy 移到单独 ADR / milestone，或显式放宽 ADR-000 并要求 scheduler characterization tests 覆盖 failed、blocked、retry、resume 组合。

### M4 [MAJOR] License 风险被 gitleaks 结果错误覆盖

**Where**: `docs/design/RISKS.md:26`, `docs/adr/vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md:32-33`, `docs/adr/vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md:83`  
**Lens**: 4  
**Issue**: R-06 标题包含 “Eva license / 历史敏感数据”，但 mitigation 只证明 gitleaks clean；这不能证明源代码 license、依赖 license、文档资产 license 都可继承。  
**Why this matters**: ADR-000 要保留全部代码、文档和 git 历史；如果未来上传 GitHub 或发布包，license 是独立硬触发，不能由 secrets scan 替代。  
**Suggested fix**: 拆分 R-06：`R-06a secrets` 和 `R-06b license provenance`；0B 加 `LICENSE` 文件核对、workspace dependency license scan、Eva docs/assets license 归属确认。

### m1 [MINOR] Workflow resume API 命名不一致

**Where**: `docs/design/EVA_TO_VESSEL_MAPPING.md:33`, `docs/design/EVA_TO_VESSEL_MAPPING.md:36`  
**Lens**: 2  
**Issue**: 同一功能一处写 `workflow_resume(id)`，另一处写 `POST /api/workflow/resume`，没有说明 id 在 path、body 还是 query。  
**Suggested fix**: 统一成一个 HTTP contract，例如 `POST /api/workflows/:id/resume` 或 `POST /api/workflow/resume { id }`，并写进 TS/Swift DTO。

### m2 [MINOR] 0-pre Acceptance 状态已过期

**Where**: `docs/design/EVA_TO_VESSEL_MAPPING.md:159-165`, `docs/adr/vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md:3`, `docs/adr/vessel/ADR-012-language-typescript-with-ml-worker.md:3`, `docs/design/RISKS.md:1-3`  
**Lens**: 1  
**Issue**: Mapping 仍写 “ADR-000 + ADR-012 Status=Accepted（待写）” 和 “RISKS ≥ 11 条（待写）”，但对应文件已经存在且 Accepted / 13 条风险。  
**Suggested fix**: 更新 Acceptance 勾选状态，避免 Verify Gate 读到旧状态后误判。

### m3 [MINOR] 文档中保留私人绝对路径

**Where**: `docs/notes/EVA_INVENTORY.md:5`, `docs/adr/vessel/ADR-013-rename-strategy.md:98`  
**Lens**: 4  
**Issue**: artifact 中出现 `/Users/yongqian/Desktop/...` 绝对路径。对本地 plan 没问题，但若进入公开仓库，会泄露用户名和本机目录结构。  
**Suggested fix**: 改成 `~/Desktop/claude-web`、`~/Desktop/Vessel` 或 `$HOME/Desktop/...`；只在本地脚本里解析真实路径。

## False-Positive Watch

- F? M4 license finding — uncertain because本次没有读取 Eva 原仓库的 `package.json`、`LICENSE`、lockfile 或依赖清单；如果这些已经有单独 license scan 报告，可以降为 minor。
- F? m3 private path — uncertain because这是个人本地项目文档；如果仓库永远不公开，风险较低。

## What I Did Not Look At

- Did not run `pnpm audit`, gitleaks, license scan, or dependency install.
- Did not inspect actual TS Zod schemas, Swift source, or SQLite migration SQL beyond these review artifacts.
- Did not read sibling reviewer verdicts or author counter-arguments.
- Did not modify any file.
