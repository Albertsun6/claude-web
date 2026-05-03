# Proposal — M0 第二契约：permissionModes server-driven + minor bump 真测

> **状态**：v1.1 修订版（2026-05-03，已吸收 phase 1+2 评审 13 项 finding 全 ✅）。M0 mini-milestone B。
>
> **触发**：M0 modelList Round 已完工。permissionModes 是最小增量（同 modelList 模式），**关键价值**是顺便验证 protocolVersion v1.0 → v1.1 minor bump + 老 client graceful skip。
>
> **关联**：[modelList RFC v1.1](M0_HARNESS_CONFIG_MODELLIST.md)（同源） · [ADR-0011](../adr/ADR-0011-server-driven-thin-shell.md) · [ADR-0015 minor bump 规则](../adr/ADR-0015-schema-migration.md)
>
> **评审**：v2 三层 PASS — phase 3 矩阵 13 项 finding 全 ✅ 收敛见 [HARNESS_REVIEW_LOG.md](../HARNESS_REVIEW_LOG.md)。

---

## 0. 目标

把 iOS Settings 「权限模式」段从硬编码 4 项迁到 server-driven，**并在过程中真实验证 ADR-0015 minor bump 流程**：

- backend 升 protocolVersion `"1.0"` → `"1.1"`，加 `permissionModes` 字段
- minClientVersion 仍 `"1.0"`（minor bump 不阻塞老 client）
- **已装机 build 31（v1.0 schema） 必须 graceful skip 新字段不崩**
- build 32 真机部署后 Settings 用 server-driven 4 项

退出条件（M0 全局子集）：
- shared `HarnessConfigSchema` 加 `permissionModes` + 全局 superRefine isDefault exactly-one 扩展
- backend `fallback-config.json` 加 4 项 + protocolVersion bump 1.1
- iOS Codable + Settings 接 server permissionModes
- **build 31 graceful skip 真验证（不重装手机，直接 backend 升级 → 看 telemetry）**
- build 32 装机 + Settings 显示 server 4 项 + telemetry 验证

---

## 1. PermissionModeItem schema

```ts
// PermissionModeId 三端同步约束（phase 3 arch MINOR-3 + cross agree）：
// 必须与下列三处保持一致，改一处必须同步全部：
// - packages/shared/src/protocol.ts ClientMessage.permissionMode 字面值
// - packages/shared/src/harness-protocol.ts PermissionModeIdSchema enum
// - packages/backend/scripts/permission-hook.mjs / cli-runner.ts 实际处理 permissionMode
export const PermissionModeIdSchema = z.enum([
  "default", "acceptEdits", "bypassPermissions", "plan",
]);

export const PermissionModeItemSchema = z.object({
  id: PermissionModeIdSchema,
  displayName: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean(),                                  // exactly-one constraint at HarnessConfig level
  riskLevel: z.string().optional(),                         // hint-only string, UI 不分支 (phase 3 arch MAJOR-2 修复 + cross self-withdraw enum 建议)
                                                            // 与 modelList recommendedFor "枚举锁定权属于契约字段" 共识对称
                                                            // 推荐值: "low" / "medium" / "high"; 未知值 UI 默认色 + telemetry warn
});
```

**初始 4 项**（`fallback-config.json` 加段；phase 3 arch react N1 + cross m2 修复：displayName 短名 + description 拆 + riskLevel 表达风险）：

```json
[
  { "id": "plan",              "displayName": "Plan",         "description": "只读规划，最安全 — agent 只能 read/grep，不会改文件",          "isDefault": false, "riskLevel": "low"    },
  { "id": "default",           "displayName": "Default",      "description": "默认行为，每个 tool call 弹权限弹窗",                          "isDefault": true,  "riskLevel": "low"    },
  { "id": "acceptEdits",       "displayName": "Accept Edits", "description": "自动允许 Edit/Write；代码改动不再问但 Bash 仍弹窗",          "isDefault": false, "riskLevel": "medium" },
  { "id": "bypassPermissions", "displayName": "Bypass",       "description": "全自动，最危险 — agent 跑任何工具都不弹窗，仅用于受信工作流", "isDefault": false, "riskLevel": "high"   }
]
```

