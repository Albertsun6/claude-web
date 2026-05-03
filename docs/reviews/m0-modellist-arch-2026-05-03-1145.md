# Architecture Review — M0 第一契约 `/api/harness/config` payload + modelList 试点

**Reviewer**: harness-architecture-review
**Model**: claude-opus-4-7 (1M context)
**Date**: 2026-05-03 11:45
**Files reviewed**:
- /Users/yongqian/Desktop/claude-web/docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md
- /Users/yongqian/Desktop/claude-web/docs/HARNESS_PROTOCOL.md
- /Users/yongqian/Desktop/claude-web/docs/adr/ADR-0011-server-driven-thin-shell.md
- /Users/yongqian/Desktop/claude-web/docs/HARNESS_ROADMAP.md (§0 / §3.1 / §6 / §9 M0)
- /Users/yongqian/Desktop/claude-web/CLAUDE.md
- /Users/yongqian/Desktop/claude-web/packages/ios-native/Sources/ClaudeWeb/Settings.swift（行 30 / 78-82 / 160）
- /Users/yongqian/Desktop/claude-web/packages/ios-native/Sources/ClaudeWeb/Views/Settings/SettingsView.swift（行 127-135）
- /Users/yongqian/Desktop/claude-web/packages/shared/src/harness-protocol.ts（行 35-65 / WS 事件段）
- /Users/yongqian/Desktop/claude-web/packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift（HarnessEvent 段）
- /Users/yongqian/Desktop/claude-web/.claude/skills/harness-architecture-review/LEARNINGS.md
- /Users/yongqian/Desktop/claude-web/docs/reviews/（仅列目录，未读 sibling）

未读：`docs/reviews/m0-modellist-cross-2026-05-03-1144.md`（独立性约束）。

## Summary
- Blockers: 0
- Majors: 4
- Minors: 5
- 总体判断：**建议小改后合并**。提案在边界裁剪、ETag 设计、fallback 兜底大方向都对路，是个干净的 dogfood 起点；但 4 处垂直契约 / 退出条件 / 行为合同需要先收口，否则会把"看似 thin shell"的负债挪到 M0.5。

---

## 总体判断

一句话结论：**建议小改后合并**——M0 退出条件主张与本提案 §2.4 的实施直接矛盾（说要 WS 推 `config_changed`、实际没推）；`isDefault: sonnet-4-6` 与 iOS 当前 fallback 默认 `claude-haiku-4-5` 不一致，cutover 行为没定义；ETag 算法描述含糊；`compareVersion` 工具被 ADR-0011 / §8 风险表分别"指给对方"实现，没人真要写。这些是 4 个明确的契约空洞而不是品味问题，建议在 phase 3 收敛掉再开工。

---

## 必须先改

无 BLOCKER。下面 MAJOR 全部建议在动手前修，但用户在 M0 退出条件里已经显式接受 "author single-arbitration bias"（[HARNESS_ROADMAP §6 M0 行](../HARNESS_ROADMAP.md)），所以 reviewer 不强求；MINOR 可以延后到 M0.5 retrospective。

---

## 四维评审

### 架构可行性（评分 4/5）

提案的架构选型和 M-1 已 ship 的契约 100% 对齐：复用 Hono router、Zod schema、`HarnessProtocol.swift` Codable 镜像、Cache.swift 原子写、`@Observable` HarnessStore、`crypto` 内置 sha256——CLAUDE.md §0 #11 "不引入新基础组件" 没破。`If-None-Match` + 304 是 W3C 标准 HTTP，hono 默认支持，零依赖。fallback config 走打包内 JSON / Bundle resource 也是 LEARNINGS.md #1 的正面用法（"先固定 schema version、minClientVersion、fallback 行为"——本提案三件齐了）。

**关键脆弱假设**：`HarnessStore.refetch()` 何时被调用没在提案里画线。§3.1 给的 skeleton 只声明 `func refetch() async`，但没说"WS reconnect 时一定 refetch"。M0 退出条件写"重启 backend → WS 推 → iOS 拉新"，§2.4 实际改成"靠 WS 自动断重连 + iOS 端在重连成功 hook 内 refetch"——这个 hook 不存在 / 没在提案 §3 列出。若 iOS 重连后不 refetch，整条 hot-reload chain 就废了。需要在 §3.1 / §4 实施步骤里显式加一行 "WebSocketClient.onReconnected → HarnessStore.refetch"，而且这是 iOS 唯一一次大改装的一部分（M0 之后不重装），漏了等于把热更下放给 M0.5 重做。

