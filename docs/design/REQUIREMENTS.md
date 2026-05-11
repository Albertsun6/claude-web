# Vessel Requirements（需求规格）

> **Status**: 0A 早期 + 中期 · 2026-05-09 · 写作风格 = FAQ + MoSCoW + NFR 场景化（按 [ADR-014](../adr/vessel/ADR-014-review-workflow.md) 工程方法论原则 #3）
>
> **0A 内部顺序**：A 段（产品定位 FAQ） → B 段（MoSCoW feature 表） → C 段（**NFR 场景化**，必须在 FRAMEWORK 之前完成，反向驱动接口）→ D 段（FAQ）

---

## A. 产品定位（FAQ 风格）

### A.1 价值主张（一句话）

> **Vessel 是一个本地优先、订阅驱动的个人 AI 化身底座 —— 你的灵魂（soul.md）+ 你装的 Capability + 你的 Memory，全部跑在你自己的设备上。**

未来形态：**软件 → 桌面宠物 → 机器人 → 各种 embodiment**。本作者的 Vessel Instance 名叫 **EVA**（来自 WALL·E）。

### A.2 Non-Goals（明确不是什么）

| ❌ 不是 | 理由 |
|---|---|
| ChatGPT 替代品 | Vessel 是化身底座，不是单 LLM 客户端 |
| 商用 SaaS | 个人单机，单用户 |
| 企业级部署 | 不上 K8s / 多租户 / SSO / 审计合规 |
| token 计费 LLM API | Coding Agent 走 CLI 订阅模式（CC Pro/Max plan）；ML 任务走本地 worker |
| 云端账户体系 | 数据本地（`~/.vessel/`）；可选 mDNS 局域网多端 |
| 多用户协作 | v0.1 ~ v1+ 都是单用户；多 Instance 切换是 v1+ 议题 |
| 永久云同步 | v0.1-v0.5 不上云；v1+ 可选 self-hosted backup（不是 product feature） |

### A.3 Trade-off 优先级（冲突时按这个判）

```
隐私 > 成本可预测 > 简洁 > 性能 > 功能广度
```

例子：
- 隐私 vs 性能：Trace 默认脱敏（隐私 > 性能即可接受 < 5% IPC 开销）
- 成本 vs 功能：拒绝 token 计费 LLM API（即使能力更强）
- 简洁 vs 功能：拒绝池化 ML worker（YAGNI，性能问题真现再做）

### A.4 起点不是绿地（D' 路线）

Vessel 起点 = Eva 仓库（codename `claude-web`，~5400 行 TS backend / 14,537 行 Swift iOS / 13 表 SQLite）已实现 Vessel 计划约 70% 功能。fork-rename + 增量加 Soul Spec / Capability 装卸 / 5 接口契约 / ML worker 边界。详见 [ADR-000](../adr/vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md)。

---

## B. 核心功能（MoSCoW + Eva 已有？）

