# Commit Convention

> harness 流水线 + 人工 commit 通用规约（M-1 v1.0，2026-05-03）。
>
> 关联：[HARNESS_PR_GUIDE.md §3](HARNESS_PR_GUIDE.md) · [ADR-0013](adr/ADR-0013-worktree-pr-double-reviewer.md)

---

## 1. 格式

```
<type>(<scope>): <subject>

<body, optional>

<trailers>
```

**Subject 规则**：
- 英文普通词小写，不加句号；**代码标识符 / 专有名词保留原大小写**（如 `unifiedCreditCode` / `Issue` / `iOS` / `WebSocket`）
- 中英混合 OK；中文优先（项目语言）
- ≤ 70 字符

**Trailers**（agent 流水线产物时强制）：
- `harness-stage: <kind>` — 哪个 SDLC Stage 产出（spec/implement/test/...）
- `harness-issue: <issueId>` — 关联 Issue
- `Co-Authored-By: <agent-profile> <agent@harness>` — 哪个 AgentProfile 写的

---

## 2. type 枚举

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | bug 修复 |
| `docs` | 文档变更（不影响代码行为） |
| `refactor` | 不改变行为的重构 |
| `test` | 测试新增或修改 |
| `perf` | 性能优化 |
| `chore` | 构建脚本 / CI / 依赖更新 |
| `style` | 格式化 / 注释 / 命名（不改逻辑） |

新加 type 必须先开 ADR。

---

## 3. scope 例

| scope | 范围 |
|---|---|
| `harness` | harness 流水线本身（数据模型 / 协议 / agent / methodology） |
| `ios` | packages/ios-native 改动 |
| `backend` | packages/backend 改动 |
| `frontend` | packages/frontend 改动 |
| `shared` | packages/shared/protocol / fixtures |
| `tts` | TTS 相关跨 package 改动 |
| `voice` | 语音输入相关 |
| `auth` | 认证 / token / allowlist |
| `tests` | 测试基础设施（与 type=test 不同：scope=tests 是改 vitest 配置等） |

---

## 4. 例子

人工 commit：
```
feat(ios): 长按 chip → 强制中断当前 run
```

agent 流水线 commit：
```
feat(harness): customer 表加 unifiedCreditCode 字段

按 spec.md 加 NOT NULL TEXT(18) 字段 + 18 位长度 CHECK + 在线核验 stub。

harness-stage: implement
harness-issue: iss-01HJK5XB0CDEF03
Co-Authored-By: Coder Agent <coder@harness>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

文档：
```
docs(harness): M-1 contract #3 ContextBundle + ADR-0014
```

---

## 5. 禁止

- ❌ `WIP` / `wip` / `tmp` 作为 subject
- ❌ 空 subject
- ❌ subject 含敏感信息（token / 密码 / IP）
- ❌ 跳 hook（`--no-verify`）—— 由 [git-guard.mjs](../packages/backend/scripts/git-guard.mjs) 强制
- ❌ 用 `git commit -m "..."` 单引号合并多行（HEREDOC 才能正确换行 — 见 CLAUDE.md commit 章节）

---

## 6. Squash merge 时

PR squash 时主 commit 的 subject + body 应保留 trailer + 关联信息。`gh pr merge --squash --auto` 默认会拼 PR 描述；agent 流水线产 PR 时由 [pr-manager.ts](../packages/backend/src/pr-manager.ts)（M2）规范化。
