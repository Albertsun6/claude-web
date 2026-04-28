# 路径 B：内部工具化（≤50 人公司内部用）

把现有个人工具升级成公司内部用的"Claude 工作台"。**不对外卖、不做 SaaS**——这是它跟路径 C 的根本区别，也是它能用 2-3 周做完的原因。

---

## 决策前提（必须先定，否则后面全白干）

### 🔴 凭据策略 — 这一步定不下来其他都做不动

CLI 子进程跑订阅是**单用户专属**的优化。多用户后不可能维持。三选一：

| 选项 | 月成本 | 改动量 | 适合 |
|---|---|---|---|
| **A. 公司买 Anthropic Teams** | ~¥250/人 | 中 | 大多数情况，最简单 |
| **B. 每人自己绑 API key** | 各付各 | 小 | 已有员工自购订阅 |
| **C. 每人 SSH 进自己 Mac** | 0 | 大 | 极少数情况，运维灾难 |

**强烈推荐 A**。改动到 SDK 模式（`@anthropic-ai/sdk` 直连 API），把 cli-runner.ts 大改一遍。但只改一次。

定了凭据 → 进 Phase B-1。

---

## Phase B-1：身份认证与多用户基座（**1 周**）

### 目标
- 公司员工用 Google Workspace / Microsoft 365 / Okta 登录
- 后端识别 "who is calling"
- 前端 AuthGate 升级成真登录页

### 改动

#### 后端（新文件）
```
packages/backend/src/auth.ts          → 扩展为完整 auth 模块
packages/backend/src/routes/auth.ts   → /api/auth/login, /callback, /me, /logout
packages/backend/src/db/              → Postgres schema + migrations
  schema.sql                          → users, sessions, projects (移到 DB)
  client.ts                           → pg pool
packages/backend/src/middleware/      → 
  authenticate.ts                     → 解 JWT → ctx.user
  authorize.ts                        → role 检查
```

#### 前端（替换/扩展）
```
packages/frontend/src/components/AuthGate.tsx   → 真正的登录页
packages/frontend/src/components/UserMenu.tsx   → 顶栏头像 + 切组织 / 登出
packages/frontend/src/api/auth.ts               → /api/auth/me, refresh token
packages/frontend/src/store.ts                  → currentUser: User | null
```