| Feature | M S C W | 落地里程碑 | Eva 已有？ | Vessel 改造 |
|---|---|---|---|---|
| **CLI 入口（`vessel-core "<intent>"`）** | M | M0 | ❌ Eva 是 HTTP server | ⭐ 新加 CLI 包装 |
| **Coding Agent 调用（仅 CC CLI）** | M | M0.5 | ✅ Eva `cli-runner.ts` | wrap 成 CodingDriver（ADR-016 C 路径） |
| **Web 前端（多项目 Tab / Harness 看板 / Inbox / Voice）** | M | M1A | ✅ Eva frontend | 沿用 + 改 brand（ADR-000 §3） |
| **HTTP/WebSocket 多入口 + session_id 共享** | M | M1A | ✅ Eva Hono + ws | 沿用 |
| **MCP Tool 接入（filesystem 等）** | M | M1B | ❌ Eva 有 permission 没 MCP | ⭐ 新加 MCP client（@modelcontextprotocol/sdk） |
| **权限边界 + 路径白名单** | M | M1B | ✅ Eva `auth.ts` + `permission.ts` | 沿用 + 加 MCP scope schema |
| **Workflow 挂起恢复（HITL）** | M | M1C-A | ⚠️ Eva scheduler 没 HITL persist | 加 workflow_state 表（migration 0004） |
| **长期记忆向量检索** | M | M1C-B | ❌ Vessel 全新 | ⭐ sqlite-vec + ML worker（fastembed） |
| **Soul Spec 注入（soul.md → cli-runner prompt）** | M | M2-Soul | ❌ Vessel 全新 | ⭐ ADR-004 |
| **语音输入输出（Capability 装卸）** | S | M2-Voice | ✅ Eva voice routes + iOS Voice 三件套 | 包成 Capability + ML worker 边界 |
| **iOS 客户端（Bonjour 发现 + 手填 IP fallback）** | S | M2-iOS | ✅ Eva ios-native（59 Swift 文件） | 改 Bundle ID + Network.framework + 手填 IP |
| **Inbox（30s 碎想捕捉）** | S | M2+ | ✅ Eva inbox（routes + iOS UI） | 包成 Capability |
| **通知（ServerChan / Telegram）** | C | M2+ | ✅ Eva notifications hub | 包成 Capability |
| **Trace 可观测性（OpenTelemetry-lite 12 字段）** | M | M0 设计 / 各 milestone 落地 | ⚠️ Eva telemetry-store 字段不全 | 重构为 12 字段 + 脱敏（trace-redaction-spec） |
| **Heartbeat（Mac-iOS 在线检测）** | S | M2-iOS | ✅ Eva heartbeat | 沿用 + 加 Bonjour |
| 多 CLI（Cursor / Codex） | C | v1+ | — | drivers/coding/cursor-cli.ts 占位 |
| 多 Instance 切换 | C | v1+ | ⚠️ Eva projects-store 雏形 | v1+ 重构 |
| 云同步 | W | 永不做 | — | — |
| 自定义 Soul Templates 库（社区分享） | C | v1+ | — | v1+ |

**总计**：M = 10 / S = 4 / C = 4 / W = 1（**v0A 修订 cursor m1 + Claude M-P1**）。M 级全在 v0.1（M0–M2-iOS）覆盖。

---

## C. NFR 场景化（**M0–M1C 涉及的 NFR**，必须在 FRAMEWORK 之前完成）

借鉴 ATAM Quality Attribute Scenarios，每条用「**刺激 → 响应 → 指标**」三段式表达。

### C.1 可观测性（Observability）

#### NFR-O1：Trace 全链路贯穿

- **刺激**：用户跑 `vessel-core "写一个 fibonacci"`
- **响应**：所有跨模块调用（Gateway → Orchestrator → Workflow → Skill → CodingDriver → CC CLI 子进程 → MCP server）共享同一个 `trace_id`；CC CLI 子进程通过环境变量 `VESSEL_TRACE_ID` / `VESSEL_PARENT_SPAN_ID` 接收
- **指标**：
  - `instance/traces/<trace_id>/` 目录存在
  - 至少 5 个 span_id 文件（gateway / orchestrator / skill / driver / mcp 各 1）
  - 所有 span 的 `parent_span_id` 形成树状结构无环（GraphLib 验证）
  - `vessel-core trace replay <trace_id>` 命令打印完整树形视图

#### NFR-O2：Trace 脱敏

- **刺激**：CC CLI stdout 含用户 prompt 全文 / API key-like 字符串 / 用户私人路径
- **响应**：Trace event 的 `payload` 字段按 [trace-redaction-spec](trace-redaction-spec.md) 脱敏（白名单 + 黑名单 + 4KB 切到 artifact_refs）；`instance/traces/<trace_id>/<span_id>.stdout` 文件 mode 0600 / 目录 mode 0700
- **指标**：
  - `grep -E "sk-[A-Za-z0-9]{20,}|user_prompt" instance/traces/<trace_id>/*.json` 退出码 1（无命中）
  - `stat -f "%Lp" instance/traces/<trace_id>` = 700
  - `stat -f "%Lp" instance/traces/<trace_id>/<span_id>.stdout` = 600

#### NFR-O3：Trace 可重放（v0A 修订 2026-05-09，cursor M1：解决 vs O2 脱敏冲突）

- **刺激**：3 天前用户跑过的 Intent，今天调试某个 bug
- **响应**：`vessel-core trace replay <trace_id>` **默认显示脱敏版**（不破坏 NFR-O2）；要看原文必须 `vessel-core trace replay <trace_id> --unsafe-raw`（owner 显式）
- **指标**：
  - 默认 replay 输出：脱敏 prompt 摘要 + artifact_refs 文件路径 + 各 span 时间线
  - `--unsafe-raw` 路径：从 `instance/traces/<trace_id>/<span_id>.stdout`（mode 0600）读原文 + warn user "containing sensitive content"
  - replay 默认路径**不**违反 NFR-O2 grep 检查

