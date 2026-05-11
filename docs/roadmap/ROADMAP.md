# Vessel Roadmap（执行任务清单）

> **Status**: 0A · 2026-05-09 · 11 步 milestone 任务拆分 + 每条 acceptance + 借鉴清单 vs 自研最小子集
>
> **Source**: [plan v5.4](../../../../yongqian/.claude/plans/playful-inventing-conway.md) §「总路线 12 步」 + [REQUIREMENTS.md](../design/REQUIREMENTS.md) §B MoSCoW + [EVA_TO_VESSEL_MAPPING.md](../design/EVA_TO_VESSEL_MAPPING.md)
>
> **完成定义**：每条任务有可执行 acceptance（shell / curl / pnpm 跑 yes/no），按 [DoD 6 条](../adr/vessel/ADR-014-review-workflow.md) + 4-way 评审 + Verify Gate

---

## 路线总览

| 步骤 | 类型 | 状态 | 完成时间 | 关键产出 |
|---|---|---|---|---|
| 0-meta-lite | 评审基建 | ✅ 完成 | 2026-05-09 | 4 reviewer prompt + 2 README + ADR-014/015 + cursor 集成 ADR-016/017 |
| 0-pre | Eva 盘点 + 适配层设计 | ✅ 完成 | 2026-05-09 | EVA_INVENTORY + EVA_TO_VESSEL_MAPPING + ADR-000/012/013 + RISKS |
| **0A** | 设计文档 | 🔄 进行中 | — | REQUIREMENTS + FRAMEWORK + ROADMAP + 11 ADR + NFR 场景化 |
| 0B | 工程改造 | ⏳ 待开始 | — | 改名 + 5 接口 stub + 数据迁移 + REFERENCES/IDEAS |
| M0 | 内核骨架 | ⏳ | — | CLI echo 闭环 + boot 三层 + Trace 协议落地 |
| M0.5 | Coding Driver | ⏳ | — | wrap cli-runner + capability-coding + FakeCodingDriver |
| M1A | HTTP/WS + 多入口 | ⏳ | — | session_id 共享 + Web 薄壳（Eva 沿用） |
| M1B | MCP + 权限 | ⏳ | — | MCP filesystem + 路径白名单 |
| M1C-A | Workflow 挂起恢复 | ⏳ | — | workflow_state 表（migration 0004） |
| M1C-B | 长期记忆向量 | ⏳ spike 后 | — | sqlite-vec + ML worker（fastembed） |
| M2-Soul | Soul Spec 注入 | ⏳ | — | parser + injector + 3 Soul Templates |
| M2-Voice | 语音 Capability | ⏳ | — | whisper.cpp + Piper（沿用 Eva） |
| M2-iOS | iOS 端到端 | ⏳ | — | Bonjour + 手填 IP + Bundle ID 改名 |

---

## 1. 0B — 工程改造（不是从零建仓）

**前置**：owner 处理 0-pre escalation（已完成 2026-05-09）

