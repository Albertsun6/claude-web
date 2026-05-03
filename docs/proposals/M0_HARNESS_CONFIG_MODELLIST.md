# Proposal — M0 第一契约：`/api/harness/config` payload + modelList 试点

> **状态**：v1.1 修订版（2026-05-03，已吸收 phase 1+2 评审 18 项 finding）。M0 第一个 server-driven config 端点，modelList 试点验证 hot-reload chain。
>
> **触发**：M-1 退出条件全部满足 + Review Mechanism v2 ship 完毕，进 M0 第一 mini-milestone。
>
> **关联**：[ADR-0011 server-driven thin-shell](../adr/ADR-0011-server-driven-thin-shell.md)（M0 实施完同步改 Decision #1 + #3 后再升级 Accepted） · [HARNESS_PROTOCOL.md](../HARNESS_PROTOCOL.md) · [HARNESS_ROADMAP.md §3.1 / §6 M0](../HARNESS_ROADMAP.md)
>
> **评审**：本提案是 v2 Review Mechanism 第一个真实用例（dogfood self-validation 之外），全程走三层流程（phase 1 + phase 2 + phase 3）。phase 3 矩阵 18 项 finding 见 [HARNESS_REVIEW_LOG.md M0 modelList Round](../HARNESS_REVIEW_LOG.md)。

---

## 0. 目标

M0 第一 endpoint：`GET /api/harness/config` 返回 server-driven 配置。**仅 modelList 一项**，是 hot-reload chain 的最小可验证试点。

退出条件（**本 mini-milestone 退出条件，是 [HARNESS_ROADMAP M0 全局退出条件](../HARNESS_ROADMAP.md) 的子集**——phase 3 修复 arch MINOR-1 + cross B1 配套）：
- `pnpm --filter @claude-web/shared test` 含 modelList round-trip 测试通过
- iOS 装新版后老聊天功能零回归
- 后端改 modelList → 重启 → **WS 重连后 iOS 立即 GET config**（带 If-None-Match）→ iOS 不重装能看到新列表（**phase 3 cross B1 + arch MAJOR-1 收敛：M0 不实施 `harness_event { kind: "config_changed" }` push，靠 backend tsx watch 重启 + iOS WS 重连 + ETag 304 / 200 流程兜底；真 push 推到 M0.5**）
- 离线时 iOS 用打包内 fallback modelList，UI 显示"未连接"占位但不崩
- minClientVersion 检测在 dev 环境跑通（payload 含字段，行为是当前 1.0 全通过）

---

## 1. 协议契约（packages/shared/src/harness-protocol.ts 扩展）

### 1.1 ModelListItem schema

```ts
export const ModelListItemSchema = z.object({
  id: z.string(),                       // 稳定 ID, e.g. "claude-opus-4-7"
  displayName: z.string(),              // 用户可读, e.g. "Opus 4.7"
  description: z.string().optional(),   // 简短描述, e.g. "复杂推理 / 架构 / 评审"
  capabilities: z.object({
    supportsThinking: z.boolean(),      // 是否支持思维链显示
    supportsLongContext: z.boolean(),   // 是否 1M+ 上下文
    contextWindow: z.number().int().positive(),  // 200000 | 1000000
  }),
  recommendedFor: z.array(z.string()),  // ["architecture","review","fast-chat"]; hint-only, iOS UI 不分支, 未知值 graceful skip (phase 3 arch MAJOR-3 + cross refine)
  isDefault: z.boolean(),               // exactly one item should be true (HarnessConfigSchema 全局 superRefine, 见 §1.2)
  enabled: z.boolean(),                 // false → UI 隐藏；当前 selection 已 disabled 则保留 + "已停用" 标签 + 切走后不可再选 (phase 3 cross m1 + arch MAJOR-4(3))
});
export type ModelListItem = z.infer<typeof ModelListItemSchema>;
```