### C.2 可装卸（Capability Hot-swap）

#### NFR-C1：Capability 卸载彻底

- **刺激**：用户运行 `vessel capability uninstall voice`
- **响应**：① vessel-core 释放 whisper.cpp / Piper ML worker 进程；② Tool Registry 注销 voice 相关 tool；③ Capability App Manifest 标 `installed=false`
- **指标**：
  - 30 秒内 `pgrep -f "whisper_server.py|piper_server.py"` 返回空
  - 进程 RSS 下降 ≥ 100 MB（vs 卸载前快照）
  - `vessel-core --voice` 退出码非 0 + stderr 含 "capability voice not installed"

#### NFR-C2：专属 worker uninstall 立即 shutdown

- **刺激**：voice capability uninstall（专属 worker）
- **响应**：worker 立即收 SIGTERM；5 秒内 SIGKILL 兜底
- **指标**：`pgrep -g <pgid>` 5 秒内返回空（按 cli-runner pattern + ML worker 同样规则）

#### NFR-C3：共享 worker TTL 回收

- **刺激**：embedding worker 闲置 N 分钟（默认 N=10）
- **响应**：自动 SIGTERM + 释放内存；下次需要时重新 spawn
- **指标**：闲置 N+1 分钟后 `pgrep -f embedding_server.py` 返回空；下次 `vessel-core memory search` 调用前自动重启 + 缓存模型

### C.3 权限（Permission）

#### NFR-P1：路径白名单

- **刺激**：vessel-core 收到 Intent "读 `/etc/passwd`"
- **响应**：通过 MCP filesystem server → permission middleware 检查 → 命中黑名单（默认 deny / 仅 `~/.vessel/` + `~/Desktop/Vessel/` + 显式白名单）→ 拒绝 + trace 记录 `permission.denied`（**payload 用 path_class + path_hash + redacted_path，不写敏感原路径**，v0A 修订 cursor M4）
- **指标**：
  - HTTP/CLI 返回 403 / 退出码非 0
  - trace event 含 `event_type=permission.denied + payload.{ path_class: "/etc", path_hash: <sha256前6>, redacted_path: "/etc/<redacted>", decision: "deny" }`
  - 用户无 stack trace（不暴露路径检查实现细节）
  - **不出现** `/etc/passwd` 全路径于 payload（按 trace-redaction-spec 一致）

#### NFR-P2：白名单路径正常通行

- **刺激**：Intent "读 `~/.vessel/config.toml`"
- **响应**：检查通过 → MCP server 返回内容
- **指标**：HTTP 200 / 退出码 0；trace event `permission.granted`

#### NFR-P3：Capability 越权检查

- **刺激**：voice Capability 试图读 `~/.ssh/`（不在 voice 的 scope）
- **响应**：Capability Manifest scope 不含此路径 → 拒绝
- **指标**：trace event `permission.denied + payload.{ capability: "voice", path_class: "~/.ssh", path_hash: <sha256前6>, redacted_path: "~/.ssh/<redacted>", decision: "deny" }`（v0A 修订 cursor M4）；**不**写 `~/.ssh/` 全路径

### C.4 失败模式（Failure Modes）

#### NFR-F1：CC CLI 子进程崩溃恢复

- **刺激**：cli-runner spawn CC CLI 后 CC 进程被 OS kill（OOM）
- **响应**：cli-runner 检测 exit code != 0 → 标 Run failed → 释放 process group → 通知 Orchestrator → Orchestrator 写 trace event `event_type=driver.exited` + `status=error`（v0A 修订 cursor M2，避免 enum 扩展）
- **指标**：
  - vessel-core 主进程**不**崩溃
  - `vessel-core --health` 输出 `coding_driver: ok`（不是 unavailable）
  - 用户能立即跑下一个 Intent

#### NFR-F2：ML worker 启动失败 graceful degrade

- **刺激**：fastembed Python worker 启动失败（模型下载失败 / Python 版本不兼容 / venv 损坏）
- **响应**：vessel-core 标 memory capability `unavailable`；写 inbox 通知；保持其他 capability 可用
- **指标**：
  - `vessel-core "echo hi"` 仍正常
  - `vessel-core memory search "..."` 返回 `{ status: "capability_unavailable", reason: "<具体原因>" }`
  - `vessel-core --health` 列出 `memory: unavailable (reason: ...)`
  - `instance/inbox/<TS>-capability-unavailable-memory.md` 文件存在

