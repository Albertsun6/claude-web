# ADR-013: Rename Strategy（claude-web/Eva → Vessel 改名 runbook）

- **Status**: Accepted
- **Date**: 2026-05-09
- **Deciders**: yongqian
- **Tags**: rename, fork, eva-evolution, ios, methodology
- **Resolves**: v5.1 第五轮外部 AI 评审 Q2（"加 ADR-013 或至少一份 rename runbook；不要重写 git history 除非 secrets"）+ v5.4 dogfood R-09
- **Depends on**: ADR-000-adopt-eva-codebase-as-vessel-foundation
- **Spike report**: 无（决策由 EVA_INVENTORY iOS 配置盘点 + gitleaks 扫描结果驱动）

## Context

ADR-000 锁定 D' 路线（fork Eva 仓库）。改名工程横跨：

- git remote / origin / local branch（仓库级）
- `package.json` `name` 字段（pnpm workspace 多包）
- iOS bundle id / display name / Team ID / Xcode scheme（59 Swift 文件涉及）
- 部署脚本 / 启动命令（`pnpm dev:backend` 等）
- 文档内部链接（`README` / `CLAUDE.md` / 50+ 处 Eva/claude-web 引用）
- 数据目录（`~/.claude-web/` → `~/.vessel/`）
- 缓存目录（iOS Application Support 自动跟随 bundle ID）

第五轮外部 AI 评审 Q2 警告：**不要为了改名重写 git history**；只有发现 secrets 时才用 git filter-repo，并先备份 mirror。

v5.4 dogfood R-09 增订：iOS bundle id 改名 → TestFlight 重新审核 2-3 天。

## Decision

### 1. 改名总策略

**保留 git 历史 + fork-rename + 渐进改名**：

- ✅ 保留完整 git 历史（gitleaks 已扫 clean）
- ✅ git remote 加 alias（旧 `claude-web-legacy` 保留只读引用）
- ✅ Vessel 新 remote 上传（GitHub 仓库改名 / 或新建）
- ❌ **不重写 git history**（只在 gitleaks 发现真 secrets 时才用 git filter-repo + 先备份 mirror）

### 2. 改名 Checklist（按依赖顺序）

#### Stage 1: 仓库 + 包名（0B 第一阶段，可立即做）

- [ ] **本地目录**：`mv ~/Desktop/claude-web ~/Desktop/Vessel`（**Vessel/ 已存在作为 plan 目录，需先合并**——见 §3）
- [ ] **git remote 改 / 加 alias**：
  ```bash
  git remote rename origin claude-web-legacy
  git remote add origin <new-vessel-url>  # GitHub 改名后的 URL
  ```
- [ ] **root `package.json`**：`"name": "claude-web"` → `"name": "vessel"`
- [ ] **每个 workspace `package.json`**：
  - `packages/backend/package.json`：`"name": "@claude-web/backend"` → `"@vessel/backend"`
  - `packages/frontend/package.json`：`"@claude-web/frontend"` → `"@vessel/frontend"`
  - `packages/shared/package.json`：`"@claude-web/shared"` → `"@vessel/shared"`
- [ ] **pnpm workspace 引用**：根 `pnpm-workspace.yaml` 不需改（路径未变）；但所有 import `@claude-web/shared` 改 `@vessel/shared`（grep 替换）
- [ ] **`pnpm install`** 重新解析依赖
- [ ] **CI / GitHub Actions**：`.github/workflows/*.yml` 中所有 `claude-web` 引用改 `vessel`（如有）

#### Stage 2: 数据目录（0B 第二阶段）

- [ ] **数据目录**：`~/.claude-web/` → `~/.vessel/`（按 EVA_TO_VESSEL_MAPPING §2 数据迁移脚本）
  - `harness.db` 复制（不删源）
  - `inbox.jsonl` 复制
  - `artifacts/` 复制
  - `projects.json` 复制
  - `telemetry.jsonl` → `~/.vessel/traces/telemetry-legacy.jsonl`
  - `eva.json` **不迁**（worktree orchestration，Eva 业务）
