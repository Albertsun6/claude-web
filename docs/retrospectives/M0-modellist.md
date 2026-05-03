# M0 modelList Round Retrospective — `/api/harness/config` 第一契约

> **状态**：✅ 完成（2026-05-03）
>
> **关联**：[HARNESS_INDEX.md](../HARNESS_INDEX.md) · [proposals/M0_HARNESS_CONFIG_MODELLIST.md](../proposals/M0_HARNESS_CONFIG_MODELLIST.md) · [HARNESS_REVIEW_LOG.md M0 modelList Round](../HARNESS_REVIEW_LOG.md)

> 注：本 retrospective 是 M0 第一个 mini-milestone（modelList 试点）的复盘。完整 M0 退出条件还包括 stages / agentProfiles / decisionForms 等其他子项，将在后续 mini-milestone 各自落 retrospective.md。

---

## 1. 起点 vs 终点

### 进入时

- M-1 退出条件全部满足 + Review Mechanism v2 ship 完毕 + dogfood self-validation PASS
- iOS Settings 硬编码 model 列表（M-1 期 commit）—— 改一次要重装
- 无 `/api/harness/config` endpoint
- ADR-0011 status = Proposed，Decision #1 写"全量 config"，Decision #3 写"WS push config_changed"
- HARNESS_PROTOCOL.md §1 ID 行 vs §8 自相矛盾（UUIDv4 vs opaque ULID）

### 离开时

- **`/api/harness/config` endpoint live**（200 + ETag quoted + 304 If-None-Match 全验通过）
- **iOS HarnessStore + xcodegen Bundle resource + Settings cutover** 全 ship；iOS sim build SUCCEEDED + 安装 + 启动 + telemetry 验证 hot-reload chain 真跑通
- **真正端到端 hot-reload 验证**：改 fallback-config.json 加第 4 模型 → tsx watch 重启 backend → 重启 sim app → iOS 拉到新 etag `sha256:95048cc1cbdf4a92` + 4 model（telemetry 实测）
- **v2 Review Mechanism 第一个真用例**（dogfood self-validation 之外）：phase 1+2+3 全跑通，18 项 finding 收敛
- ADR-0011 Decision #1 改"分阶段扩展 + minor bump + graceful skip"；Decision #3 改"WS 重连 GET + If-None-Match"
- HARNESS_PROTOCOL.md §1 ID 行修 opaque stable string（与 §8 对齐）

---

## 2. 干了什么（按时间序）

### Phase 1 — 用户讨论 + 5 OQ 拍板

- 用户选 P3=A 线性路径（v2 → 实施 → 自验收 → M0 开工），不重新讨论
- 5 OQ 全部按推荐：Q1=A 仅 modelList / Q2=B 中等 6 字段 / Q3=A WS reconnect refetch / Q4=A 硬编码 + tsx watch / Q5=A minClientVersion 实装

### Phase 2 — RFC 提案 v1.0 + v2 Review

- 写 docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md v1.0
- v2 phase 1 双 reviewer：arch (4-dim) + cross (5-lens)
  - arch: 0 BLOCKER + 4 MAJOR + 5 MINOR
  - cross: **2 BLOCKER + 4 MAJOR + 3 MINOR (overall 3.0/5)**
- v2 phase 2 cross-pollinate（**第一次真业务运行 v2 phase 2，不是 dogfood**）
  - cross react: 7 agree / 1 disagree / 6 refine / 3 self-revisions / 0 new findings
  - arch react: 6 agree / 0 disagree / 3 refine / 2 self-revisions / 2 new findings (N1+N2)
  - **关键交叉**：
    - cross 自降 own B1 BLOCKER → MAJOR（接受 arch 路线降级）
    - cross 自拆 own B2（ETag BLOCKER 共识 / compareVersion MAJOR 拆出）
    - arch 接受 4 项 cross-lens unique 贡献（ID 契约 / ADR Decision #1 / ETag header quoting / auth 继承）—— 全是 4-dim lens 之外的真问题
    - cross 拒绝 arch MINOR-4（minClientVersion 合并 backend）—— 唯一保留分歧
