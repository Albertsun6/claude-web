# Harness Landscape — 竞品 / 参考全景图

> **本文用途**：claude-web/Seaidea 演进为企业级 AI software engineer harness 的过程中，关于"市场上同类与邻近工具"的全景档案。每次外部评审 / 设计讨论前**喂给评审 AI 作为上下文**，避免它建议已有答案的方向（如"为什么不做 Telegram 渠道"）；每次新发现值得对标的工具时**追加到本文**而不是依赖对话记忆。
>
> **状态**：v0.1（2026-05-01 初版，由 hapi/Paseo 调研触发）。
> **维护规则**：见文末 §维护规则。

---

## 0. 一句话定位（Seaidea 自己）

**纯个人自用、自托管的 AI software engineer harness**（永不分发、永不商业化），多端控制（iOS native + Web），通过 SDLC stage gate + multi-agent + 多 AI 交叉评审 + 上下文管理 + 进化体系，把企业管理系统的全生命周期跑成可观测、可追溯、人在关键点卡控的流水线。**不写代码，调度 Claude CLI 写代码**。

**项目定位边界**：用户自己用，最多在自己的多设备间同步（iOS + Mac + Web）。绝不部署给团队、绝不公网开放、绝不商业化。这条边界决定了所有 AGPL 项目的代码可直接搬运（详见 §3）。

战场坐标：[详见 §战场坐标]

---

## 1. 战场坐标（按 6 层 + 横切归类）

### L1+L2 跨设备控制台（远程访问本地 CLI Agent）

**已有强对手，不是 Seaidea 的差异化战场**。