**字段语义**：
- `id` 稳定不变，**opaque stable string，推荐 `<type>-<ULID>`，不强制 UUIDv4**（与 [HARNESS_PROTOCOL §8 ID 格式契约](../HARNESS_PROTOCOL.md) 一致；phase 3 cross M2 + arch react agree：同步修 HARNESS_PROTOCOL §1 ID 行）
- `displayName` 是 server-driven 文案，可改不重装
- `recommendedFor` 是 **hint-only string array**：iOS UI 仅展示 hint（如 "推荐: architecture, review"），**不基于值分支**（不能写 `if recommendedFor.contains("coding") { ... }`）；未知值（如 server 加 `"audit"`）老 iOS 仍渲染但不识别 → graceful skip 而非协议契约违反
- `enabled: false` 隐藏但保留 → 用户回退老模型时仍可用；**当前已选模型变 disabled 时**：保留 selection + UI 显示 "已停用" 标签 + 用户切走后不可再选回

### 1.2 HarnessConfig schema (M0 仅 modelList)

```ts
export const HarnessConfigSchema = z.object({
  protocolVersion: z.string(),          // "1.0"; minor bump = "1.x" → "1.(x+1)"; major = "1.x" → "2.0" (phase 3 arch react N1)
  minClientVersion: z.string(),         // "1.0"; iOS 自查 < minClient 切 fallback (见 §2.3)
  etag: z.string(),                     // SHA-256 of canonical recursive JSON; 见 §1.3
  modelList: z.array(ModelListItemSchema),
  // M0+ 后续追加 stages, agentProfiles, decisionForms, ... (minor bump)
}).superRefine((cfg, ctx) => {           // phase 3 cross M1 修复：isDefault exactly-one 全局校验
  const enabledDefaults = cfg.modelList.filter(m => m.isDefault && m.enabled);
  if (enabledDefaults.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `modelList must have exactly 1 enabled+isDefault item, got ${enabledDefaults.length}`,
    });
  }
});
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
```

**M0 范围**：仅 `modelList`。`stages` / `agentProfiles` / `decisionForms` 等 M1+ 加（minor bump，老 iOS graceful skip）。

**版本演化语义**（phase 3 arch react N1 修复，对接 [ADR-0015](../adr/ADR-0015-schema-migration.md)）：
- **minor bump**（如 `1.0` → `1.1`）：加新字段（如 `stages`）/ 加 enum 值。**老 iOS Zod `.passthrough()` + Swift `Codable` `keyDecodingStrategy` graceful skip 未知字段**，不切 fallback
- **major bump**（如 `1.x` → `2.0`）：删字段 / 改语义。iOS 自查 `clientVersion < minClientVersion` 时切打包内 fallback config + 显示升级提示
- **patch bump**（如 `1.0.0` → `1.0.1`，本字段不记 patch）：纯文档；不出现在 wire

### 1.3 ETag 算法（phase 3 cross B2 BLOCKER 修复：递归 canonicalizer）

> **关键**：原 v1.0 写"`Object.keys 排序`"含糊，按 `JSON.stringify(value, sortedKeysArray)` 字面实现会被解读为 key 白名单，**modelList 嵌套字段被过滤掉，etag 不随模型字段变化**。phase 3 cross B2 BLOCKER + arch MAJOR-2a 共识改为递归 canonicalizer。

**算法**（伪码）：

```ts
function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    // array 保持顺序（不排序），递归 canonicalize 每项
    return "[" + v.map(canonicalize).join(",") + "]";
  }
  // object 按 key 字典排序，递归 canonicalize 每个 value
  const keys = Object.keys(v).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalize((v as any)[k])).join(",") + "}";
}

const canonical = canonicalize({ protocolVersion, minClientVersion, modelList });  // etag 自身不含
const etag = "sha256:" + sha256(canonical).slice(0, 16);  // 16 字符前缀，与 Artifact.hash 风格一致
```

**强制 fixture 测试**（phase 3 cross B2 修复必填）：
- `etag(modelList[0].displayName="X" → "Y")` 必须改变 etag
- `etag(modelList[0].capabilities.contextWindow=200000 → 1000000)` 必须改变 etag
- `etag(modelList[0].recommendedFor=["a"] → ["a","b"])` 必须改变 etag
- `etag(同 config 但 key 顺序不同)` 必须 **stable**（两端独立计算结果一致）

**Unicode / 数字精度**：
- 字符串 UTF-8 直接序列化（`JSON.stringify` 默认）
- 数字保持 IEEE 754 双精度（M-1 EpochMs / contextWindow 都 < 2^53 兼容）
- 不允许 NaN / Infinity / undefined（Zod `.refine()` 边界已防）