### 任务清单

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| 0B-1 | 备份 Vessel/（按 ADR-013 §3 锁定方案 B）| — | `ls ~/Desktop/Vessel-backup-2026-05-09-XXXX/` 包含完整 docs/ |
| 0B-2 | rsync claude-web 内容到 Vessel/ + cp .git | 0B-1 | `git log --oneline | wc -l` ≥ 201（保留 Eva 历史） |
| 0B-3 | git remote rename + 加 alias `claude-web-legacy` | 0B-2 | `git remote -v` 含 `claude-web-legacy`（旧）+ `origin`（Vessel 新 URL，可暂留 placeholder） |
| 0B-4 | 多 package name 改名 `@claude-web/*` → `@vessel/*`（root + backend + frontend + shared）| 0B-2 | `pnpm install` 退出码 0；`grep "@claude-web/" packages/*/package.json` 退出码 1 |
| 0B-5 | env var 改名 + 迁移脚本 `scripts/migrate-env-vars.sh`（按 ADR-013 §2 修订） | 0B-4 | 旧 `CLAUDE_WEB_*` env 检测时 alert 并退出；代码无 fallback |
| 0B-6 | 数据目录改名 `~/.claude-web` → `~/.vessel` + 一次性迁移脚本 `scripts/migrate-eva-to-vessel.ts` | 0B-5 | `pnpm migrate:eva-to-vessel --dry-run` 退出码 0；实迁后 `~/.vessel/harness.db` 存在 + `~/.claude-web/` 仍存在（不删源） |
| 0B-7 | 5 接口 stub（`packages/backend/src/interfaces/{agent,skill,tool,memory,app}.ts`） | 0B-4 | `import { Agent, Skill, Tool, Memory, App } from '@vessel/backend/interfaces'` 不报错；`pnpm tsc --noEmit` 退出码 0 |
| 0B-8 | observability/trace.ts（Trace schema + 子进程环境变量协议） | 0B-4 | `import { TraceEvent, TraceContext } from ...` 不报错；脱敏函数单测通过 |
| 0B-9 | drivers/types.ts + ml-worker/types.ts | 0B-4 | TS 编译通过 |
| 0B-10 | 文档 grep-replace `claude-web` → `vessel`（Vessel 主文档；不动 eva-legacy/） | 0B-2 | `grep -r "claude-web" docs/ --exclude-dir=eva-legacy` 仅命中正确引用（如 ADR-000 提及 Eva codename） |
| 0B-11 | Stage Checkpoint 验证（每 Stage 跑） | — | `pnpm install + pnpm test:cli + pnpm test:protocol` 全过 |
| 0B-12 | Stage 5: gitleaks re-scan（结果进 SECRETS log，不阻塞） | 0B-11 | log 文件存在；real-production 计数 = 0 |
| 0B-13 | Stage 6: license-checker 跑（结果进 LICENSE log，不阻塞） | 0B-11 | log 文件存在 |
| 0B-14 | REFERENCES.md（参考项目库初版，从 ARCHITECTURE §7 迁移）| — | `docs/notes/REFERENCES.md` ≥ 10 条参考项目 |
| 0B-15 | IDEAS.md（从根目录 Note.md 迁移） | — | `docs/notes/IDEAS.md` 含 💡/❓/✅ 三类标签模板 |

### 0B Acceptance

- [x] 0-pre escalation 全部处理 ✅（2026-05-09）
- [ ] 0B-1 ~ 0B-15 全部完成
- [ ] CI green（如有 GitHub Actions / pre-commit）
- [ ] DoD 6 项全过

---

## 2. M0 — 内核骨架

### 任务清单

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| M0-1 | `boot.ts` 三层骨架（按 FRAMEWORK §9） | 0B-7 | `pnpm tsc --noEmit` 退出码 0；`bootProcess() / bootInstance() / bootSession()` 三函数存在 |
| M0-2 | Orchestrator + Intent dispatch（在 Eva backend 加 Vessel-specific endpoint） | M0-1 | `POST /api/intent` 接受 IntentSchema；返回 ServerMessage `intent_response` kind |
| M0-3 | EchoSkill（最小可用 Skill） | M0-2 | `pnpm vessel-core "echo hi"` stdout 含 `echoed: hi`；退出码 0 |
| M0-4 | session_kv（M0 简化版） | M0-1 | `sqlite3 ~/.vessel/memory.db "select count(*) from sessions"` ≥ 1 |
| M0-5 | Trace 协议落地（trace_id 贯穿 + 文件归档 + 脱敏） | M0-1 | M0 acceptance C-1 / C-2 / C-3（trace 目录 0700 / 文件 0600 / payload 不出现 user_prompt） |
| M0-6 | CLI 入口（`pnpm vessel-core "<intent>"` 或 `pnpm exec vessel-core ...`） | M0-2 | `pnpm vessel-core --version` 退出码 0；`pnpm vessel-core --help` 列举 subcommand |
| M0-7 | 优雅退出（SIGINT 5 秒）| M0-2 | 跑 long-running command 时 ctrl-c → 5 秒内退出 + SQLite 无锁残留 |

### M0 Acceptance

- 全 7 项 ✅
- DoD 6 项全过
- Verify Gate 5 项全过
- 4-way Phase 1 评审完成（含 cursor cross-reviewer）

---