#### NFR-F3：Workflow HITL 挂起 + 进程崩溃 + 重启 + 续跑

- **刺激**：Workflow 在 HITL 节点等待 owner 决定 → vessel-core 进程被 OS kill（电脑断电 / 用户 ctrl-c 失误）
- **响应**：workflow_state 表持久化（migration 0004 v103）；重启 vessel-core 后 `vessel-core workflow resume <id>` 从挂起点恢复
- **指标**：
  - `SELECT * FROM workflow_state WHERE status='paused'` 重启后仍存在
  - resume 命令完整执行剩余 stage
  - 不丢失任何 artifact（`instance/workspace/<run_id>/` 文件完整）

### C.5 跨端一致性（Cross-End Consistency）

#### NFR-X1：Wire Protocol round-trip

- **刺激**：iOS 端发 ClientMessage（含 `intent` kind / `attachments` ImageAttachment）
- **响应**：backend Zod parse 成功 → Orchestrator 处理 → 回 ServerMessage（含 `trace_event` kind）→ iOS Swift Codable 解析成功
- **指标**：
  - `packages/shared/__tests__/protocol.test.ts` 覆盖 23+ 个 fixture
  - iOS `ProtocolFixtureTests.swift` 同 fixture decode 通过
  - 任一端新增 kind/字段必须先在 shared/protocol.ts 添加 + Swift HarnessProtocol.swift 同步

#### NFR-X2：iOS 服务发现兼容多种网络

- **刺激**：用户在不同网络环境启动 iOS app（家庭 Wi-Fi / 公司网络 / 5G 蜂窝 / VPN）
- **响应**：① 优先 NWBrowser 自动发现；② 失败时显示具体原因 + 手填 IP/端口入口
- **指标**：
  - 家庭 Wi-Fi：3 秒内自动发现 Mac vessel-core
  - 企业网络（VLAN / AP isolation）：明确报"Local Network 权限被拒"或"未发现服务"
  - 手填 IP+端口路径独立可用，不依赖 mDNS

### C.6 简洁（Simplicity，对应硬约束 §A.3 优先级 #3）

#### NFR-S1：Vessel 主进程是唯一常驻服务

- **刺激**：用户运行 `vessel-core` 启动进程
- **响应**：仅 1 个 vessel-core 主进程常驻；ML worker / MCP server / CC CLI 都是受控 helper subprocess（按需 spawn / 退出时清理）
- **指标**：
  - `pgrep -fc "vessel-core"` = 1（vessel-core 命令自身）
  - 无 helper subprocess 长期运行（ML worker 闲置 TTL 后退出 / CC CLI 跑完即退）

---

## D. FAQ（常见疑问，论述式）

### D.1 为什么不上 LLM Driver？

v0.1 所有"AI 类能力"都通过：① **Coding CLI（CC Pro/Max plan，订阅模式）** spawn 子进程；② **本地 ML worker（fastembed/whisper.cpp/Piper，纯本地推理）**。**不**直接调原始 LLM API（OpenAI/Anthropic SDK 走 token 计费）。

理由：
- 成本可预测（订阅 vs token）
- 隐私（本地推理不出本机）
- 简洁（一种调用模式：spawn subprocess + IPC）
- 个人单机硬约束自洽

详见 [ADR-012](../adr/vessel/ADR-012-language-typescript-with-ml-worker.md)。

### D.2 为什么从 Eva 演进而非重写？

Eva 已实现 Vessel 计划约 70% 功能。重写 Python 至少多 5 倍工作量，且重新踩坑。D' 路线 = fork Eva + 改 brand + 增量加 Vessel 特有（Soul / Capability / 5 接口）。

详见 [ADR-000](../adr/vessel/ADR-000-adopt-eva-codebase-as-vessel-foundation.md)。

### D.3 我能装多少 Capability？

无限制。Capability 是装卸式 App（manifest.yaml 声明）。但单 vessel-core 进程内活跃 Capability 越多，内存占用越多（每个 Capability 可能 spawn ML worker）。

