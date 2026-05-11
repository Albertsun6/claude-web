# M2-iOS-α — Closeout Arbiter
Date: 2026-05-10-2200

## Aggregated findings matrix

| ID | 严重度 | Finding | 决策 |
|---|---|---|---|
| MINOR-arch-1 | MINOR | _vessel._tcp IANA 正式注册 | deferred/v0.5 release |
| MINOR-arch-2 | MINOR | hostname 漂移破坏 instance 持久标识 | deferred/iOS-β |
| MINOR-arch-3 | MINOR | VESSEL_DISABLE_MDNS=1 无文档 | deferred/docs |
| MINOR-prag-1 | MINOR | DNS_SD_BIN env 覆盖 | deferred |
| MINOR-prag-2 | MINOR | shutdown grace 1500ms 魔数 | accepted-as-is |
| MINOR-risk-1 | MINOR | hostname 经 mDNS + /health 双重曝光 | deferred/docs |
| MINOR-risk-2 | MINOR | instanceName 派生无长度上限 | accepted-as-is |

7 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now.

## 跨 reviewer 一致性

- 4 reviewers 全部 PASS
- 无对立 verdict（不需 cross-pollinate phase 2）
- 关键决策"端点合并 vs 新加路由"由 architect + pragmatist + cursor 三角验证
- dataDir 泄漏修复被 risk + cursor 独立认可
- 拆段决策（α/β/γ）被 cursor 独立检查与 plan ROADMAP 对应

## M2-iOS-α 范围验收

**α 段（自动可验证 — 我做的部分）**:
- ✅ mDNS 广播 _vessel._tcp（dns-sd 子进程，零依赖，含 lifecycle）
- ✅ /api/vessel/health 升级（service identity，删 dataDir 泄漏）
- ✅ 22/22 集成测试（含真实 dns-sd browse 验证）
- ✅ 回归全过（soul/m1bplus/m1b/workflow/lessons/coding/vessel-http/vessel-ws）
- ✅ Eva 路径 0 影响

**β 段（待 operator）**:
- iOS Swift NWBrowser 实现
- bundle id 改名 com.albertsun6.claudeweb-native → com.albertsun6.vessel
- project.yml ClaudeWeb → Vessel 重命名

**γ 段（待 operator）**:
- 真机 TestFlight 验证
- 端到端 voice round-trip ≤ 8 秒
- Mac 离线 iOS graceful failure 验证

## Verdict: PASS
- 0 BLOCKER, 0 MAJOR
- 7 MINOR (全部 deferred/accepted-as-is)
- tsc clean ✅
- 22/22 m2-ios-alpha 测试 ✅
- 回归全过 ✅
- Eva 路径 0 影响 ✅

M2-iOS-α 完成。Mac 后端服务发现接通；iOS-β 启动条件齐备。
Ready for Verify Gate.


lesson_id: 290e1d7e-40f4-4609-bcf0-ab1ba721b831
