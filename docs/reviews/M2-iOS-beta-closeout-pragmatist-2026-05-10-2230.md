# M2-iOS-β — Closeout (vessel-pragmatist lens)
Date: 2026-05-10-2230

## Findings

### PASS: 范围克制到极致
- BonjourBrowser.swift ~140 行
- VesselDiscovery.swift ~80 行
- project.yml +6 行（NSBonjourServices）
- 0 新依赖
- 0 测试代码（Swift 测试比 Node 测试 setup 重，且 NWBrowser 难单测，主动
  跳过比加 mock infra 务实）

总量 ~220 行 + 1 个 plist 字段。最小可达"iOS 端能 NWBrowser + 验证
是 vessel"的工作量。

### PASS: 不改既有结构
没碰 BackendClient.swift / ContentView.swift / Settings.swift。Bonjour
功能完全独立。如果 operator 后期决定不要这个功能，git revert 干净。

### PASS: 错误信息中文友好
VesselDiscoveryError.errorDescription 用中文（"未连接（超时）" / "返回
HTTP X，非 vessel-core" / "响应格式异常：..." / "网络错误：..."）。Eva
项目本来就是中文 UI，operator 给真机用户看时不需要再翻译。

### PASS: 保守的 bundle id 决策
不改 bundle id 是对的 —— 改 bundle id 会让 TestFlight 现有装机变成"两个
不同的 app"，不能升级，必须重装。M2-iOS γ 阶段 operator 自己决定何时改
（可能配合 TestFlight 重新发版做）。

### MINOR-1: VesselHealth.BonjourInfo 字段全 Optional
backend response 里 `bonjour: {published: true, instanceName, port, type}`
或 `bonjour: {published: false}`。Swift Codable 把所有字段标 Optional 是
最安全但失去类型表达力。能用 `enum BonjourInfo` 区分 published / not 更
精准。
**Verdict**: MINOR — accepted-as-is. Swift Codable 写 enum decode 代码量
比当前实现多 3 倍，YAGNI defer。

### MINOR-2: 没有 backendURL 写回的 UI helper
discovery 拿到 host:port 后，没人把它写回 Settings.backendURL —— operator
后期接入 UI 时会发现"VesselDiscovery 给我返回 health，但 BackendClient
仍然连 saved URL"。这是 β 范围之外的 UI 接入工作。
**Verdict**: MINOR — defer / β 不做 UI 接入声明里有提到。

### INFO: build_sim 不在 scripts/ 但 deploy.sh 内嵌了 build 逻辑
β 验证用 xcodebuild 直接命令，没用 deploy.sh 的"完整 install + launch"
路径 —— 后者超出 β 范围（β 不需要 launch app）。

## Verdict: PASS — 2 MINOR (accepted-as-is / deferred)
