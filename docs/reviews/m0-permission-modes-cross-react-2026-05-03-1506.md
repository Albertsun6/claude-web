# Phase 2 React Verdict — M0_PERMISSION_MODES.md

**Reviewer**: reviewer-cross  
**Phase**: 2 (debate / cross-pollinate)  
**Model**: gpt-5.5  
**Date**: 2026-05-03 15:06  
**Read sibling**: `docs/reviews/m0-permission-modes-arch-2026-05-03-1501.md`

---

## 对 sibling finding 的逐项表态

### sibling B1 [BLOCKER] iOS `permissionModes` non-optional 与 minor bump 永久兼容形成单向 trap
**Stance**: agree  
**Evidence / Refinement**: 与我 M1 同源，但 sibling 把 live fetch 回滚路径讲清了，升为 blocker 成立。

### sibling M1 [MAJOR] 验证矩阵第 4 行没有可执行入口
**Stance**: agree  
**Evidence / Refinement**: 我只指出契约矛盾；sibling 补出 row4 未进步骤，确实应补回滚验证。

### sibling M2 [MAJOR] `riskLevel` enum 反了 modelList hint-only 共识
**Stance**: refine  
**Evidence / Refinement**: 方向对；但 server Zod parse 失败是预期门禁。核心应写成“UI hint 不该锁协议语义”。

### sibling M3 [MAJOR] Swift Codable unknown keys 风险方向写反
**Stance**: agree  
**Evidence / Refinement**: 成立。未知字段 ignore 是 Decodable 合成行为；真正风险是自定义 init 校验 allKeys。

### sibling m1 [MINOR] 退出条件漏 ADR-0011 / ADR-0015 同步
**Stance**: agree  
**Evidence / Refinement**: 成立。此提案主打 minor bump 真测，ADR-0015 应记录实测结果。

### sibling m2 [MINOR] 时间估算与用户偏好冲突
**Stance**: refine  
**Evidence / Refinement**: 删除估时我同意；但若只按本 artifact，外部 user memory 不能作为强证据。

### sibling m3 [MINOR] PermissionModeId 三端同步约束没 trace 到代码
**Stance**: agree  
**Evidence / Refinement**: 成立。server-driven id 是契约字段，必须标 shared schema、ClientMessage、cli-runner 同步。

### sibling m4 [MINOR] telemetry watch 没写前置条件
**Stance**: agree  
**Evidence / Refinement**: 成立。build 31 真机若已被覆盖，关键验收无法执行。

### sibling OQ-A [强意见] build 31 端不写测试，靠 telemetry 真测
**Stance**: agree  
**Evidence / Refinement**: 同意。旧 build 不改代码，真机 telemetry 是本轮最有价值证据。

### sibling OQ-B [强意见] `riskLevel` 不锁 enum
**Stance**: refine  
**Evidence / Refinement**: 我撤回 Swift enum 建议；但建议写明未知 riskLevel 默认色 + telemetry warn。

### sibling OQ-C [强意见] `permissionModes` 应 optional
**Stance**: agree  
**Evidence / Refinement**: 同意。optional 统一解决 build32 收 v1.0 payload 与回滚验收。

---

## Self-revision

- **Upgrade my M1 to BLOCKER**：sibling B1 指出问题不只是文档矛盾，而是 build32 ship 后 live HTTP fetch 回滚路径会失败；这会破坏本提案“minor bump 真测”的核心目标。
- **Withdraw my M2 suggested Swift enum shape**：sibling M2 指出 `riskLevel` 是 hint-only 字段，应沿用 modelList `recommendedFor` 的开放字符串策略。我保留“未知值要有 UI fallback / telemetry warn”的要求。
- **Refine my m3 telemetry finding**：应补 `protocolVersion`, `etag`, `modelCount`, `buildVersion`，同时加入 sibling m4 的 build31 仍在真机运行前置条件。

---

## New findings

无。

---

## Stance distribution

- agree: 8
- disagree-with-evidence: 0
- refine: 3
- not-reviewed-with-reason: 0
- self-revisions: 3
- new-findings: 0

(M + K = 3，合法 phase 2 verdict)
