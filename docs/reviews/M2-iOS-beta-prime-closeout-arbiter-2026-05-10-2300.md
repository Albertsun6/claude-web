# M2-iOS-β' — Closeout Arbiter
Date: 2026-05-10-2300

## Aggregated findings matrix

| ID | 严重度 | Finding | 决策 |
|---|---|---|---|
| MINOR-arch-1 | MINOR | 选择后无"撤回"路径 | accepted-as-is |
| MINOR-arch-2 | MINOR | sheet 不响应 backendURL 外部变化 | accepted-as-is |
| MINOR-prag-1 | MINOR | 自动 probe 缺失，必须手动点测试 | accepted-as-is |
| MINOR-prag-2 | MINOR | 文案硬编码中文（i18n） | deferred |
| MINOR-risk-1 | MINOR | 假阳性 spoofed displayName | accepted-as-is（威胁模型外） |
| MINOR-risk-2 | MINOR | onSelect → dismiss 隐式时序 | accepted-as-is |
| MINOR-cursor-1 | MINOR | 缺 #Preview macro | deferred |

7 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now.

## 跨 reviewer 一致性

- 4 reviewers 全部 PASS
- 无对立 verdict（不需 cross-pollinate phase 2）
- 用 sheet 而非 NavigationLink 的决策 architect + pragmatist 双重认可
- "选择"按钮直接写 settings.backendURL 而不引入 confirmation 中间态 architect
  + risk + pragmatist 三角认可

## β' 段范围验收

**β' 段（我做完）**：
- ✅ Views/Settings/VesselDiscoveryView.swift — sheet UI（idle/probing/ok/failed
  四态机；浏览结果列表 + 测试按钮 + 选择按钮 + 中文错误信息）
- ✅ SettingsView.swift — Backend section 加"自动发现局域网 Vessel"按钮 +
  showDiscoverySheet @State + sheet modifier（onSelect 写回 settings.backendURL）
- ✅ xcodegen 重生成 + iPhone 17 simulator BUILD SUCCEEDED
- ✅ Eva path 0 影响（BackendClient/ContentView 不动；onChange 路径既有）

**剩下 γ 段（operator）**：
- bundle id 改名 com.albertsun6.claudeweb-native → com.albertsun6.vessel
- ClaudeWeb→Vessel 仓库重命名（git mv + project.yml name + xcodegen）
- TestFlight 上传新 build
- 真机 e2e：录 5 秒 → ≤ 8 秒
- Mac 离线 graceful failure 验证

## Verdict: PASS
- 0 BLOCKER, 0 MAJOR
- 7 MINOR (全部 deferred/accepted-as-is)
- xcodebuild simulator BUILD SUCCEEDED ✅
- 编译时刻 .app 含 SettingsView + VesselDiscoveryView + 既有 BonjourBrowser/
  VesselDiscovery 链路 ✅
- Eva path 0 影响 ✅

M2-iOS-β' 完成。Operator 装新 simulator build / 同 bundle id 真机 dev build
能立刻看到设置页"自动发现局域网 Vessel"按钮 → 点开 sheet → 见 _vessel._tcp
广播 → 测试 → 选择 → backend 自动重连。
γ 段（bundle id 改名 + TestFlight + 真机）继续由 operator 主导。

Ready for Verify Gate.


lesson_id: 5e3075b9-d49d-4d1b-948b-08dbd9c5e910
