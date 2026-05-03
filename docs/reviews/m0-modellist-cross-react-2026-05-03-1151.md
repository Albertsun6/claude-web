# Phase 2 React Verdict — M0 Harness Config ModelList

**Reviewer**: reviewer-cross  
**Phase**: 2 (debate / cross-pollinate)  
**Model**: gpt-5.5  
**Date**: 2026-05-03 11:51  
**Read sibling**: `docs/reviews/m0-modellist-arch-2026-05-03-1145.md`

---

## 对 sibling finding 的逐项表态

### sibling MAJOR-1 [MAJOR] M0 退出条件 wording 与 §2.4 实施直接矛盾
**Stance**: refine  
**Evidence / Refinement**: 方向同意；我认为应升 BLOCKER，因为验收项与实现项互斥，无法开工验收。

### sibling MAJOR-2 [MAJOR] ETag canonical_json 算法描述含糊 + compareVersion 实现责任真空
**Stance**: refine  
**Evidence / Refinement**: ETag 是 BLOCKER；compareVersion 是 MAJOR。两者风险不同，建议拆开裁决。

### sibling MAJOR-3 [MAJOR] `recommendedFor` 开放 string 在首发字段就破协议契约
**Stance**: refine  
**Evidence / Refinement**: 应降为 MINOR/MAJOR 边界；若 iOS 只展示 hint、不分支，开放 string 可接受但须写未知值忽略。

### sibling MAJOR-4 [MAJOR] `isDefault` / `enabled` 行为不变量缺失 + iOS cutover 默认模型静默漂移
**Stance**: agree  
**Evidence / Refinement**: 补到了我漏掉的默认模型漂移；这是用户可见行为变化，应进 M0 契约。

### sibling MINOR-1 [MINOR] §0 退出条件没标“试点子集”
**Stance**: agree  
**Evidence / Refinement**: 合理。能避免把本 mini-milestone 误读成完整 M0 退出。

### sibling MINOR-2 [MINOR] OQ-C drift 单元测试 placement 不清
**Stance**: refine  
**Evidence / Refinement**: 同意 drift 风险；但 shared fixture 被 iOS Bundle 复制需验证 xcodegen 路径，别过早定唯一方案。

### sibling MINOR-3 [MINOR] `etag: ""` placeholder 然后 mutating 赋值的 TS 风格
**Stance**: agree  
**Evidence / Refinement**: 不是 correctness 风险，但 lazy `getHarnessConfig()` 更利于后续 JSON/file-watch。

### sibling MINOR-4 [MINOR] §2.3 minClientVersion 检测放 iOS 端的合理性
**Stance**: disagree-with-evidence  
**Evidence / Refinement**: sibling 说可统一 backend 校验；但 HTTP config endpoint 无 client version，iOS 自查仍必要。

### sibling MINOR-5 [MINOR] §5.2 真机验证缺失
**Stance**: agree  
**Evidence / Refinement**: iOS fallback 是 M0 核心路径，真机断网 cold start 应至少跑一次。

### sibling OQ-A fallback 实现：支持手抄 JSON，建议 shared fixture 单 source
**Stance**: refine  
**Evidence / Refinement**: 支持 Bundle JSON；但 backend hardcode 与 fixture import 二选一要写死，避免“双 source”。

### sibling OQ-B ETag 失效：支持永不主动失效
**Stance**: agree  
**Evidence / Refinement**: M0 依赖重启 + refetch 足够，manual invalidate 可推 M0.5。

### sibling OQ-C drift 风险：强烈支持单元测试，但执行细节缺失
**Stance**: agree  
**Evidence / Refinement**: 与我 M4 一致；fallback 来源必须在 M0 契约里收口。

### sibling OQ-D ADR-0011 升级时机：建议 M0 全部子任务 ship 后再 Accepted
**Stance**: agree  
**Evidence / Refinement**: 单 modelList 只能证明管线，不足以代表 ADR 全量 thin-shell 已验证。

---

## Self-revision

- **Refine my own phase 1 B1**：保留“必须先修”，但接受 sibling 的路线拆分：若选择“重连后 refetch”并删除所有 `config_changed` 验收 wording，则不必实现 WS push。
- **Refine my own phase 1 M4**：采纳 sibling 对 OQ-A/OQ-C 的证据，fallback 不应继续作为 open question；但具体可选 Bundle JSON 或 shared fixture copy，关键是单 source。
- **Add severity nuance to my B2**：ETag 嵌套字段遗漏仍是 blocker；compareVersion 不应和 ETag 合并为同一 blocker，当前更像 M0 dev-path MAJOR。

---

## New findings

无。

---

## Stance distribution

- agree: 7
- disagree-with-evidence: 1
- refine: 6
- not-reviewed-with-reason: 0
- self-revisions: 3
- new-findings: 0

(M + K ≥ 1，合法 phase 2 verdict)