- [ ] **dry-run 必跑**：`pnpm migrate:eva-to-vessel --dry-run` 退出码 0
- [ ] **DATA_DIR 常量**：`packages/backend/src/data-dir.ts` `~/.claude-web` → `~/.vessel`
- [ ] **环境变量**（v0-pre 修订：**不留代码侧 fallback**，迁移脚本 alert 用户改 env）：
  - `CLAUDE_WEB_DATA_DIR` → `VESSEL_DATA_DIR`
  - `CLAUDE_WEB_TOKEN` → `VESSEL_TOKEN`
  - `CLAUDE_WEB_ALLOWED_ROOTS` → `VESSEL_ALLOWED_ROOTS`
  - 迁移脚本启动时检测 `CLAUDE_WEB_*` env vars → alert "请改成 VESSEL_*" → 退出
  - **不在代码里写 `process.env.VESSEL_X || process.env.CLAUDE_WEB_X`**（避免长期维护双名债务，pragmatist M-P1）

#### Stage 3: 文档 + 内部链接（0B 第三阶段）

- [ ] **README.md / CLAUDE.md / docs/\*.md**：grep 替换 `claude-web` → `vessel`（敏感）；保留 `Eva` 作为旧仓库 codename（按 v5.4 plan 术语区分）
- [ ] **package scripts**：`pnpm dev:backend` 等 script name 是否要改？**保留**（路径相对，不影响）
- [ ] **fixture 文件**：`packages/shared/fixtures/` 内若有 hardcoded `claude-web` 字符串，按需改
- [ ] **CLAUDE.md** 顶部增订：「项目原 codename Eva（claude-web），fork-rename 为 Vessel；详见 ADR-000」

#### Stage 间 Checkpoint（v0-pre 修订，pragmatist B-P1）

每个 Stage 完成后必须跑：

```bash
pnpm install              # 解析依赖
pnpm test:cli             # backend 核心 cli-runner / scheduler / permission 测试
pnpm test:protocol        # shared 协议 fixture 测试
./scripts/verify-rename.sh   # 自动检查 claude-web/Eva 残留（不在 eva-legacy/ 内的）
```

任一失败 → 回退到 Stage 起点 + 修复 + 重跑。**禁止**带 broken state 进下一 Stage。

#### Stage 5（v0-pre 修订，2026-05-09 owner E2 决策）：0B 收尾 secrets re-scan（**结果进 log，不阻塞**）

`gitleaks detect --no-git --source .` + `gitleaks detect --source .`（含 git 历史）。

**新规则**（按 ADR-014 §「硬触发 #5」修订版）：
- 🚨 **真实 production secret** → 立即 escalation owner（撤 token + filter-repo + force push）
- ✅ **test token / 示例 token / 借鉴代码 leftover** → 写入 [`docs/security/SECRETS_AND_TEST_TOKENS_LOG.md`](../../security/SECRETS_AND_TEST_TOKENS_LOG.md)，**不阻塞** Stage 5 → Stage 6
- 不阻塞进入 Stage 6 / 后续 milestone；v0.1 release 前 release gate 集中检查

#### Stage 6（v0-pre 修订，2026-05-09 owner E2 决策）：0B license scan（**结果进 log，不阻塞**）

```bash
# 安装一次：
pnpm install -g license-checker

# 扫所有 workspace 依赖（不强制 fail）：
license-checker --excludePackages "$(grep -l 'workspace:' packages/*/package.json | xargs -n1 dirname | xargs -I {} basename {})" \
                --csv > /tmp/license-report.csv

# 命中 AGPL / SSPL / BUSL 的依赖：
grep -E "AGPL|SSPL|BUSL" /tmp/license-report.csv
```

**新规则**（按 ADR-014 §「硬触发 #6」修订版）：
- ✅ AGPL / SSPL / BUSL 命中 → 写入 [`docs/legal/THIRD_PARTY_LICENSE_LOG.md`](../../legal/THIRD_PARTY_LICENSE_LOG.md)（`status: copied-temporarily` 或 `needs-replacement`），**不阻塞**当前 milestone
- ✅ 可以先借鉴或搬用（包括跑 pnpm install 让依赖进来），但必须记录来源 + 处理期限 = before-v0.1-release
- v0.1 release 前 release gate 集中检查：所有 active 条目 status 已处理

同时（同样 log + defer）：
- Eva 文档资产（docs/、icon、launch screen）license 归属 → owner 手动 audit；第三方资产无 license 的写入 LICENSE log（不阻塞）

#### Stage 4: iOS 改名（M2-iOS，**不在 0B 做**——避免阻塞前面 milestone）

- [ ] **CFBundleDisplayName**：`Info.plist` line 8 `Seaidea` → `Vessel`（或 owner 决定的新名）
- [ ] **PRODUCT_BUNDLE_IDENTIFIER**：`project.pbxproj` 多处（main app + tests + uitests）：
  - `com.albertsun6.claudeweb-native` → `com.albertsun6.vessel-native`
  - 测试 target：`...vessel-native.tests` / `...vessel-native.uitests`
