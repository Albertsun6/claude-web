# ADR-016: Coding Driver Interface（路径 C — 轻量 Driver 层内部契约）

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: architecture, driver-layer, eva-evolution, M0.5
- **Supersedes**: 无
- **Resolves**: [v5.4 dogfood escalation E1 / B-A1 / B-P1](../../../instance/inbox/2026-05-09-2140-dogfood-escalations.md)

## Context

v5.4 plan dogfood 自评里 vessel-architect（B-A1）和 vessel-pragmatist（B-P1）出现真分歧：

- **Architect 立场**：`submit_coding_task` 接口必须显式抽象，否则 Coding Driver 边界模糊。但 5 接口契约（Agent / App / Memory / Skill / Tool）里**没有 Driver**——是扩成 6 接口还是把 CodingDriver 强塞进 Tool？
- **Pragmatist 立场**：v0.1 只有一个 driver（CC CLI），抽接口是过早 abstraction。Eva cli-runner.ts 已经在生产里跑通，强行重构有破坏 Eva 已踩过坑的风险。

**Phase 2 cross-pollinate** 时两位 reviewer 自动融合到一个折中方案：抽 Driver interface 但**不动** cli-runner 内部逻辑。risk-officer 增订：façade 之外加单元测试覆盖 5 个集成挑战边界。

owner 决策：accept 折中方案（路径 C）。

## Decision

引入 **Driver 层的轻量内部契约**，作用域局限在 `packages/backend/src/drivers/`，**不动 5 接口契约**（Agent / App / Memory / Skill / Tool）。

### 1. Driver 内部契约（不在 5 接口里）

```typescript
// packages/backend/src/drivers/types.ts

export interface DriverSpec {
  // 通用 spec 字段（每个 driver 可扩展）
  trace_id: string;
  run_id: string;
  // ... driver-specific args via discriminated union
}

export interface DriverArtifact {
  // 通用产物字段
  files?: string[];          // 产生的文件路径（绝对）
  exitCode: number;
  stdout?: string;           // 截断到 4KB；> 4KB 走 artifact_refs
  stderr?: string;
  metadata?: Record<string, unknown>;
}

export interface CodingDriver {
  /**
   * 提交一个 coding 任务，返回 artifact。
   * 不规定具体实现（可以是 CC CLI / Cursor / Codex / Fake / ...）。
   */
  submit(spec: CodingDriverSpec): Promise<CodingDriverArtifact>;

  /**
   * 优雅终止当前在跑的 task（SIGTERM 进程组 + 5 秒后 SIGKILL）。
   */
  cancel(runId: string): Promise<void>;

  /**
   * Health check（首次启动失败时报具体原因）。
   */
  health(): Promise<{ ok: boolean; reason?: string }>;
}

export interface CodingDriverSpec extends DriverSpec {
  prompt: string;
  workspace: string;          // instance/workspace/<run_id>/
  systemPromptPrefix?: string; // M2-Soul 注入 soul.md 渲染内容
}

export interface CodingDriverArtifact extends DriverArtifact {
  // CC CLI 专属字段（若有）
}
```

### 2. cli-runner.ts 实现 CodingDriver（不动内部）

```typescript
// packages/backend/src/drivers/coding/claude-code.ts (M0.5 新增)

import { spawnClaudeCli, /* 其他 Eva 现有导出 */ } from '../../cli-runner';
import type { CodingDriver, CodingDriverSpec, CodingDriverArtifact } from '../types';

export class ClaudeCodeDriver implements CodingDriver {
  async submit(spec: CodingDriverSpec): Promise<CodingDriverArtifact> {
    // 把 spec 映射到 Eva cli-runner 现有调用方式
    return spawnClaudeCli({
      prompt: spec.systemPromptPrefix
        ? `${spec.systemPromptPrefix}\n\n${spec.prompt}`
        : spec.prompt,
      cwd: spec.workspace,
      env: {
        // v0A.1 cursor B1: W3C Trace Context standard
        TRACEPARENT: `00-${ctx.traceCtx.trace_id}-${ctx.traceCtx.span_id}-01`,
        VESSEL_CONVERSATION_ID: ctx.traceCtx.conversation_id,
        VESSEL_RUN_ID: ctx.traceCtx.run_id,
        /* ... */
      },
      // ... 其他 Eva 已有参数
    });
  }

  async cancel(runId: string) { /* 调 Eva 已有进程组终止逻辑 */ }
  async health() { /* 检查 CC CLI 在 PATH + auth 状态 */ }
}
```

