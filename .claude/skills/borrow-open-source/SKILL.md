---
name: borrow-open-source
description: Research comparable open-source projects, download or inspect their source safely, extract useful product/architecture ideas, evaluate fit for claude-web/Seaidea, and append actionable candidates to docs/IDEAS.md. Use when the user asks to 借鉴, compare, learn from, benchmark, study, clone, or evaluate open-source projects for feature ideas.
---

# Borrow Open Source

把“找类似开源软件 → 看源码 → 提炼强项 → 评估适用性 → 写入自己的功能池”变成固定流程。

## Default Mode

默认只做研究和文档整理：

1. 找同类项目。
2. 读取 README/docs/源码关键路径。
3. 总结强项。
4. 评估是否适合 `claude-web` / Seaidea。
5. 追加到 `docs/IDEAS.md`。

不要默认实现代码。只有用户明确说“实现 / 做掉 / 开始改代码”时，才进入实现。

## Safety Rules

- 不直接复制大段源码；默认只借鉴思路、架构、交互和流程。
- 下载源码只做只读分析，不运行陌生项目的 install/build/dev/test 脚本。
- 记录 repo URL、commit/release、license。AGPL/GPL 项目尤其只能谨慎借鉴思路，复制实现前必须提醒用户。
- 默认 clone 到临时目录或独立 scratch 目录，不放进当前仓库源码树。
- 不提交、不 push、不创建 PR，除非用户明确要求。
- 任何用户可见功能完成后，检查 `docs/USER_MANUAL.md` 是否需要更新。
- 已完成的 idea 从 `docs/IDEAS.md` 移到 `fuction.md`。

## Workflow

### 1. Clarify Target

如果用户给了具体项目，直接研究。例如：

- `tiann/hapi`
- `getpaseo/paseo`
- `xhoanggiang/yepanywhere`

如果用户只说“找类似项目”，先用 WebSearch 找 5-10 个候选，再筛出最接近当前问题的项目。

### 2. Gather Evidence

优先级：

1. README
2. docs / guide
3. package map / monorepo layout
4. source files for the feature being studied
5. issues / changelog / release notes

需要下载源码时：

- shallow clone：`git clone --depth 1 <repo-url> <scratch-dir>`
- 只读分析。
- 不运行项目脚本。

### 3. Analyze

每个项目至少回答：

- 它解决什么问题？
- 它最强的 3-8 个功能是什么？
- 它的架构强项是什么？
- 它的移动端 / 远程控制 / 权限 / 安全 / 部署有什么值得学？
- 它用订阅、API key、官方 CLI 登录，还是自带云服务？
- 它的 license 对我们有什么限制？

### 4. Fit Scoring

用 1-5 分打分：

| 维度 | 含义 |
|---|---|
| 用户价值 | 对 Seaidea / claude-web 使用体验提升多大 |
| 架构贴合 | 和当前 backend + iOS + WebSocket + Claude CLI 架构是否自然 |
| 实现复杂度 | 1 = 简单，5 = 很复杂 |
| 风险 | 安全、权限、许可、维护、状态一致性风险 |
| 优先级 | 综合后建议 P0/P1/P2/P3 |

### 5. Write To IDEAS

默认追加到 `docs/IDEAS.md`，放在合适分类下。

推荐格式：

```markdown
### <功能名>
灵感来自 <项目名>：<一句话说明>。

**可借鉴点**：
- ...

**适用性**：
- 用户价值：
- 架构贴合：
- 实现复杂度：
- 风险：
- 优先级：

**实现草案**：
- ...
```

如果只是横向强项池，更新 `## 竞品 / 同类项目强项池` 表格。

## Output Summary

完成后给用户简短总结：

- 研究了哪些项目。
- 追加了哪些 idea。
- 哪些不建议做，为什么。
- 是否需要继续拆成实现计划。

## Escalation To Implementation

只有用户明确要求实现时才改代码。实现前必须：

1. 读现有相关代码。
2. 说明改动范围。
3. 优先小步落地。
4. 跑相关 lint/build/test。
5. 用户可见变化完成后检查 `docs/USER_MANUAL.md`。