**安装位置**：`packages/shared/src/canonical-json.ts` 工具函数，shared/Zod 测试和 backend/etag 计算共享。

### 1.4 fixtures（packages/shared/fixtures/harness/）

新增：
- `harness-config.json` — full config snapshot
- `model-list-item-opus.json` — 单 ModelListItem（Opus）
- `model-list-item-sonnet.json` — 单 ModelListItem（Sonnet）

---

## 2. Backend endpoint

### 2.1 端点

`GET /api/harness/config`

**Auth 继承**（phase 3 cross m3 + arch react agree）：挂在现有 `/api/*` auth 体系下，与 `projects` / `sessions` / `fs` 一致——支持 `CLAUDE_WEB_TOKEN` bearer 或 `?token=` query。localhost dev 行为沿用现有 auth 策略。

**Request headers**：
- `If-None-Match: <etag>` (optional) → 304 Not Modified if match
- **不传 If-None-Match → 200 + body**（phase 3 arch react N2 修复：HTTP 标准默认行为，写实避免误解为"必须传才能拿 config"）
- ETag header 用 **HTTP 标准 quoted 格式** `ETag: "sha256:abc123..."`（phase 3 cross m2 + arch react agree）；body 内 `etag` 字段保持裸字符串。Backend 比较 `If-None-Match` 时同时兼容 quoted / unquoted

**Response 200**：
- Content-Type: application/json
- `ETag: "<current etag>"` (quoted)
- Body: `HarnessConfig` JSON（含裸 `etag` 字段，与 header quoted 值同源）

**Response 304 Not Modified**：
- 无 body
- 仍返回 `ETag: "<current etag>"`

### 2.2 后端 modelList 来源（OQ4 = A 硬编码 + phase 3 single-source 修复）

**Single source**（phase 3 cross M4 + arch MINOR-2 收敛）：fallback config 唯一 source 在 `packages/shared/fixtures/harness/fallback-config.json`。backend 与 iOS 都从此 import / Bundle resource，**避免双 source drift**。

`packages/shared/fixtures/harness/fallback-config.json`：

```json
{
  "protocolVersion": "1.0",
  "minClientVersion": "1.0",
  "etag": "",
  "modelList": [
    { "id": "claude-opus-4-7", "displayName": "Opus 4.7", "description": "复杂推理 / 架构 / 评审", "capabilities": { "supportsThinking": true, "supportsLongContext": true, "contextWindow": 1000000 }, "recommendedFor": ["architecture","review","complex"], "isDefault": false, "enabled": true },
    { "id": "claude-sonnet-4-6", "displayName": "Sonnet 4.6", "description": "通用 / CRUD / 文档", "capabilities": { "supportsThinking": false, "supportsLongContext": false, "contextWindow": 200000 }, "recommendedFor": ["coding","docs"], "isDefault": true, "enabled": true },
    { "id": "claude-haiku-4-5", "displayName": "Haiku 4.5", "description": "快速 / 摘要 / 通知", "capabilities": { "supportsThinking": false, "supportsLongContext": false, "contextWindow": 200000 }, "recommendedFor": ["fast-chat","summarization"], "isDefault": false, "enabled": true }
  ]
}
```

`packages/backend/src/harness-config.ts`（**phase 3 arch MINOR-3 修复：lazy getter 避免 mutating const**）：

```ts
import fallback from "@claude-web/shared/fixtures/harness/fallback-config.json" with { type: "json" };
import { HarnessConfigSchema, computeEtag } from "@claude-web/shared";

let _cached: HarnessConfig | null = null;

export function getHarnessConfig(): HarnessConfig {
  if (_cached) return _cached;
  const parsed = HarnessConfigSchema.parse(fallback);
  parsed.etag = computeEtag(parsed);
  _cached = Object.freeze(parsed) as HarnessConfig;  // immutable after first compute
  return _cached;
}
```

`packages/ios-native/Sources/ClaudeWeb/Harness/HarnessStore.swift` 的 `fallbackConfig()` 也从同一份 fixture decode（xcodegen 复制为 Bundle resource，见 §3.1）。

