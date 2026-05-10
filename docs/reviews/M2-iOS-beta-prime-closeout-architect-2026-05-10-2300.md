# M2-iOS-β' — Closeout (vessel-architect lens)
Date: 2026-05-10-2300

## Scope (β' 段，UI 接入)
β 段交付了 BonjourBrowser / VesselDiscovery / Info.plist；β' 段把它们接入
SettingsView 让 operator 真能用。仍走保守路线（不动 bundle id / 不重命名）。

具体改动：
- 新增 Views/Settings/VesselDiscoveryView.swift（sheet UI，~165 行）
- SettingsView.swift +20 行：showDiscoverySheet state + Backend section 加按钮
  + sheet modifier 接 onSelect 写回 backendURL
- xcodegen 重生成 + simulator BUILD SUCCEEDED

## Findings

### PASS: UI 与底层契约一致
VesselDiscoveryView 的状态机 idle → probing → ok / failed，对应 BonjourBrowser
的 browse + resolve 链 + VesselDiscovery.probe 三步。每步状态用枚举显式表达，
SwiftUI 用 switch 渲染对应 icon / button，无 partial state 漏判。

### PASS: Sheet 关闭语义清晰
- 用户点"取消" → dismiss 不写回 URL
- 用户点某 entry 的"选择" → onSelect 回调把 url 写回 draftURL + settings.backendURL
  → dismiss
- "完成"按钮的 settings.backendURL 写入路径不变，β' 多了一条 sheet→直接生效路径

### PASS: 资源生命周期 onAppear/onDisappear
browser.start() 在 sheet 打开时启动，stop() 在关闭时停。NWBrowser 是有
内核资源的（mDNS service browse），sheet 关掉 stop 防止泄漏。

### MINOR-1: probe 之后没"撤回"路径
点"选择"后 url 直接写入 settings.backendURL —— 没有"先预览，确认后再切换"
模式。如果 probe 假阳性（某个非 vessel 服务恰好 200 + service:vessel），
operator 切过去了才发现连不上，必须再回去手填。
**Risk**: Low —— /api/vessel/health 协议有 4 字段验证（service / version /
hostname / uptimeSec）+ Codable 解码失败 throws，假阳性概率极低。
**Verdict**: MINOR — accepted-as-is.

### MINOR-2: showDiscoverySheet 没在 onChange backendURL 主动关闭
极端场景：sheet 打开时 settings.backendURL 被外部代码改了（不会发生但理论
存在），sheet 仍显示旧 service。无实际影响。
**Verdict**: MINOR — accepted-as-is.

### INFO: SettingsView 现在 503 行（β 前 485）
+ ~20 行（state + button + sheet binding）。可读性没明显下降；合理增量。

## 架构评估: PASS
- 三层职责：Networking/BonjourBrowser → Networking/VesselDiscovery → Views/Settings/VesselDiscoveryView
- SwiftUI 状态机用 Swift enum 显式表达
- BackendClient.swift 0 改动 — sheet 选定 → settings.backendURL → BackendClient
  通过既有 onChange path 自动重连
- xcodebuild simulator BUILD SUCCEEDED

## Verdict: PASS — 2 MINOR (accepted-as-is)