## 3. M0.5 — Coding Driver（按 ADR-016 C 路径）

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| M0.5-1 | `drivers/coding/claude-code.ts` adapter（implement CodingDriver；wrap Eva cli-runner.ts） | M0-1, 0B-9 | `cli-runner.ts` 内部 git diff ≤ 5 行；ClaudeCodeDriver 实例化成功 |
| M0.5-2 | `drivers/coding/fake.ts`（FakeCodingDriver 录制回放） | M0.5-1 | `pnpm test packages/backend/tests/integration/coding-driver.test.ts` 通过（不调真实 CC） |
| M0.5-3 | `packages/capability-coding/manifest.yaml` + src/ | M0.5-1 | manifest schema 验证通过；CodingSkill 注册成功 |
| M0.5-4 | CodingSkill 实现（wrap CodingDriver） | M0.5-3 | `pnpm vessel-core "写 fibonacci"` 后 `instance/workspace/<run_id>/fibonacci.py` 存在 |
| M0.5-5 | 进程组终止 + 5 集成挑战 characterization tests | M0.5-1 | ctrl-c 后 `pgrep -g <pgid>` 5 秒内空；test-cli / test-e2e / test-stale-session 通过 |

---

## 4. M1A — HTTP/WS + Web 薄壳 + session_id 共享

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| M1A-1 | HTTP `/api/intent` endpoint（沿用 Eva Hono） | M0.5 | `curl POST localhost:3030/api/intent -d ...` 返回 200 |
| M1A-2 | WebSocket `/api/ws` trace stream（沿用 Eva ws） | M0.5 | WS 接到 ≥ N trace events（含 `intent.received` / `skill.invoked` / `skill.completed`） |
| M1A-3 | session_id 跨入口共享（CLI / HTTP / WS 同一个 session） | M1A-1, M1A-2 | CLI 起 sess_id → Web 用同 sess_id 看到上下文 |
| M1A-4 | Web 前端连接（沿用 Eva React + Vite + Zustand）+ 改 brand（按 ADR-000 §3） | 0B-10 | 浏览器访问 localhost 端口 → Vessel UI（多项目 Tab + Inbox）+ Logo 是 Vessel |

---

## 5. M1B — MCP + 权限

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| M1B-1 | `drivers/io/mcp_client.ts`（MCP TypeScript SDK 接入） | M1A | spawn MCP filesystem server + JSON-RPC 通信通过 |
| M1B-2 | Tool Registry（注册 MCP server 的 tools） | M1B-1 | `vessel-core --tools` 列出 ≥ 5 filesystem tool |
| M1B-3 | Permission middleware（路径白名单 + Capability scope） | M1B-2 | NFR-P1: `~/.ssh/...` 拒绝；NFR-P2: `~/.vessel/...` 通行 |
| M1B-4 | MCP server lifecycle（按 ADR-009：按需起 + TTL 回收） | M1B-1 | vessel-core 退出后 `pgrep -f mcp-server-filesystem` 返回空 |

---

## 6. M1C-A — Workflow 挂起恢复（不依赖 ML）

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| M1C-A-1 | migration 0004（v103）：workflow_state 表 | 0B-6 | `sqlite3 memory.db ".schema workflow_state"` 显示完整表 |
| M1C-A-2 | scheduler.ts 加 paused/resume 持久化字段（**不**改 STAGE_SEQUENCE） | M1C-A-1 | Workflow HITL 节点持久化 + paused_at 时间戳 |
| M1C-A-3 | `POST /api/workflows/:id/resume` endpoint | M1C-A-2 | resume 命令完整执行剩余 stage（NFR-F3） |
| M1C-A-4 | workflow_state 序列化按 trace-redaction-spec 脱敏（R-14） | M1C-A-1 | `SELECT serialized_state FROM workflow_state` 不出现 user_prompt 全文 / token-like |

---

## 7. M1C-B — 长期记忆向量（spike 通过才做）

**Spike 前置**：M1C-B 实施前必跑 spike（按 ADR-002 待 spike）：
- 尝试 1：fastembed-js（ONNX Node）
- 尝试 2：fastembed Python via spawn
- 双 spike 都失败 → M1C-B 推 v1+；M1C-A 仍按计划完成

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| M1C-B-1 | M1C-B 前 spike（写 spike report 进 docs/research/embedding-typescript-options-<date>.md） | — | spike report 存在；ADR-002 Status=Accepted |
| M1C-B-2 | migration 0005（v104）：embedding 表 + sqlite-vec 加载 | M1C-B-1 | `SELECT vec_version()` 返回版本号 |
| M1C-B-3 | `ml-workers/src/embedding_server.py` + `packages/backend/src/ml-worker/embedding-client.ts` | M1C-B-1 | EmbeddingClient.embed(['hello world']) 返回非空 number[][] |
| M1C-B-4 | LongTermMemory write + search | M1C-B-2, M1C-B-3 | NFR-O3: 写入 5 条 record（含唯一测试词） → 重启 → search 返回 top-5 |
| M1C-B-5 | ML worker lifecycle（NFR-C3 TTL 回收） | M1C-B-3 | 闲置 N+1 分钟后 `pgrep -f embedding_server.py` 返回空 |
| M1C-B-6 | `vessel-core --health` 报具体原因（NFR-F2） | M1C-B-3 | worker 失败时输出 'memory: unavailable (reason: ...)' |

