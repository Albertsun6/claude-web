# M2-iOS-β — Closeout (vessel-architect lens)
Date: 2026-05-10-2230

## Scope (β 段)
β 段定义为"我能写 Swift 代码，operator 编译验证"。本次 β 走**保守路线**：
- 加 BonjourBrowser.swift（Network.framework NWBrowser，浏览 _vessel._tcp）
- 加 VesselDiscovery.swift（验证 /api/vessel/health 区分真假 vessel）
- project.yml 加 NSBonjourServices Info.plist 字段
- xcodegen 重生成 + xcodebuild simulator BUILD SUCCEEDED

**不做（留 γ 阶段或 operator 决策）**：
- bundle id 改名 com.albertsun6.claudeweb-native → com.albertsun6.vessel
- ClaudeWeb→Vessel 仓库内大重命名（git mv + 路径变化）
- BackendClient.swift / ContentView.swift 接入 BonjourBrowser 的 UI 部分

## Findings

### PASS: Network.framework 现代 API 选择正确
NWBrowser + NWEndpoint.service 是 iOS 14+ 的官方 LAN 服务发现路径。比
NetService（弃用）/ DNSServiceRef（C API）更适合 SwiftUI / async/await。
Discovered/Resolve 是两步：browse 拿到 endpoint 描述，resolve 才知道
host:port —— Apple 框架的标准用法，与 ADR-009 helper subprocess 异步语义
对齐。

### PASS: 不破坏 Eva 路径的接入策略
新增的 BonjourBrowser/VesselDiscovery 是独立类型，**没有改 BackendClient /
Settings / ContentView**。app 启动后默认仍走 Settings.backendURL
（手填 / 上次保存）。下一步 UI 接入由 operator 完成，本 β 段只交付
discovery 基础设施。

这是"层下而上"的好习惯：先把能自动验证的底层做好，UI 接入与人类决策分开。

### PASS: 端到端 health 探测协议匹配 α
VesselHealth Codable struct 字段精确镜像 M2-iOS-α 的 /api/vessel/health
JSON shape：service / version / hostname / uptimeSec / bonjour（嵌套
published+instanceName+port+type）/ soul（嵌套 present+name+error）。
displayName 优先级 soul.name > bonjour.instanceName > hostname —— 与
operator 实际看到的 NWBrowser 输出一致。

### MINOR-1: BonjourBrowser 没接入 ContentView / Settings
β 范围里只交付 discovery 类型。operator 还没法在 UI 里点"自动发现"按钮。
γ 阶段（或下一个 β 子段）需要在 SettingsView 加入口 + ContentView 启动时
首次发现尝试。
**Verdict**: MINOR — 这是有意拆分（β 范围声明），不是漏做。defer 到 UI 接入段。

### MINOR-2: 没有 Swift 单元测试
ios-native 项目下有 ClaudeWebTests/ 但 BonjourBrowser/VesselDiscovery 没加
测试用例。NWBrowser 难以单元测试（依赖真实网络），VesselDiscovery 可以
用 URLProtocol mock 写单元测试。
**Verdict**: MINOR — defer / Swift mock 框架学习成本不在本段。

### INFO: bundle id / 重命名风险被显式 defer
β 段保守不动 bundle id 是有意决定 —— 改 bundle id 会让现有 TestFlight
安装无法升级（必须重装），这是 γ 阶段 operator 切换 TestFlight 时一起做
的事。架构合理。

## 架构评估: PASS
- Apple 框架选型正确（Network.framework / NWBrowser / async/await）
- 类型设计清洁（DiscoveredVesselService / VesselHealth / VesselDiscoveryError）
- Eva path 0 影响（新文件 only）
- xcodegen 重生成 + simulator BUILD SUCCEEDED

## Verdict: PASS — 2 MINOR (deferred)
