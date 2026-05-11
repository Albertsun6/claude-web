# Doc Sync Cross-check — §13.2 多项目使用 5 文档同步修订

**Reviewer**: reviewer-cross (lightweight cross-check)  
**Model**: cursor-agent gpt-5.5  
**Date**: 2026-05-05 23:58

## Summary

- Cross-check items pass: 2 / 5
- Drift findings: 3
- 总体判断: 建议修后 PASS

## Findings

### F1 [DRIFT] R8.x 数量与命名
**Where**: `docs/HARNESS_RISKS.md` L274-L421; `docs/proposals/EVA_MULTI_PROJECT_USAGE.md` L416-L435  
**Status**: ID / 命名与 v0.3 列表一致，但“15 条”不成立。实际枚举是 R8.1、R8.2、R8.3a、R8.3b、R8.4-R8.15，共 16 个条目。source 和同步文件都写了“15 条”，计数漂移。

### F2 [DRIFT] H 段编号无冲突
**Where**: `docs/IDEAS.md` L1061-L1188; `docs/proposals/EVA_MULTI_PROJECT_USAGE.md` L437-L448、L645-L646  
**Status**: `IDEAS.md` 本身正确：H18 已被 Provider Runtime Matrix 占用，多项目条目从 H19 到 H26，共 8 条，无冲突。但 v0.3 proposal 仍有两处写 H18-H25，traceability 漂移。

### F3 [PASS] DATA_MODEL §1.1 字段一致
**Where**: `docs/HARNESS_DATA_MODEL.md` L55-L68; `docs/proposals/EVA_MULTI_PROJECT_USAGE.md` L204-L209、L234-L237  
**Status**: `domain_profile` / `needs_user_review` 与 P0-4a 一致。5 选 enum、migration nullable、新建 API 强制必传、legacy default `software-enterprise` + `needs_user_review = 1` 都对齐。

### F4 [PASS] K12 跨端契约一致
**Where**: `docs/HARNESS_ROADMAP.md` L108; `docs/HARNESS_DATA_MODEL.md` L425-L479; `docs/proposals/EVA_MULTI_PROJECT_USAGE.md` L410、L224-L233  
**Status**: 三处机制一致：Swift `init(from:)` fallback、TS Zod `.catch(default)`、fixture round-trip 覆盖 future unknown enum。fixture 字符串有长短差异，但语义一致，不构成 drift。

### F5 [DRIFT] 用户拍板引用一致
**Where**: `docs/HARNESS_RISKS.md` L309-L311、L370-L372; `docs/IDEAS.md` L1141、L1172; `docs/HARNESS_DATA_MODEL.md` L58-L59; `docs/HARNESS_ROADMAP.md` L101; `docs/proposals/EVA_MULTI_PROJECT_USAGE.md` L604-L619  
**Status**: U1-A / U2-C 基本一致。U3 在多数地方写成 U3-defer + 默认 U3-B，正确；但 `HARNESS_ROADMAP.md` L101 写“用户拍板 U3-B”，容易把最终决定从“defer，spike 后默认 U3-B”误读成“已直接拍板 U3-B”。

## What I Did Not Look At

- 未重新评审 `EVA_MULTI_PROJECT_USAGE.md` v0.3 设计本身。
- 未检查这些文档是否已经 commit。
- 未跑测试、未检查实现代码、未验证 migration 或 Swift/TS fixture 是否已经存在。
