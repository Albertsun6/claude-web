我会按你给出的四个 artifact 内容做一次静态二评，不读外部上下文、不落文件、不跑命令；输出只覆盖 Round 2 这 8 个争议项在正确性、跨端对齐、不可逆、安全、简化上的问题。# Cross Review — Round 2 Brief / Contract 1-2 Debate

**Reviewer**: reviewer-cross  
**Model**: gpt-5.5-medium (via cursor-agent CLI)  
**Date**: 2026-05-03 02:29  
**Files reviewed**:
- docs/reviews/round-2-brief.md
- docs/reviews/contract-1-2-arch-2026-05-03-0209.md
- docs/reviews/contract-1-2-cross-2026-05-03-0207.md
- docs/HARNESS_REVIEW_LOG.md

---

## Summary

- Blockers: 0
- Majors: 3
- Minors: 3
- 总体判断：建议小改后合并

## Findings

### M1 [MAJOR] `methodology.default_weight` 无法表达按 stage.kind 的默认 weight

**Where**: `docs/reviews/round-2-brief.md` 项 #1；`docs/HARNESS_REVIEW_LOG.md` 辩论矩阵 #13  
**Lens**: 正确性 / 跨端对齐  
**Issue**: counter 说把 `stage.kind -> weight` 映射下沉到 `methodology.default_weight`，但单个 `default_weight` 只能表达一个默认值，无法同时表达 `design/implement/test/review/release = heavy`、`strategy/compliance = checklist`。  
**Suggested fix**: 不要用单列 `methodology.default_weight` 承载 per-stage 默认。改成 `methodology.stage_defaults_json`，形如 `{ "design": "heavy", "compliance": "checklist" }`；或者建立 `methodology_stage_template(methodology_id, kind, default_weight)`。

### M2 [MAJOR] 推迟 `stage_artifact` 可能把临时 JSON 数组固化成跨端合同

**Where**: `docs/reviews/round-2-brief.md` 项 #2；`docs/HARNESS_REVIEW_LOG.md` 辩论矩阵 #14  
**Lens**: 跨端对齐 / 不可逆 / 简化  
**Issue**: counter 说 M-1 不拆 `stage.{input,output,review_verdict}_artifact_ids_json`，等 M2 看查询频率。但契约 #2 正在定义 TS Zod / Swift Codable / fixtures，一旦这些 JSON 数组进入协议 DTO，M2 再改成 `stage_artifact` 就是 wire-format migration。  
**Suggested fix**: 二选一：要么现在就把关系建模成 `stageArtifactRefs`；要么在协议文档中明确这三个 JSON 数组是 persistence-only/internal，不进入稳定 DTO，不承诺客户端 round-trip。

### M3 [MAJOR] `metadata_json` 接受非 typed schema 可以，但仍缺 JSON 有效性约束

**Where**: `docs/reviews/round-2-brief.md` 项 #3；`docs/HARNESS_REVIEW_LOG.md` 辩论矩阵 #18  
**Lens**: 正确性 / 跨端对齐  
**Issue**: counter 接受 `metadata_json TEXT NOT NULL DEFAULT '{}'`，但只说结构由 methodology 约定，没有要求 SQLite 层保证它是合法 JSON。非法字符串会让 TS / Swift decode 行为分裂。  
**Suggested fix**: SQL 加 `CHECK (json_valid(metadata_json))`。如果 JSON1 不可用，就在 harness-store 写入层做统一 parse/stringify，并把失败语义写进 ADR。

### m1 [MINOR] Round 2 对 #6 的反驳缺少“最小可验收物”边界

**Where**: `docs/reviews/round-2-brief.md` 项 #6  
**Lens**: 不可逆 / 简化  
**Issue**: 保留 ContextBundle / PR-worktree 契约在 M-1 有合理性，但当前反驳只说明为什么不能砍，没有定义 M-1 到底交付到什么程度，容易重复 `HARNESS_PROTOCOL.md §8` 的 doc-only 完工问题。  
**Suggested fix**: 给 #3/#4 各列 2-3 个必须存在的落地物，例如 DTO、fixture、最小验收脚本；没有这些就不能标 done。

### m2 [MINOR] FTS5 性能观察项缺少可记录指标

**Where**: `docs/reviews/round-2-brief.md` 项 #8；`docs/HARNESS_REVIEW_LOG.md` Open Questions  
**Lens**: 安全 / 运维风险  
**Issue**: “M2 Retrospective 加观察项”方向对，但没有说记录什么，后续会变成主观感受。  
**Suggested fix**: 记录每批 artifact 写入数量、总字节数、FTS trigger 写入耗时、p95 insert latency。M2 只要手动日志也可以，不需要先上监控系统。

### m3 [MINOR] migrations 路径反驳成立，但边界应写清楚

**Where**: `docs/reviews/round-2-brief.md` 项 #7；`docs/HARNESS_REVIEW_LOG.md` 辩论矩阵 #24  
**Lens**: 正确性 / 运维风险  
**Issue**: 以当前 `tsx watch src/index.ts` 部署方式看，路径 finding 可以反驳。但这个反驳依赖“不打包、不复制 dist、不生产 bundle”的运行边界。  
**Suggested fix**: 在 ADR-0015 或 harness-store 注释里写明 migrations 路径假设：当前 backend 以源码目录运行；若未来打包，必须把 migrations 纳入复制清单或改成显式配置路径。

## False-Positive Watch

- F? M1 依赖我对 `methodology.default_weight` 的理解：如果作者实际打算的是“methodology 内部有 stage template JSON，只是简称 default_weight”，则 M1 可降级；但当前 brief 的字段名表达不支持这个理解。
- F? M3 依赖 SQLite JSON1 可用性；如果 better-sqlite3 构建不带 JSON1，则 SQL CHECK 方案要换成应用层 parse/stringify。

## What I Did Not Look At

- 没有读取真实 SQL patch、TS DTO、Swift Codable 或 fixtures。
- 没有运行 migration 或 round-trip 测试。
- 没有评审 ContextBundle / PR-worktree 契约正文，因为本轮只给了 Round 2 brief 和 Round 1 verdict/log。
