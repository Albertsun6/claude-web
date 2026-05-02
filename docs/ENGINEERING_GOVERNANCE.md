# claude-web 工程约束改进建议

这份文档回答一个问题：这个项目要不要引入“框架”来约束工程质量。

结论先说清楚：**不建议现在引入重型应用框架来重写项目；建议引入轻量工程约束框架**。这里的“框架”不是 Nest、Next、Redux 这类会改变项目形态的大框架，而是一套能让项目持续变复杂时不失控的规则、测试、检查和决策流程。

当前项目的问题不是选错了技术栈。`backend` / `frontend` / `shared` / `ios-native` 的边界基本正确，Hono、Vite、Zustand、SwiftUI 都和项目体量匹配。真正的风险在于：协议变更靠人工同步，WebSocket 状态机靠记忆维护，测试和 CI 不够系统，前端状态继续膨胀后会难拆。

所以优先级应该是：

1. 先加自动化保护。
2. 再加边界规则。
3. 最后才考虑引入更重的框架。

---

## 不建议现在引入的重型框架

### 不建议把 backend 迁到 NestJS

NestJS 的价值是模块、依赖注入、装饰器、统一生命周期和大型团队协作。这个项目的后端核心是本机工具代理：HTTP routes、WebSocket、CLI 子进程、文件/Git/语音接口。Hono 当前足够轻，启动快，逻辑直接。

迁到 NestJS 会带来几个成本：

- CLI runner、permission hook、WebSocket run 生命周期都要重新接入 Nest 的生命周期。
- 目录和抽象会变多，但核心复杂度不会消失。
- 个人项目的迭代速度会下降。
- 最大风险“协议同步和状态机正确性”并不会因为换 Nest 自动解决。

建议：继续用 Hono，但把 `packages/backend/src/index.ts` 逐步拆薄，把 WebSocket、静态资源、health、app 创建拆成独立模块。

### 不建议把 frontend 迁到 Next.js

这个项目是一个本机工具 UI，不需要 SSR、路由系统、服务端组件、边缘部署或复杂页面 SEO。Vite 更贴近当前需求：启动快、构建简单、单页应用直接由 backend 服务。

迁到 Next.js 会引入新的运行时模型，还会让“backend 单端口服务 dist”的部署方式变复杂。

建议：继续用 Vite + React。要提升前端工程质量，应先拆 store、补组件测试、补 WebSocket 契约测试，而不是换框架。

### 不建议马上把 Zustand 换成 Redux Toolkit

`store.ts` 已经变重，但问题不是 Zustand 不够强，而是状态领域没有拆分。Redux Toolkit 可以提供更强规范，但也会带来模板代码和迁移成本。

建议：先保留 Zustand，把状态拆成 slice 文件：

```text
packages/frontend/src/store/
  index.ts
  projectSlice.ts
  permissionSlice.ts
  layoutSlice.ts
  voiceSlice.ts
  usageSlice.ts
  persistence.ts
```

如果拆分后仍然出现跨 slice 事务复杂、调试困难、历史回放需求，再考虑 Redux Toolkit。

### 不建议为类型安全马上引入 tRPC

tRPC 适合 TypeScript 前后端共享 HTTP API 类型，但这个项目还有 Swift iOS 客户端。只照顾 TS 端会让 iOS 更边缘化。

真正需要治理的是跨端协议，尤其是 `packages/shared/src/protocol.ts` 和 `packages/ios-native/Sources/ClaudeWeb/Protocol.swift` 的一致性。

建议：优先做 JSON Schema 或 fixture 契约测试。等协议稳定后，再考虑是否从 schema 生成 TS/Swift 类型。

### iOS 前端技术路线：继续使用 SwiftUI 原生

Seaidea 的 iOS 前端继续以 `packages/ios-native/` 的 SwiftUI 原生 app 为主线。这个决策不是因为 SwiftUI “更流行”，而是因为当前产品形态需要可靠地调用 iOS 系统能力：WebSocket 长连接、麦克风录音、TTS 播放、音频会话、权限弹窗、本地缓存、后台音频实验、断线恢复和未来更深的系统集成。

不建议回到 `packages/frontend/ios/` 的 Capacitor wrapper，也不建议现在迁到 React Native / Flutter：

