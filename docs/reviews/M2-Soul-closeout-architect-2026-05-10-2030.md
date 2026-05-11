# M2-Soul — Closeout Review (vessel-architect lens)
Date: 2026-05-10-2030

## Scope
M2-Soul 把 Vessel "灵魂" 注入到 Claude CLI 的 system prompt。Files reviewed:
- packages/backend/src/soul/parser.ts (YAML frontmatter + Markdown parser, type-safe SoulSpec)
- packages/backend/src/soul/injector.ts (renderSoulPrompt → string)
- packages/backend/src/cli-runner.ts (buildArgs +1 conditional --append-system-prompt)
- packages/backend/src/cli/vessel-core.ts (init / soul show-prompt / soul list-templates)
- templates/soul/{jarvis-style,friday-style,blank}.soul.md
- packages/backend/src/test-soul.ts (42 assertions)

## Findings

### PASS: ADR-004 锁定的注入点正确实现
ADR-004 决策为 "注入到 cli-runner prompt wrapper"。实现使用 Claude CLI 的
`--append-system-prompt` flag —— 保留 Claude Code 默认 system prompt（含工具
能力、CLAUDE.md 等），仅在末尾追加 persona 段落。这是最小侵入注入。

### PASS: 5 接口契约不漏
soul/parser.ts 的 SoulSpec 是新增的 Vessel 内部数据模型，对 5 接口（Agent /
Skill / Tool / Memory / App）均无影响。Soul 是 Instance 私有人格规格，
不是 Capability，落在 cli-runner 集成层而不是接口层 —— 与 plan 一致。

### PASS: 三层 boot 独立可重入
- 解析层 (parser) 纯函数，无副作用；只在 loadSoulOrNull 触发文件 I/O
- 渲染层 (injector) 纯函数，无副作用
- 注入层 (cli-runner buildArgs) 失败 fail-soft（SoulParseError → console.warn 跳过注入）

soul.md 损坏不会让 vessel-core 完全无法 coding，仅使该次运行无 persona。
正确的失败模式选择。

### MINOR-1: SoulSpec schema 没在 docs/design/FRAMEWORK.md 落档
0A 阶段 FRAMEWORK 提到了 "Soul Spec YAML-in-Markdown schema"，但 v1 实现
完成后没有同步更新 FRAMEWORK 的具体字段定义（schema_version / personality
子字段 / preferences.verbosity 枚举）。下次 docs 同步时补。
**Verdict**: MINOR — defer to docs pass.

### MINOR-2: Schema 版本演进还没有 migration 路径
soul.md schema_version=1 是当前唯一支持版本；如果未来新增字段或重命名，
没有 migration 脚本。目前只能拒绝 schema_version != 1 的文件。这与
ADR-006 (Schema 演进策略) 的"启动时检测 schema_version，老版本自动 migrate"
原则不一致 —— 但 v0.1 阶段就一个版本，构造 migration 是 YAGNI。
**Verdict**: MINOR — defer to v2 schema 实际出现时再加。

### INFO: templates/soul/ 是仓库内静态资源
通过 import.meta.url 上溯 4 层定位（src/cli → src → backend → packages → repo
root → templates/soul）。如果未来 backend 包打包发布，templates 路径解析
会失败。当前阶段（个人单机仓库内运行）可接受。

## Architecture Assessment: PASS
- 模块边界清晰：parser / injector / cli-runner / cli 四个职责单一
- 无循环依赖（parser ← injector ← cli-runner / cli-vessel-core）
- TypeScript 类型从 YAML 一直贯通到注入点
- 42/42 测试，包含 e2e CLI 子进程测试（spawn vessel-core init / soul show-prompt 验证）

## Verdict: PASS — 2 MINOR (deferred)
