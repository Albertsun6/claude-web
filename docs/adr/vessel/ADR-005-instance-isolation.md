# ADR-005: INSTANCE 隔离 + Fork-Friendly 设计

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: data-isolation, gitignore, fork-friendly
- **Tier**: 2

## Context

Vessel 长期目标包含开源分享（每个用户 Vessel 灵魂不同）。如果 owner 个人数据（soul.md / memory.db / traces / 等）混进 git 历史，未来 fork 时会泄漏 + 难清理。

## Decision

3 条隔离原则：

### 1. `instance/` 顶层目录全部 gitignore

```
# .gitignore (root)
instance/
!instance/*.example         # 模板文件保留
!instance/.gitkeep          # 让 git 跟踪空目录
```

`instance/` 包含：
- `soul.md`（M2-Soul 起，owner 私有灵魂）
- `config.toml`（按 ADR-008，owner 私有配置）
- `memory.db`（SQLite，含全部历史对话）
- `workspace/<run_id>/`（CC CLI artifact）
- `traces/<trace_id>/`（OpenTelemetry-lite 归档）
- `inbox/`（escalation + idea capture）

### 2. 模板用 `.example` 扩展名

仓库里只有 `instance/soul.md.example` / `instance/config.toml.example`；用户首次跑 `vessel init` 复制成真实文件。

### 3. 首次启动向导 `vessel init`

按 M2-Soul Acceptance：
- 选 Soul Template（`templates/soul/{jarvis-style,friday-style,blank}.soul.md`）
- 强制改 ≥ 1 字段（避免所有用户灵魂雷同）
- 起 Instance 名（M2-Soul 之前默认 `vessel-core`，之后用户取如 `EVA`）
- 写入 `instance/soul.md`

## Consequences

- ✅ git push 不泄漏 owner 私人数据（gitleaks 扫已 clean）
- ✅ 任何人 fork Vessel 仓库后跑 `vessel init` 自动得到空 `instance/`
- ✅ Soul Templates 共享但 Instance 独立（与 OpenClaw / SillyTavern 设计一致）
- ⚠️ owner 备份 `instance/` 是个人责任（不在 git，需手动 backup）

## Prior Art

- OpenClaw `~/.openclaw/` 模式
- VS Code `.vscode/settings.json` vs user settings split
- Git ignore best practices for personal config