**与 modelList 一致约束**：HarnessConfigSchema 全局 superRefine 加 `permissionModes.filter(p => p.isDefault).length === 1`。

**Invariant 注**（phase 3 cross m1 + arch refine）：
- **M0 没有 enabled 字段**，因此 `isDefault` exactly-one 是对**所有项**的约束
- **未来加 enabled 字段时**（minor bump），superRefine 必须同步改为 `isDefault && enabled` exactly-one——否则静默放过 0-default 配置。这条约束写到 [ADR-0015](../adr/ADR-0015-schema-migration.md) footnote 防遗漏

---

## 2. HarnessConfig schema 更新（minor bump）

```ts
export const HarnessConfigSchema = z
  .object({
    protocolVersion: z.string(),                           // "1.0" → "1.1"
    minClientVersion: z.string(),                          // 仍 "1.0"（v1.0 client graceful skip）
    etag: z.string(),
    modelList: z.array(ModelListItemSchema),
    permissionModes: z.array(PermissionModeItemSchema),    // NEW (minor bump)
  })
  .superRefine((cfg, ctx) => {
    // existing modelList isDefault check
    const enabledModels = cfg.modelList.filter(m => m.isDefault && m.enabled);
    if (enabledModels.length !== 1) ctx.addIssue({...});

    // NEW; phase 3 cross m1 + arch refine: 当前对所有 permissionModes 检查
    // 因为 M0 无 enabled 字段。未来加 enabled 字段时必须改为 isDefault && enabled
    // exactly-one (ADR-0015 footnote 标记此约束)
    const defaultModes = cfg.permissionModes.filter(p => p.isDefault);
    if (defaultModes.length !== 1) ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `permissionModes must have exactly 1 isDefault, got ${defaultModes.length}`,
      path: ["permissionModes"],
    });
  });
```

---

## 3. Minor bump 真验证（本提案最大价值）

### 3.1 验证矩阵（phase 3 arch MAJOR-1 修复：每行都有可执行入口）

| # | Client schema | Server payload | 期望 | 执行步骤 | Acceptance |
|---|---|---|---|---|---|
| 1 | **v1.0 build 31（已装机，未升级）** | v1.0（modelList only） | ✅ 正常 | (已 ship M0 modelList Round) | telemetry `harness_store.refetch.updated` etag=sha256:50b7b96d models=3 |
| 2 | **v1.0 build 31** | **v1.1（含 permissionModes）** | ✅ **graceful skip 新字段不崩** | backend 升 fallback-config.json + permissionModes → tsx watch 重启 → 已装机 build 31 WSReconnect | telemetry `harness_store.refetch.updated` props 含 `protocolVersion="1.1" etag=新值 modelCount=3 buildVersion="31"` |
| 3 | **v1.1 build 32（新装）** | v1.1 | ✅ 全功能 | xcodebuild + deploy.sh → build 32 启动 | telemetry props 含 `protocolVersion="1.1" buildVersion="32"` + Settings 显示 server-driven 4 modes |
| 4 | v1.1 build 32 | v1.0（backend 回滚或临时配置）| ✅ Codable 可选字段缺省 fallback bundle | backend 临时改 fallback-config 删 permissionModes → tsx watch 重启 → build 32 WSReconnect | iOS optional decode 成功（permissionModes=nil）→ HarnessStore `permissionModes ?? bundleFallback().permissionModes` → Settings 仍显 4 项（来自 Bundle）+ telemetry warn `harness_store.partial_payload` |

### 3.2 测试方法

