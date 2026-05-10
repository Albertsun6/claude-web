# Phase 1 Verdict — Claude Combined（vessel-architect / vessel-pragmatist / vessel-risk-officer 合并）

- **Artifact**: 0A 核心 4 文档（REQUIREMENTS + FRAMEWORK + ROADMAP + ADR README）+ 11 新 ADR
- **Phase**: 1 (isolated)
- **Role**: Claude 主会话扮演 3 lens（v5.4 lite 收缩：合并 verdict 减冗余；cursor cross-reviewer 单独后台跑保异质性）
- **Date**: 2026-05-09 23:30
- **Lens marks**: 🏛️ architect / ⚙️ pragmatist / 🛡️ risk-officer

---

## BLOCKER（0 条）

无 BLOCKER。0A 主体方向清晰：3 大文档完整 + 11 ADR 齐全 + 14 NFR scenarios 覆盖 + 18 ADR 全部 Accepted（除 ADR-002 待 M1C-B spike）。

---

## MAJOR（5 条）

### 🏛️ M-A1: AppManifest schemaVersion 用 `z.literal(1)` 限制 v1+ 演进

**Where**: `FRAMEWORK.md` §7 + `SoulSpec` §6 同问题

**Issue**: `schemaVersion: z.literal(1)` 意味着只接受字面量 1。M2+ 加 schemaVersion=2 时 Zod 不兼容。

**Suggested fix**: 改成 `z.number().int().min(1)` 或 discriminated union pattern：
```typescript
export const AppManifestV1Schema = z.object({ schemaVersion: z.literal(1), ... });
export const AppManifestV2Schema = z.object({ schemaVersion: z.literal(2), ... });
export const AppManifestSchema = z.discriminatedUnion('schemaVersion', [AppManifestV1Schema, AppManifestV2Schema]);
```
v0.1 仅 V1 实现；M1C+ 加 V2 时无破坏。

### 🏛️ M-A2: Workflow 接口未在 FRAMEWORK 5 接口或 Driver 里定义

**Where**: `FRAMEWORK.md` §1 + §2 + §3

**Issue**: ARCHITECTURE §3 控制平面含 Workflow Engine（与 Orchestrator / HITL Gate / Session 同层），但 FRAMEWORK 没给 Workflow interface 签名。M1C-A 实施时会问"Workflow 是什么类型？Skill 子类？独立 interface？"

**Suggested fix**: FRAMEWORK §11 加 placeholder："Workflow Engine 接口签名待 M1C-A 时定义；当前作为 Vessel 控制平面内部模块（不在 5 接口顶层契约）"。或者立即在 §2 加 6th interface `interfaces/workflow.ts`（如果决定 Workflow 也是顶级抽象）。

### 🛡️ M-R1: TraceEvent.payload 用 `z.unknown()` 无类型保护

**Where**: `FRAMEWORK.md` §5 TraceEventSchema

**Issue**: `payload: z.unknown().optional()` 接受任意类型——但 trace-redaction-spec 要求 JSON-only / ≤4KB。Zod 没有 "JSON literal" 类型，但应该至少 typeof check：
```typescript
payload: z.record(z.string(), z.unknown()).or(z.array(z.unknown())).optional()  // JSON object/array
   .refine((v) => JSON.stringify(v).length <= 4096, { message: 'payload > 4KB' })
```

**Suggested fix**: §5 加 `.refine()` 验证 + 文档说明 "payload 必须是 JSON-serializable，4KB 上限"。

### ⚙️ M-P1: REQUIREMENTS B 段 MoSCoW 表行数和总数对不上

**Where**: `REQUIREMENTS.md` §B 表格 + 末尾"M = 14 / S = 5 / C = 4 / W = 1"

**Issue**: 表格列出 19 行 feature。但末尾统计 14+5+4+1=24，不是 19。重新数：
- M（Must）：CLI / CC / Web / HTTP/WS / MCP / 权限 / Workflow / Memory / Soul / Trace = 10（不是 14）
- S（Should）：Voice / iOS / Inbox / Heartbeat = 4（不是 5）
- C（Could）：Notification / 多 CLI / 多 Instance / Soul Templates 库 = 4（不是 4，对的）
- W（Won't）：云同步 = 1
- 总：10 + 4 + 4 + 1 = 19 ✅ 但末尾写错

**Suggested fix**: 重新数表格行数 + 修末尾统计。

### ⚙️ M-P2: ROADMAP §11.2 跟 EVA_TO_VESSEL_MAPPING §1 内容重叠

**Where**: `ROADMAP.md` §11.2「借鉴架构 + 自研实现」10 行 vs `EVA_TO_VESSEL_MAPPING.md` §1（35 行映射）

