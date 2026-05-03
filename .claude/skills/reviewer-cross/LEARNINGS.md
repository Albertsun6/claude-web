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