- Capacitor / PWA 的优势是 Web 代码复用和更新快，但 Seaidea 的核心难点正好在 WebView 较弱的系统能力上：录音、后台音频、锁屏控制、权限生命周期和长期连接。
- React Native / Flutter 会引入额外运行时和桥接复杂度。当前只服务 iPhone，SwiftUI 能更直接地处理系统能力。
- 锁屏和 Now Playing 等能力即使在原生 app 里也受 iOS 平台限制，换成 WebView 或跨平台框架不会让这些限制消失。

这个路线的主要代价是：Swift 代码变更后需要重新安装 app。长期策略不是换技术栈，而是减少必须发版的变更：

- 日常真机开发优先使用 Xcode 无线调试：第一次 USB 配对后，在 Xcode 的 Devices and Simulators 里勾选 “Connect via network”，之后同一 Wi‑Fi 下可无线构建安装。
- 稳定版本或给别人测试时使用 TestFlight，而不是让每台手机都连开发机。
- 能由后端配置控制的内容不要写死到 iOS 二进制里，例如模型列表、常用 profile、feature flag、权限模式说明、health check 展示项、onboarding 文案。
- iOS app 保持“可靠遥控器”定位：负责交互、系统能力、本地缓存和状态展示；Claude CLI、文件系统、Git、语音转写、TTS 生成继续放在 backend。

维护规则：

- 新移动端功能默认进 `packages/ios-native/`。除非明确是旧 PWA 兼容修复，不要在 `packages/frontend/ios/` 增加功能。
- 改 `packages/shared/src/protocol.ts` 时，必须同步检查 `packages/ios-native/Sources/ClaudeWeb/Protocol.swift` 和协议 fixture。
- 改语音、后台、锁屏、权限、缓存、会话恢复这类系统能力时，必须更新或复核 `docs/IOS_NATIVE_DEVICE_TEST.md`。
- 只有真正面向用户的使用方式变化，才更新 `docs/USER_MANUAL.md`；工程路线和技术取舍继续维护在本文档。

---

## 建议引入的轻量工程约束

### 现状检查

先按当前仓库状态落地，不要假设已经有测试框架：

- 根 `package.json` 只有 `dev:backend`、`dev:frontend`、`test:cli`。
- `packages/backend/package.json` 有脚本式测试，例如 `test:auth`、`test:permission`、`test:e2e`、`test:strip`。
- `packages/frontend/package.json` 有 `build`，但没有 test 脚本。
- 当前没有 `vitest.config.*`。
- 当前没有 `.github/workflows/*`。

所以改进路线应该从“补最小保护”开始，而不是直接搭完整测试平台。

### 优先级矩阵

| 任务 | 工作量 | 风险降低 | 优先级 |
|---|---:|---:|---:|
| Protocol fixtures | 低 | 高 | 1 |
| CLI runner mock 单测 | 中 | 高 | 2 |
| GitHub Actions CI | 中 | 中 | 3 |
| Store 持久化和低风险 slice 拆分 | 高 | 中 | 4 |
| WebSocket 模块拆分和生命周期测试 | 高 | 中 | 5 |
| Swift XCTest fixture 测试 | 中 | 高 | 6 |
| ADR 和 PR checklist | 低 | 中 | 7 |

这个排序的原因是：当前项目已经能稳定运行，最紧急的风险不是“没有 CI 平台”，而是 TS 和 Swift 协议漂移。fixture 成本最低，收益最高，应该先做。

### 1. 协议契约测试

这是当前最重要的工程约束。

问题来源：

- Web 端通过 `packages/shared/src/protocol.ts` 拿到 TS 类型。
- iOS 端通过 `packages/ios-native/Sources/ClaudeWeb/Protocol.swift` 手写同一套协议。
- 后端新增消息字段时，TS 能编译，Swift 不一定会马上报错。

建议建立 `packages/shared/fixtures/protocol/`：

```text
packages/shared/fixtures/protocol/
  client-user-prompt.json
  client-permission-reply.json
  server-sdk-message.json
  server-permission-request.json
  server-clear-run-messages.json
  server-session-ended.json
  server-error.json
  server-fs-changed.json
  server-session-event.json
```

然后做两类测试：

- TS 测试：读取 fixture，验证能按 `ClientMessage` / `ServerMessage` 预期处理。
- Swift 测试：读取同一批 fixture，验证 `ServerMessage.decode` 和 `ClientMessage.encode` 行为。

最小 fixture 示例：