**Drift 单元测试**（phase 3 cross M4 + arch MINOR-2 修复必填，安装于 shared 测试）：
```ts
test("fallback-config.json passes HarnessConfigSchema", () => {
  expect(() => HarnessConfigSchema.parse(fallback)).not.toThrow();
});
test("fallback isDefault is exactly one", () => {
  const cfg = HarnessConfigSchema.parse(fallback);
  expect(cfg.modelList.filter(m => m.isDefault && m.enabled)).toHaveLength(1);
});
```

改 modelList → tsx watch 重启 backend → WS 自动断重连 → iOS 自动 refetch 新 etag。

OQ4=A 选定，B（JSON 文件 + file watch）推到 M0.5 / M1。

### 2.3 minClientVersion 检测（OQ5 = A 实装 + phase 3 compareVersion 修复）

backend 不在 endpoint 内做（无法知道 client version，且这是 phase 3 cross react disagree 的真实分歧——cross 反驳 arch MINOR-4 "合并 backend 校验"，理由：HTTP config endpoint 无 client version，iOS 自查必要。最终 phase 3 author 接受 cross 立场）。

**iOS 端实施**：
- iOS GET response → 用 [`packages/shared/src/version.ts`](../../packages/shared/src/version.ts) `compareVersion(a, b): -1 | 0 | 1` 工具按数值字段比较（**phase 3 cross B2 拆出 + arch MAJOR-2b 修复：避免 string lex 失效；与 v2 dogfood arch M-D 同源**）
- compareVersion 实施步骤（实施清单 §4 step #X）：
  ```ts
  // packages/shared/src/version.ts
  export function compareVersion(a: string, b: string): -1 | 0 | 1 {
    const pa = a.split(".").map(n => parseInt(n, 10));
    const pb = b.split(".").map(n => parseInt(n, 10));
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] ?? 0, y = pb[i] ?? 0;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  }
  ```
- iOS HarnessStore：`compareVersion(clientVersion, response.minClientVersion) < 0` → 切打包内 fallback config + 显示升级提示
- 当前 1.0 = 1.0，全通过；为 M1+ 真 incompatible change 铺路

### 2.4 Hot-reload chain（OQ3 = A 简化版，phase 3 cross B1 + arch MAJOR-1 收敛后版本）

**M0 不实施 WS push**（与 §0 退出条件一致；phase 3 cross B1 + arch MAJOR-1 共识：删除 "WS 推 config_changed" 的 wording 一致性矛盾）：

```
作者改 modelList → tsx watch 检测文件变化 → backend 重启
   → WS 现有协议自动断 → iOS WSReconnect 自动 reconnect
   → iOS HarnessStore.refetch() with If-None-Match: <cached etag>
   → backend 200 + 新 ETag (etag 变了)
   → iOS 解析 + 缓存 + SwiftUI re-render
```

**总耗时**：tsx watch 重启 < 5s + WSReconnect < 2s + GET < 1s = 用户感知 < 10s。

WS push `harness_event { kind: "config_changed" }` 推到 M0.5（如果用户反馈"改模型不想每次重启 backend"，需要 OQ4 升 B JSON 文件 + file watch + WS event）。**ADR-0011 Decision #3 同步改"WS 重连后 iOS 立即 GET config + If-None-Match"**（phase 3 cross B1 + arch react agree）。

---

## 3. iOS 端

### 3.1 HarnessStore (OQ2 = B 中等粒度)

[`packages/ios-native/Sources/ClaudeWeb/Harness/HarnessStore.swift`](../../packages/ios-native/Sources/ClaudeWeb/Harness/HarnessStore.swift) 新建：

```swift
@Observable
final class HarnessStore {
    var config: HarnessConfig
    var lastFetchedAt: Date?
    var lastError: Error?

    private let cache: Cache  // 复用现有 Cache.swift 写 Application Support JSON
    private let api: HarnessConfigAPI

    init(cache: Cache, api: HarnessConfigAPI) {
        self.cache = cache
        self.api = api
        // 冷启动：先 fallback，再异步拉新
        self.config = cache.loadHarnessConfig() ?? HarnessStore.fallbackConfig()
    }

    func refetch() async { /* GET with If-None-Match: config.etag */ }

    static func fallbackConfig() -> HarnessConfig {
        // 与 backend hardcode 同步的最小 fallback（构建时 codegen 或手抄一遍）
        // 见 §4 实施细节
    }
}
```

