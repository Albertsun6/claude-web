# Cross Review — Review Mechanism v2

**Reviewer**: reviewer-cross  
**Model**: gpt-5.5-medium (via cursor-agent CLI)  
**Date**: 2026-05-03 10:58  
**Files reviewed**:
- docs/proposals/REVIEW_MECHANISM_V2.md
- docs/HARNESS_REVIEW_LOG.md
- docs/retrospectives/M-1.md

---

## Summary

- Blockers: 0
- Majors: 3
- Minors: 3
- 总体判断：建议小改后合并

## Numeric Score（Round 1 contract #2 cross M3 修正：与 ReviewVerdict DTO 对齐）

| Lens | Score (0..5) |
|---|---|
| 正确性 | 3.8 |
| 跨端对齐 | 3.6 |
| 不可逆 | 4.0 |
| 安全 | 4.1 |
| 简化 | 3.7 |

**Overall score**：3.8

## Findings

### M1 [MAJOR] Phase 2 输入定义自相矛盾：说 author 不写 brief，但脚本仍依赖 author 分类草案

**Where**: `docs/proposals/REVIEW_MECHANISM_V2.md` §1.2  
**Lens**: 正确性 / 跨端对齐  
**Issue**: §1.2 写“author 不写 brief”，但脚本 prompt 又包含 “author 的 4 档分类草案”。  
**Why this is major**: phase 2 的核心目标是减少 author 单点 bias；如果 phase 2 仍要先读 author 分类草案，就不是纯 reviewer cross-pollinate，而是 reviewer 对 author framing 的二次反应。实现脚本也会卡在“分类草案从哪里来”。  
**Suggested fix**: 二选一写死：
- 方案 A：phase 2 只读 `artifact + own verdict + sibling verdict`，不读 author counter / 4 档分类。
- 方案 B：保留 author draft，但明确它是 phase 2 输入，并承认 v2 没有完全移除 author framing。

### M2 [MAJOR] “fresh context / 不读自己上一轮”与“读自己 Round 1 verdict 并撤回”冲突

**Where**: `docs/proposals/REVIEW_MECHANISM_V2.md` §1.1 / §1.2  
**Lens**: 正确性 / 不可逆  
**Issue**: 三层表要求 phase 2 “fresh context（不读自己上一轮）”，但 §1.2 prompt 又要求读“你 Round 1 的 verdict”，并允许撤回自己原 verdict。  
**Why this is major**: 这是流程契约，不是措辞问题。runner 到底该不该喂 own verdict 会直接影响 reviewer 能否撤回、能否逐条确认 sibling finding。  
**Suggested fix**: 把约束改成更精确的版本：fresh context = 不复用对话历史 / transcript，但允许读取本轮最终 artifact，包括 own Round 1 verdict、sibling Round 1 verdict、原始 artifact。

### M3 [MAJOR] `HARNESS_REVIEW_LOG.md` v1 元配置与 v2 提案会短期并存，缺 migration 边界

**Where**: `docs/HARNESS_REVIEW_LOG.md` “评审机制元配置”; `docs/proposals/REVIEW_MECHANISM_V2.md` §2  
**Lens**: 跨端对齐 / 不可逆  
**Issue**: 当前 log 明确写 “作者跑 debate-review 合并发现”，而 v2 要拆成 phase 2 react + phase 3 arbitration。提案说更新 log 头部，但没说明旧 Round 1 / Round 2 记录是否保持 v1 语义，还是要补写 phase 标注。  
**Why this is major**: review log 是历史审计入口。一旦 v1 / v2 记录混在同一文件，后续读者可能误以为旧 “辩论矩阵” 已经包含 reviewer cross-pollinate。  
**Suggested fix**: 在 `HARNESS_REVIEW_LOG.md` 头部加一段版本边界：
- 2026-05-03 10:58 前记录使用 v1：independent review + author arbitration。
- v2 生效后新增记录必须包含 phase 1 / phase 2 / phase 3 三段。
- 旧记录不回填 react verdict，避免伪造历史。

### m1 [MINOR] 脚本命名放在 backend scripts 下，但它不是 backend runtime 逻辑

**Where**: `docs/proposals/REVIEW_MECHANISM_V2.md` §2 step 4  
**Lens**: 简化  
**Issue**: `packages/backend/scripts/run-debate-phase.sh` 更像 harness workflow tooling，不是 backend 包的一部分。  
**Suggested fix**: 考虑放到 `scripts/run-debate-phase.sh`，与 `scripts/verify-m1-deliverables.mjs` 同级；如果继续放 backend，需要说明它依赖 backend package tooling。

### m2 [MINOR] 验收条件“至少 1 条真表态”太弱

**Where**: `docs/proposals/REVIEW_MECHANISM_V2.md` §4 / §8  
**Lens**: 正确性 / 简化  
**Issue**: phase 2 的目标是逐项 agree / disagree / refine，但验收只要求至少 1 条表态。  
**Suggested fix**: 改成：每条 sibling finding 都必须有 `agree | disagree-with-evidence | refine | not-reviewed-with-reason` 之一；否则 phase 2 不通过。

### m3 [MINOR] `retrospectives/M-1.md` 已明确 reviewer-cross 缺“里程碑出口自检 lens”，但 v2 没决定是否处理

**Where**: `docs/retrospectives/M-1.md` §5; `docs/proposals/REVIEW_MECHANISM_V2.md` §1.4  
**Lens**: 简化 / 跨端对齐  
**Issue**: M-1 复盘两次指出 cross 漏判 §8 撒谎为 blocker 的模式，但 v2 §1.4 又说 reviewer-cross 5 lens 不动。  
**Suggested fix**: 不一定要加 lens 6，但要写明选择：v2 只修 phase 2 缺失，不修 reviewer-cross lens blind spot；该问题另开 M0/M1 方法论改进项。

## False-Positive Watch

- F? M3 可能是 false positive：如果作者计划实施 v2 时立刻重写 `HARNESS_REVIEW_LOG.md` 头部并明确旧记录边界，则问题会消失；当前 artifact 里还没看到这个边界。
- F? m1 可能是 false positive：如果现有 runner 都集中在 `packages/backend/scripts/`，保持同目录也可以接受，但提案需要说明归属理由。

## What I Did Not Look At

- Did not run any script or inspect repository state.
- Did not review actual `run-debate-phase.sh` implementation because it does not exist in the provided artifact.
- Did not read author transcripts, tool history, or sibling architecture verdict.