- [ ] **DEVELOPMENT_TEAM**：保持 `V84XLAQ28F` 不变
- [ ] **NSLocalNetworkUsageDescription**：`Info.plist` line 29 "Seaidea connects..." → "Vessel connects..."
- [ ] **NSMicrophoneUsageDescription**：`Info.plist` line 31 "Seaidea needs..." → "Vessel needs..."
- [ ] **`struct ClaudeWebApp: App`**：`Sources/ClaudeWeb/ClaudeWebApp.swift` line 10 → `struct VesselApp: App`
- [ ] **Cache fallback string**：`Cache.swift` line 40 `"com.albertsun6.claudeweb-native"` → `"com.albertsun6.vessel-native"`
- [ ] **Xcode scheme**：`ClaudeWeb` → `Vessel`（Xcode UI 操作）
- [ ] **Source 目录名**：`Sources/ClaudeWeb/` 是否改为 `Sources/Vessel/`？**保留旧名**（避免 import path 大改），仅 struct 名 + bundle id 改
- [ ] **App Store Connect**：新建 Vessel app record（旧 Eva record 保留作为历史）
- [ ] **TestFlight**：新 build 走 Vessel app record；2-3 天审核期内**保留 Eva 旧 build 可用**（不破坏现有 TestFlight 用户）
- [ ] **iOS Cache 自动迁移**：`Cache.swift` Bundle.bundleIdentifier 动态读取，新 bundle ID 自动用新 Application Support 路径；**老缓存不自动删**（用户首次开新版本会重新拉数据；老缓存可手动清）

### 3. 当前 Vessel/ 目录冲突处理（**v0-pre 修订：锁定方案 B，删除破坏性方案 A**）

> **2026-05-09 修订**：v0-pre 4-way Phase 1 评审 cursor B1 + risk-officer B-R1（4 类硬触发 #8）找出原方案 A 的 `rm -rf ~/Desktop/Vessel` 是破坏性 runbook（即使备份只覆盖 docs/，会删除非 docs 内容 / 隐藏文件 / 未来本地状态）。**已锁定方案 B 作为唯一路径**。详见 [escalation inbox E1](../../../instance/inbox/2026-05-09-2255-0-pre-escalations.md#e1)。

**锁定方案（B）：rsync 复制 + 保留 git 历史**：

```bash
# Stage 1.0：先备份当前 Vessel/（防意外，不依赖任何脚本逻辑）
cp -r ~/Desktop/Vessel ~/Desktop/Vessel-backup-$(date +%Y-%m-%d-%H%M)

# Stage 1.1：把 claude-web 的所有内容（含 .git）rsync 到 Vessel/
rsync -avh --exclude='.git' ~/Desktop/claude-web/ ~/Desktop/Vessel/
cp -r ~/Desktop/claude-web/.git ~/Desktop/Vessel/.git

# Stage 1.2：解决文件冲突（Eva 旧 docs/architecture/ vs Vessel docs/architecture/）
# - Eva 旧 ARCHITECTURE.md / CONCEPTS.md 在 docs/（来自 Vessel 0-meta-lite 搬过来的） → 保留 Vessel 版（更新）
# - Eva 旧 ADR-0011 等 → 移到 docs/adr/eva-legacy/（按 ADR-000 决议）
# - 其他冲突文件：人工 review

# Stage 1.3：claude-web 仓库本身保留（不删，作为参考 / 紧急回退）
# 如未来确认 Vessel 完整可用且不再需要 claude-web 副本：
#    mv ~/Desktop/claude-web ~/Desktop/_old-claude-web-archive-$(date +%Y-%m-%d)
#    （**不直接删**，仅 rename + 加 archive 前缀）
```

**禁止操作**（ADR-014 escalation #8 破坏性数据迁移命中）：
- ❌ `rm -rf ~/Desktop/Vessel`（即使备份了 docs/）
- ❌ `rm -rf ~/Desktop/claude-web`（保留作参考）
- ❌ 不经 owner 显式 review-and-confirm 的目录删除

**escape hatch**：如确实需要删除老 Vessel/ 或 claude-web/，必须：
1. `mv` 到 trash 目录或 `~/_archive/`（不直接 rm）
2. owner 显式 review-and-confirm（写 inbox 确认文件）
3. 等 14 天观察期，无问题再清理 archive