```json
{
  "type": "sdk_message",
  "runId": "test-run-123",
  "message": {
    "type": "system",
    "subtype": "init",
    "session_id": "test-session-456",
    "model": "claude-sonnet-4-6"
  }
}
```

TS 端最小测试可以先放在 `packages/shared/src/protocol-fixtures.test.ts` 或 `packages/backend/src/__tests__/protocol-fixtures.test.ts`。当前 `ServerMessage` 是 TypeScript type，不是运行时 parser，所以第一版测试重点是 fixture 结构校验和分支覆盖，不要假装有 `ServerMessage.parse()`：

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@claude-web/shared";

const fixturePath = path.resolve(
  process.cwd(),
  "../shared/fixtures/protocol/server-sdk-message.json",
);

describe("protocol fixtures", () => {
  it("loads sdk_message fixture", () => {
    const msg = JSON.parse(readFileSync(fixturePath, "utf-8")) as ServerMessage;
    expect(msg.type).toBe("sdk_message");
    if (msg.type === "sdk_message") {
      expect(msg.runId).toBe("test-run-123");
    }
  });
});
```

iOS 端推荐把同一批 fixture 加到 Xcode target resources。XcodeGen 可以在 `packages/ios-native/project.yml` 里加入测试 target，测试代码通过 `Bundle.module` 或 test bundle URL 读取 JSON。示意：

```swift
import XCTest
@testable import ClaudeWeb

final class ProtocolFixtureTests: XCTestCase {
    func testServerSDKMessageDecode() throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "server-sdk-message", withExtension: "json")
        )
        let data = try Data(contentsOf: url)
        let msg = try ServerMessage.decode(data)

        guard case .sdkMessage(let runId, _) = msg else {
            return XCTFail("expected sdkMessage")
        }
        XCTAssertEqual(runId, "test-run-123")
    }
}
```

fixture 同步可以分三步推进：

1. 人工规则：改 `protocol.ts` 时必须改 fixture，并在 commit/PR 描述里写明。
2. 半自动：本地 hook 检查 `protocol.ts` 或 `Protocol.swift` 变化时，提醒检查 `packages/shared/fixtures/protocol/`。
3. 全自动：GitHub Actions 里做 diff 检查，协议文件变化但 fixture 没变化时失败。

最低目标：**每次改 `protocol.ts`，必须同步改 fixture。**

### 2. CLI runner 适配层测试

`packages/backend/src/cli-runner.ts` 是项目核心适配层。它把外部 `claude` CLI 变成项目内部协议。这里应该像对待第三方支付或数据库驱动一样测试。

建议引入 `vitest`，先覆盖这些场景：

- stdout 按行输出 JSON 时能逐条转发。
- stdout 最后一行没有换行时也能解析。
- stdout 出现非法 JSON 时不会导致整个进程崩掉。
- stale session 错误会触发 `clear_run_messages` 并无 resume 重试。
- abort 先 SIGTERM，超时后 SIGKILL。
- 非 0 exit 会返回可读错误。

这类测试不应该真的启动 `claude`。应把 spawn 抽象出来：

```text
packages/backend/src/cli/
  runner.ts
  spawnClaude.ts
  runner.test.ts
```

测试里 mock `spawnClaude`，模拟 stdout、stderr、close、error。

### 3. CI 作为第三道闸门

CI 很重要，但不应该排在 protocol fixtures 前面。CI 是执行平台，fixtures 和核心单测才是要被执行的内容。正确顺序是先有最小测试资产，再让 CI 稳定运行它们。

建议新增 `.github/workflows/ci.yml`，第一版只跑低环境依赖的检查：

```bash
pnpm install --frozen-lockfile
pnpm --filter @claude-web/frontend build
pnpm --filter @claude-web/backend test:auth
pnpm --filter @claude-web/backend test:permission
pnpm --filter @claude-web/backend test:strip
```

`test:cli` 不建议直接放进必跑 CI，因为它依赖本机 `claude` CLI 和登录态。等 `cli-runner` 有 mock spawn 单测后，CI 应该跑 mock 单测，而不是跑真实 CLI。

建议目标：

- 每个 PR 至少保证 TypeScript 编译通过。
- 协议 fixture 和 CLI runner 单测能自动跑。
- 安全、权限、会话解析这类关键路径逐步进入 CI。
- 不要求一步到位覆盖所有功能。

### 4. WebSocket run 生命周期测试

WebSocket 是这个项目最容易出隐性 bug 的地方。重点不是测 UI，而是测状态转移。

建议覆盖：

- `user_prompt` 后创建 run，并把 CLI 消息按 runId 包装成 `sdk_message`。
- `session_ended` 后删除 run handle 和 permission channel。
- `interrupt` 能中断指定 run。
- WS close 时能 abort 所有 run、unsubscribe fs/session watcher。
- `permission_reply` 带 runId 时走 O(1) 路由。
- cwd 不在 allowlist 时返回 error 并结束该 run。

如果直接测 `index.ts` 太难，说明 `index.ts` 需要拆：

```text
packages/backend/src/server/
  app.ts
  websocket.ts
  static-assets.ts
  health.ts