按 NFR-C3（共享 worker TTL 回收），闲置 Capability 自动释放资源；按 NFR-C2（专属 worker uninstall 立即 shutdown），不再用的彻底卸载。

### D.4 ML 任务怎么走 Python worker？

- vessel-core 主进程 = TS（Hono），不引入 Python 依赖
- ML 任务（embedding / ASR / TTS）= Python 子进程（`ml-workers/src/*.py`）
- IPC = stdin/stdout JSON-RPC 或 Unix socket
- 接口：`embeddingClient.embed(texts) -> number[][]` 等（接口在 0A FRAMEWORK 锁定）

详见 [ADR-012](../adr/vessel/ADR-012-language-typescript-with-ml-worker.md)。

### D.5 Vessel 跟 Eva 是什么关系？

| 词 | 含义 |
|---|---|
| **Eva** | 旧仓库 codename（claude-web fork），作为 Vessel 起点 |
| **EVA** | 用户 Vessel Instance 名（M2-Soul 后取，来自 WALL·E）|
| **Vessel** | 新平台名，目录 `~/Desktop/Vessel/` |
| **VesselCore** | Vessel 内核进程 = `vessel-core` 命令 |

ADR-000 锁定 Vessel = Eva fork-rename + 增量加 Soul/Capability/5 接口。Eva 仓库本身保留作为参考 / 紧急回退。

### D.6 评审工作流会不会拖慢开发？

不会。按 [ADR-014 v5.4 lite](../adr/vessel/ADR-014-review-workflow.md)：
- 4-way Phase 1 评审 = 主会话扮演 3 reviewer + cursor-agent 1 跑 ≈ 1-2 小时
- Phase 3 仲裁 + 立即修关键 finding ≈ 0.5-1 小时
- Verify Gate 5 项 ≈ 几分钟（grep + test）

每个 milestone 收尾跑一次。期间日常修改不强制评审（owner 自己判断 DAR yes/no 检查表）。

详见 [ADR-014](../adr/vessel/ADR-014-review-workflow.md) + [ADR-015 §「DAR 触发条件」](../adr/vessel/ADR-015-research-before-design.md)。

### D.7 我什么时候可以用上完整 EVA 体验？

按 v5.4 plan 路线：
- M0 / M0.5 / M1A / M1B / M1C — **Vessel 工程骨架**（不是完整 AI 化身体验）
- **M2-Soul 起** — soul.md 注入 → 第一次接触"完整 EVA"形态
- M2-Voice — 语音端到端
- M2-iOS — 移动端

期间给朋友看 demo 应明确说"这是底座的能力测试"，别承诺"我的 AI 助手"。详见 plan v5.4 §「产品形态 disclaimer」。

### D.8 v0.1 release 是什么时候 / 什么状态？

- **状态**：M0 + M0.5 + M1A + M1B + M1C-A + M2-Soul + M2-Voice + M2-iOS 全部完成；Verify Gate + release-gate（[ADR-014 §「Release Gate」](../adr/vessel/ADR-014-review-workflow.md)）通过
- **时间**：plan v5.4 不用时间度量。按依赖关系串行；阶段大小由 owner 实际投入决定

### D.9 Soul Spec 在 v0.1 仅注入到 cli-runner 是不是太局限？

是。这是 [R-12 已登记的 trade-off](RISKS.md)。v0.1 Soul 作用范围 = 走 CodingSkill 的 Intent；非 cli-runner Skill（M1B 直接调 MCP / EchoSkill / 等）暂不带 soul prompt。v1+ 决定是否扩展到所有 Skill。

详见 [ADR-004](../adr/vessel/ADR-004-soul-prompt-injection-target.md)（待写）。

---

## E. 0A REQUIREMENTS Acceptance（自查）

按 v5.4 plan 0A 完成判定第 1 + 第 6 条：

- [x] 所有 Must 级 feature 在 ROADMAP 找到对应里程碑（B 段表格 ✅）
- [x] NFR 场景化已落 REQUIREMENTS C 段（C.1~C.6 共 14 个 scenario）—— **必须在 FRAMEWORK 之前完成** ✅

剩余条件（FRAMEWORK / ROADMAP / ADR / TBD 检查）见 [`docs/roadmap/ROADMAP.md`](../roadmap/ROADMAP.md) + [`docs/design/FRAMEWORK.md`](FRAMEWORK.md) + [`docs/adr/vessel/`](../adr/vessel/)（待写）。