### 3.2 Cache.swift 扩展

加方法：
```swift
func loadHarnessConfig() -> HarnessConfig? { /* read Application Support / harness-config.json */ }
func saveHarnessConfig(_ config: HarnessConfig) { /* atomic write */ }
```

写法与现有 [Cache.swift](../../packages/ios-native/Sources/ClaudeWeb/Cache.swift) 的 saveProjects / saveSession 一致（OQ2=B 手写 JSON）。

### 3.3 HarnessConfigAPI

[`packages/ios-native/Sources/ClaudeWeb/HarnessConfigAPI.swift`](../../packages/ios-native/Sources/ClaudeWeb/HarnessConfigAPI.swift) 新建：

```swift
struct HarnessConfigAPI {
    let baseURL: URL  // backend
    let token: String?

    func fetch(ifNoneMatch etag: String?) async throws -> HarnessConfigFetchResult {
        // GET /api/harness/config + If-None-Match
        // 200 → return .updated(config)
        // 304 → return .notModified
    }
}

enum HarnessConfigFetchResult {
    case updated(HarnessConfig)
    case notModified
}
```

### 3.4 Settings.swift 接 modelList

当前 Settings.swift 有硬编码 model 列表（M-1 期已 commit）。改为读 `HarnessStore.config.modelList`，过滤 `enabled: true`，按 `isDefault && enabled` 找默认。

**fallback 行为**：HarnessStore 离线 / 首次启动用打包内 fallback 配置（来自 §2.2 single-source `fallback-config.json`）；UI 不阻塞。

**Cutover 行为**（phase 3 arch MAJOR-4 (2) 修复：iOS cutover 后默认模型从 haiku 静默漂移到 sonnet）：
- 当前 Settings.swift 硬编码可能默认 haiku（用户在 server-driven 切换前选）。新 server config 默认 sonnet
- iOS 升级后**首次启动**：检查 `settings.currentModelId`：
  - 若用户从未显式选过（默认值 = old hardcoded default）→ 应用 server `isDefault` 模型
  - 若用户显式选过且该 id 仍在 modelList && enabled → 保留用户选择
  - 若用户显式选过但该 id 现在 `enabled: false` 或被删 → 显示提示 "您之前选择的模型已停用，已切换到 server 默认（Sonnet）"
- 不允许静默漂移（用户可能依赖 haiku 的速度，被静默换 sonnet 会感知性能差异）

**Disabled 当前 selection 处理**（phase 3 cross m1 + arch MAJOR-4 (3) 修复）：
- 若当前 selection 在新 modelList 仍存在但 `enabled: false`：保留 selection，但 Picker 显示 "已停用" 标签 + 灰色样式
- 用户切到其他模型后，已停用模型从 Picker 消失（不再可选回）

### 3.5 Codable Swift mirror

[`packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`](../../packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift) 已有 13 实体 DTO。加：

```swift
struct ModelListItem: Codable { ... }
struct HarnessConfig: Codable {
    let protocolVersion: String
    let minClientVersion: String
    let etag: String
    let modelList: [ModelListItem]
}
```

字段命名与 Zod schema 1:1 对应。

---

## 4. 实施步骤（按依赖序，phase 3 修订后）