---

## 8. M2-Soul — Soul Spec 注入

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| M2-Soul-1 | migration 0006（v105）：soul_history 表 | M1C-A | schema 创建成功 |
| M2-Soul-2 | `packages/backend/src/soul/parser.ts`（YAML-in-Markdown） | M0-1 | 按 [FRAMEWORK §6 SoulSpec schema](../design/FRAMEWORK.md) Zod 校验 |
| M2-Soul-3 | `packages/backend/src/soul/injector.ts`（注入到 cli-runner prompt wrapper） | M2-Soul-2, M0.5-1 | FakeCodingDriver 录到的调用 prompt 含 soul.md 渲染内容 |
| M2-Soul-4 | `templates/soul/{jarvis-style,friday-style,blank}/` 3 个 template **目录**，每个含 4 sibling 文件（SOUL.md / STYLE.md / SKILL.md / MEMORY.md）—— v0A.1 修订 cursor M2 + A1 | — | 3 个 template 目录存在；每个目录含 4 sibling |
| M2-Soul-5 | `vessel init` 引导命令（强制改 ≥ 1 字段，跨任意 sibling） | M2-Soul-2 | 不改 jarvis-style 直接保存 → 退出码非 0 + 报 "must modify ≥ 1 field across SOUL/STYLE/SKILL/MEMORY" |
| M2-Soul-6 | bootInstance 扩展（读 4 sibling + 拼 system prompt 注入） | M2-Soul-2, M0-1 | `vessel-core soul show-prompt` 输出按 SOUL → STYLE → SKILL → MEMORY 顺序拼接，含 `identity.name` + `values` + `guardrails` 字段（v0A.1 修订 cursor M2） |

---

## 9. M2-Voice — 语音 Capability

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| M2-Voice-1 | `packages/capability-voice/manifest.yaml` + src/ | M0.5 | manifest schema 验证通过 |
| M2-Voice-2 | `ml-workers/src/whisper_server.py`（沿用 Eva voice routes 中的 whisper-cli 调用） | 0B-9 | AsrClient.transcribe(wav) 返回非空字符串 |
| M2-Voice-3 | `ml-workers/src/piper_server.py` | 0B-9 | TtsClient.synthesize('hello') 返回非空 wav buffer |
| M2-Voice-4 | VoiceSkill（wrap ASR + TTS workers） | M2-Voice-1, M2-Voice-2, M2-Voice-3 | 录音 5 秒 → ASR → EchoSkill → TTS → wav 文件 > 0 |
| M2-Voice-5 | Capability 卸载语义（NFR-C1 + NFR-C2） | M2-Voice-1 | `vessel capability uninstall voice` 30 秒内 worker 进程组清理 + RSS 下降 |

---

## 10. M2-iOS — iOS 端到端

| # | 任务 | 依赖 | Acceptance |
|---|---|---|---|
| M2-iOS-1 | iOS Bundle ID + Display Name 改名（按 ADR-013 Stage 4） | M0 | TestFlight build 上传成功；iOS app 显示 "Vessel" |
| M2-iOS-2 | `ServiceDiscovery.swift`（NWBrowser `_vessel._tcp`） | M2-iOS-1 | 家庭 Wi-Fi 启动 3 秒内自动发现 Mac vessel-core |
| M2-iOS-3 | 手填 IP/端口 fallback UI | M2-iOS-2 | NWBrowser 失败时显示具体原因 + 手填入口可见（NFR-X2） |
| M2-iOS-4 | Bonjour 网络环境检测（家庭 vs 公共 vs 企业） | M2-iOS-2 | 公共网络自动 disable Bonjour + 强制手填（R-15） |
| M2-iOS-5 | Audio 上传 + 播放回流（iPhone 录音 → Mac → iPhone 播） | M1A, M2-Voice | 端到端 ≤ 8 秒 |
| M2-iOS-6 | HarnessProtocol.swift / BackendClient.swift 同步新加 protocol kinds（NFR-X1） | M2-Soul | iOS fixture decode 通过 |

---

