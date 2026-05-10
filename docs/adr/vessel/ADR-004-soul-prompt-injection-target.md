# ADR-004: Soul Spec 注入目标 = CC CLI Prompt Wrapper

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: soul-spec, prompt, m2-soul, scope
- **Tier**: 2（短决策；scope 锁定 + 已知 trade-off）
- **Depends on**: ADR-000 / ADR-016 / ADR-003

## Context

v0.1 不上 LLM Driver（违反硬约束）→ Soul Spec 注入"system prompt"必须明确**注入给谁**。第二轮外部 AI 评审 B2 提出此问题。

## Decision

**注入到 CC CLI prompt wrapper**（在 `ClaudeCodeDriver.submit()` 的 `systemPromptPrefix` 字段）：

- M2-Soul 时 `bootInstance()` 读 `instance/soul.md` → 解析 SoulSpec → 渲染成 system prompt 文本
- vessel-core 调 ClaudeCodeDriver 时把 prompt 拼到 CC CLI 的 prompt 头
- iOS / Web / CLI 任何 entry point 走 CodingSkill → CodingDriver → CC CLI 都带 soul prompt

## 排除（Consequences）

❌ **排除：注入到 LLM Driver**（v0.1 不存在）
❌ **排除：引入新 Chat Driver**（增加新依赖，违反"v0.1 不上 LLM"硬约束）
❌ **排除：注入到所有 Skill** —— 按 [R-12](../../design/RISKS.md) 已知 trade-off：

> v0.1 Soul 作用范围 = 所有走 CodingSkill 的 Intent；非 cli-runner Skill（M1B 直接调 MCP / EchoSkill / VoiceSkill）暂不带 soul prompt。
>
> v1+ 决定是否扩展到所有 Skill。

CONCEPTS §1.2「Soul Spec」会加一段说明此作用范围。

## App Manifest 字段对应

`AppManifest.soulInjection`（按 FRAMEWORK §7）：
- `cli-runner-only` — v0.1 默认（capability-coding 用此）
- `all-skills` — v1+ 才会出现

## 验证

- M2-Soul Acceptance：FakeCodingDriver 录到的 cli-runner 调用 prompt 含 soul.md 渲染内容 ✅
- M2-Soul Acceptance：`vessel-core soul show-prompt` 输出含 personality 字段 ✅
- 不验证："非 CodingSkill 调用带 soul prompt"（明确不做，按 R-12）

## Prior Art

参考：
- [OpenClaw SOUL.md](https://github.com/openclaw/openclaw)：注入到 agent system prompt（与 Vessel 一致）
- [SillyTavern character cards](https://docs.sillytavern.app/usage/core-concepts/personas/)：注入到 LLM context（Vessel 选 CC CLI prompt 等价位置）
