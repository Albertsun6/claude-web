---
name: ios-sim-e2e
description: 在 iOS 模拟器上跑 Seaidea 的机器可验证 E2E 测试：后端 API 全链路、Swift 编译、App 启动、网络联通。沉淀 M1 Harness Board 首次模拟器验证经验。Use when 用户说"模拟器测试"、"sim E2E"、"先在模拟器验证"、"simulator test"、"模拟器跑一遍"，或在装真机前想先验证功能正确。真正需要人眼验证的 UI 交互不在本 skill 范围。
---

# iOS Simulator E2E Skill

在 Booted 模拟器上完整验证 Seaidea，分四层：

1. **后端 API 层** — curl 全链路
2. **Swift 编译** — xcodebuild for sim
3. **App 启动** — simctl launch
4. **网络联通** — 模拟器 → 127.0.0.1:3030

UI 渲染、Sheet 弹出、手势交互等需要 XCUITest target，当前不自动验证——完成后提示用户在模拟器里手动点一遍。

---

## 0. 前置 gate（同 ios-install §1）

```bash
# curl gate（必跑，30ms）
curl -sS http://127.0.0.1:3030/api/harness/config | python3 -c "import sys,json; d=json.load(sys.stdin); print('backend OK, proto:', d['protocolVersion'])"
```

**vitest gate（UI-only 时可跳过）**：

```bash
# 检查变更范围
git diff --name-only HEAD~1 HEAD
```

若不含 `packages/shared/` / `packages/backend/src/routes/` / `HarnessProtocol.swift` / `HarnessStore.swift` → 自动判定 UI-only，跳过 vitest。否则：

```bash
pnpm --filter @claude-web/shared test
```

---

## 1. 确认 Booted 模拟器

```bash
xcrun simctl list devices booted
```

若无 Booted 设备，启动一个：

```bash
xcrun simctl boot "iPhone 17"   # 或列表中任意 iPhone
open -a Simulator
sleep 5
```

记录 `SIM_ID`（形如 `8CFC97FD-0140-4593-92DA-2E3CD398080E`）。

---

## 2. xcodebuild for simulator

```bash
xcodebuild build \
  -project packages/ios-native/ClaudeWeb.xcodeproj \
  -scheme ClaudeWeb \
  -destination "id=$SIM_ID" \
  -derivedDataPath /tmp/claude-web-sim-build \
  -quiet 2>&1 | tail -1
```

**预期**：`** BUILD SUCCEEDED **`

失败时 tail log：

```bash
cat /tmp/claude-web-sim-build/Logs/Build/*.xcactivitylog 2>/dev/null | head -100
# 或直接
xcodebuild build ... 2>&1 | grep error:
```

---

## 3. 安装 + 启动 App

```bash
APP="/tmp/claude-web-sim-build/Build/Products/Debug-iphonesimulator/ClaudeWeb.app"

xcrun simctl terminate $SIM_ID com.albertsun6.claudeweb-native 2>/dev/null || true
xcrun simctl install $SIM_ID "$APP"
xcrun simctl launch $SIM_ID com.albertsun6.claudeweb-native
```

**验证**：launch 返回 PID，exit 0。

---

## 4. 后端 API 全链路验证

模拟器与 Mac 共享 `127.0.0.1`，直接 curl 后端：

### 4a. 基础端点

```bash
curl -sf http://127.0.0.1:3030/health && echo "health OK"
curl -sf http://127.0.0.1:3030/api/harness/config | python3 -c "import sys,json; d=json.load(sys.stdin); print('config OK, proto:', d['protocolVersion'])"
curl -sf http://127.0.0.1:3030/api/projects | python3 -c "import sys,json; d=json.load(sys.stdin); print('projects OK, count:', len(d['projects']))"
```

### 4b. Harness Board 全链路

取当前项目 UUID（claude-web 项目固定，其他项目从 `/api/projects` 查）：

```bash
CWD="/Users/yongqian/Desktop/claude-web"
UUID=$(curl -sf http://127.0.0.1:3030/api/projects | python3 -c "
import sys, json
projects = json.load(sys.stdin)['projects']
match = [p for p in projects if p['cwd'] == '$CWD']
print(match[0]['id'] if match else 'NOT_FOUND')
")
echo "project UUID: $UUID"
```

**8 步流水**：