```

拆分的目标不是追求目录好看，而是让 WebSocket 生命周期可以被测试。

### 5. 前端状态边界规则

当前 `packages/frontend/src/store.ts` 同时管理项目、会话、权限、语音、布局、用量、localStorage。继续加功能会变成维护瓶颈。

建议规则：

- 新状态先判断属于哪个领域：project、session、permission、voice、layout、usage。
- 持久化逻辑放到 `persistence.ts`，不要散落在 slice 里。
- localStorage value 加 schema version。
- store 只做状态变更，不直接放复杂副作用。
- WebSocket 事件处理和 store mutation 保持分层。

建议先拆成：

```text
packages/frontend/src/store/
  index.ts
  types.ts
  persistence.ts
  projectSlice.ts
  permissionSlice.ts
  layoutSlice.ts
  voiceSlice.ts
  usageSlice.ts
```

拆分顺序：

1. 先抽 `types.ts` 和 `persistence.ts`。
2. 再抽 `layoutSlice`，因为风险最低。
3. 再抽 `permissionSlice`，因为边界清楚。
4. 最后抽 `project/session`，因为它们和主流程耦合最高。

### 6. iOS 原生工程边界

iOS 不是附属客户端，它已经是当前移动端主路径。工程治理不能只保护 TS 端，也要保护 SwiftUI 端。

当前 iOS 风险主要有三类：

- `BackendClient.swift` 容易变成 WebSocket、runId 路由、消息解析、TTS 触发、permission 状态的总入口。
- `ProjectRegistry.swift` 同时协调项目列表、历史会话、缓存恢复、服务端同步，继续增长后会变成第二个状态中心。
- `ContentView.swift` 承载大量 UI 编排，SwiftUI view 如果继续直接拿多个对象做复杂判断，会出现和前端 store 类似的膨胀问题。

建议边界：

- `BackendClient` 只负责连接、发送、接收、按 conversation/runId 路由，不直接决定高层项目策略。
- `ProjectRegistry` 负责项目和会话编排，但不解析低层 SDK message。
- `Cache` 保持纯持久化，不掺入网络重试和 UI 策略。
- SwiftUI view 只做展示和用户交互，复杂判断下沉到 view model 或 coordinator。

建议测试：

- `Protocol.swift` 使用 shared fixture 做 decode 测试，这是第一优先级。
- `TranscriptParser.swift` 用 jsonl fixture 测试真实历史会话解析。
- `BackendClient` 的 runId routing 可以先抽纯函数测试，例如“收到 sessionEnded 后是否清理映射”。
- `ProjectRegistry` 测 bootstrap 顺序：先 cache、再 server projects、再 reconcile、再 restore last conversation。

不要一开始就给 iOS 引入复杂架构框架。SwiftUI + ObservableObject 当前够用。更重要的是把协议、缓存、registry、client 的职责边界写清楚，并用少量 XCTest 保护核心不变量。

### 7. 文档化决策流程：ADR

建议新增 `docs/adr/`，用于记录重要工程决策。ADR 是 Architecture Decision Record，意思是“架构决策记录”。它不需要复杂格式，只要写清楚当时为什么这么选。

模板：

```markdown
# ADR-0001: 在 Hono 内模块化，不迁 NestJS

## 状态
Accepted

## 背景
项目后端已经有多个 routes，`index.ts` 同时承担 Hono app、静态资源、WebSocket upgrade 和 run 生命周期。团队考虑是否需要迁到更重的后端框架来管理复杂度。

