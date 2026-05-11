# M2-iOS-β — Closeout Arbiter
Date: 2026-05-10-2230

## Aggregated findings matrix

| ID | 严重度 | Finding | 决策 |
|---|---|---|---|
| MINOR-arch-1 | MINOR | BonjourBrowser 没接入 UI | deferred/UI 接入段 |
| MINOR-arch-2 | MINOR | 没 Swift 单元测试 | deferred |
| MINOR-prag-1 | MINOR | BonjourInfo 全 Optional vs enum | accepted-as-is |
| MINOR-prag-2 | MINOR | 没 backendURL 写回 helper | deferred/UI 接入段 |
| MINOR-risk-1 | MINOR | scheme 校验 | deferred/UI 接入时 |
| MINOR-risk-2 | MINOR | host 解析 unknown default | accepted-as-is |
| MINOR-cursor-1 | MINOR | ClaudeWeb→Vessel 重命名 | deferred/γ |

7 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now.

## 跨 reviewer 一致性

- 4 reviewers 全部 PASS
- 无对立 verdict（不需 cross-pollinate phase 2）
- "保守路线"决策（不改 bundle id / 不大重命名）被 architect + pragmatist
  + cursor 三角认可
- "discovery 层与 UI 接入分开"决策被 architect + pragmatist 独立认可

## β 段范围验收

**β 段（我做完）**：
- ✅ BonjourBrowser.swift（NWBrowser + 手动 fallback 调用方决定）
- ✅ VesselDiscovery.swift（验证 vessel-core /api/vessel/health 协议）
- ✅ project.yml 加 NSBonjourServices = ["_vessel._tcp"]
- ✅ xcodegen 重生成 + xcodebuild iPhone 17 simulator BUILD SUCCEEDED
- ✅ Info.plist 验证 NSBonjourServices 落到 .app bundle
- ✅ Eva path 0 改动（BackendClient/ContentView/Settings 不动）

**γ 段（待 operator）**：
- iOS 端 UI 接入：在 SettingsView 加"自动发现"入口；启动时尝试 NWBrowser
- bundle id 改名 com.albertsun6.claudeweb-native → com.albertsun6.vessel
- ClaudeWeb→Vessel 仓库内重命名（git mv + project.yml 改 name + .pbxproj 重生成）
- 真机 TestFlight 部署（带新 bundle id）
- 端到端 voice round-trip ≤ 8 秒
- Mac 离线 graceful failure 验证

## Verdict: PASS
- 0 BLOCKER, 0 MAJOR
- 7 MINOR (全部 deferred/accepted-as-is)
- xcodebuild simulator BUILD SUCCEEDED ✅
- NSBonjourServices ["_vessel._tcp"] 落进 .app/Info.plist ✅
- Eva path 0 影响（β 完全增量加入）✅

M2-iOS-β 完成。iOS 端 Bonjour 服务发现 + Vessel 验证基础设施齐备。
γ 阶段（UI 接入 + bundle id 改名 + TestFlight + 真机）由 operator 主导。
Ready for Verify Gate.


lesson_id: 30e9e95d-f6df-40d3-b610-5b77930111a9