**第二个脆弱点**：§1.3 ETag 算法描述 `JSON.stringify(..., Object.keys 排序)`——`JSON.stringify` 第二参数是 replacer 或字段白名单数组，不是"sort 标志"。canonical JSON 需要递归对所有 nested object key 排序、数组保持原序（语义 order-significant）。`recommendedFor: ["coding", "docs"]` 顺序是否语义化？如果不是，需要 backend 写入前 `.sort()`；如果是，需要文档说明"order matters"。这一行不写清，etag 会因元素重排无意义churn 或者两端算出不同结果。详见 MAJOR-2。

整体评分 4/5：契约面对路，落地协议两条线（refetch 触发、canonical_json）必须写实。

### 里程碑裁剪（评分 4/5）

提案明确把 M0 退出条件 split 成"全局 退出条件"和"本试点子集"，§0 列了 5 条子集，作者主动把 Inbox / 全 schema / WS push / 多硬编码列表迁移推到后续 mini-milestone。这种切法对路——LEARNINGS.md #3 "全链路 MVP 可保留，但每个 Stage 需要最小不可作假的产出"——modelList 试点产出 4 个真东西：Zod schema + fixtures + 后端 endpoint + iOS HarnessStore，下一个 mini-milestone（Inbox / decisionForm）能直接复用，没有 stub。

**矛盾点**：提案 §0 第 3 条退出条件原文写"后端改 modelList → 重启 → WS 推 `config_changed` → iOS 不重装能看到新列表"，但 §2.4 的实施文字明确写"M0 不引入额外 push 机制 — tsx watch 重启 + iOS 自动重连 + If-None-Match 已经覆盖热更"，§7 又把 `harness_event { kind: "config_changed" }` 推到 M0.5。**§0 退出条件的 wording 与 §2.4 实施互斥**：要么真推 config_changed（HarnessProtocol.ts 里这个 kind 已经定义、Swift 端也已经能 decode，工作量 < 30min），要么把 §0 第 3 条改成"重启 → iOS 重连后 refetch → 不重装看到新列表"。详见 MAJOR-1。

**M0 全局退出条件 vs. 试点子集的关系**：HARNESS_ROADMAP §6 M0 行还列了"硬编码列表全部迁移到 server" + "Inbox 端点上线"等。本提案显式只覆盖 modelList——这个收缩合理（最小 hot-reload chain 可验证），但提案 §0 / §7 应该清楚标"本提案不消化 M0 退出条件中 X / Y / Z 项，这些走后续 mini-milestone PR-N / PR-M"。否则下次 review 提案时无法判断 M0 还差什么。

整体评分 4/5：裁剪干净；§0 vs §2.4 wording 矛盾必须 reconcile。

### 企业管理系统贴谱性（评分 4/5）

modelList 试点本身不直接服务"企业管理系统"垂直（CRUD / 审批 / 表单 / 报表），但它是 server-driven shell 的最小 hot-reload chain 验证；这条 chain 立住之后，M1 的 decisionForm（审批流） / methodologyTemplates（业务模板） / agentProfiles（角色矩阵）才能挂在同一根管子上下发。从这个意义上看，modelList 是"管子"的 smoke test，先做对路。

**贴谱性观察**：
- `recommendedFor: z.array(z.string())` 是开放 string，作者意图是 "便于扩展"。但 HARNESS_PROTOCOL.md §1 显式说"枚举值锁"是协议契约。本字段是首个 server-driven shell 配置上 iOS 要做条件判断的 enum-like 字段（Settings.swift 可能要"按 recommendedFor 分组展示"或"在 spec stage 自动选 architecture 模型"）。开放 string 看似 future-proof，实际 iOS 端要么按 substring 匹配（"包含 'review' 就视为评审专用"，规则糊）、要么 switch case（出现新值静默 fall-through）。**M0 第一个真上线的开放 string 字段，建议在提案里加一句"iOS 必须用 `.contains` 而不是 `switch`，未知值不报错"**，或者干脆现在锁 enum（`architecture | review | complex | coding | docs | fast-chat | summarization | other`）。这条不锁，后面 decisionForm.formType / agentProfile.role 都会照抄"开放 string"，集体松绑。详见 MAJOR-3。
- `isDefault` 行为契约缺失：提案没说"如果 modelList 里有多个 isDefault=true / 全是 false 时 iOS 怎么办"。HARNESS_PROTOCOL.md §1 的不变量风格要求 schema 自约束。建议加 Zod refinement 校验 "exactly one isDefault=true"，fixture round-trip 测试覆盖。
- `enabled: false` 兜底语义：当用户已经 pin 了一个被 `enabled=false` 隐藏的 model（比如老 modelList 有、新版下发后被 disable），Settings UI 怎么展示？提案 §8 风险表只说"enabled=false 兜底；iOS 切回时显式提示"，没给具体策略。详见 MAJOR-4。