#### 凭据存储
- **OIDC**：用 [openid-client](https://github.com/panva/node-openid-client)，最稳
- 不要用 NextAuth（我们用 Hono 不是 Next）
- Session：JWT signed by server secret，httpOnly cookie + CSRF 双 token

### 风险
- iOS PWA Cookie 跨 Tailscale hostname 能不能正常 set — 实测过

### 退出条件
- 三个测试账号能各自登录、看到隔离的项目列表
- 错的 token / 过期 token → 401，前端引导重登
- E2E auth 测试覆盖 unauth / wrong-token / refresh 流程

---

## Phase B-2：多租户存储（**3-4 天**）

### 目标
现在的 `localStorage:claude-web:projects` 等改成服务端持久化，按用户隔离。

### 数据模型

```sql
users (
  id uuid pk,
  email text unique,
  display_name text,
  oidc_sub text,
  created_at timestamptz,
  -- 凭据策略 A: org_credential_id fk
  -- 凭据策略 B: anthropic_api_key text encrypted
)

projects (
  id uuid pk,
  user_id uuid fk users,
  name text,
  cwd text,
  created_at timestamptz,
  unique (user_id, cwd)
)

sessions (
  id uuid pk,
  project_id uuid fk projects,
  cli_session_id text,        -- claude CLI's session uuid
  last_used_at timestamptz,
  message_count int
)

audit_log (
  id bigserial pk,
  user_id uuid fk users,
  action text,                 -- prompt_sent | tool_used | permission_granted
  payload jsonb,
  created_at timestamptz
)

allowed_roots (
  user_id uuid fk users,
  root text,
  primary key (user_id, root)
)
```

### 关键设计

- **claude CLI 的 sessions 文件** (`~/.claude/projects/...`) 仍然存盘，但路径用 `CLAUDE_HOME=/var/lib/claude-web/users/<user_id>/.claude` 隔离 → 通过 spawn 时的 env var 控制
- 数据库存"我的项目列表" + "活跃会话索引"，真实 turn 数据继续在 jsonl
- 每次 user_prompt 写一条 audit_log（合规需要）

### 改的文件
```
packages/backend/src/cli-runner.ts    → spawn env 加 CLAUDE_HOME
packages/backend/src/index.ts         → user_prompt → 校验 user 拥有该 cwd → 写 audit
packages/backend/src/routes/projects.ts → 替代 localStorage 的项目 CRUD
packages/frontend/src/store.ts        → projects 从 server 拉，不再 localStorage
packages/frontend/src/api/projects.ts → CRUD
```

### 风险
- claude CLI 用环境变量 `CLAUDE_HOME` 不一定支持，需要先验证。备选：用 `--settings` 注入 + 软链 storage 路径

---

## Phase B-3：迁部署（**2-3 天**）

### 目标
后端从 Mac launchd 迁到公司 Linux 服务器。

### 选型
| 项 | 推荐 | 备选 |
|---|---|---|
| OS | Ubuntu 24.04 LTS | Debian 12 |
| 进程管理 | systemd | docker compose |
| HTTPS | Caddy（自动 cert） | Nginx + certbot |
| 数据库 | Postgres 16（同机或云 RDS） | – |
| 域名 | 公司子域 + Cloudflare | Tailscale serve |
| 备份 | pg_dump 定时 + S3-compat 上传 | – |

### 文件
```
deploy/
  Dockerfile                      → multi-stage build (deps + dist)
  docker-compose.yml              → backend + postgres + caddy
  Caddyfile                       → 自动 HTTPS, /api/* → backend
  systemd/claude-web.service      → 替代 launchd plist
  scripts/
    deploy.sh                     → ssh + git pull + restart
    backup.sh                     → pg_dump + S3
  .env.production.example         → 全部必须 env 变量列出
```

### 部署后必跑的检查
- [ ] HTTPS 证书自动签
- [ ] 跨域 OIDC redirect 正确
- [ ] postgres 连接稳定
- [ ] systemd 重启后 backend + postgres 都恢复
- [ ] 备份脚本能恢复

### 风险
- claude CLI 在 Linux 上的 OAuth 流程需要一次性人工 `claude auth login`，每个 user 一次，麻烦
- 凭据策略 A 时不需要这步——直接用 API key

---

## Phase B-4：语音 Tier 3 + Tier 2（**1 周**）

### Tier 3：OpenAI Realtime
- 后端 `/api/realtime/session`：用 `OPENAI_API_KEY` 调 [client_secrets API](https://platform.openai.com/docs/api-reference/realtime-sessions) 生成 ephemeral token
- 前端 `useVoice.ts` 加 `realtime` mode：
  - WebRTC `RTCPeerConnection` 连 OpenAI
  - mic stream → peer
  - 接收 transcript events → 喂给 sendPrompt 流程
  - 接收 audio events → 直接放 `<audio>`（绕过 edge-tts）
- iOS PWA 可用 ✅
- 每用户每月 OpenAI 用量记到 `audit_log`，admin dashboard 可见

### Tier 2：UX 加固
具体五项见 [MOBILE_VOICE.md](MOBILE_VOICE.md) Tier 2 节。重点：
1. WakeLock 防息屏
2. 音效提示 (开始/提交/失败)
3. Call Mode 全屏 UI
4. 慢速 TTS 选项
5. Submit 后 1s 缓冲

### 改的文件
```
packages/backend/src/routes/realtime.ts   → 真实实现
packages/backend/src/routes/usage.ts      → admin 看每用户每月 OpenAI 消耗
packages/frontend/src/hooks/useVoice.ts   → 加 realtime mode
packages/frontend/src/components/CallMode.tsx → 新
packages/frontend/src/audio/cues.ts        → 新
```

### 切换策略
配置项决定：每个用户可选 web-speech / remote-stt / realtime。低重度用 whisper 省钱，高重度用 realtime 体验好。

---

## Phase B-5：可观测 + 审计（**3 天**）

### 必须做
- **日志**：[pino](https://github.com/pinojs/pino) 结构化 JSON 日志，重定向到文件 + 公司 ELK
- **错误追踪**：[Sentry](https://sentry.io) 自托管或 SaaS（free tier 5k errors/月够内部用）
- **审计**：所有 user_prompt / tool_use / permission_grant 写 audit_log
- **基础指标**：Prometheus 风格 `/metrics` 端点（活跃会话数、API 调用量、错误率）

### Admin Dashboard（前端 /admin 页面）
- 用户列表 + 上次登录
- 每用户本月 token / OpenAI 用量
- 按 toolName 聚合的调用数（看谁在频繁用 Bash）
- 错误日志最近 50 条
- 简单图表（recharts 即可）

### 改的文件
```
packages/backend/src/observability/
  logger.ts                  → pino 实例
  audit.ts                   → 写 audit_log
  metrics.ts                 → /metrics 端点
packages/frontend/src/components/admin/
  UserList.tsx
  UsageChart.tsx
  AuditLog.tsx
```

---

## Phase B-6：硬化（**3 天**）

### 必备
- **Rate limiting**：[express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) 风格的 hono middleware；每用户每分钟 60 次 prompt 上限
- **CSRF**：除 WebSocket 外的 mutating routes 都查 CSRF token
- **Helmet headers**：CSP, X-Frame-Options, HSTS
- **Input 验证**：所有 body 用 [zod](https://github.com/colinhacks/zod) schema parse
- **Secrets 不进日志**：log 中过滤 Authorization / API keys
- **依赖扫描**：`pnpm audit` + Snyk / Dependabot 每周自动 PR

### 测试要求
- 现有 65 个 E2E 通过
- 新加 ~20 个 auth 测试（unauth, wrong-token, expired, csrf, role-denied）
- 加 ~10 个负载测试（k6）：10 / 50 并发用户跑标准 prompt
- E2E 必须在 CI（GitHub Actions）每次 push 跑

---

## 总工时

| Phase | 天 | 累计 |
|---|---|---|
| B-1 Auth | 5 | 5 |
| B-2 多租户 | 4 | 9 |
| B-3 部署 | 3 | 12 |
| B-4 语音 | 5 | 17 |
| B-5 可观测 | 3 | 20 |
| B-6 硬化 | 3 | 23 |

**全职 ≈ 4.5 周**，半职 8-9 周。能交付 50 人公司内部稳定用。

---

## 上线后第一个月需要做的（不算前面 23 天）

- 内部 alpha 5 人 → 收 bug
- beta 20 人 → 测高峰并发
- 找一个真实 bug（一定会有）→ 写复盘
- 决定是否继续推 100 人 / 200 人 → 那是另一个量级，可能需要 Redis、横向扩展、CDN

---

## 现有代码哪些能直接用 / 哪些要重写

| 模块 | 状态 |
|---|---|
| `cli-runner.ts` | 大改（CLI → SDK，多 CLAUDE_HOME） |
| `routes/fs/git/sessions/voice` | 加 user_id 校验，逻辑保留 |
| `routes/permission` | 保留，permission_token 加 user_id 维度 |
| `frontend/store.ts` | 大改（localStorage → server-side） |
| `frontend/components/*` | 90% 复用 |
| `useVoice.ts` | 加 realtime mode 分支，主体保留 |
| `auth.ts` (frontend) | 替换为 OIDC flow |
| `auth.ts` (backend) | 大改（token → JWT + OIDC） |
| `tests/test-e2e.ts` | 加 user 维度，扩到 ~80 个 |

复用率 ~60%，比想象的高（因为前端 UI 层架构干净）。

---

## 关键风险摘要

1. **claude CLI 多用户隔离不一定走得通**：需 Phase B-2 一开始就实测 CLAUDE_HOME 是否支持。如果不支持，要么每个 user 一个进程一个 OS user（噩梦），要么改用 SDK（已经在凭据策略 A 默认路径里）。
2. **OIDC 调试痛**：第一次集成总是踩坑，预留 1-2 天 buffer。
3. **iOS PWA + Cookie + Tailscale 跨 host SSO**：实测跑通才能往前。
4. **OpenAI Realtime 内嵌 WebRTC** 浏览器兼容性：Safari 偶尔有怪 bug，需测。

---

## 不在这条路径里做的事（明确说"不做"很重要）

- 团队协作 / 共享会话（路径 C 才需要）
- iOS / Android 原生 app（Tier 4，先 Capacitor 套壳就行）
- 自定义模型 / fine-tune
- 知识库接入 RAG
- Slack / Lark / 钉钉 bot 集成
- 计费 / 发票 / 自动化套餐（个人 SaaS 才需要）

这些都列到 IDEAS.md，等 B 跑稳了真的有人提才考虑。
