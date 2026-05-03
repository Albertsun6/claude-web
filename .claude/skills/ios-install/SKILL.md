---
name: ios-install
description: 把 Seaidea iOS app 单次 install/redeploy 到设备（真机或 sim）。沉淀 M0 期间 build 31/32/33 三轮真机经验：vitest+curl gate、deploy.sh 调用、锁屏 launch fail 三关键字 AND + buildinfo 正向证据判定、Mac TTS 通知。Use when 用户说"装到手机"、"deploy to iPhone"、"重装 iOS"、"装新 build"、"真机重装"、"redeploy iOS"、"reinstall app"，或在已写完代码后想单次部署到设备。**不做端到端测试**（那走 ios-e2e-test）；**不做端到端 implementation**（那走 feature-fullstack）。
---

# iOS Install Skill

把 Seaidea (`com.albertsun6.claudeweb-native`) 单次 install + launch 到 iOS 真机或 sim。

承担"已经写完代码，只想 install/redeploy 一次"场景。完整 e2e 流程走 `ios-e2e-test`；端到端 feature 实现走 `feature-fullstack`。本 skill 是**子流程**，可被前两者 inline 调用。

## 1. 强制前置 gate（带 escape hatch）

**默认 PASS 才装机**——M0 期间多次撞过"协议层错了，已经 build 完才发现，浪费 1-2min build"，立成铁律：

```bash
pnpm --filter @claude-web/shared test         # 必须全绿
curl -sS http://127.0.0.1:3030/api/harness/config | jq -e '.protocolVersion' >/dev/null  # 必须 200 OK + JSON parseable
```

**Escape hatch（UI-only 场景）**——纯 UI 改动跑 vitest 是浪费：

- **用户/Claude 显式声明**：用户说 "skip vitest because UI-only" / "因为只动 UI/Settings 视图，不改 protocol" → 跳过 vitest
- **自动判定 UI-only**：`git diff --name-only HEAD` 不包含以下任一路径时视为 UI-only：
  - `packages/shared/`
  - `packages/backend/src/routes/`
  - `packages/backend/src/harness-config.ts`
  - `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`
  - `packages/ios-native/Sources/ClaudeWeb/Harness/HarnessStore.swift`
  - `packages/shared/fixtures/harness/`
- **escape hatch 时仍跑 curl**——30ms 几乎零成本，确认 backend 活着

**vitest fail 处理**：abort，提示用户先修测试。**禁止跳过 build vitest fail 的代码**。

## 2. 跑 deploy.sh（不要单独跑 xcodegen）

```bash
bash packages/ios-native/scripts/deploy.sh
```

**4 步骤**（deploy.sh 内部）：
1. `buildinfo.sh` — bump build number（`~/.claude-web/ios-build-counter` +1，写 `BuildInfo.swift`）
2. `xcodegen generate` — 已含；**不要 skill 层再跑一次**（重复触发 Xcode 全 re-index 慢）
3. `xcodebuild` — Debug + 真机或 sim destination
4. `xcrun devicectl device install + process launch`（真机）或 `xcrun simctl install + launch`（sim）

**失败时优先 tail log**：
- `/tmp/_xcodebuild_native.log`（build 失败）
- `/tmp/_launch.log`（install/launch 失败）

## 3. xcodebuild 失败处理

`xcodebuild` 报错→真错误。tail log 看具体行：
- `provisioning paramter list ... No provider was found.` → 跑 `xcodebuild -allowProvisioningUpdates ...` 重 build（deploy.sh 默认已加，可能罕见情况漏了）
- 模块 not found / Swift compile error → 跑 vitest 已 PASS 但 Swift 端没改，往 `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift` 找未同步字段
- 公共 build 问题 → 见 `~/.claude/skills/ios-e2e-test/SKILL.md` 失败速查表（行 116-126）

## 4. 锁屏 launch fail 处理（核心 M0 经验）

**这是 M0 build 31/32/33 三次都撞到的最高频"假错误"**——退出码 1 + 大段 RequestDenied log 让人误以为真错误，**实际 install 已成功**，等用户解锁就好。

### 必要条件（三关键字 AND）

stderr 必须**同时**包含以下 3 个 substring 才判定锁屏（任一缺失则不能用此判定）：

1. `was not, or could not be, unlocked`（**主关键字**，与 KeyChain 等无关）
2. `FBSOpenApplicationServiceErrorDomain`（锁定场景独有的服务域）
3. `Locked`（context 加固，过滤 false-positive）

