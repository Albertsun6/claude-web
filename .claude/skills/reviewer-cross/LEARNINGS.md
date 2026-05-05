# reviewer-cross Learnings

本文件记录"独立 cross-review"中沉淀下来的可复用判断规则。每次跑完 reviewer-cross 后，**只追加**经过本次评审验证、以后还能复用的经验。

---

## 2026-05-03 (Round 1+2 contract #1+#2)

### 1. 协议层 ID 格式契约要么 UUIDv4 要么 opaque stable string，但全文必须一致

- **来源**：contract-2-cross-2026-05-03-0239.md M1
- **触发场景**：评审跨 schema/Zod/fixture/Swift 对齐时
- **规则**：`schema 注释`、`Zod 类型`、`fixture 实际值`、`Swift String 类型` 必须对同一种 ID 概念给同一约束。Zod `.uuid()` ↔ fixture `proj-XXXXX` 这种矛盾会让客户端发什么都不报错，污染语义
- **边界**：项目早期可保留 opaque + 推荐前缀；中期再硬化为 UUIDv4（migration 成本）

### 2. WS event payload 字段必须复用 DTO 的 enum schema，不允许放宽到 z.string()

- **来源**：contract-2-cross-2026-05-03-0239.md M2
- **触发场景**：discriminated union event 设计、harness_event 类
- **规则**：`stage_changed.status` 应是 `StageStatusSchema` 不是 `z.string()`。否则 UI 层先收 event 再刷 DTO 时会两端 decode 都成功但状态值不在 enum 中
- **边界**：仅 future-compat 字段（如 `kind` discriminator 自身）允许 z.string() 但需配合 unknown case 兜底

### 3. 跨端 round-trip 不变量必须真有 Swift 端测试，不能只靠"人工抽样"

- **来源**：contract-2-cross-2026-05-03-0239.md M3
- **触发场景**：声明 round-trip 但只跑 TS 端
- **规则**：每个 manual Codable / discriminated union / AnyCodable 类 高风险结构必须列入 M1+ Swift 测试清单；M-1 range 内不能默认"等下一里程碑"
- **边界**：纯 struct + 无 nullable 字段可以跳过 Swift 实测；含 .nullable / @objc / 联合类型必须 Swift 端测

## 2026-05-05 (Scheduler M1 骨架)

### 4. broadcastToAll(msg: unknown) 会绕过 ServerMessage 类型检查，WS event 必须先扩展 protocol.ts

- **来源**：scheduler-skeleton-cross-2026-05-05-1200.md B1
- **触发场景**：任何新增 WS 广播调用，尤其是 `(msg: unknown)` 签名的 broadcast 函数
- **规则**：新增 `harness_event` kind 必须先在 `packages/shared/src/protocol.ts` 的 `kind` 枚举里注册，payload 字段放入 `payload?: unknown`。不允许在 broadcast 调用点直接加自定义字段绕过 schema
- **边界**：broadcastToAll 本身签名可以是 unknown（对 infra 层合理），但调用点必须构造符合 ServerMessage 的对象

### 5. fire-and-forget spawn 必须在 computeNextStage 中跳过 running 状态

- **来源**：scheduler-skeleton-cross-2026-05-05-1200.md B2
- **触发场景**：任何 Scheduler tick 或任务 dispatch 函数，尤其是允许重复调用的 HTTP 端点
- **规则**：stage 状态机过滤时必须同时排除 `done` 和 `running`，防止并发 tick 对同一 Issue 重复 spawn
- **边界**：如果有数据库行锁或幂等性保证可以替代（M2 ResourceLock），届时可放宽；M1 骨架必须在内存层面防止

## 2026-05-06 (M2 Loop 4 e2e pipeline)

### 6. 使用 DATA_DIR 的测试必须在模块 import 前隔离 CLAUDE_WEB_DATA_DIR

- **来源**：m2-loop4-e2e-pipeline-cross-2026-05-06-0032.md B1
- **触发场景**：任何 e2e / fixture test 会触发 `harness-queries.audit()`、telemetry、cache、projects store 等模块级 data-dir 写入
- **规则**：如果被测模块在 import 时读取 `DATA_DIR`，测试必须用 bootstrap entry 或 dynamic import，在 import 前设置 `CLAUDE_WEB_DATA_DIR` 指向临时目录；只给 DB 传临时路径不够
- **边界**：纯内存单测或只读测试不适用；如果生产代码显式支持路径注入，也可以用注入替代 env 隔离