| # | 动作 | 文件 | 工作量 |
|---|---|---|---|
| 1 | shared/src/canonical-json.ts 写递归 canonicalizer + sha256 etag (phase 3 cross B2 修复) | shared | 10 min |
| 2 | shared/src/version.ts 写 compareVersion 工具 (phase 3 arch MAJOR-2b 修复) | shared | 5 min |
| 3 | shared/src/harness-protocol.ts 加 ModelListItemSchema + HarnessConfigSchema (含 superRefine isDefault exactly-one) | shared | 15 min |
| 4 | shared/fixtures/harness/fallback-config.json (single source for backend + iOS) | shared | 5 min |
| 5 | shared/fixtures/harness/ 加 ModelListItem fixture (单实体测试) | shared | 5 min |
| 6 | shared 测试：round-trip + etag canonical sort 稳定 + 嵌套字段改 etag 改 + drift 单测 (phase 3 cross M4 修复) | shared | 20 min |
| 7 | backend/src/harness-config.ts lazy `getHarnessConfig()` import fallback (phase 3 arch MINOR-3 修复 mutating const) | backend | 10 min |
| 8 | backend/src/routes/harness-config.ts 写 GET endpoint + If-None-Match (quoted) + 200/304 + auth 继承现有 | backend | 20 min |
| 9 | backend/src/index.ts 挂 router (现有 auth 中间件自动覆盖) | backend | 5 min |
| 10 | iOS HarnessProtocol.swift 加 Codable (HarnessConfig + ModelListItem) | iOS | 10 min |
| 11 | iOS Cache.swift 加 load/save HarnessConfig | iOS | 10 min |
| 12 | iOS HarnessConfigAPI.swift 写 fetch with If-None-Match (quoted) | iOS | 15 min |
| 13 | iOS HarnessStore.swift + fallbackConfig 从 Bundle decode (xcodegen 复制 shared/fixtures/harness/fallback-config.json) | iOS | 25 min |
| 14 | iOS Settings.swift 接 HarnessStore.modelList + cutover 行为 + disabled selection 处理 (phase 3 arch MAJOR-4 修复) | iOS | 20 min |
| 15 | iOS ClaudeWebApp.swift 启动 HarnessStore.refetch | iOS | 5 min |
| 16 | iOS xcodegen project.yml 加 fallback-config.json Bundle resource | iOS | 5 min |
| 17 | iOS xcodegen 重建 project + manual build smoke | iOS | 10 min |
| 18 | dev 环境 5.2 全部验证（含真机断网 cold start + cutover 行为 + disabled selection）| manual | 25 min |
| 19 | ADR-0011 Decision #1 + #3 同步改 (phase 3 cross M3 + B1 修复)；HARNESS_PROTOCOL §1 ID 行改 opaque (phase 3 cross M2 修复) | docs | 10 min |

**实施工作量**：~3.5 h（实测 phase 3 修订后增量）

**评审已完成**（phase 1+2+3 已 ship）：约 1 h

**总**：~4.5 h

---

## 5. 验收

### 5.1 自动化测试
- [ ] `pnpm --filter @claude-web/shared test` 全绿（含 modelList fixtures round-trip）
- [ ] `node scripts/verify-m1-deliverables.mjs` 仍 25/25（M0 deliverable 加到 M0 verify 脚本，不动 M-1）

### 5.2 端到端 dev 验证
- [ ] backend 启动后 `curl http://localhost:3030/api/harness/config | jq` 返回完整 schema
- [ ] `curl -H 'If-None-Match: "sha256:xxx"' ...` 命中返回 304；不传 If-None-Match → 200 + body（phase 3 N2 修复）
- [ ] iOS sim 装新版 → Settings 显示 3 模型 + 描述 + 默认 sonnet（**doc-only 不重装真机**）
- [ ] 改 backend fallback-config.json 加第 4 模型 → tsx watch 重启 backend → iOS WSReconnect → Settings 显示 4 模型
- [ ] iOS 离线（停 backend）→ Settings 仍显示 fallback 3 模型 + 显示"未连接"占位
- [ ] iOS app version 强行 < minClientVersion（dev 改 `1.0` → `2.0` 测）→ 显示升级提示 + fallback config 兜底
- [ ] **iOS 真机断网 cold start**（phase 3 arch MINOR-5 + cross react agree）：真机断网首次冷启 → 看到 fallback 3 模型 + Settings 不卡 + "未连接" 占位（M0 是 iOS 唯一一次大改装，真机 fallback 路径必跑一次）
- [ ] **Cutover 行为**：sim 上预先 set `settings.currentModelId = "claude-haiku-4-5"`（旧硬编码默认）→ 升级到 v1.1 → 首次启动 iOS 应用 server 默认（sonnet），但因为是显式选过的 id 仍在 modelList → 保留 haiku 不漂移
- [ ] **disabled 当前 selection**：sim 上选 haiku → backend 改 fallback-config.json haiku.enabled=false → reconnect → Picker 显示 haiku "已停用" 标签 + 用户切 sonnet 后 haiku 从 Picker 消失

### 5.3 v2 Review Mechanism 验收
- [ ] phase 1 双 reviewer verdict
- [ ] phase 2 cross-pollinate react verdict
- [ ] phase 3 裁决 + 收敛（理想 0 still-disagree）
- [ ] 用户拍板 OK