**关键约束**：
- ❌ **不重写** `cli-runner.ts` 内部（保 Eva 已踩过的 5 集成挑战坑）
- ✅ 只新建 `drivers/coding/claude-code.ts` 作 adapter / wrapper
- ✅ Eva 现有调用方（`scheduler.ts` / `routes/*` 等）**继续直接调** `cli-runner.ts`，**不强制迁移到走 CodingDriver**——只有 Vessel 新增 Skill 走 CodingDriver

### 3. 5 接口契约不变

Vessel 5 接口仍然是 **Agent / App / Memory / Skill / Tool**（按字母序），不加第 6 个 Driver 接口。

ARCHITECTURE.md / CONCEPTS.md 不需修订，但 0A FRAMEWORK.md 需要加一段说明：
> Driver 层的内部契约（如 `CodingDriver`）不属于 5 接口契约。Driver 是基础设施层，不像 Skill / App 那样可装卸——它由内核启动时初始化、按运行时绑定到对应 Skill 调用。

### 4. M0.5 实施动作（修订 plan v5.4 的 M0.5 段）

原 plan 写"把 cli-runner.ts 按 `submit_coding_task` 接口契约重构"。**修订为**：

1. 新建 `packages/backend/src/drivers/types.ts`（Driver 内部契约）
2. 新建 `packages/backend/src/drivers/coding/claude-code.ts`（实现 CodingDriver，wrap cli-runner）
3. 新建 `packages/backend/src/drivers/coding/fake.ts`（FakeCodingDriver 录制回放）
4. 新建 `packages/capability-coding/`（Capability App + Manifest）—— 这个 App 通过 CodingDriver 间接调 cli-runner
5. **不动** `cli-runner.ts` 内部 + Eva 现有调用方
6. 单元测试覆盖 5 集成挑战边界（characterization tests，risk-officer 增订）：
   - 非交互模式
   - auth 复用
   - stdout 解析
   - 进程组终止
   - 工作目录隔离

## Consequences

### 正面

- ① **Eva 优先复用原则保住**——cli-runner 内部不动
- ② **接口契约清晰**——CodingDriver 形状明确，未来 v1+ 加 Cursor/Codex 时只需新建 `cursor-cli.ts` / `codex-cli.ts` 实现 CodingDriver
- ③ **5 接口契约不变**——ARCHITECTURE.md / CONCEPTS.md / 已有 plan 段不动
- ④ **不污染 Eva 调用方**——Eva 现有 scheduler / routes 继续直接调 cli-runner，不强制迁移
- ⑤ **Phase 0 调研豁免**——这是 Vessel 特有架构决策（无 prior art），按 ADR-015 规则写 "No direct prior art found"

### 负面

- ① **Vessel Skill 和 Eva 调用方走两条路径**——前者经 CodingDriver / 后者直调 cli-runner。可能产生不一致（如 trace_id 传播 / soul.md prompt 注入只在 CodingDriver 路径生效）。**缓解**：在 0-pre EVA_TO_VESSEL_MAPPING 标注 cli-runner 直调点，按需迁移到 CodingDriver
- ② **M2-Soul 注入到 cli-runner prompt wrapper**实际是注入到 `ClaudeCodeDriver.submit()` 的 `systemPromptPrefix`——位置变了但语义不变。ADR-004 不需修订，注入实现细节在 `drivers/coding/claude-code.ts`
- ③ Driver 内部契约和 5 接口契约**两套类型并存**——FRAMEWORK.md 必须明确说明边界

### 中性

- v0.1 只有 ClaudeCodeDriver + FakeCodingDriver 两个实现；v1+ 加 Cursor/Codex 时再扩展

## Prior Art

No direct prior art found.

Search keywords: `["coding agent driver interface", "subprocess cli adapter pattern", "claude code wrapper typescript", "ML inference driver layer interface"]`

Rationale for self-design：
- Vessel 的 Coding Driver 是 vessel-core 内核与 Coding CLI（CC / Cursor / Codex）的桥接层，没有现成的开源参考
- 5 接口契约（Agent/Skill/Tool/Memory/App）的设计借鉴 OS 内核 + LangGraph + OpenClaw，但 Driver 层是 Vessel 特有
- Phase 0 调研豁免依据：ADR-015 §「引用规则 / Vessel 特有设计」

## 实施时机

**0A 阶段**：把本 ADR 内容总结到 FRAMEWORK.md "Driver 层" 小节（可摘要）。

**M0.5 阶段**：按上面"4. M0.5 实施动作" 6 步落地。

## 验证

- ADR-016 Status = Accepted（**已**）
- M0.5 完成时 `pnpm test packages/backend/tests/integration/coding-driver.test.ts` 通过
- M0.5 acceptance 加："`drivers/types.ts` + `drivers/coding/claude-code.ts` + `drivers/coding/fake.ts` 三个文件存在；cli-runner.ts 内部 git diff 行数 ≤ 5（仅 import 调整 / 类型导出）"