整体评分 4/5：管子方向对，但首发字段的契约严谨度（enum vs string、isDefault 不变量、enabled cutover）会成为后续所有 server-driven 字段的样板。

### 风险遗漏（评分 3/5）

提案 §8 风险表覆盖了 5 项，态度认真。但有 3 处遗漏 / 弱化：

**1. 默认模型静默切换（MAJOR-5 / 风险表完全没提）**：当前 Settings.swift 行 160 fallback 默认是 `claude-haiku-4-5`；本提案 §2.2 hardcode 把 `claude-sonnet-4-6` 设为 `isDefault: true`。M0 装新版后：
- 如果 iOS 用户已经在 UserDefaults 里 pin 了 model（老用户）→ 不变；
- 如果用户从未改过 → cutover 后默认从 haiku 变 sonnet。

提案没说明 cutover 行为：是"用户已 pin 优先"还是"server 默认覆盖"？Settings.swift line 160 的 `?? "claude-haiku-4-5"` 这条 fallback 也没在 §3.4 改造列表里。这是单用户唯一一次重装"看不见的默认值漂移"，触发条件触发后用户会困惑"为什么响应变慢/费用变高了"。需要在提案里写清：iOS Settings 启动逻辑改为"UserDefaults pinned → 用之；否则 → modelList.first(isDefault: true).id；fallback → bundled fallback default"。同时建议保留 haiku 作为打包 fallback 的 default（与历史一致）。

**2. ETag canonical_json 没说递归 / 没说 Unicode**：§1.3 算法描述只说"Object.keys 排序"，没说：
- 嵌套对象（capabilities）是否递归排序——必须递归，否则 etag 不稳。
- 字符串里是否含非 ASCII（Chinese displayName / description），`JSON.stringify` 默认 escape 行为两端是否一致——TS 端 `JSON.stringify` 会保留原 Unicode，sha256 字节序列以 UTF-8 算；Node `crypto.createHash('sha256').update(s)` 默认按 UTF-8。两端风险低但需要写明 "encoding: utf8"。
- 数组顺序是否 normalize：`recommendedFor` 是数组——若两个等价 config 数组顺序不同，etag 不同，触发不必要的 304 → 200 切换。M0 单源（backend hardcode）不出问题，但 §6 OQ-D 要升 ADR-0011 Accepted 时会绑定多源（B：JSON 文件 + file watch），那时 etag stability 必须先成熟。
- ETag 16 字符前缀的碰撞概率：sha256 前 16 hex = 64 bit，对单源场景碰撞率可忽略；但若未来 etag 用作"幂等键 + 版本快照表 PK"，前缀截断要再评估。

详见 MAJOR-2。

**3. compareVersion 工具实现责任真空**：
- ADR-0011 §"版本字符串比较"说"M0 实施时必须用 compareVersion(a, b)"。
- 提案 §8 风险表说"复用 ADR-0011 §版本字符串比较 写明 M0 实施 compareVersion 工具"——这是把 ADR 的"要求"当成了"实现"。
- 提案 §4 实施步骤 14 行表格里没有 "实现 compareVersion" 这一步。
- §2.3 minClientVersion 检测说 iOS 端做"比 minClientVersion 与 Bundle..."—— Swift 用 `String.compare(_:options:)` 还是手写函数？没写。

ADR 要求 + 提案没排步骤 = 上线时大概率有人偷懒用 `<` lex 比较。M-1 dogfood arch M-D 已识别此 bug。需要在 §4 加一行 "shared/src/version.ts 实现 compareVersion + iOS HarnessConfigAPI.swift mirror"，或者明确说"M0 范围 1.0=1.0 字符串相等就够，compareVersion 推 M1"。详见 MAJOR-6（合并到 MAJOR-2 风险段）。

**已覆盖的不算遗漏**：
- 提案 §8 row 4 风险表的 "minClientVersion lex" 已识别——这是上一段的源头，但提案还是把 fix 推给了 ADR-0011，没排实施步骤。
- iOS bundled fallback drift（OQ-C）已识别，但 mitigation 不彻底（详见 MINOR-2）。