### 正向证据（确认 install 成功）

**同时**满足：

- `~/.claude-web/ios-build-counter` 的 mtime 在过去 5 分钟内（buildinfo bump 已写）→ 可用 `find ~/.claude-web/ios-build-counter -mmin -5` 验证
- 输出含 `Acquired tunnel connection to device`（devicectl 已建 connection）
- **不**含 `xcodebuild failed` / `Install failed` / `App installation failed`

### 判定 + 回报

**必要条件 AND 正向证据双满足** → 不是真错误：

```
Build N installed successfully on <device>. Launch deferred (device locked).
Unlock the device — app is on home screen.
```

**否则** → 当真错误处理（exit 1 是真错），先 tail `/tmp/_launch.log` 看具体原因。

## 5. Mac TTS 通知用户解锁验证（每次都跑）

```bash
BN=$(cat ~/.claude-web/ios-build-counter 2>/dev/null || \
     grep buildNumber packages/ios-native/Sources/ClaudeWeb/BuildInfo.swift | sed 's/.*"\(.*\)".*/\1/')
say -v Tingting "Build $BN 装好了，请解锁验证"
```

**N 来源优先级**：
1. `~/.claude-web/ios-build-counter`（deploy.sh 的 buildinfo.sh 维护，最新）
2. fallback `Sources/ClaudeWeb/BuildInfo.swift` 的 `buildNumber` 字段（万一计数器文件丢失）

通用化——每次 install 成功（含锁屏 deferred）都跑这步。

## 6. 失败模式速查表（install-specific only）

| 症状 | 修复 |
|---|---|
| 锁屏 launch fail（三关键字 AND + 正向证据双满足） | **不是错误**——见 §4 |
| `provisioning paramter list ... No provider was found.` | `xcodebuild -allowProvisioningUpdates ...` 重 build |
| `~/.claude-web/ios-build-counter` 不存在 | 手动 `echo 1 > ~/.claude-web/ios-build-counter`，下次 deploy.sh 会 +1 |

**公共项指向 ios-e2e-test**（不重复造表）：

- cwd allowlist 报错 → 见 ios-e2e-test 失败速查表
- devicectl 找不到设备 → 见 ios-e2e-test
- xcodebuild 失败（非 provisioning） → 见 ios-e2e-test

## 7. 反例（不要这样做）

- ❌ **跳过 vitest gate 直接 build**（除非 UI-only 命中 §1 escape hatch）—— 浪费 1-2min build 时间
- ❌ **把锁屏 launch fail 当真错误退出**（见 §4 三关键字 AND + 正向证据）—— 误导用户以为 install 失败，实际可以马上解锁就用
- ❌ **不通知用户就静默退出** —— 用户不知道要去解锁，等不到 app
- ❌ **单独跑 xcodegen 再跑 deploy.sh** —— deploy.sh 已含 xcodegen，重复触发 Xcode 全 re-index
- ❌ **用 install.sh**（已删除，2026-04-30 旧版）—— 走 `ios-deploy` 与 deploy.sh 的 `devicectl` 路径分叉

## 8. 历史上下文 / 关联

**M0 三轮真机经验来源**（[docs/retrospectives/M0.md](../../../docs/retrospectives/M0.md)）：
- M0-A modelList Round → Build 31
- M0-B permissionModes Round → Build 32
- M0-C agentProfiles Round → Build 33
- 三次 launch 全部 fail "device locked"，三次都 install 已成功 → 沉淀为 §4

**M0 retro §5 第 6 条经验**："真端到端验证不是看 SwiftUI 屏幕，是看 telemetry 事件"——install 成功不等于功能验证。本 skill 只负责把 build 装到设备；**功能验证靠用户解锁后真机看 UI / 看 telemetry**（或走 ios-e2e-test 的 sim probe）。

**M0 retro §7 挂起项**：M2 起 Releaser agent 自动跑 deploy.sh 时，锁屏假阳性会让 PR gate 误判 fail——届时必须改 deploy.sh exit code 语义（[plan §20 后续](../../../../../.claude/plans/workflow-expressive-canyon.md)）。

**项目级 vs 用户级**：本 skill 在项目仓库内（`.claude/skills/ios-install/`）git-tracked，**不在 `~/.claude/skills/`**。理由：跨 Mac 重装时 `git clone` 即恢复，且团队/未来自己版本一致。
