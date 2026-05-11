---
name: boot
description: Steward V0 session boot ritual — 读 docs/BACKLOG.md，回 echo "Backlog: N in_progress · M planned · K blocked"，stale 时（>72h）警告。Use when 用户粘 `/boot`，或新 Claude session 启动时主动跑（per CLAUDE.md 约定）。这是 9 个 Steward prompt 的第 1 个 (STEWARD_PROMPTS.md)；其余 8 个用纯自然语言 (`看 backlog 推荐下一步` / `开始干 <id>` / `<id> 收线` etc.)。
---

# Steward V0 — boot ritual

被 `/boot` 触发，或 Claude 应在每个新 Vessel session 启动时主动跑一遍。

## 必须做的 4 步

1. **读 `docs/BACKLOG.md`** —— 一次性 Read 整个文件
2. **检查顶部 "最近更新" 时间戳**
   - 若 > 72h 前 → 第一行 echo: `⚠️ Backlog stale (> 72h since last update)`
   - 否则跳过
3. **数 status 分布**：解析 fenced YAML 里 `items[].status`，按值计数（planned / in_progress / blocked / done / dropped）
4. **Echo 一行摘要**：
   ```
   Backlog: N in_progress · M planned · K blocked · L done · D dropped
   ```
   其中 N/M/K/L/D 是实际数字。若 done 项太多（> 20），可省略 done count 简化输出。

## 然后做的 1 步（可选）

5. **若 in_progress > 0，列前 1-3 个 in_progress 项**（id + title + assigned_kind），方便用户快速知道"我正在做啥"：

   ```
   In progress:
     • testflight-encryption-compliance (user-manual) — TestFlight Build 49 加密合规对话框
   ```

## 不做的

- ❌ **不**自动跑 `pnpm eva:sessions`（v0.2 lazy ritual 设计；用户问"下一步"或"活窗口"时才跑）
- ❌ **不**主动建议下一步（用户没问就别推荐；让用户决定要不要 `看 backlog 推荐下一步`）
- ❌ **不**改 BACKLOG.md（read-only，I8 read-only auto 层）
- ❌ **不**调任何 destructive 命令

## 输出结尾

最后留一句邀请：

```
要做什么？(看 backlog 推荐下一步 / 开始干 <id> / 加待办: ... / 详见 docs/STEWARD_PROMPTS.md)
```

## 错误处理

- **BACKLOG.md 不存在** → echo `❌ docs/BACKLOG.md 不存在 — Steward V0 未初始化。详见 docs/STEWARD_USAGE.md。`
- **YAML 解析失败** → echo `❌ BACKLOG.md YAML 解析失败 (line N)。可能需要从 ~/.vessel/backlog-mirror.jsonl 复原。详见 STEWARD_USAGE.md §错误恢复.`
- **顶部缺 "最近更新" 时间戳** → 跳过 stale 检查，继续 echo 摘要

## 相关

- 数据：[docs/BACKLOG.md](../../../docs/BACKLOG.md)
- 用户面短语：[docs/STEWARD_PROMPTS.md](../../../docs/STEWARD_PROMPTS.md)
- 详细手册：[docs/STEWARD_USAGE.md](../../../docs/STEWARD_USAGE.md)
- 契约 ADR：[docs/adr/vessel/ADR-019-steward-v0-contract.md](../../../docs/adr/vessel/ADR-019-steward-v0-contract.md)
- Boot ritual 在 CLAUDE.md 的 "Session boot ritual (Steward v0)" 段
