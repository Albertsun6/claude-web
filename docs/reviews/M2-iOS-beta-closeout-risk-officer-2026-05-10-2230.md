# M2-iOS-β — Closeout (vessel-risk-officer lens)
Date: 2026-05-10-2230

## Findings

### PASS: NWBrowser includePeerToPeer = false
显式禁用 peer-to-peer 蓝牙发现 —— 只走 Wi-Fi mDNS。避免在 AirDrop / 蓝牙
配对场景被搜到。LAN-only 是正确边界。

### PASS: NSBonjourServices 显式声明 _vessel._tcp
没有给 app 一张通用的"任何 Bonjour 服务都可浏览"白名单。entitlement
最小化原则。

### PASS: VesselDiscovery 用 timeout
.timeoutInterval = 2.0 — 防止恶意 LAN 设备让 app 卡 30 秒。错误处理覆盖
URLError.timedOut + .network + .malformed + .notVessel 四类，错误信息中文
但不泄漏 backend 路径或栈帧。

### PASS: /api/vessel/health 是 unauthenticated 设计正确
M2-iOS-α 评审已通过：no-auth probe 暴露的字段 service / version / hostname
/ uptimeSec / sessions/runs / bonjour / soul.name —— 都是 LAN 可见或公共
信息。VesselDiscovery 不需要 token 就能 probe，符合"先验证再交 token"
的安全顺序。

### MINOR-1: 没有显式 verify "scheme == http/https"
VesselDiscovery.probe(_ baseURL:) 直接 appendingPathComponent，如果调用方
传 `file:///etc/passwd` URL 也会构造请求。URLSession 会拒绝非 http(s)
scheme，但显式校验更稳。
**Risk**: Low — 调用方都是 app 内部代码，不接受用户原始字符串构 URL。
**Verdict**: MINOR — defer. UI 接入 manual-IP 时校验 scheme + host 格式
更合适。

### MINOR-2: NWConnection 解析回路里 host 可能漏处理 service / unix
switch host 处理了 .name / .ipv4 / .ipv6 + @unknown default → ""。空字符串
host 会被后续 URL(string:) 拒绝，不会真造成误连，但日志里会丢"为啥
resolve 失败"信息。
**Verdict**: MINOR — accepted-as-is.

### PASS: BonjourBrowser actor-isolated
@MainActor 标记 + Task { @MainActor in ... } 包裹回调更新 — 所有 services
mutation 都在主线程。SwiftUI @Published 安全。

### INFO: NSAllowsLocalNetworking + NSBonjourServices 组合在 iOS 14+ 是必备
Eva 之前已配 NSAllowsLocalNetworking（手填 LAN IP 用），β 加 NSBonjourServices
（Bonjour 浏览用）。两者都在 ATS 例外列表里，operator 上 TestFlight 时
Apple Review 不会卡这两项 —— 已有 Eva 历史 build 通过先例。

## Verdict: PASS — 2 MINOR (deferred / accepted-as-is)