整体评分 3/5：遗漏的"默认模型静默切换"是用户视角看得见的回归。

---

## Open Questions 强意见

- **OQ-A（fallback 实现）**：作者倾向手抄 JSON。**支持**。M0 单字段单 source，手抄 30 秒；codegen 工具会变成基础设施 creep。但建议把"手抄一份" ship 进 `packages/shared/fixtures/harness/fallback-config.json`（不是 iOS Bundle resource 自己一份），iOS Bundle 通过 xcodegen project.yml 把这个 fixture 复制成 resource——单 source、零 codegen、跨端可被 round-trip 测试访问。
- **OQ-B（ETag 失效）**：作者倾向 (a) 永不主动失效。**支持**。M0 没有"backend 不重启动态改 config"这个需求；(b) 推 M0.5 + manual invalidate endpoint 时再说。
- **OQ-C（drift 风险）**：作者倾向 (a) 单元测试断言关键不变量。**强烈支持但执行细节缺失**——见 MAJOR-4 / MINOR-2。如果 OQ-A 选了"shared fixture 单 source" 路线，drift 几乎不可能发生，OQ-C 测试退化为"fixture 在 backend 启动时被 import 进 HARNESS_CONFIG"的存在性检查。
- **OQ-D（ADR-0011 升级时机）**：作者倾向 M0 完工同步升 Proposed → Accepted。**部分支持**。本提案只覆盖 modelList，没真正测过 stages / agentProfiles / decisionForms 的 server-driven。建议改成"M0 全部子任务 ship 后才升 Accepted"——让 ADR 升级和"M0 全局退出条件" 绑定，而不是单 mini-milestone 绑定。这样未来回看 git log 时 ADR 状态变迁更可信。

---

## 各 finding 详表（按严重度）

### [MAJOR-1] M0 退出条件 wording 与 §2.4 实施直接矛盾
- **Where**：proposal §0 第 3 条 vs §2.4 vs §7
- **Lens**：里程碑裁剪
- **Issue**：§0 写"WS 推 `config_changed`"是退出条件，§2.4 写"不引入额外 push 机制"，§7 把它推到 M0.5。读者无法判断 M0 是否真满足退出条件。
- **Suggested fix**：选其一：(a) 真推 `config_changed`（HarnessProtocol.ts 已定义；backend index.ts WS 启动时 broadcast；iOS HarnessProtocol.swift 已能 decode；工作量 < 30min；ROI 高），把 §7 第一条删掉；(b) 改 §0 第 3 条 wording 为"重启 backend → WS 自动断 → iOS 重连后自动 refetch → 不重装看到新列表"，并在 §3.1 加 `WebSocketClient.onReconnected → HarnessStore.refetch()` hook 的实施行。

### [MAJOR-2] ETag canonical_json 算法描述含糊 + compareVersion 实现责任真空
- **Where**：proposal §1.3 / §2.3 / §4 / §8 风险表 row 3-4
- **Lens**：架构可行性 / 风险遗漏
- **Issue**：(a) `JSON.stringify(..., Object.keys 排序)` 不是合法 API 调用，没说嵌套递归排序、Unicode 编码、数组是否 normalize。(b) compareVersion 在 ADR-0011 / 提案 §8 间互推，没人真排实施步骤。
- **Suggested fix**：§1.3 改为伪代码示意 `function canonicalJson(o): string` 显式实现：递归遍历对象按 key 排序、数组保持原序、UTF-8 编码、不含 etag 字段；fixture round-trip 测试断言不同 key 顺序的等价 config 算出同 etag。§4 实施步骤加一行 "shared/src/version.ts 实现 compareVersion + Swift mirror"，或者明确 "M0 1.0=1.0 阶段用字符串相等，M1 加 compareVersion" 并在提案里删掉所有"用 compareVersion"的引用。

### [MAJOR-3] `recommendedFor` 开放 string 在首发字段就破协议契约
- **Where**：proposal §1.1 ModelListItem schema
- **Lens**：企业管理系统贴谱性
- **Issue**：HARNESS_PROTOCOL §1 显式锁所有枚举；本字段是 server-driven 时代第一个 iOS 要消费的 enum-like 字段，开放 string 等于把"未来字段都开放 string"的样板写定。iOS 要么 substring 匹配（脆弱）、要么 switch（fall-through）。
- **Suggested fix**：选其一：(a) 锁 enum（`architecture | review | complex | coding | docs | fast-chat | summarization | other`）+ 加新值走 minor bump（与 §1 风格一致）；(b) 显式在 §1.1 字段说明里写"iOS 必须用 `Set.contains` 判断、不能 `switch`，未知值视为 hint 忽略不报错"，并把这条规则提升到 HARNESS_PROTOCOL.md §1 的"开放 string 字段处理约定"小节。优先 (a)。