**Issue**: ROADMAP §11.2 列了 Eva harness/scheduler / cli-runner / permission / voice routes / BackendClient.swift / debate-review SKILL —— 这些都已在 EVA_TO_VESSEL_MAPPING §1 中。重复维护两份会失同步。

**Suggested fix**: ROADMAP §11.2 简化为引用 "详见 [EVA_TO_VESSEL_MAPPING.md](../design/EVA_TO_VESSEL_MAPPING.md)"，本表只列**Eva 之外的借鉴**（OpenClaw SOUL.md / OpenTelemetry-lite / Stage-Gate / Spike / 等）。

---

## MINOR（4 条）

### 🛡️ m-R1: Trace event_type enum 只列 14 种 + 扩展机制不清

**Where**: `FRAMEWORK.md` §5 `event_type: z.enum([...])` 14 个值

**Issue**: M2-Voice 时加 `voice.transcribed` / `voice.synthesized` 怎么扩？enum 直接加值需要 protocol.ts schema 升级。

**Suggested fix**: §5 加注释 "新增 event_type 必须经 ADR-006 schema 演进流程；protocol.ts schemaVersion bump minor"。

### ⚙️ m-P1: 11 ADR 中 7 个 Tier 2 极短（5-15 行）—— 仪式化检查

**Where**: `ADR-001 / 003 / 004 / 005 / 007 / 008 / 010` 等

**Issue**: 部分 Tier 2 ADR 内容非常少（如 ADR-001 pnpm 完全可以一句话写在 ADR-000 §2 "✅ 沿用 Eva pnpm" 解释清楚）。但 v5.4 dogfood M-P2 partial 已决议"所有 ADR 都正式写但篇幅可短"——pragmatist accept 现状（决策路径完整性 > 仪式简化）。

**Suggested fix**: 不阻塞；保持现状。下次评审循环可考虑合并某些 Tier 2 ADR。

### 🏛️ m-A1: 18 ADR 编号 ADR-002 Status=Proposed 不严格符合 v5.4 plan 0A 第 3 条

**Where**: `ADR-002`

**Issue**: v5.4 plan 0A 完成判定第 3 条："ADR-000 ~ ADR-015 全部 Status=Accepted（不是 Proposed）"。ADR-002 Status=Proposed（待 M1C-B spike）。

**Suggested fix**: 改 ADR-002 Status 为 `Accepted-conditional`（首选 fastembed Python via worker；具体细节 spike 后确认）。或加注释解释 conditional accept。

### 🛡️ m-R2: REQUIREMENTS NFR 缺 Performance 类

**Where**: `REQUIREMENTS.md` §C 6 类（O / C / P / F / X / S）

**Issue**: 当前 NFR 覆盖 Observability / Capability hot-swap / Permission / Failure modes / Cross-end consistency / Simplicity 6 类。**漏了 Performance**（如 vessel-core 启动时间 / Intent → response 延迟 / Memory search top-K 延迟）。

**Suggested fix**: §C 加 NFR-Perf 类（M0–M2 可观测性能基线）：
- NFR-Perf1：vessel-core 启动 < 5s（boot 三层完成）
- NFR-Perf2：CLI Intent → response 延迟（含 CC CLI spawn）≤ N 秒（具体值待 M0.5 实测）
- NFR-Perf3：Memory.longTerm.search top-K 返回时间 ≤ 500ms（M1C-B 实测）

不阻塞 0A（M0+ 实测后填具体值）。

---

## Decision-required（0 条）

无；所有 finding 都是 author 可仲裁的。

## Risk Callouts

无 4 类硬触发命中（按 v0-pre 修订后的策略：license/secrets 改为 log-not-block）。

## What I Did Not Look At

- 没读 cursor cross-reviewer verdict（隔离评审，等结果在 Phase 3 融合）
- 没跑 `pnpm test:cli` / `pnpm tsc --noEmit`（0A 阶段无代码改动）
- 没扫每个 ADR 的内部一致性（仅核心 5 个：000/012/013/014/016 重读）
- 没核对 ADR-013 §3 修订是否在 inbox archive 状态

## 总结

0 BLOCKER + 5 MAJOR + 4 MINOR。0A 主体 PASS。最重要 5 条 MAJOR：
- M-A1（AppManifest schemaVersion z.literal 限制）→ 改 z.number().int()
- M-A2（Workflow 接口未定义）→ FRAMEWORK §11 加 placeholder
- M-R1（TraceEvent.payload z.unknown 无验证）→ 加 .refine() JSON + 4KB
- M-P1（MoSCoW 总数错）→ 修
- M-P2（ROADMAP §11.2 跟 EVA_TO_VESSEL_MAPPING 重叠）→ 简化引用

3 lens 都没找到 BLOCKER，证明 0A 设计成熟度高。等 cursor cross-reviewer 出 verdict 后 Phase 3 融合。
