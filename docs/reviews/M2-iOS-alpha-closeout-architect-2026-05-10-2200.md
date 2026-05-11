# M2-iOS-α — Closeout (vessel-architect lens)
Date: 2026-05-10-2200

## Scope (α 拆段)
M2-iOS 三段拆分中的 α — Mac 后端能自动验证的部分：
- mdns/publisher.ts（dns-sd 子进程封装）
- /api/vessel/health 升级（service identity + bonjour + soul + 去掉 dataDir 泄漏）
- wire 进 index.ts startup/shutdown

β（iOS NWBrowser Swift + bundle id 改名 + project.yml 改名）由 operator 主导
β/γ（真机 + TestFlight + 端到端 voice ≤ 8s）由 operator 验证

## Findings

### PASS: 子进程 lifecycle 与 ADR-009 / McpServerManager 对齐
mdns publisher 走 spawn → SIGTERM → SIGKILL 模式，与 mcpManager 完全一致。
process.once('SIGTERM', ...) handler 同时调 stopMdnsPublisher + cleanupMcpConfig
+ mcpManager.shutdown — 三个 helper subprocess 都按 ADR-009 受控管理。

### PASS: 端点合并而非新加路由
最初我加了独立的 vesselHealthRouter，发现 vesselRouter 已有 /health
（M1A-α 的 sessions/runs counts）。Hono 多次 app.route 串联导致不可达。
正确处理：合并到现有 endpoint，保留 ok+counts 兼容性，加 service/bonjour/soul，
**删掉 dataDir 字段**（M1A-α 当时的实现泄漏 ~/.vessel 绝对路径）。

老 readiness 探针（test-vessel-http、test-vessel-ws）只看 status 200，不看
body 字段名 — 兼容性零破坏（已验证回归全过）。

### PASS: 不暴露敏感信息
回归测试 + Test 3 主动 grep `VESSEL_TOKEN` / `CLAUDE_CLI` / `/Users/`，确认
响应不含。soul.name 是公共显示字段（NWBrowser 已经把 instanceName 公开）。

### MINOR-1: SERVICE_TYPE = '_vessel._tcp' 没纳入正式注册
按 RFC 6335 / IANA 服务名注册，Bonjour service type 理应申请。Vessel 是个
人单机软件，目前不申请也不会冲突，但未来发布要走规范流程。
**Verdict**: MINOR — defer to v0.5 release prep.

### MINOR-2: instanceName 默认从 hostname 派生，不防主机名漂移
hostname 改了（`scutil --set HostName`）→ instanceName 也跟着变 → iOS 端
保存的 "上次连过的 instance" 失效。可以从 ~/.vessel/soul.md 的 name 字段
派生 instanceName 来稳定化（Soul 名往往比主机名更稳定）。
**Verdict**: MINOR — defer until iOS-β 发现真实痛点。

### MINOR-3: VESSEL_DISABLE_MDNS=1 是 backdoor 但没文档
我加了 env opt-out 给 CI / 测试用，但没写进任何文档。下次 docs pass 补到
README 或 ENV 表。
**Verdict**: MINOR — defer to docs.

### INFO: dns-sd 子进程在某些场景可能 zombie
spawn detached:false → 父进程崩溃时 dns-sd 不会被 reaped 而成 zombie 直到
parent's parent (launchd / shell) 清理。process.once SIGTERM/SIGINT 处理覆
盖正常 shutdown，但 abort/kill -9 路径不覆盖。Mac 个人单机场景影响小。

## 架构评估: PASS
- 模块边界：publisher (lifecycle) / vesselRouter /health (data) — 单一职责
- 依赖方向：vessel-intent.ts → mdns/publisher.ts → 'node:child_process'
- 测试金字塔：integration test 覆盖 spawn/browse/stop + HTTP 200/字段/无泄漏
- ADR-009（helper subprocess 受控管理）已满足

## Verdict: PASS — 3 MINOR (deferred)