### [MAJOR-4] `isDefault` / `enabled` 行为不变量缺失 + iOS cutover 默认模型静默漂移
- **Where**：proposal §1.1 / §3.4 / §8 风险表 row 5
- **Lens**：风险遗漏
- **Issue**：(1) Schema 没说 "exactly one isDefault=true"——如果 backend 误设两个 / 零个，iOS 行为未定义。(2) 当前 iOS Settings.swift 行 160 fallback default 是 `claude-haiku-4-5`，本提案 hardcode `isDefault: true` 给 `claude-sonnet-4-6`——cutover 后未 pin 用户的默认模型从 haiku 变 sonnet（响应慢 / 费用高）。提案没列这条行为变化。(3) 用户 pin 的 model 被 server `enabled=false` 隐藏后，Settings UI 怎么显示。
- **Suggested fix**：(1) ModelListItemSchema 加 Zod refinement：`.refine(arr => arr.filter(m => m.isDefault).length === 1)`，fixture round-trip 测试覆盖。(2) §3.4 加明确启动逻辑："`UserDefaults.model` 非空且匹配某 enabled item → 用之；否则 → modelList.first(isDefault: true).id；都失败 → bundled fallback default（建议保留 haiku 与历史一致）"。(3) §8 风险表 row 5 fix 改为"用户 pin 的 model 被 enabled=false 隐藏 → Settings UI 显示该 item 但灰色 + 一行说明 '已在服务端禁用，下次切换不可回选'"。

---

## 观察项（[MINOR]）

### [MINOR-1] §0 退出条件没标"试点子集"
**Lens**：里程碑裁剪。建议提案 §0 加一行 "本提案不消化 M0 退出条件中 Inbox / 多硬编码列表迁移 / 全 schema 项；这些走后续 PR-N (Inbox) / PR-M (decisionForm) 等 mini-milestone"，让 review 时易判断 M0 整体进度。

### [MINOR-2] OQ-C drift 单元测试 placement 不清
**Lens**：架构可行性。`shared` 包看不到 iOS Bundle resource。如果 OQ-A 选 (a) 手抄、OQ-C 选 (a) 单元测试，测试位置应该在 shared 包还是 iOS Xcode test target？建议合并 OQ-A + OQ-C：fallback JSON 唯一 source 放 `packages/shared/fixtures/harness/fallback-config.json`，backend 启动时 import、iOS 通过 xcodegen project.yml 复制为 Bundle resource——单 source 自动消除 drift 风险，OQ-C 测试退化为"backend HARNESS_CONFIG.modelList 至少包含 fallback 中的 default model id" 这一行 assertion。

### [MINOR-3] `etag: ""` placeholder 然后 mutating 赋值的 TS 风格
**Lens**：架构可行性。`HARNESS_CONFIG.etag = computeEtag(HARNESS_CONFIG)` 在模块顶层 mutating const 对象——能跑但风格差。建议 `harness-config.ts` 写成函数 `getHarnessConfig(): HarnessConfig`，第一次调用时 lazy compute；endpoint 直接调用。这样未来 OQ-B (b) 加 invalidate / OQ-D 升 (b) 文件 watch 时不用重构。

### [MINOR-4] §2.3 minClientVersion 检测放 iOS 端的合理性
**Lens**：架构可行性。理由"backend 不知道 client version"——其实 WS 握手时 iOS 应该上报 version（HARNESS_PROTOCOL.md §5 已规定客户端在握手上报 version）。这等于把同一逻辑分两端做：HTTP fetch 时 iOS 自查 + WS 握手时 backend 校验。建议统一到 backend 校验+ HTTP fetch 顺带 echo `minClientVersion` 字段让 iOS 自做兜底就够，不需要 iOS 真做版本比较。M0 范围内两端都是 1.0 不会触发，但"iOS 自做版本比较"会诱发 MAJOR-2 提到的 lex 比较 bug。