```bash
# 1. list initiatives
curl -sf "http://127.0.0.1:3030/api/harness/initiatives?projectId=$UUID" | python3 -c "import sys,json; d=json.load(sys.stdin); print('list initiatives OK, count:', len(d['data']))"

# 2. create initiative
INIT=$(curl -sf -X POST http://127.0.0.1:3030/api/harness/initiatives \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$UUID\",\"cwd\":\"$CWD\",\"title\":\"Sim E2E $(date +%H:%M:%S)\"}")
INIT_ID=$(echo $INIT | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "initiative: $INIT_ID"

# 3. create issue
ISSUE=$(curl -sf -X POST http://127.0.0.1:3030/api/harness/issues \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$UUID\",\"initiativeId\":\"$INIT_ID\",\"title\":\"Sim E2E issue\"}")
ISSUE_ID=$(echo $ISSUE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "issue: $ISSUE_ID"

# 4. create stage
STAGE=$(curl -sf -X POST http://127.0.0.1:3030/api/harness/stages \
  -H "Content-Type: application/json" \
  -d "{\"issueId\":\"$ISSUE_ID\",\"kind\":\"spec\"}")
STAGE_ID=$(echo $STAGE | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "stage: $STAGE_ID"

# 5-6. state transitions
curl -sf -X PUT "http://127.0.0.1:3030/api/harness/stages/$STAGE_ID/status" \
  -H "Content-Type: application/json" -d '{"status":"running"}' | python3 -c "import sys,json; print('running OK:', json.load(sys.stdin)['ok'])"
curl -sf -X PUT "http://127.0.0.1:3030/api/harness/stages/$STAGE_ID/status" \
  -H "Content-Type: application/json" -d '{"status":"awaiting_review"}' | python3 -c "import sys,json; print('awaiting_review OK:', json.load(sys.stdin)['ok'])"

# 7. create decision
DEC=$(curl -sf -X POST http://127.0.0.1:3030/api/harness/decisions \
  -H "Content-Type: application/json" \
  -d "{\"stageId\":\"$STAGE_ID\",\"requestedBy\":\"PM\",\"question\":\"Approve?\",\"options\":[\"approve\",\"reject\"]}")
DEC_ID=$(echo $DEC | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "decision: $DEC_ID"

# 8. resolve
curl -sf -X PUT "http://127.0.0.1:3030/api/harness/decisions/$DEC_ID" \
  -H "Content-Type: application/json" \
  -d '{"chosenOption":"approve","decidedBy":"user"}' | python3 -c "import sys,json; print('resolve OK:', json.load(sys.stdin)['ok'])"

echo "=== Harness API E2E: ALL PASS ==="
```

任何步骤失败（非 200、JSON parse 错误）→ 立即 abort，检查 `tail -5 ~/Library/Logs/claude-web-backend.stderr.log`。

---

## 5. 清理测试数据（可选）

E2E 创建的 initiative/issue/stage/decision 留在 DB 里不影响功能，但污染列表。开发期间保留供复盘；需要清理时：

```bash
PATH="/opt/homebrew/Cellar/node/25.8.0/bin:$PATH" node -e "
const db = require('$HOME/.claude-web/harness.db');  // 不要用这种方式
"
# 正确方式：直接用 sqlite3
sqlite3 ~/.claude-web/harness.db "DELETE FROM initiative WHERE title LIKE 'Sim E2E%';"
```

---

## 6. 手动 UI 验证 checklist（模拟器操作）

机器自动化止步于 §4。以下需要人眼在模拟器里确认：

- [ ] 抽屉打开 → 看到"🔬 Harness 看板"行
- [ ] 点击 → HarnessBoardView sheet 弹出，显示 Initiative 列表（含 §4 创建的条目）
- [ ] 点 + → 填标题 → 创建成功 → 列表新增
- [ ] 点 Initiative → IssueListView → 创建 Issue → 进 StageListView
- [ ] 添加 stage → 左滑"开始"→ status 变 running
- [ ] 左滑"等审批" → status 变 awaiting_review
- [ ] 左滑"审批" → DecisionSheet 弹出 → 点"✅ 批准" → sheet 关闭
- [ ] 关闭 Board → 回到主聊天界面，旧功能正常

全部 ✅ 后再装真机。

---

## 7. 失败模式速查

| 症状 | 原因 | 修复 |
|---|---|---|
| xcodebuild error: module not found | Swift 协议字段不同步 | 检查 HarnessProtocol.swift vs harness-protocol.ts |
| App launch 后立刻 crash | Swift runtime 崩溃 | `xcrun simctl diagnose` 或看 Console.app |
| `{"ok":false,"error":"harness unavailable"}` | better-sqlite3 node 版本不匹配 | `PATH="/opt/homebrew/Cellar/node/25.8.0/bin:$PATH" pnpm --filter @claude-web/backend rebuild better-sqlite3` |
| Harness Board decode 错误 | URL query param 被 percent-encode | HarnessAPI.swift request() 用字符串拼接，不用 appendingPathComponent |
| projectId 冲突 500 | 传了 cwd 路径而非 UUID | DrawerContent 从 registry.project(forCwd:)?.id 取 UUID |

---

## 8. 历史上下文

**M1 首次模拟器验证（2026-05-04）**：

- 发现 `appendingPathComponent` 把 `?projectId=` 中的 `?` percent-encode 成 `%3F`，后端 404 → iOS decode 错误"The data couldn't be read because it isn't in the correct format."
- 发现 iOS 用 `settings.cwd`（路径）作 projectId，触发 `SQLITE_CONSTRAINT_UNIQUE`，500
- 两个 bug 均通过此 E2E 流程发现并修复（commit 30c29c4）

**关联 skill**：
- `ios-install` — 验证通过后装真机
- `ios-e2e-test` — 含 sim 测试 Phase 1-5，本 skill 是 Phase 5 的简化版（专注 Harness Board）