---

## 6. Open Questions（phase 3 后已敲定）

- **OQ-A**（phase 3 cross M4 + arch MINOR-2 收敛）：fallback config 在 iOS 怎么 ship？
  - **决议**：**single source `packages/shared/fixtures/harness/fallback-config.json`**。backend `getHarnessConfig()` 直接 import；iOS xcodegen 复制为 Bundle resource，HarnessStore.swift `fallbackConfig()` 从 Bundle decode。两端必须解析同一份字节，**没有 drift 余地**
- **OQ-B**：ETag 失效策略
  - **决议**：(a) 永不主动失效，靠 backend 重启换 etag。M0.5 视需要加 manual invalidate debug endpoint
- **OQ-C**（phase 3 cross M4 + arch MINOR-2 收敛）：Bundle resource fallback 与 backend hardcode drift 风险
  - **决议**：与 OQ-A 同源 — single source 直接消除 drift。**单元测试断言**（phase 3 强制必填）：(1) `fallback-config.json passes HarnessConfigSchema`；(2) `enabled+isDefault` 恰好 1 项；(3) `etag(fallback) == computeEtag(parsed)` 自洽
- **OQ-D**（phase 3 arch react 升级）：M0 是否同步升 ADR-0011 Proposed → Accepted
  - **决议**：M0 实施完不仅推迟 Accepted，**还必须同步改 ADR-0011 Decision #1 写"分阶段扩展，M0 仅 modelList，新增字段走 minor bump + graceful skip"**（phase 3 cross M3 + arch react agree）。Decision #3 改"WS 重连后 iOS 立即 GET config + If-None-Match"（phase 3 cross B1 + arch react 同步修）

---

## 7. 不在范围（推到 M0.5 / M1）

- WS push `harness_event { kind: "config_changed" }`（M0.5 当用户反映"改模型不想重启" 时加）
- backend modelList 来源 B（JSON 文件 + file watch）
- 全 schema（stages / agentProfiles / decisionForms / methodologyTemplates / promptTemplates / featureFlags / copy / healthChecks）—— M1+ 逐项加
- i18n（zh-CN only，M4 视情况）
- modelList 与 AgentProfile.modelHint 联动（M2 真 agent 启用时）
- cost hint（M2 走 telemetry，不入 config）
- Web `/harness/settings` 页面（M1 主战场）

---

## 8. 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| iOS bundled fallback 与 backend hardcode drift | 中 | OQ-C 单元测试断言关键不变量 |
| backend 重启 → iOS 重连不及时（用户在改完代码后还看到旧列表）| 低 | tsx watch 重启 < 5s，iOS WSReconnect < 2s，用户感知 < 10s |
| ETag 计算不稳定（JSON.stringify key 顺序）| 中 | canonical_json 强制 sorted keys；fixture round-trip 测试 ETag 输出稳定 |
| minClientVersion 比较用 string lex（v2 dogfood arch M-D 修复同源）| 中 | 复用 [ADR-0011](../adr/ADR-0011-server-driven-thin-shell.md) §"版本字符串比较" 写明 M0 实施 compareVersion 工具，按数值字段 |
| iOS Settings 现有硬编码 model list 与 server modelList 切换时用户回退 | 低 | enabled=false 兜底；iOS 切回时显式提示 |

---

## 9. 完工状态（实施后填）

- [ ] shared/src/harness-protocol.ts ModelListItemSchema + HarnessConfigSchema
- [ ] shared/fixtures/harness/ 3 fixtures
- [ ] shared 测试 round-trip 通过
- [ ] backend/src/harness-config.ts 硬编码 modelList + computeEtag
- [ ] backend/src/routes/harness-config.ts GET endpoint + If-None-Match
- [ ] iOS HarnessProtocol.swift Codable
- [ ] iOS Cache.swift load/save HarnessConfig
- [ ] iOS HarnessConfigAPI.swift fetch
- [ ] iOS HarnessStore.swift + fallbackConfig
- [ ] iOS Settings.swift 接 HarnessStore.modelList
- [ ] dev 端到端验证（5 项 §5.2 全过）
- [ ] v2 Review 三层全过 + 用户拍板
- [ ] ADR-0011 Proposed → Accepted（OQ-D=a）