| 项目 | License | star | 控制台形态 | 多 Agent 支持 | 加密中继 | 移动端 | 借鉴指数 |
|---|---|---|---|---|---|---|---|
| **hapi** (tiann/hapi) | AGPL-3.0 | 3.8k+ | Web/PWA/**Telegram Mini App** | Claude/Codex/Gemini/OpenCode | WireGuard + TLS | Telegram | ⭐⭐⭐⭐⭐ |
| **Paseo** (getpaseo/paseo) | AGPL-3.0 风格 | — | Mac app + Web + iOS/Android + CLI | BYO CLI Agent | E2E (libsodium) | iOS/Android 对等 | ⭐⭐⭐⭐ |
| **Seaidea** (本项目) | 私有 | — | iOS native + Web | 仅 Claude CLI | Tailscale | SwiftUI 原生 | 自身 |

**判断**：hapi 和 Paseo 在 L1/L2 已经做得相当成熟。Seaidea 在这一层级**只追求"够用"**，不再投入新功能去和它们卷。

### L3 编排层（多 Agent 调度 / 任务生命周期 / SDLC 流水线）

**Seaidea 真正的差异化战场**。

| 项目 | License | 重点 | 是否做 SDLC stage | 是否做 task lifecycle | 是否做多 AI 评审 | 借鉴指数 |
|---|---|---|---|---|---|---|
| **Multica** (multica-ai/multica) | Modified Apache-2.0 | Agent-as-issue-assignee + task state machine + daemon/server 分离 | ❌ | ✅ (queued→dispatched→running→completed/failed/cancelled) | ❌ | ⭐⭐⭐⭐ |
| **Paseo** (getpaseo/paseo) | AGPL-3.0 风格 | git worktree 一等公民 + 多 Agent session | ❌ | 🟡 简单 session 概念 | ❌ | ⭐⭐⭐⭐ |
| **hapi** (tiann/hapi) | AGPL-3.0 | 主要 L1，L3 较弱 | ❌ | ❌ | ❌ | ⭐⭐ |
| **Temporal / Airflow / Prefect** | 各 OSS | 通用 workflow engine | 🟡 通用 stage 但非 SDLC | ✅ | ❌ | ⭐⭐ |
| **Coze / Dify / Flowise / n8n** | 各 OSS | 低代码 AI workflow | 🟡 用户自定义 | 🟡 部分 | ❌ | ⭐ |
| **Seaidea** (本项目 plan v4) | 私有 | SDLC 10 stage gate + task lifecycle + 多 AI 评审 + ContextBundle + 方法论 v2 ritual | ✅ **空白** | ✅ (Initiative→Issue→Stage→Task→Run→Artifact→Retrospective) | ✅ **空白** | 自身 |

**判断**：L3 的 SDLC stage gate + 多 AI 交叉评审 + 方法论 ritual 在市场上是**结构性空白**。Multica 最接近，但只到 task lifecycle，没碰 stage gate；Paseo 的 worktree 一等公民是必抄设计。

### L4 Agent 执行层（runtime）

| 项目 | License | 路径 | 借鉴指数 |
|---|---|---|---|
| **OpenHands** (All-Hands-AI) | MIT | 自建执行器 + sandbox docker | ⭐⭐⭐ 路径不同（自建 vs BYO CLI） |
| **SWE-agent** (princeton-nlp) | MIT | 自建 ACI + repo navigation tools | ⭐⭐ |
| **Cline** (clinebot) | Apache-2.0 | VS Code 扩展 + agent loop + MCP | ⭐⭐ |
| **Aider** | Apache-2.0 | CLI git commit assistant | ⭐⭐ |
| **Devin** (Cognition) | 闭源 | 云端黑盒 | ⭐ |
| **Seaidea** (本项目) | — | spawn `claude` CLI 子进程 + worktree 隔离 | 自身 |

**判断**：Seaidea 走"BYO CLI Agent"路径（同 hapi/Paseo），不自建 runtime。这条路径的好处是借力 CLI 厂商持续迭代，缺点是受制于 CLI 行为。

### L1+L3 IDE 一体（编辑器内嵌 agent）

| 项目 | License | 关键差异 | 与 Seaidea 关系 |
|---|---|---|---|
| **Cursor** (含 Background Agents) | 闭源 + 商业 | IDE 内嵌 + 云端 background | 不同形态，Seaidea 是控制台不是 IDE |
| **Windsurf** | 闭源 + 商业 | 同 Cursor | 同上 |
| **Continue.dev** | Apache-2.0 | 跨 IDE agent 框架 | "团队同步 config 不同步 session" 反例 |
| **GitHub Copilot Workspace** | 闭源 | plan→approve→execute | 单条 PR 流程参考 |

**判断**：IDE 内嵌路径与 Seaidea 控制台路径互补不竞争，但 Cursor Background Agents 的"plan-then-execute"流程值得借鉴。

### L7 横切关注点（演化 / 安全 / 可观测）

市场上**没有一个工具同时做** SDLC harness + 多 AI 评审 + 进化体系（methodology v2 / skill 提炼 / anti-pattern）+ 不可逆操作沙箱。这是 Seaidea 独占空白。

可参考但非同类：
- **OpenTelemetry** — 可观测性标准，可作 trace 实现参考
- **HashiCorp Sentinel** — 策略即代码，prod-guard 可借鉴思路
- **GitHub Actions / branch protection** — PR 流程基线

**进化路径竞品参照**（仅供参照、不要照搬：他们走"独立 evolution engine"路线，与我们 §0 第 15 条 Invariant"进化是副产物而非独立组件"路线相反；我们抄机制不抄架构）：
- **Agentic Harness Engineering** ([arxiv 2604.25850](https://arxiv.org/abs/2604.25850)) — 三 observability pillar（component / experience / decision），**self-declared predictions verified against next-round outcomes** 这一点值得借鉴到 §16 ritual 验证环节
- **Self-Evolving Agents Survey** ([arxiv 2508.07407](https://arxiv.org/abs/2508.07407) / [2507.21046](https://arxiv.org/abs/2507.21046)) — what / when / how / where to evolve 四维分类，可作我们触发分类（用户拍板式 / 累积式）的二次校对参照
- **SkillX / EvoSkill / CoEvoSkills** — automatic skill discovery from execution traces，与我们 §16.2 路径 2 相同方向；他们做自动构建 + 自动迭代，我们走"双 reviewer + 用户拍板"通过率门——**不要把他们的 closed-loop 自动迭代抄进 harness**

---

## 2. 战略含义（落到 plan v4）

### 2.1 L1/L2 不再扩张（但需要时直接搬运）

iOS 原生 + Web + Tailscale 已能与 hapi/Paseo 持平。**plan 不在 L1/L2 设计新形态功能**——把预算集中到 L3+L7。

但如果某个具体功能（如 hapi 的 WG 中继打洞、Paseo 的分支域名自动分配）确实有用，**个人自用允许直接代码级搬运**，保留版权声明即可（§3）。

落到 plan：[§0 设计原则] 第 19 条 **"L1/L2 不与已有强对手卷"** + 第 20 条 **"代码搬运的版权礼仪"**。

### 2.2 集中投入 L3 + L7

SDLC stage gate / 多 AI 评审 / 方法论 ritual / 进化体系 / 不可逆操作沙箱 / Context Manager 都是市场空白。这些是 Seaidea 真正能形成长期壁垒的地方。

### 2.3 必抄设计

| 来源 | 设计 | 落到 Seaidea 哪 |
|---|---|---|
| Paseo | git worktree 一等公民 | M2 worktree.ts |
| Paseo | `paseo.json` 仓库内配置 | M0 server-driven config 子集 |
| Paseo | 分支域名自动分配 (`web.<branch>.<app>.localhost`) | M2/M3 dev server 多分支并行（备选） |
| Multica | server / daemon / AI tool 三层分离 | 个人自用规模不需要；现阶段 Mac 单进程足够 |
| Multica | 任务生命周期 queued/dispatched/... | plan v4 §1 Stage.status 已扩展为更细粒度 |
| Multica | 显式 provider capability matrix | M4 多 provider 时引入 |
| hapi | Telegram Mini App 通道 | 个人若想用 Telegram 收通知可考虑（备选） |
| hapi | WireGuard + TLS 中继 | 现阶段 Tailscale 够，未来 Tailscale 不够时可代码级搬运 |
| Cursor BG Agents | plan-then-execute + 云端审批 | M3 release Stage 流程参考 |

### 2.4 必避陷阱

- **不学 Cursor / Windsurf 的 IDE 内嵌路径**——形态不同，硬转会丢失移动端优势。
- **不学 OpenHands / SWE-agent 的自建 runtime**——违反 §0 第 2 条"永不调用 SDK"。
- **不学 Coze / Dify 的拖拽 DAG**——手机不友好，企业 PM 学习成本高。
- **不学 Continue.dev "团队同步 config 不同步 session"**——反例，和我们 Issue 全可追溯背道而驰。

---

## 3. 代码搬运规则（个人自用情形）

**核心事实**：Seaidea 是**纯个人自用工具，永不分发**（§0 项目定位边界）。这意味着：

- **AGPL 的核心约束（"网络分发要开源"）不触发**——不分发 = 不需要开源你的修改
- **GPL/LGPL 同理**——分发条款都基于"分发"行为
- **所有开源 license 的代码都可以搬运到 Seaidea**

| License 类型 | 例 | 个人自用规则 |
|---|---|---|
| MIT / Apache-2.0 / BSD | claude-relay-service / Clay / AnythingLLM / LibreChat / OpenHands / Continue.dev | 直接搬运，保留 license 头 |
| AGPL-3.0 / GPL / LGPL | **hapi** / **Paseo** / Coder / CloudCLI/siteboon | **直接搬运**，保留 license 头与版权声明 |
| Modified Apache-2.0 | Multica | 直接搬运，保留 license 头；注意他们的 logo / 品牌限制（不要在自己版本里用 "Multica" 名字） |
| 自定义 / 品牌限制 | Open WebUI | 搬代码 OK；不要用同名/同 logo |

### 3.1 搬代码的版权礼仪（即使个人自用）

虽然 license 没强制要求，但**强烈建议**：

```typescript
// borrowed from tiann/hapi v0.17.2 (AGPL-3.0)
// https://github.com/tiann/hapi/blob/main/src/relay/wireguard.ts
// modified for single-user Seaidea use
import ...
```

理由：
1. **版权法基本要求**：保留作者署名是版权法的基础（与 license 无关）
2. **未来余地**：万一哪天你改变主意（给朋友用 / 开源），有出处可追溯，避免追溯不到的尴尬
3. **找 bug 容易**：知道这段代码原本来自哪里，原项目修了 bug 你能跟着同步

### 3.2 触发线（哪些情况会让 license 重新变成红线）

如果哪天发生以下任一情况，**AGPL 立刻触发**，已搬运的 AGPL 代码必须开源你的整套修改或重写：

- 把 backend 部署到公网让任何外人访问
- 给朋友/家人/团队装一份你的 backend，他们的设备访问你的 Mac
- 把 backend 打包成 SaaS / 产品发布
- 把 Seaidea 代码开源到 GitHub 公开仓库

**目前都不会发生**（§0 #13 已写死）。但如果发生，要立刻审视已搬代码并决定开源 / 替换 / 重写。

---

## 4. 维护规则

### 4.1 何时更新本文

- 发现新的相关开源项目（star ≥ 500 或社区讨论提及）→ 追加一条
- 现有项目重大更新（major version、license 变更、形态切换）→ 更新对应行
- Seaidea 路线决策被某项目验证或推翻 → 更新 §2 战略含义

### 4.2 何时引用本文

- **每次外部评审 plan / 架构 / spec 之前**——把本文与 plan 一起喂给评审 AI，避免它建议已有答案。
- **每次新增 SDLC stage 方法论的 ritual 时**——参考对应层的同类工具
- **每次 dogfood Issue 涉及"是否要做某能力"时**——查表看市场是否已有，避免重复造轮

### 4.3 不要做的

- ❌ 把本文用作"功能 wishlist"——很多对标项目的功能不该抄
- ❌ 让本文取代 plan v4——本文是 plan 的输入，不是 plan 本身
- ❌ 删除已 deprecated / 已退场的项目记录——保留作为历史教训

---

## 5. 引用源

- [tiann/hapi on GitHub](https://github.com/tiann/hapi) — AGPL-3.0、3.8k star、活跃
- [getpaseo/paseo on GitHub](https://github.com/getpaseo/paseo) + [paseo.sh](https://paseo.sh)
- [multica-ai/multica on GitHub](https://github.com/multica-ai/multica)
- 详细历史调研在 [docs/IDEAS.md §11 团队协作方向调研](IDEAS.md)