**不重装 build 31**（验证 row 2）：
1. backend 升 fallback-config.json → protocolVersion "1.1" + 加 permissionModes
2. tsx watch 重启 → 新 etag
3. 已装机 build 31 重连 → GET /api/harness/config → 收到 v1.1 payload
4. **iOS Swift Codable 行为**（phase 3 arch MAJOR-3 + cross agree 修复）：
   - `HarnessConfig` v1.0 schema 没有 `permissionModes` 字段
   - **Apple Swift `Decodable` 协议合成 init(from:) 默认 ignore unknown JSON keys**（不是 iOS 17 特有，是 Swift 语言层面合约）→ graceful skip
   - 真风险是：作者**手动加自定义 init(from:) 时如果用 `container.allKeys` 校验，会反向破坏默认 graceful skip 行为**
   - decode 成功 → telemetry `harness_store.refetch.updated` 触发 + 新 etag + 含 protocolVersion="1.1"
   - Settings 模型列表仍正常显示（permissionModes 字段 build 31 不识别）
5. 验证证据：telemetry props 至少含 `protocolVersion="1.1"` + `etag=<新>` + `modelCount=3` + `buildVersion="31"`（phase 3 cross m3 + arch react agree）

**前置条件**（phase 3 arch MINOR-4 + cross m4 修复）：
- build 31 仍是 iPhone 上的 live install（未被 build 32 覆盖）。验证步骤前检查 `xcrun devicectl device info processes` 确认 ClaudeWeb 进程跑的是 build 31

**Zod 端在 backend**：backend 的 v1.0 → v1.1 都用最新 schema，不存在"老 backend 收到新 client"。

### 3.3 失败兜底

如发现 build 31 真崩了：
- 立刻 backend 回滚 protocolVersion 1.1 → 1.0 + 删 permissionModes
- 排查 author 是否给 HarnessConfig 加了自定义 init(from:) 用 allKeys 校验（phase 3 arch MAJOR-3 修复点）
- 加 ADR：minor bump 必须验证老 client graceful（M0/M1 expand 时每次都验）

---

## 4. iOS 端

### 4.1 HarnessProtocol.swift 加 Codable

```swift
struct PermissionModeItem: Codable, Equatable {
    let id: String                           // "default" / "acceptEdits" / etc
    let displayName: String
    let description: String?
    let isDefault: Bool
    let riskLevel: String?                   // 推荐 "low"/"medium"/"high"; 未知值默认色 + telemetry warn
}

struct HarnessConfig: Codable, Equatable {
    let protocolVersion: String
    let minClientVersion: String
    let etag: String
    let modelList: [ModelListItem]
    // NEW. **Optional 不是 required**（phase 3 BLOCKER 修复）：
    // 双向 minor bump 兼容——v1.1 build 32 + v1.0 server payload 时 nil → bundle fallback
    let permissionModes: [PermissionModeItem]?
}
```

**为什么 optional 而不是 required**（phase 3 BLOCKER 修复关键决策）：
- Required 会破坏 ADR-0015 minor bump 的**双向 additive 兼容**（永久兼容性质）
- 若 backend 临时回滚 v1.1 → v1.0（删字段），新 build 32 会 `keyNotFound` decode 失败 → 灰度回滚不可行
- HarnessStore 在 store 层用 `cfg.permissionModes ?? bundleFallback().permissionModes!`（bundle fallback 永远有 permissionModes，guaranteed by drift 单测），UI 永远拿到非空数组

**警告**：**不要给 HarnessConfig 加自定义 `init(from decoder:)` + `container.allKeys` 校验**——这会反向破坏 Apple Swift Decodable 默认的 ignore unknown keys 行为。phase 3 arch MAJOR-3 修复明确：默认合成 init(from:) 是 graceful skip 的来源，自定义 init 必须谨慎。

### 4.2 Settings.swift 接 permissionModes

当前 SettingsView 「权限模式」段是硬编码：
```swift
Picker("权限模式", selection: $draftMode) {
    Text("Plan（只读规划，最安全）").tag("plan")
    Text("Default（每次工具问允许 / 拒绝）").tag("default")
    Text("Accept Edits（自动允许 Edit/Write）").tag("acceptEdits")
    Text("Bypass（全自动，最危险）").tag("bypassPermissions")
}
```

改为读 `harnessStore.config.permissionModes ?? harnessStore.bundleFallback().permissionModes!`（store 层兜底 nil 见 §4.1），按 `displayName` 渲染 + `riskLevel` 着色：
- `"low"` → 默认色
- `"medium"` → 黄色 hint
- `"high"` → 红色 hint
- 其他（包括 nil 或未来 server 加 "critical" 等未知值）→ **默认色 + telemetry warn `harness_store.unknown_risk_level`**（phase 3 cross M2 修复）

