# M2-iOS-α — Closeout (cursor cross-review lens)
Date: 2026-05-10-2200

## Cross-cutting concerns

### PASS: M2-iOS ROADMAP 验收 4 条 partial — α 段覆盖范围明确
ROADMAP M2-iOS 验收条目：
1. iOS app 启动后任一 NWBrowser 自动发现 OR 手填 IP 连接成功 → **β/γ 范围**（iOS 端实现 + 真机）
2. iPhone 真机录 5 秒上传 → 端到端 ≤ 8 秒 → **β/γ 范围**（依赖 iOS 端 + 真机）
3. Mac vessel-core 离线时 iOS app 显示"未连接"且不崩溃 → **β/γ 范围**
4. iOS bundle id 已改名 + TestFlight 验证 → **β/γ 范围**

α 段不直接满足 ROADMAP 验收，但解锁所有 4 条：iOS 客户端必须能 NWBrowse
到 service（α 提供 _vessel._tcp 广播）+ 通过 health probe 区分 vessel 实例
（α 提供无 auth /health endpoint）。验收条目最终签收在 γ 阶段。

### PASS: 拆段决策有先例
M1C 在 plan 里就已拆为 M1C-A（必做）+ M1C-B（spike 通过才做）。M2-iOS
拆 α/β/γ 同样合理：α 自动可验证 → β 我能写 Swift 但 operator 必须编译
→ γ 必须 operator 真机。每段单独 closeout。

### PASS: Eva 路径不受影响
/api/health 路径仍是 Eva healthRouter（原 /api/health/full、/api/health/heartbeat）。
新增的 /api/vessel/health 在 vessel namespace 下，不与 Eva /api/health 串
联。回归 vessel-http / vessel-ws / coding-driver / lessons / workflow / soul
全部通过。

### PASS: 删除 dataDir 泄漏属于"顺手修 bug"
M1A-α 当时的 /health 实现把 DATA_DIR 绝对路径返回 — 是意外保留的内部诊
断字段。现在合并 endpoint 时一并修复。**这种"顺手修边界条件 bug"在
review 里值得肯定**（pragmatist 第 9 原则）。

### PASS: TypeScript strict 干净
0 tsc errors. publisher 的 spec 类型 + getPublishedSpec readonly 返回 +
SoulParseError 类型守卫都到位。

### Finding 矩阵汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | _vessel._tcp 未走 IANA 正式注册 | defer/v0.5 release |
| MINOR-arch-2 | MINOR | architect | hostname 漂移破坏 instance 持久标识 | defer/iOS-β 真实痛点 |
| MINOR-arch-3 | MINOR | architect | VESSEL_DISABLE_MDNS=1 没文档 | defer/docs |
| MINOR-prag-1 | MINOR | pragmatist | dns-sd 命令路径无 env 覆盖（DNS_SD_BIN） | defer |
| MINOR-prag-2 | MINOR | pragmatist | shutdown grace 1500ms 魔数 | accepted-as-is |
| MINOR-risk-1 | MINOR | risk | hostname 经 mDNS + /health 双重曝光 | defer/文档 |
| MINOR-risk-2 | MINOR | risk | instanceName 派生无长度上限 | accepted-as-is |

7 MINOR, 0 MAJOR, 0 BLOCKER. 全部 deferred / accepted-as-is. 无 fix-now.

## Verdict: PASS
