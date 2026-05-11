# Third Party License Log

> **Policy**（E2 owner 决策 2026-05-09）：发现 AGPL / SSPL / BUSL 等限制性 license 时**可以先借鉴或搬用**（不阻塞开发），**但必须在此 log 记录来源**。所有未"removed"或"approved-for-public"的条目，**v0.1 release / 公开发布 / 分发 / 上架前必须集中清理**。
>
> **Scope**：仅记录 license **可能不兼容** Vessel 目标 license（推荐 Apache-2.0）的依赖或代码片段。MIT / Apache-2.0 / BSD / MPL-2.0 / ISC 等友好 license 不需登记。
>
> **配套**：[ADR-014 §「Escalation #6 license」](../adr/vessel/ADR-014-review-workflow.md) + [ADR-013 §「Stage 6 license scan」](../adr/vessel/ADR-013-rename-strategy.md) + [RISKS R-06b](../design/RISKS.md)
>
> **Tooling**：`license-checker --failOn 'AGPL;SSPL;BUSL'` 跑 workspace 全依赖；命中后写入此 log。

---

## 字段定义（每条记录必填）

| 字段 | 说明 |
|---|---|
| **id** | `LIC-NNN`（递增编号） |
| **date** | 发现日期 YYYY-MM-DD |
| **source** | 来源项目 / URL / commit hash |
| **path** | 在 Vessel 仓库中的文件路径 |
| **license** | 具体 license 类型（如 `AGPL-3.0-only` / `SSPL-1.0` / `BUSL-1.1`） |
| **purpose** | 借鉴 / 搬用的用途（功能模块） |
| **extent** | `code-copied` / `idea-only` / `dependency`（pnpm 装入） |
| **expiry** | 处理期限（默认 `before-v0.1-release`） |
| **status** | `copied-temporarily` / `needs-replacement` / `removed` / `false-positive` / `approved-for-public`（按 owner 决策） |
| **notes** | owner 备注（如替代方案 / 法律咨询结论 / 等） |

---

## 状态汇总

- **active（待处理）**：0
- **resolved（removed / approved / false-positive）**：0
- **总条目**：0

---

## 0B Stage 6 license-checker 扫描结果（2026-05-10）

**Scope**：`packages/backend` production 依赖（继承 Eva + 新增 zod）。
**Tooling**：`pnpm dlx license-checker --production --csv`。
**结果**：

| Package | Version | License | Repo |
|---|---|---|---|
| @hono/node-server | 1.19.14 | MIT | honojs/node-server |
| better-sqlite3 | 11.10.0 | MIT | WiseLibs/better-sqlite3 |
| chokidar | 5.0.0 | MIT | paulmillr/chokidar |
| dotenv | 16.6.1 | BSD-2-Clause | motdotla/dotenv |
| hono | 4.12.15 | MIT | honojs/hono |
| ws | 8.20.0 | MIT | websockets/ws |
| zod | 3.25.76 | MIT | colinhacks/zod |

**判断**：全部友好 license（6 MIT / 1 BSD-2-Clause），**无 AGPL/SSPL/BUSL 命中**，无需登记。

**未来变化触发**：每次 `pnpm install` 引入新依赖时重新跑此命令；命中限制性 license → 按本 log 模板追加条目。

---

## 日志（按时间倒序）

_（暂无 active 条目。）_

### 模板

```markdown
### LIC-001 — <项目名 license 类型>
- **id**: LIC-001
- **date**: YYYY-MM-DD
- **source**: <项目 URL 或 npm package + 版本>
- **path**: `packages/<...>/<...>` 或 N/A（如仅借鉴 idea）
- **license**: <具体 license SPDX 标识>
- **purpose**: <为什么搬这块>
- **extent**: code-copied | idea-only | dependency
- **expiry**: before-v0.1-release
- **status**: copied-temporarily
- **notes**: <owner 备注>
```

---

## Release Gate（v0.1 release 前必须满足）

```bash
# 检查所有 active 条目都已处理
grep -c "status: copied-temporarily" THIRD_PARTY_LICENSE_LOG.md     # 应该 = 0
grep -c "status: needs-replacement" THIRD_PARTY_LICENSE_LOG.md      # 应该 = 0
```

未通过 → 4 类硬触发 #6 release-gate escalation owner 处理。
