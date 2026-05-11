# M2-iOS-β' — Closeout (vessel-risk-officer lens)
Date: 2026-05-10-2300

## Findings

### PASS: probe 流程默认无 token
VesselDiscovery.probe 在 β 评审已确认无 auth header — β' UI 调用方不传
token，跟 backend /api/vessel/health 路由 no-auth 设计对齐。operator 在
sheet 选完之后再去 settings.authToken 输入 token —— 顺序合理（先验证
host，后给凭证）。

### PASS: settings.backendURL 写入只发生在用户主动点击"选择"
没有"自动选第一个"逻辑 — operator 必须看到结果 + 主动点击才切换。这是
正确的"少即多"边界（β' pragmatist 也提到）。

### MINOR-1: probe 假阳性场景需要 displayName 防误导
displayName 优先用 soul.name (M2-iOS-α 已确认 soul.name 是 LAN 公开信息)，
fallback bonjour.instanceName，最后 hostname。如果遇到一个 spoofed service
（攻击者在 LAN 上跑假 vessel-core）能伪造 displayName 内容。但这是攻击者
"控制了你的 LAN"假设之下 — 已超出个人单机威胁模型。
**Verdict**: MINOR — accepted-as-is. 不在威胁模型内。

### PASS: HTTP 而非 HTTPS 是 LAN 必需
sheet 选定 url 是 `http://<host>:<port>`（Bonjour 解析回的 .local 主机名 +
port）。LAN 内 Mac vessel-core 默认 :3030 没 TLS — 跟 NSAllowsLocalNetworking
+ NSAppTransportSecurity 例外配置一致。

### MINOR-2: dismiss() 在 onSelect 回调后调用，但 url 写入是异步外部
代码结构：`onSelect(url)` → `dismiss()`。如果 onSelect 闭包里
`settings.backendURL = u` 触发 onChange BackendClient 重连，重连过程中 sheet
已经在 dismiss。BackendClient.disconnect+connect 已经处理这种竞态，没问题。
但代码里这种隐式依赖值得记。
**Verdict**: MINOR — accepted-as-is.

### PASS: NWBrowser 资源 onDisappear 释放
sheet 关闭 → onDisappear → browser.stop() → NWBrowser.cancel() → 释放
mDNS service browse 内核资源。

### INFO: 没有 probe 节流
operator 可以反复点"测试"按钮 —— 会重复触发 probe（每次发一个 GET）。
没节流，但每次 timeout 2s + 单 LAN 内不会失控，影响小。

## Verdict: PASS — 2 MINOR (accepted-as-is)