**Cutover**（与 modelList 一致）：用户已选 mode 仍存在 → 保留；否则切 server isDefault。

---

## 5. 实施步骤（phase 3 修订后；删除时间估算 phase 3 arch MINOR-2 + cross refine 修复——尊重 user no-time-estimates 偏好）

| # | 动作 | 文件 |
|---|---|---|
| 1 | shared/harness-protocol.ts 加 PermissionModeIdSchema + PermissionModeItemSchema (riskLevel z.string().optional()) + HarnessConfig 加 permissionModes 字段 (Zod array, 但 Swift 端 optional) + 扩展 superRefine | shared |
| 2 | shared/fixtures/harness/fallback-config.json 加 permissionModes 4 项 (短 displayName + 长 description + riskLevel) + protocolVersion "1.1" | data |
| 3 | shared 测试 m0-permission-modes.test.ts: 4 项 round-trip + isDefault exactly-one + minor bump v1.0 schema 解析 v1.1 payload graceful skip + 未知 riskLevel 不崩 + drift 单测 (fallback parses + isDefault exactly-one + 与 ClientMessage.permissionMode 字符串等价) | shared |
| 4 | backend tsx watch 自动捡起 → curl /api/harness/config 验证 protocolVersion "1.1" + 新 etag + 含 permissionModes 4 项 | manual |
| 5 | **真机 build 31 minor bump 验证（不重装）**：前置确认 build 31 仍是 live install (xcrun devicectl) → watch telemetry `harness_store.refetch.updated` props 含 `protocolVersion="1.1" etag=新值 modelCount=3 buildVersion="31"` → 不崩 (phase 3 cross m3+m4 + arch MINOR-4 合并修复) | manual |
| 6 | iOS HarnessProtocol.swift 加 PermissionModeItem Codable + HarnessConfig 加 `permissionModes: [PermissionModeItem]?` optional (phase 3 BLOCKER 修复关键) | iOS |
| 7 | iOS HarnessStore.swift 加 cfg.permissionModes ?? bundleFallback().permissionModes! 兜底 + 未知 riskLevel telemetry warn | iOS |
| 8 | iOS Settings.swift 改硬编码 4 Picker → 读 harnessStore.config.permissionModes + cutover 行为 + riskLevel 着色 (low/medium/high) | iOS |
| 9 | xcodegen + xcodebuild build 32 sim install + sim 验证 row 3 + 模拟 row 4 (backend 临时回滚删 permissionModes → build 32 graceful → telemetry warn `partial_payload`) | iOS + manual |
| 10 | deploy.sh 真机 build 32 → telemetry 验证 props (protocolVersion="1.1" buildVersion="32") + Settings 4 项 server-driven | manual |
| 11 | **ADR sync** (phase 3 arch MINOR-1 + cross M3 合并 + arch react N1 displayName 总则)：(a) ADR-0011 fallback 行为 bullet 删 `config_changed` wording 改 "WS reconnect 携带 If-None-Match"；(b) ADR-0011 加 §"server-driven displayName 治理总则"；(c) ADR-0015 footnote 加 "permissionModes.enabled 字段加入时为 minor bump，但 superRefine 语义需同时改" | docs |
| 12 | retrospective + commit + push + 双通道通知 | docs + commit |

---

## 6. 验收

### 6.1 自动化测试
- [ ] vitest 全绿（含 permissionModes round-trip + isDefault exactly-one + minor bump graceful 解析 + drift 单测 + 未知 riskLevel）
- [ ] backend curl 返回 protocolVersion "1.1" + 新 etag + 含 permissionModes 4 项