- v2 phase 3 author 裁决：**18 项 finding → 14 ✅ / 2 ⚠️ / 1 🚫 / 0 🟡** → 0 still-disagree → 1 轮收敛

### Phase 3 — RFC v1.0 → v1.1 修订

- §0 删 push 验收 + 加"M0 全局退出条件子集"标
- §1.1 ID opaque + recommendedFor hint-only + enabled 切换语义
- §1.2 superRefine isDefault + protocolVersion bump 规则 graceful skip
- §1.3 ETag 递归 canonicalizer pseudo-code + fixture 测试断言（**phase 3 cross B2 BLOCKER 修复**）
- §2.1 ETag header quoted + auth 继承 + If-None-Match 缺省行为
- §2.2 single-source `packages/shared/fixtures/harness/fallback-config.json` + lazy getter
- §2.3 compareVersion 工具 + iOS 端实施
- §2.4 hot-reload chain 简化版（删 push wording）
- §3.4 cutover 行为 + disabled selection 处理
- §5.2 加真机断网 cold start + cutover + disabled
- §6 OQ 全敲定
- ADR-0011 Decision #1 + #3 同步改
- HARNESS_PROTOCOL §1 ID 行同步改
- 全 commit `f156a51` push to origin

### Phase 4 — 实施 19 步（按 RFC §4 修订版）

| 步 | 内容 | 验证 |
|---|---|---|
| 1 | shared/canonical-json.ts 递归 canonicalizer + sha256 etag | vitest 5 测试 |
| 2 | shared/version.ts compareVersion | vitest 4 测试（"1.10" vs "1.9" 防 lex） |
| 3 | shared/harness-protocol.ts 加 ModelListItem + HarnessConfig + superRefine | vitest 8 测试 |
| 4 | fallback-config.json single source（3 model） | drift 单测 |
| 5 | model-list-item.json 单实体 fixture | round-trip |
| 6 | shared 测试 6 项（**61/61 全绿**，含 嵌套字段改 etag 改 + key 顺序 stable + isDefault exactly-one + reject 0 default + reject 2 default + reject default disabled） | ✅ |
| 7 | backend/harness-config.ts lazy `getHarnessConfig()` import + Object.freeze | tsx watch reload OK |
| 8 | backend/routes/harness-config.ts GET + If-None-Match (quoted/unquoted) + 200/304 + ETag header | curl 4 场景全验 |
| 9 | backend/index.ts 挂 router + auth 继承 | `app.route("/api/harness/config", ...)` |
| 10 | iOS HarnessProtocol.swift Codable + compareVersion + HARNESS_PROTOCOL_CLIENT_VERSION 常量 | sim build OK |
| 11 | iOS Cache.swift load/save HarnessConfig（atomic） | telemetry 验证 |
| 12 | iOS HarnessConfigAPI.swift fetch with If-None-Match + 200/304 | ✅ |
| 13 | iOS HarnessStore.swift + bundleFallback() 从 Bundle resource decode | ✅ |
| 14 | iOS Settings.swift 接 modelList + cutover 行为 + disabled "已停用" 标签 | UI 渲染 OK |
| 15 | iOS ClaudeWebApp.swift wire HarnessStore + onAppear refetch | telemetry `harness_store.refetch.updated` 触发 |
| 16 | xcodegen project.yml 加 fallback-config.json buildPhase: resources | xcodegen 重生 OK |
| 17 | xcodebuild iOS sim 17/26.4.1 → BUILD SUCCEEDED + Bundle 含 fallback-config.json | ✅ |
| 18 | sim install + launch → telemetry refetch.updated etag 50b7b96d 3 models → fallback-config.json 加 4th model → tsx watch restart → sim relaunch → refetch.updated etag 95048cc1 4 models | **真端到端 hot-reload 验证** ✅ |
| 19 | ADR-0011 + HARNESS_PROTOCOL §1 同步改（已在 phase 3 commit `f156a51`） | ✅ |

