# M2-iOS-β' — Closeout (vessel-pragmatist lens)
Date: 2026-05-10-2300

## Findings

### PASS: 用 sheet 而非新 NavigationLink page
sheet 一气呵成 — 弹出/关闭语义和"先选 Mac 再回设置"流程匹配。NavigationLink
会让 operator 进入再返回，多一层认知负担。

### PASS: 不重新发明状态机
ProbeState enum 4 状态（idle/probing/ok/failed）—— 最少够用。没引入
@Observable VM 类、没 Combine pipeline、没 Reducer 式架构。SwiftUI native。

### PASS: Section 文案中文 + 一致风格
"扫描局域网 Vessel" / "等待开始…" / "正在扫描局域网…" / "扫描完成，未发现服务" —
跟项目其他中文 UI 文案一致。"测试" / "选择" 两个动词清晰。

### PASS: 错误信息直接来自 VesselDiscoveryError.errorDescription
Network failure 下的中文错误信息（"未连接（超时）" / "返回 HTTP X，非
vessel-core" / "响应格式异常"）直接从 β 已经写好的 LocalizedError 里来。
β' UI 完全复用，没在 VesselDiscoveryView 里再造一遍中文。

### MINOR-1: 没自动 probe，operator 必须手动点每行"测试"
打开 sheet 后看到一堆 service，必须挨个点"测试"才知道是否真 vessel。
对 LAN 上有多个候选的 operator 可能繁琐。
**Why accepted**: 自动 probe 会同时打 N 个 health request；且 NWBrowser 在
ready 之前可能服务陆续到，自动 probe 时机不好把握。手动点击是最简洁路径。
**Verdict**: MINOR — accepted-as-is.

### MINOR-2: NSLocalizedString 没用，文案硬编码中文
苹果建议用 String(localized: "...") 或 NSLocalizedString 集中管理。Eva 项目
其他 view 也是硬编码中文 —— 跟现状一致。
**Verdict**: MINOR — defer / 整个项目国际化时一起做。

### INFO: probes 字典没清理
切换 sheet 重开时 @StateObject browser 重建，但 @State probes 字典只重置
为空（StateObject 重建本身重置 wrapped 值）。已正确。

## Verdict: PASS — 2 MINOR (accepted-as-is / deferred)