## 11. 借鉴清单 vs 自研最小子集

按 ARCHITECTURE §10 要求 + ADR-000 D' 路线。

### 11.1 完全借鉴（pnpm install 直接装）

| 依赖 | License | 用途 | 落到 milestone |
|---|---|---|---|
| `hono` | MIT | HTTP server（沿用 Eva）| 全程 |
| `ws` | MIT | WebSocket（沿用 Eva）| 全程 |
| `zod` | MIT | Schema 校验（沿用 Eva）| 全程 |
| `better-sqlite3` | MIT | SQLite（沿用 Eva）| 全程 |
| `vite` + `react` + `zustand` | MIT | 前端（沿用 Eva）| M1A |
| `@modelcontextprotocol/sdk` | MIT | MCP client | M1B |
| `sqlite-vec` | Apache-2.0 | 向量库（C 扩展）| M1C-B |
| `fastembed`（Python via uv）OR `fastembed-js`（ONNX Node）| Apache-2.0 | embedding worker | M1C-B（spike 决定）|
| `pywhispercpp`（Python via uv）| MIT | ASR worker | M2-Voice |
| `piper-tts`（Python via uv）| MIT | TTS worker | M2-Voice |
| Cursor CLI（cursor-agent）| 商业（用户已有 Pro 订阅） | cross-reviewer 异质评审 | 全程评审 |
| CC CLI | 商业（用户已有 Max plan） | Coding Driver | M0.5 |

### 11.2 借鉴架构 + 自研实现

| 借鉴项目 | 借鉴点 | Vessel 自研 | 落到 milestone |
|---|---|---|---|
| Eva harness/scheduler | 并行编排状态机 | scheduler.ts 加 paused/resume 持久化 + workflow_state 表 | M1C-A |
| Eva cli-runner | 5 集成挑战（非交互 / auth / stdout / 进程组 / artifact 隔离） | drivers/coding/claude-code.ts adapter（不动 cli-runner 内部，按 ADR-016）| M0.5 |
| Eva permission + hook | 权限询问 + path allowlist | routes/permission.ts 加 MCP scope schema | M1B |
| Eva voice routes | spawn whisper-cli + edge-tts pattern | ml-workers/src/{whisper,piper}_server.py 包成 ML worker | M2-Voice |
| Eva BackendClient.swift | iOS WS 多会话路由（5 不变量） | 沿用 + 加 NWBrowser + 手填 IP fallback | M2-iOS |
| Eva debate-review SKILL | 三层评审（phase 1/2/3）+ Independence Constraints | Vessel 项目级 reviewer-cross SKILL（按 ADR-017）| 全程评审 |
| OpenClaw SOUL.md 模式 | 结构化灵魂规格 + 启动注入 | soul/parser.ts + soul/injector.ts | M2-Soul |
| OpenTelemetry-lite 12 字段 | trace 字段标准 | observability/trace.ts 自实现（不引 OpenTelemetry 库） | 0A 设计 / M0 落地 |
| Stage-Gate / DAR / Fagan / CD gate | 自治评审工作流 | Vessel ADR-014 B' lite 方案 | 0-meta-lite ✅ |
| Spike / Trade Study / Prior Art | 调研先于设计 | Vessel ADR-015 + docs/research/ | 0-meta-lite ✅ |

### 11.3 不借鉴 / 不依赖（明确 W 级）

| 项 | 理由 |
|---|---|
| LangGraph / AutoGen / CrewAI | Python + Anthropic SDK（违反 v0.1 不上 LLM Driver 硬约束）|
| OpenTelemetry full library | 太重；Vessel 用 lite 12 字段自实现 |
| Capacitor iOS / Android | Eva 已 DEPRECATED |
| Anthropic SDK / OpenAI SDK | token 计费（违反订阅模式硬约束）|
| LiteLLM | 同上 |
| Temporal / NATS server | 违反"个人单机不要企业级"|
| K8s / Docker Swarm | 同上 |
| PostgreSQL / Redis server | 同上（SQLite + 文件够用）|

---

## 11.5. v0A.1 完善 sprint 增订改进（来自 [docs/research/0A-completion-sprint-prior-art-2026-05-09.md](../research/0A-completion-sprint-prior-art-2026-05-09.md) Phase 0 调研）