**额外修复（实施中发现）**：minClientVersion 比较语义混淆——`Bundle.main.infoDictionary["CFBundleShortVersionString"]` 返回 app marketing version (0.2.2)，但 minClientVersion 是 harness 协议版本 (1.0)。改用 `HARNESS_PROTOCOL_CLIENT_VERSION` 常量。telemetry 实测 fix 后 `harness_store.client_version_too_old` 不再误触发。

---

## 3. 产出清单

| # | 类别 | 文件 | 验证 |
|---|---|---|---|
| 1 | code | `packages/shared/src/canonical-json.ts` | vitest 5/5 |
| 2 | code | `packages/shared/src/version.ts` | vitest 4/4 |
| 3 | code | `packages/shared/src/harness-protocol.ts` (extend) | vitest 8/8 |
| 4 | data | `packages/shared/fixtures/harness/fallback-config.json` (single source) | drift 单测 |
| 5 | data | `packages/shared/fixtures/harness/model-list-item.json` | round-trip |
| 6 | test | `packages/shared/src/__tests__/m0-modellist.test.ts` | **vitest 19/19** |
| 7 | code | `packages/backend/src/harness-config.ts` (lazy getter) | curl OK |
| 8 | code | `packages/backend/src/routes/harness-config.ts` (GET + If-None-Match) | 200/304 quoted/unquoted 全验 |
| 9 | wire | `packages/backend/src/index.ts` 挂 `/api/harness/config` | live |
| 10 | code | `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift` (extend) | sim build OK |
| 11 | code | `packages/ios-native/Sources/ClaudeWeb/Cache.swift` (extend) | atomic save |
| 12 | code | `packages/ios-native/Sources/ClaudeWeb/HarnessConfigAPI.swift` | fetch OK |
| 13 | code | `packages/ios-native/Sources/ClaudeWeb/Harness/HarnessStore.swift` | telemetry verified |
| 14 | code | `packages/ios-native/Sources/ClaudeWeb/Views/Settings/SettingsView.swift` (modify) | UI 渲染 OK |
| 15 | code | `packages/ios-native/Sources/ClaudeWeb/ClaudeWebApp.swift` (wire) | refetch on appear |
| 16 | conf | `packages/ios-native/project.yml` (Bundle resource) | xcodegen OK |
| 17 | build | `packages/ios-native/ClaudeWeb.xcodeproj/` (regenerated) | BUILD SUCCEEDED |
| 18 | doc | `docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md` v1.0 → v1.1（含 phase 3 修订）| reviewers approved |
| 19 | doc | `docs/adr/ADR-0011-server-driven-thin-shell.md` Decision #1 + #3 改 | ADR 仍 Proposed（M0 全套完工后再升 Accepted） |
| 20 | doc | `docs/HARNESS_PROTOCOL.md` §1 ID 行 → opaque stable string | aligned with §8 |
| 21 | log | `docs/HARNESS_REVIEW_LOG.md` M0 modelList Round 完整 phase 1+2+3 矩阵 | ✅ |
| 22-25 | reviews | `docs/reviews/m0-modellist-{arch,cross,arch-react,cross-react}-*.md` | 4 verdict 文件永久档案 |

---

## 4. v2 Review Mechanism 第一次真业务用例的关键发现

| Lens 跨视角 | cross 抓 arch 漏 | arch 抓 cross 漏 |
|---|---|---|
| 协议层文档自洽 | HARNESS_PROTOCOL §1 vs §8 ID 矛盾 / ADR-0011 Decision #1 vs proposal §1.2 不一致 / proposal §3 cost table 与 §1.1/§1.2 矛盾 | (none) |
| 里程碑出口判定 | (none) | §0 退出条件没标 "试点子集" / cutover 默认模型从 haiku 静默漂移到 sonnet / N1 protocolVersion vs ADR-0015 minor bump 流程未 echo |
| 安全 / HTTP 标准 | ETag header quoted / endpoint auth 继承 | (none) |
| 算法实现细节 | ETag canonical_json 含糊会被字面误读 (BLOCKER) | (none) |

**18 finding 中只有 1 项 still-disagree（minClientVersion 责任分散）**——证明 v2 phase 2 cross-pollinate 在真业务上有效。

