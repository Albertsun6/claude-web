# ADR-008: 配置文件位置 = `~/.vessel/config.toml`

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: config, instance-isolation
- **Tier**: 2
- **Related to**: ADR-005（INSTANCE 隔离）

## Context

Vessel 配置（vessel-core 启动参数 / Capability 配置 / iOS endpoint URL / 等）需要持久化位置。选项：
- 用户级 `~/.vessel/config.toml`
- 项目级 `./vessel.toml`（在仓库根）
- XDG `~/.config/vessel/config.toml`

## Decision

**`~/.vessel/config.toml`**（用户级，HOME 路径）。

数据目录结构（按 ADR-005 + ADR-013 §2 Stage 2）：

```
~/.vessel/                              # owner 用户级（XDG-friendly: 也支持 $XDG_DATA_HOME/vessel/）
├── config.toml                         # 主配置
├── memory.db                           # SQLite
├── workspace/<run_id>/                 # CC CLI artifact
├── traces/<trace_id>/                  # OpenTelemetry-lite
├── inbox/                              # escalation + idea capture
├── traces/                             # OpenTelemetry-lite
├── soul.md                             # M2-Soul 起
└── models/                             # ML worker 模型缓存（fastembed / whisper / piper）

~/Desktop/Vessel/                       # owner 工作目录（git repo）
└── instance/ (gitignored, 模板 .example) → 软链或绑定到 ~/.vessel/
```

## 不选项目级原因

- ❌ `./vessel.toml` 跟着仓库走 → 跨机器同步麻烦（v0.1 不上云）
- ❌ owner 切换 milestone 时数据可能错位（git checkout 把 vessel.toml 改了）

## XDG 兼容（v1+ 可选）

env var fallback 链：
1. `$VESSEL_DATA_HOME`（用户显式）
2. `$XDG_DATA_HOME/vessel/`（XDG 标准）
3. `~/.vessel/`（默认）

v0.1 仅实现 #3（最简）；v1+ 加 #1/#2。

## Consequences

- ✅ 按 ADR-005 instance 隔离（gitignored）
- ✅ owner 单机使用，跨机器手动 backup（明确职责）
- ⚠️ Eva → Vessel 迁移按 EVA_TO_VESSEL_MAPPING §2：`~/.claude-web/` → `~/.vessel/`（一次性）

## Prior Art

- npm `~/.npmrc` / pnpm `~/.config/pnpm/`
- Claude CLI `~/.claude/`
- VS Code `~/.vscode/`