### 4. 不重写 git history（**HARD constraint**）

按 v5.1 评审 Q2：
- ✅ 保留所有 commit hash（不破坏现有引用）
- ✅ Eva commit 作者保留为 yongqian（个人项目，无作者改名需求）
- ❌ **不**用 `git filter-repo` 重写历史（除非真发现 secrets，且当前 gitleaks 扫 clean）
- ❌ **不**用 `git rebase --root` 改改提交信息

如未来发现 secrets：先 `git clone --mirror` 备份；再 `git filter-repo --invert-paths --path <leak-file>`；推送后通知所有 mirror 重新克隆。

### 5. 可回退点（万一改名出错）

- 0B Stage 1 失败 → `git remote rename claude-web-legacy origin` 恢复
- Stage 2 失败 → `~/.claude-web/` 数据未删，复用即可
- Stage 3 失败 → 文档 commit revert
- Stage 4 (iOS) 失败 → bundle ID rollback 但 TestFlight 已审核 build 仍可用（多版本并存）

## Consequences

### 正面

- ① **改名成本可控**——按 4 个 Stage 渐进，不一次性 big bang
- ② **保留 git 历史**——不破坏 commit hash 引用，Eva 决策路径作为证据保留
- ③ **iOS 改名不阻塞 0B**——推到 M2-iOS（TestFlight 审核可以等）
- ④ **数据迁移非破坏性**——dry-run + 不删源（按 EVA_TO_VESSEL_MAPPING §2）
- ⑤ **gitleaks 已扫 clean**——可放心保留 git 历史，不需要 filter-repo

### 负面

- ① **改名 checklist 长**（30+ 项），漏一项可能导致编译/runtime 失败 → 缓解：每 Stage 跑 `pnpm install` + `pnpm test:cli` + `pnpm test:protocol` 验证
- ② **iOS 改名引发 TestFlight 重审**（2-3 天 Apple 审核）→ 缓解：M2-iOS 时安排，提前打包 build
- ③ **Vessel/ 目录冲突需 owner 决策**（见 §3 + escalation #1）
- ④ **环境变量改名会打断旧配置** → 缓解方式：迁移脚本检测 `CLAUDE_WEB_*` 并 alert 用户改成 `VESSEL_*` 后再跑；**代码不保留 fallback**（避免长期维护双名债务，pragmatist M-P1 + v0-pre 顺手修正 2026-05-09）

### 中性

- 跟 ADR-000（fork） + ADR-001（pnpm） + ADR-006（schema 演进） 高度耦合
- ADR-005（INSTANCE 隔离）继续生效：`instance/` 目录在新 Vessel 仓库内

## Prior Art

参考：
- **GitHub repository transfer / rename**（GitHub docs）：保留 fork / star / issue 历史
- **npm package deprecation + redirect**（npm docs）：旧 name 保留几个月，重定向到新 name
- **iOS bundle id transfer**（Apple Developer docs）：新 app record 推荐 fresh

Search keywords: `["monorepo rename git history preserve", "iOS bundle id rename testflight transition", "npm workspace package rename"]`

## 验证

- ADR-013 Status = Accepted（**已**）
- 0B Stage 1 完成：`pnpm install` 退出码 0；`pnpm test:cli` 通过
- 0B Stage 2 完成：`pnpm migrate:eva-to-vessel --dry-run` 退出码 0；实迁后 `~/.vessel/harness.db` 存在
- 0B Stage 3 完成：`grep -ri "claude-web" docs/` 不命中 Vessel 主文档（Eva legacy ADR 内除外）
- 0B Stage 4（M2-iOS 时）：iOS app TestFlight build 上传成功；Bundle ID 显示新值

## Escalation Notes

### #1: Vessel/ 目录与 claude-web/ 合并方案

owner 需在 0B 第一步前决定：
- A. 备份 Vessel/ docs → 删除 Vessel/ → mv claude-web → 恢复 docs（涉及短暂数据移动）
- B. claude-web rsync 复制到 Vessel/（保留 git via `cp -r .git`，处理文件冲突）

推荐 **B**（更稳，不删除 Vessel 现有内容）。

### #2: iOS App Store Connect 新 record vs 转移

owner 决定：
- A. 新建 Vessel app record（旧 Eva 保留作为历史，TestFlight 用户切换需重装）
- B. 修改现有 Eva app record 的 Bundle ID（**不被 Apple 允许** —— Bundle ID 一旦上传就锁定）

推荐 **A**（Apple 政策强制）。