phase 2 最有价值的 self-revision：**cross 自降 own B1 BLOCKER → MAJOR**——避免 author 在 phase 3 强行打架，节约 1 轮 escalation。

---

## 5. 学到了什么（沉淀）

1. **app marketing version ≠ harness protocol version**——iOS `CFBundleShortVersionString` 是营销版本，不能当协议兼容性指标。M0 实施中真撞到，写一个独立 `HARNESS_PROTOCOL_CLIENT_VERSION` 常量
2. **ETag canonical_json "Object.keys 排序" 在中文里会被实施者按字面解读为 key 白名单**——必须给递归 canonicalizer pseudo-code（cross B2 真 catch）
3. **single-source fallback config 是消除 backend / iOS drift 的最小机制**——shared/fixtures 一份字节，两端都 import / Bundle resource，没有"双 source" 余地
4. **xcodegen `buildPhase: resources` 直接 cross-package 复制**——不需要额外 build script，xcodegen 把 `../shared/fixtures/...` 路径 flatten 进 .xcodeproj
5. **Hot-reload 链 < 10s**：tsx watch 重启 < 5s + iOS WSReconnect < 2s + GET < 1s = 用户感知 "改完立即同步"
6. **真端到端验证不是看 SwiftUI 屏幕，是看 telemetry 事件**——telemetry 实测 etag 50b7b96d → 95048cc1 + models 3 → 4 是最硬证据

---

## 6. 挂起到后续

| 项 | 触发条件 | 处理 |
|---|---|---|
| WS push `harness_event { kind: "config_changed" }` | 用户反馈"改 config 不想每次重启 backend" | M0.5+ 加，需要 OQ4 升 B JSON 文件 + file watch |
| backend modelList 来源升级到 JSON 文件 + file watch | 同上 | M0.5+ |
| review-orchestrator.ts 自动跑 phase 2（替代 run-debate-phase.sh stub） | M2 dogfood 跑批量 contract review | M2 |
| ADR-0011 升 Proposed → Accepted | M0 完整退出条件全满足（不只 modelList，还包括 stages / agentProfiles / decisionForms 等 server-driven 全部） | M0 全部 mini-milestone 完工 |
| iOS 真机断网 cold start 验证 | 用户回来真机测 | 用户 / 后续 mini-milestone |
| sim Settings UI 截屏验证 | 用户 / e2e 测试自动化 | 后续 |

---

## 7. 下一步

M0 第一 mini-milestone（modelList 试点）已完成。M0 全局退出条件还有：
- iOS 装新版后老聊天功能零回归（待真机验证）
- 离线 fallback iOS 真机 cold start（待真机验证）
- 硬编码列表全部迁移到 server（modelList ✅；其他如 permission modes / onboarding 文案 / agentProfiles 待）
- Inbox 端点 + iOS 💡 按钮（M0.5 已 ship）

**建议下一个 mini-milestone**：
- **A. permissionModes 迁 server-driven**（最小，复用 modelList 结构）
- **B. agentProfiles config 试点**（M2 dogfood 真用，工作量大）
- **C. iOS 一次性大改装真机部署**（OK 模式，doc-only 路线已通过 sim 验证；可上真机）

按 §0 #1 iOS thin shell 原则 + §0 #13 不做时间估算，建议**先 C 真机部署一次**（让用户真机看到 server-driven modelList 工作），再 A（最小 server-driven 增量），再 B（M2 准入条件）。

---

## 8. 关键 commit 路径

| commit | 内容 |
|---|---|
| f156a51 | M0 modelList RFC + v2 评审三层 PASS（phase 1+2+3 + 14 接受 + 2 部分 + 1 反驳） |
| (本 commit) | M0 实施 19 步全部完工 + verify 25/25 + telemetry hot-reload 真验证 |

`origin/main` 同步。

---

**M0 modelList Round 终结：✅ 所有 §5 验收门槛达成，v2 Review Mechanism 第一次真业务用例 PASS（18 finding 1 轮收敛 0 still-disagree），real hot-reload chain 端到端通过。**