### [MINOR-5] §5.2 真机验证缺失
**Lens**：里程碑裁剪。M0 是 iOS"唯一一次大改装"（HARNESS_ROADMAP §6 关键节奏），但 §5.2 ALL test cases 都标 sim 或 dev 验证，没有"装一台真机看 cold start fallback path 是否真走通"。建议加一条 "iOS 真机装新版 + 全程断网启动 + 看到 Settings 模型列表 = bundled fallback"。M0 不在 IOS_NATIVE_DEVICE_TEST.md 全跑没关系，但 fallback path 必须真机验证一次（sim 网络模型与真机 cellular 行为不同）。

---

## 建议的下一版改动

1. **§0 第 3 条退出条件 reconcile**（MAJOR-1）：选"真推 config_changed" 路线（作者建议，HarnessProtocol.ts 已定义、< 30min 工作量），删 §7 第一条；若选"靠 reconnect refetch" 路线，§3.1 加 `WebSocketClient.onReconnected → HarnessStore.refetch()` 实施行。
2. **§1.3 ETag 算法写实**（MAJOR-2 a）：伪代码 `canonicalJson(o)` 递归排序对象 key、数组保持原序、UTF-8、排除 etag 字段；shared 测试加 "key order 不同的等价 config 算出同 etag" assertion。
3. **§4 加 compareVersion 实施行**（MAJOR-2 b）：`shared/src/version.ts` 实现 compareVersion + Swift mirror；或显式声明 "M0 1.0=1.0 字符串相等阶段；compareVersion 推 M1" 并清理引用。
4. **§1.1 `recommendedFor` 改 enum**（MAJOR-3）：锁 8 个值 + ADR-0015 minor bump 流程；或保留 string 但加 HARNESS_PROTOCOL.md §1 "开放 string 字段消费约定" 小节。
5. **§1.1 / §3.4 加 isDefault / enabled / cutover 行为合同**（MAJOR-4）：Zod refinement + iOS 启动逻辑显式化 + bundled fallback default 保留 haiku；§8 风险表 row 5 写实。
6. **OQ-A + OQ-C 合并**（MINOR-2）：fallback JSON 单 source 放 `packages/shared/fixtures/harness/fallback-config.json`；xcodegen 复制为 iOS Bundle；backend 也从此 import；drift 自然消失。
7. **§0 加"试点子集" 显式声明**（MINOR-1）：写明 M0 全局退出条件中本 PR 不覆盖的项，方便 review 时判断 M0 整体进度。

---

## What I Did Not Look At

- `docs/reviews/m0-modellist-cross-2026-05-03-1144.md`（sibling 跨视角 reviewer Round 1 verdict）—— phase 1 独立性约束。
- 实际 backend 路由 wiring（packages/backend/src/index.ts WS upgrade / hono routes）—— 仅依靠 CLAUDE.md / 提案 §2.4 描述。
- iOS WebSocketClient.swift 现有 reconnect / onConnected hook 是否真存在 onReconnected 钩子—— MAJOR-1 fix 路线 (b) 依赖此点，建议作者在落实前 read 一次 packages/ios-native/Sources/ClaudeWeb/Networking/WebSocketClient.swift。
- iOS HarnessProtocol.swift `HarnessEvent.configChanged` 当前是否被任何 listener 消费—— MAJOR-1 fix 路线 (a) 工作量评估依赖此点。
- Round-trip 测试套件当前覆盖深度（packages/shared/src/__tests__/harness-protocol.test.ts）—— 假设作者会照 contract-2 模板新加 modelList round-trip。
- 安全 / 鉴权 / token 路径—— 属于 reviewer-cross 的 lens；本 reviewer 仅在"4 维"边界内。
- M0.5 / M1 后续 mini-milestone 的具体边界（Inbox / decisionForm / WS push）—— 不在本提案 scope。
- 真机 build / xcodegen project.yml 当前 resource 复制规则—— MINOR-2 / MINOR-5 fix 落地需要作者验证。

---

## 三行 summary

- **Blockers**: 0
- **Majors**: 4（M0 退出条件 vs 实施 wording 矛盾 / ETag canonical_json + compareVersion 责任真空 / `recommendedFor` 开放 string 破协议契约 / isDefault+enabled+cutover 默认模型静默漂移）
- **Minors**: 5（试点子集声明 / OQ-A+C 合并 / mutating const TS 风格 / minClientVersion 责任分散 / 真机 fallback path 验证缺失）
- **Overall verdict**: 建议小改后合并——4 处 MAJOR 在 phase 3 收敛即可，方向、契约面、裁剪粒度都对路，是 server-driven shell hot-reload chain 的干净起点。
