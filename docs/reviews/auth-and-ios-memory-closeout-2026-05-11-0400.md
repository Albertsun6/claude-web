# Auth Boundary + iOS Memory UI — Closeout (4-way consolidated)
Date: 2026-05-11-0400
Type: defense + UI integration（无新 ADR / 无 schema 变化）

> 两个改动合一份：(#1) auth middleware NO_AUTH_PATHS bypass for /api/vessel/health
> + (#22) iOS MemoryAPI + VesselMemoryView 接入 SettingsView。前者闭合 M1C-B+
> 盘点的 MINOR-arch-1（其实之前误判 — auth 已全局保护，只是没考虑 health bypass），
> 后者让 iOS 真"用上"长期记忆能力。M2-Voice 经评估后 defer（user 决策）。

## Scope

### #1 — Auth boundary fix
**事实订正**：M1C-B+ closeout 时报告 vessel-memory 路由"没显式 auth check"。
实际 [index.ts:118](packages/backend/src/index.ts#L118) `app.use("/api/*", authMiddleware)`
已**全局保护**所有 /api/* 路由，包括 vessel-*. 实际缺口是 **/api/vessel/health
也被全局拦截**，违反 M2-iOS-α 的 LAN discovery probe no-auth 设计意图（iOS
NWBrowser 发现服务后还没拿到 token 就要 probe health）。

**Fix**: [auth.ts:101-127](packages/backend/src/auth.ts) 加 NO_AUTH_PATHS
集合，当前仅包含 `/api/vessel/health`，bypass 该路径的 token check。
其他 vessel 路由仍要求 token（when VESSEL_TOKEN set）。

### #22 — iOS Memory UI
- packages/ios-native/Sources/ClaudeWeb/MemoryAPI.swift (~165 行) — HTTP
  client wrapper for /api/vessel/memory* 6 endpoints (mirror of M1C-B+
  vessel-memory.ts)
- packages/ios-native/Sources/ClaudeWeb/Views/Settings/VesselMemoryView.swift
  (~285 行) — list / add sheet / search sheet + delete via swipe
- SettingsView.swift +12 行 — NavigationLink 进 VesselMemoryView，section
  header "Vessel 长期记忆"
- xcodegen + iPhone 17 simulator BUILD SUCCEEDED

## Findings

### PASS (architect): auth NO_AUTH_PATHS 是显式枚举而非 wildcard
NO_AUTH_PATHS 是 `Set<string>`，**显式列出**每个 bypass 路径。未来加
bypass 必须 inline 改这个文件（不是通过 env）— 防"误开 backdoor"。当前
仅 `/api/vessel/health`，附注释解释判断标准（公开服务身份、无 secret）。

### PASS (architect): iOS 三层职责清晰
- MemoryAPI.swift — 纯 HTTP wrapper（与 ProjectsAPI 同模式）
- VesselMemoryView.swift — UI + state 管理
- SettingsView NavigationLink — 入口
不重复发明 token 注入 / error handling pattern。

### PASS (pragmatist): auth fix 一行测试就抓到 4 scenario
test-vessel-auth.ts 以 4 spawn 子进程方式覆盖：
- token-set + 无 token + health → 200; 其他 → 401
- token-set + 正 token → 全 200
- token-set + 错 token → health 200 / 其他 401
- token-unset (dev) → 全 200 + warning logged

16/16 全过。

### PASS (pragmatist): iOS UI 不发明 navigation pattern
NavigationStack + NavigationLink + sheet 都是 Apple 标准模式。MemoryAddSheet
+ MemorySearchSheet 是局部 inline struct（同文件），不污染独立文件计数。

### PASS (risk): no-auth bypass 的安全分析
NO_AUTH_PATHS 仅含 `/api/vessel/health`，响应 fields:
- service / version / hostname / uptimeSec — 公开（mDNS 已含 hostname）
- sessions / runs counts — 数字，无 PII
- bonjour metadata — 与 mDNS 广播相同
- soul.name — 与 mDNS instanceName 同级公开

无 secret 暴露。匹配 M2-iOS-α closeout 已确认的安全 posture。

### PASS (risk): iOS memory delete idempotent
用户 swipe-delete 一条 → API DELETE 总返回 200（service 端 idempotent）。
即使本地状态删了 / API 失败，refresh() 会重新拉真实状态。错误恢复路径
正常。

### PASS (cursor cross): #22 复用既有 settings.backendURL + authToken
不动 BackendClient.swift / Settings.swift。MemoryAPI 通过 closure 拿
backendURL + token，符合 ProjectsAPI 既有模式。

### MINOR-1 (architect): auth NO_AUTH_PATHS 没单元测过 path 字符串规范化
Hono c.req.path 是否对 trailing slash / query string / case 敏感？
代码假设 `c.req.path === '/api/vessel/health'`。如果 Hono 给的是
`/api/vessel/health/` (trailing slash) 就 miss → 401。
**Verdict**: MINOR — 现有 16/16 测试用 `/api/vessel/health`（无 trailing
slash）路径，覆盖主流场景。defer / 真发现 trailing slash 边界 case 再改成
prefix match。

### MINOR-2 (pragmatist): iOS 没有 pull-to-refresh 失败的明确反馈
.refreshable { await refresh() } 触发 listError 状态 → UI 显示 Section + 红色
label。但 spinner 消失瞬间 user 可能没注意到。无 toast / haptic 反馈。
**Verdict**: MINOR — accepted-as-is. 错误信息在 List 顶部展示。

### MINOR-3 (cursor cross): iOS 中文 i18n 仍硬编码
"Vessel 长期记忆" / "新增记忆" / "搜索语义相似的记忆..." 等都是字面字符串。
项目其他 view 也是。
**Verdict**: MINOR — defer / 整体 i18n 工程化时一起做（M2-iOS-β' 也提过）。

### Finding 矩阵汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | NO_AUTH_PATHS 路径规范化 | defer |
| MINOR-prag-1 | MINOR | pragmatist | iOS pull-to-refresh 错误反馈不明显 | accepted-as-is |
| MINOR-cursor-1 | MINOR | cursor | iOS i18n 硬编码 | defer / 整体国际化 |

3 MINOR, 0 MAJOR, 0 BLOCKER. 全部 defer / accepted-as-is.

## 验收

### #1 验收
- ✅ tsc clean
- ✅ test-vessel-auth.ts 16/16 全过（token-set+ok / +wrong / no-token / health bypass）
- ✅ Eva path 不受影响（既有 /api/health/full / /api/sessions 等仍由全局
   middleware 保护）

### #22 验收
- ✅ MemoryAPI.swift 6 endpoint wrapper + 中文 LocalizedError
- ✅ VesselMemoryView.swift list / add sheet / search sheet + swipe-delete
- ✅ SettingsView 接入"Vessel 长期记忆" NavigationLink
- ✅ xcodegen 重生成 + iPhone 17 simulator BUILD SUCCEEDED
- ✅ 装到 booted simulator + launch 成功

## Verdict: PASS
- 0 BLOCKER, 0 MAJOR
- 3 MINOR (全 defer / accepted-as-is)
- 11 套件回归全过 (auth/soul/memory/soul-memory/vessel-memory-http/workflow/
  m1bplus/m1b/lessons/m2-ios-alpha/coding-driver)

#1 闭合 M1C-B+ MINOR-arch-1 误判（实际为 health bypass 缺口）。#22 让 iOS
真"用上"长期记忆能力 — 与 M2-iOS-α / β / β' soul-memory-integration 形成
完整链路：discover → connect → 长期记忆 + 灵魂注入。

M2-Voice **defer**（user 决策）：当前 Eva voice 已生产可用，capability
runtime loader 工作量与"零用户感知价值"不匹配。defer 到真需要第三方
capability 装卸时再做（contained in Vessel backlog）。


lesson_id: 051f272b-0b24-470a-b69a-f2cc79df42ad