按调研 17 条改进按 A/B/C 分类。**3 项 A 类立即在 0A.1 完善 sprint 落 0A 文档**（A1 soul 拆 / A6 HTTP loopback / A7 OTEL GenAI 兼容）。剩余 4 项 A 类 + 5 项 B 类按 milestone 实施时落，**不阻塞 0B**。

### A 类（架构 / 接口改进，分散到各 milestone 实施时改）

| ID | 改进 | 落到 milestone | 对应 ROADMAP 段 |
|---|---|---|---|
| A2 | Memory 单层 → Letta 三层 typed blocks（core / recall / archival + self-edit） + CrewAI hierarchical scope | M1C-A（core/recall）+ M1C-B（archival 向量层）| §6 + §7 |
| A3 | Capability 单接口 → LM Studio 4 hook point + Goose Extension trait（4 方法收敛 Skill+Tool） | M0.5+ Capability App 实施时 | §3 |
| A4 | cli-runner artifact 隔离 → Aider git-commit-per-edit + Cursor `git worktree add` 临时隔离 | M0.5 ClaudeCodeDriver adapter 时 | §3 |
| A5 | Permission 路径白名单 → Claude Code 三档（grant once / permanently / reject）+ 静态命令分析 + settings.json 三层 hierarchy | M1B Permission middleware 时 | §5 |

实施约束：每个 milestone 启动前重读对应 A 项调研建议；如 stub refactor 工作量 > 2 小时，单独跑 ADR Phase 0 spike（按 ADR-015）。

### B 类（功能改进，进 ROADMAP M1C+ / M2+ / v1+）

| ID | 功能 | 落到 milestone | 备注 |
|---|---|---|---|
| B1 | SillyTavern V3 character card 导入器（PNG + tEXt ccv3 chunk + base64 JSON） | v1+ | 零成本接 SillyTavern 数千社区角色卡；与 v0A.1 4 sibling soul 双向映射 |
| B2 | SillyTavern Lorebook 风格的可激活 KB（@@depth/@@position/@@role decorators + token budgeting）| M1C-B 之后（增强长期记忆）| flat KV → 结构化注入；与 A2 Memory 三层不冲突 |
| B3 | Goose Recipe YAML（instructions + extensions + parameters + subrecipes）替代 / 补充 Workflow engine | M1C-A 之后 | portable / 可分享 / CI 可跑；不取代 scheduler 但作为产物 |
| B4 | Aider Architect mode（双模型：planning + execution，subscription 内成本最优） | v1+ | 涉及多 CLI 协调（Cursor + CC），M0.5 v0.1 仅 CC 时不需要 |
| B5 | LangGraph interrupt() + checkpointer 模式 HITL（M1C-A 已对齐设计，需明确 checkpoint schema）| M1C-A | scheduler.ts 加 paused/resume 时按 LangGraph spec 落 schema |

### C 类（灵感记录，进 IDEAS.md，不进 ROADMAP）

C1-C5 进 [`docs/notes/IDEAS.md`](../notes/IDEAS.md) 灵感库（💡 标签）。详见该文件。

---

## 12. 跨 milestone 持续任务

| 任务 | 频次 | Acceptance |
|---|---|---|
| 跑 4-way Phase 1 评审（每 milestone closeout） | 每个 milestone | 4 reviewer 各出 verdict + Phase 3 仲裁 + Verify Gate 全过 |
| RISKS.md 回看（每 milestone 完成时） | 每个 milestone | 已触发的 RISKS 标 mitigated；新发现 RISKS 追加 |
| LICENSE / SECRETS log 维护 | 每次发现时立即写 | log 文件存在；release 前全部 resolved |
| ADR README supersede 矩阵 | 每个新 ADR 加时 | docs/adr/README.md 含完整索引 |
| `docs/notes/IDEAS.md` 整理 | owner 触发 | 灵感 → ❓ → ✅（升格到 ROADMAP） |

---

## 13. 0A ROADMAP Acceptance 自查

按 v5.4 plan 0A 完成判定第 1 + 第 4 条：

- [x] REQUIREMENTS Must 级 feature 在 ROADMAP 找到对应里程碑 ✅（§1-§10 全覆盖 14 个 M 级 feature）
- [x] 借鉴清单 vs 自研最小子集（ARCHITECTURE §10 要求）✅（§11）
- [x] 跨 milestone 持续任务列出（§12）
- [ ] M0–M1C 实施相关决策不留 TBD（**待 ADR-001~011 全部 Accepted**）

剩余 ADR 见 [`docs/adr/vessel/`](../adr/vessel/)。