### 6.2 真机 build 31 minor bump graceful skip（关键，phase 3 cross m3+m4 + arch MINOR-4 修复后版）
**前置**：xcrun devicectl 确认 build 31 进程仍是 ClaudeWeb live install (未被覆盖)
- [ ] backend 升 v1.1 后，build 31 telemetry `harness_store.refetch.updated` 触发
- [ ] telemetry props **必须含**：`protocolVersion="1.1"` + `etag=<新值>` + `modelCount=3` + `buildVersion="31"`（仅 etag/models 不够，要 protocolVersion 才能证明吃到 v1.1 payload）
- [ ] iPhone Settings 仍正常显示 3 模型 + 权限模式仍硬编码 4 项 (build 31 v1.0 schema 不识别 server permissionModes)
- [ ] 不出现 decode failure / crash logs

### 6.3 build 32 真机部署后
- [ ] Settings 「权限模式」从 server 读 4 项（短 displayName + description + riskLevel 着色）
- [ ] 已选 mode 不漂移（cutover 行为）
- [ ] telemetry props 含 `buildVersion="32"` + `protocolVersion="1.1"`
- [ ] **outbound WS 验证**（phase 3 cross m4）：选 plan / bypassPermissions 各发一次 prompt → 抓帧验证 `ClientMessage.permissionMode` 字段值 == config item.id

### 6.4 验证矩阵 row 4（phase 3 arch MAJOR-1 修复必跑）
- [ ] backend 临时改 fallback-config 删 permissionModes 字段 → tsx watch 重启 → build 32 WSReconnect
- [ ] iOS optional decode 成功 (permissionModes=nil) → store 层兜底 bundle fallback
- [ ] Settings 仍显示 4 项 (来自 Bundle resource，不是 server)
- [ ] telemetry warn `harness_store.partial_payload` 触发

### 6.5 v2 Review Mechanism
- [x] phase 1 双 reviewer (arch 1B+3M+4m / cross 0B+3M+4m)
- [x] phase 2 cross-pollinate (cross 8 agree+3 refine+3 self-rev / arch 4 agree+1 disagree+2 refine+1 new finding)
- [x] phase 3 收敛 13 项 finding 全 ✅ (0 still-disagree, 1 轮收敛)
- [ ] 用户拍板

---

## 7. 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| Swift Codable 收到未知字段 strict 模式 → decode 失败 → build 31 崩 | 中 | iOS 17 默认 ignoreUnknownKeys；如失败立刻 backend 回滚 + 加 .passthrough() / Codable 自定义 init(from:) graceful skip |
| permissionModes isDefault exactly-one 与 fallback-config 配置冲突 | 低 | superRefine 单测 + fixture 显式 default="default" |
| protocolVersion "1.1" → "1.0" client 触发误升级提示 | 低 | minClientVersion 仍 "1.0"，clients 1.0 通过；compareVersion("1.0", "1.0") = 0 |
| iOS 收到 v1.1 后 cache 写到 Application Support，build 31 关闭 / 重启读 cache 时仍带未知字段 → decode | 低 | Cache.swift load 时 try JSONDecoder().decode 失败兜底 nil → 走 Bundle fallback |

---

## 8. Open Questions

- **OQ-A**：build 31 graceful skip 是否需要 build 31 端写测试？
  - **作者倾向 否**：iOS Codable 默认 ignoreUnknownKeys，行为是 Apple 默认；不需要改 build 31 代码（不重装）。**真测就靠 telemetry**
- **OQ-B**：riskLevel 是否锁 enum？
  - **作者倾向 锁 enum**："low" / "medium" / "high" 三档够用；UI 直接 switch case 渲染颜色
- **OQ-C**：HarnessConfig.permissionModes 缺失（v1.0 schema 兼容回滚）时 iOS 兜底？
  - **作者倾向**：Swift Codable 字段写非 optional → decode 失败 → 兜底 Bundle fallback。这是 `permissionModes` field **non-optional** 的合理代价
  - 若想保险：写 optional `[PermissionModeItem]?`，但需要在 build 31 升级之前 backend 不能去除该字段（约束写到 ADR-0015）

---

## 9. 不在范围

- agentProfiles（M0 后续 mini-milestone C）
- decisionForms / methodologyTemplates / promptTemplates / featureFlags / copy / healthChecks
- WS push `harness_event { kind: "config_changed" }`（M0.5+）
