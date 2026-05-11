# M2-iOS-β' — Closeout (cursor cross-review lens)
Date: 2026-05-10-2300

## Cross-cutting concerns

### PASS: β / β' 拆分给 operator 提供了"先看再上 TestFlight"的台阶
β 段：底层 + Info.plist，但没 UI（operator 装新 build 看不到任何变化）。
β' 段：UI 接入，operator 装新 build 能在 Settings 里点"自动发现"看效果。
β / β' 一起完成后，operator **不需要改 bundle id 也能在自己的设备上验证整
个 NWBrowser 流程**（前提：装的是 simulator 或同 Apple ID 真机能装当前
bundle id 的 dev build）。

这种"装包 → simulator 测 → 准备好后再上 TestFlight"流程比直接跳到 γ 改
bundle id + 真机 + TestFlight 的"全押注"路径更稳。

### PASS: 没回到"破坏 Eva path"的诱惑
sheet 选定 url 写入 settings.backendURL —— 用既有 onChange 路径触发
BackendClient 重连。BackendClient 0 改动。Eva 用户用 Tailscale URL 不切
"自动发现"完全不受影响。

### PASS: simulator BUILD SUCCEEDED 全栈验证
- xcodegen 重生成 .xcodeproj 包含新 VesselDiscoveryView.swift
- xcodebuild 编译 4 个相关文件（BonjourBrowser / VesselDiscovery /
  VesselDiscoveryView / SettingsView）+ 链接 + sign + validate → SUCCESS
- SwiftUI sheet + onAppear/onDisappear 时序按 Apple 标准 lifecycle

### MINOR-1: 缺一个 Preview macro
SwiftUI #Preview 块能让 operator 在 Xcode canvas 实时看 UI 设计，β' 没加。
不影响运行，影响开发体验。
**Verdict**: MINOR — defer.

### Finding 矩阵汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | 选择后无"撤回"路径 | accepted-as-is |
| MINOR-arch-2 | MINOR | architect | sheet 不响应 backendURL 外部变化 | accepted-as-is |
| MINOR-prag-1 | MINOR | pragmatist | 自动 probe 缺失，必须手动点测试 | accepted-as-is |
| MINOR-prag-2 | MINOR | pragmatist | 文案硬编码中文（i18n） | defer |
| MINOR-risk-1 | MINOR | risk | 假阳性 spoofed displayName | accepted-as-is（威胁模型外） |
| MINOR-risk-2 | MINOR | risk | onSelect → dismiss 隐式时序 | accepted-as-is |
| MINOR-cursor-1 | MINOR | cursor | 缺 #Preview macro | defer |

7 MINOR, 0 MAJOR, 0 BLOCKER. 全部 accepted-as-is / deferred. 无 fix-now.

## Verdict: PASS