## 决策
继续使用 Hono，但在 Hono 内部做模块拆分。先把 app 创建、WebSocket、静态资源、health 拆出，不做框架迁移。

## 后果
- 避免迁移成本和学习曲线。
- 保留当前单端口部署和快速启动。
- 如果 6 个月内 routes 和后台服务数量明显翻倍，再重新评估 NestJS 或其他模块系统。
```

建议第一批 ADR：

- `ADR-0001`: 在 Hono 内模块化，不迁 NestJS。
- `ADR-0002`: 保持 Vite SPA，不迁 Next.js。
- `ADR-0003`: 用协议 fixture 约束 TS/Swift 同步。
- `ADR-0004`: iOS 新功能只进 `packages/ios-native`，不进 Capacitor wrapper。

### 8. 变更检查清单

建议在 `docs/ENGINEERING_CHECKLIST.md` 或 PR 模板里加一份简单清单。

协议变更：

- 是否改了 `packages/shared/src/protocol.ts`？
- 是否同步更新 Swift `Protocol.swift`？
- 是否新增或更新 protocol fixture？
- 是否覆盖 Web 和 iOS 的 decode 行为？

WebSocket/runId 变更：

- 是否所有 `sdk_message`、`error`、`clear_run_messages`、`session_ended` 都能按 runId 路由？
- 是否所有结束路径都会清理 run handle？
- 是否断线时会 abort 和 unregister？
- 是否不会把 A 会话的权限弹窗显示到 B 会话？

安全变更：

- 是否仍然默认绑定 `127.0.0.1`？
- 是否绕过了 `verifyAllowedPath`？
- 是否新增了可读文件或可执行命令的入口？
- 是否会把 token 写入日志、URL 或错误消息？

用户可见变更：

- 是否需要更新 `docs/USER_MANUAL.md`？
- 是否需要更新 `CLAUDE.md` 的关键不变量？
- 是否影响 iOS native？

检查清单需要执行机制，否则很容易被忽略。建议分三层：

- 人工检查：新增 PR template，把上面的清单放进去，review 时逐项扫。
- 半自动检查：本地 hook 检查协议文件变化时，提示 fixture 是否同步更新。
- 全自动检查：CI 读取 git diff，如果 `packages/shared/src/protocol.ts` 或 `packages/ios-native/Sources/ClaudeWeb/Protocol.swift` 改了，但 `packages/shared/fixtures/protocol/` 没改，就让检查失败。

本项目是个人项目，不一定需要一开始就上 husky。第一步可以只做 PR template 和 CI diff check；本地 hook 等协作频率变高后再加。

---

## 分阶段实施计划

### 不要一次做完

这不是一周任务，也不是必须一次完成的重构计划。更合理的理解是：**未来半年到一年可以逐步落地的工程治理路线图**。

项目现在已经能稳定使用，不应该为了治理而打断功能迭代。每次只做一个能独立合并、独立验证的小改动。

### Month 1：先防协议漂移

目标：低成本建立第一层保护。

建议任务：

1. 新建 `packages/shared/fixtures/protocol/`。
2. 放入所有 `ClientMessage` / `ServerMessage` 的最小 JSON 样例。
3. 引入 `vitest` 到 shared 或 backend。
4. 写 TS 端 fixture 测试。
5. 给 `Protocol.swift` 规划 XCTest target，暂时不强制一次完成。

预估工作量：半天到一天。无压力模式下可以拆成两到三个小提交。

验收标准：

- 改协议时有 fixture 文件可以对照。
- TS 端至少能读取并验证这些 fixture。
- 文档明确说明 Swift 端要使用同一批 fixture。

### Month 1-2：保护 CLI 适配层

目标：让 `cli-runner` 的核心行为可测。

建议任务：

1. 抽出 `spawnClaude` 包装函数。
2. 用 Vitest mock stdout、stderr、close、error。
3. 覆盖 stale session retry、非法 JSON、非 0 exit、abort。
4. 明确真实 `test:cli` 仍然是手动验收，不放进必跑 CI。

验收标准：

- 改坏 `cli-runner` 基础行为会被单测发现。
- 测试不依赖真实 `claude` CLI 和登录态。
- 真实 CLI 测试继续保留为人工或手动 workflow。

### Month 2-3：接入自动化

目标：把已经存在的测试和构建放进 CI。

建议任务：

1. 新增 `.github/workflows/ci.yml`。
2. 跑 frontend build。
3. 跑 backend 现有脚本式测试中低环境依赖的部分。
4. 跑 protocol fixture test。
5. 跑 CLI runner mock test。
6. 增加 diff check：协议文件变化时 fixture 必须变化。

验收标准：

- 每个 PR 至少能自动验证 TypeScript 编译。
- 核心测试不依赖本机登录态。
- 协议漂移能被自动提醒。

### Month 3+：降低未来维护成本

目标：慢慢拆复杂文件，不做大爆炸重构。

建议任务：

1. 把 `store.ts` 的类型和持久化逻辑先抽出来。
2. 拆 layout、permission、voice preference 等低风险 slice。
3. 为 Swift `Protocol.swift` 增加 XCTest fixture decode 测试。
4. 给 `ws-client.ts` 的消息处理补单元测试。
5. 把 `MessageItem.tsx` 中不同消息类型的渲染拆成小组件。
6. 把 `useVoice.ts` 拆出 speech recognition、TTS queue、commands、cleanup。
7. 拆 `backend/src/index.ts` 的 WebSocket 逻辑并补生命周期测试。

验收标准：

- 新增一个 UI 状态不需要改 500 行大 store。
- TS 和 Swift 至少用同一批协议 fixture。
- runId 清理、interrupt、permission reply 不再只靠人工检查。
- 会话解析和语音命令逐步有测试保护。

### 持续判断：再评估是否需要重框架

只有出现下面情况时，才重新考虑重框架：

- 后端路由和服务模块增长到 Hono 手动组织明显吃力。
- 有多人长期并行开发，需要强 DI、统一模块生命周期和团队约束。
- 前端出现复杂跨页面路由、服务端渲染、权限页面体系。
- Zustand slice 拆分后仍然无法管理状态一致性。
- TS/Swift 协议 fixture 仍然不足，需要 schema-first 类型生成。

可能的选择：

- 后端仍优先考虑在 Hono 内部模块化，而不是直接迁 Nest。
- 前端若只是状态复杂，先考虑 Redux Toolkit，不要直接迁 Next。
- 协议若持续扩张，优先考虑 JSON Schema / OpenAPI / AsyncAPI 生成 TS 和 Swift 类型。

---

## 建议引入的工具清单

### 立即引入

- protocol fixtures：跨端协议样例。
- `vitest`：先服务 protocol fixtures 和 CLI runner mock 单测。
- ADR 文档：记录重要工程决策，不要求一次补齐全部历史。

### 可以后续引入

- GitHub Actions：等 fixtures 和核心单测存在后接入。
- `playwright`：Web UI 关键路径端到端测试，例如打开项目、发 prompt、权限弹窗。
- Swift XCTest fixture 测试：确保 iOS 协议解码不漂移。
- JSON Schema：当协议继续变复杂时，用 schema 作为 TS/Swift 共同来源。
- PR template：把协议、runId、安全、文档更新变成检查清单。

### 暂不引入

- NestJS：当前后端不需要重框架。
- Next.js：当前 Web UI 不需要 SSR 或复杂路由。
- Redux Toolkit：先拆 Zustand slice，再评估。
- tRPC：不能覆盖 Swift iOS 的主要协议风险。

---

## 推荐落地顺序

如果只做五件事，建议按这个顺序：

1. 建 `packages/shared/fixtures/protocol/`，把所有 WS 消息类型样例放进去。
2. 写 TS 端 protocol fixture 测试。
3. 给 `cli-runner` 加 mock spawn 单测。
4. 加 GitHub Actions，跑 build、fixture 测试和 mock 单测。
5. 给 Swift `Protocol.swift` 加 fixture decode 测试。

这样做的好处是：不改变产品运行方式，不打断当前开发速度，但能立刻降低未来改坏核心链路的概率。

---

## 最终建议

这个项目现在不需要“换框架”，需要“立规矩”。

更准确地说：

- 应该保留 Hono、Vite、Zustand、SwiftUI。
- 应该引入 CI、Vitest、协议 fixture、ADR、变更检查清单。
- 应该把大文件按真实职责拆小。
- 应该把 runId、permission、protocol、CLI runner 这些高风险路径变成自动化测试保护的对象。

等这些基础约束建立后，再判断是否需要更重的框架。否则现在换框架，只是把复杂度从一个地方搬到另一个地方。
