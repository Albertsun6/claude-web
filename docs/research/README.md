# Vessel 调研目录（research/）

存放外部探索调研产出的 spike report。**Phase 0 调研结果的归档地**。借鉴 **Spike (XP)** / **Trade Study (系统工程)** / **Prior Art (学术/专利)** / **Build vs Buy Analysis (产品)**。

完整调研规范见 [`docs/adr/vessel/ADR-015-research-before-design.md`](../adr/vessel/ADR-015-research-before-design.md)。

---

## DAR 触发 yes/no 检查表

**只要满足任一项 → 跑 Phase 0 出 spike report**：

- [ ] 引入新依赖（`package.json` / `pyproject.toml` 加新行）
- [ ] 引入新协议（如 MCP / Bonjour / WebRTC）
- [ ] 引入新存储（如换 SQLite 为 DuckDB / 加向量库）
- [ ] 引入新语言或 worker（如加 Rust 模块 / 新增 Python worker 类型）
- [ ] 引入新 Capability App
- [ ] 替换核心模块（cli-runner / Workflow / Permission 等）
- [ ] 影响隐私 / 权限 / 数据迁移
- [ ] 改变硬约束（语言主栈 / Coding CLI not SDK / 个人单机等）

**不跑**：命名调整 / 文案修改 / 测试补齐 / 内部小重构 / 已接受 ADR 的落地实现。

---

## Spike Report 文件命名

```
<topic>-<YYYY-MM-DD>.md
```

例：
- `embedding-typescript-options-2026-05-12.md`
- `mcp-server-lifecycle-2026-06-01.md`
- `ios-service-discovery-2026-07-15.md`

---

## Spike Report 模板（**10 段必备**）

```markdown
---
researched_at: YYYY-MM-DD
review_after: YYYY-MM-DD          # 默认 +90 天
sources_checked:
  - https://example.com/...
  - https://github.com/...
status: draft | accepted | stale
---

# <Topic> Spike Report

## 1. 目标决策（Decision being made）
要决定什么？属于 DAR yes/no 检查表的哪一项？

## 2. 业界做法（Prior Art）
3-5 个相关项目（含 license / 活跃度判断 / 接口形态）。

| 项目 | License | 活跃度 | 接口形态 | 备注 |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

> Vessel 特有设计（无合适 prior art 时）必须显式写：
> ```
> No direct prior art found.
> Search keywords: ["<关键词1>", "<关键词2>", ...]
> Rationale for self-design: <为什么自研>
> ```

## 3. 学术 / 标准参考（如有）
相关 RFC / paper / industry standard。

## 4. 对比表（方案 A vs B vs C，按 Vessel 硬约束打分）

| 维度 | 方案 A | 方案 B | 方案 C |
|---|---|---|---|
| 个人单机兼容 | ✅ / ❌ | | |
| 不上 token 计费 LLM | ✅ / ❌ | | |
| TS 主栈兼容 | ✅ / ❌ | | |
| Eva 优先复用 | ✅ / ❌ | | |
| 维护成本 | 低 / 中 / 高 | | |

## 5. 成本估算
实施工作量（相对大小：XS/S/M/L）+ 后续维护成本 + 学习曲线。

## 6. 迁移路径
如选某方案，从当前状态如何迁移到目标状态（步骤 + 风险点）。

## 7. 回退方案
如选错了，怎么回退？影响范围多大？回退点在哪个 commit / milestone？

## 8. 与 Vessel 硬约束兼容性
明确论证（个人单机 / 不上 LLM Driver / TS 主栈 / 等）。
**如果违反某条硬约束，必须有显式 trade-off 说明**——为什么这次违反值得，未来如何修复。

## 9. license / security 风险
| 依赖 | License | 过去 12 月 CVE | 维护者背景 | 风险等级 |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

## 10. 推荐 + 不确定的地方
- **推荐方案**：Vessel 应选哪个？借鉴哪些代码片段？避免哪些坑？
- **留给 Phase 1 reviewer 挑战的不确定点**：
  1. ...
  2. ...
```

---

## Staleness 规则

- 每份 spike report 顶部 frontmatter 必须有 `researched_at` / `review_after` / `sources_checked`
- **超过 90 天** + **仍要支撑新决策时** → 必须 refresh（重跑 Phase 0 或显式标 `status: stale-but-still-valid`）
- 长期不用的 stale report 不强制 refresh，但下次引用时必须重看

---

## 索引（按时间倒序，手动维护）

| 日期 | Topic | 服务的决策 | Status |
|---|---|---|---|
| 2026-05-10 | [embedding-and-vector-store](embedding-and-vector-store-2026-05-10.md) | M1C-B 长期记忆向量检索路径选型 | draft（待 Phase 1 review） |
