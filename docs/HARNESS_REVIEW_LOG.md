# Harness Review Log

> **用途**：harness 各契约 / 设计 / 方法论的评审历史。每轮评审追加一段，**不删除**历史。
>
> **流程**：每个待审 artifact 由 2 个独立 reviewer 出 verdict，作者跑 debate-review 合并发现，用户拍板放行 / 返工。
>
> **状态**：M-1 启动期建立（2026-05-03）。

---

## 评审机制元配置

| Reviewer | 角色 | 视角维度 | 实现 | 模型 |
|---|---|---|---|---|
| `harness-architecture-review` | 主评审 | 架构可行性 / 里程碑裁剪 / 垂直贴谱性 / 风险遗漏 | Claude (Agent) | claude-opus-4-7 |
| `reviewer-cross` | 独立第二视角 | 正确性 / 跨端对齐 / 不可逆 / 安全 / 简化 | cursor-agent CLI（plan 模式） | gpt-5.5-medium |
| `debate-review` (作者跑) | 合并发现 | 4 档判断（接受 / 部分接受 / 反驳 / 挂起） | skill in current context | claude-opus-4-7 |
| 用户拍板 | 终审 | blocker rebuttal 必须显式批准；分歧升级人审 | 人 | — |

**独立性硬约束**（每位 reviewer 必须满足）：
1. 不读 author 的 transcript / 思考流 / 工具调用历史
2. 不读其他 reviewer 的 verdict（直到 debate 阶段才合并）
3. 不修改任何文件
4. fresh context（不复用前一轮 review 对话历史）

**Verdict 等级**：
- **BLOCKER**：必须先修才能放行；如需绕开，需 author rebuttal + 用户显式 approve
- **MAJOR**：明确缺陷，建议修但不阻塞；可作为 Open Question 留下一里程碑
- **MINOR**：建议或观察项，不影响放行

**分歧处理**：两位 reviewer 在某点冲突时，作者用 debate-review 整理分歧 → 升级用户人审（不引入第三方 tiebreak）。

**返工触发**：blocker 全部清零（修 / rebut + 批准）才能进下一契约 / 里程碑。

---

## 评审轮次记录

### Round 1 — 契约 #1 数据模型 + 契约 #2 协议骨架

**日期**：2026-05-03
**待审 artifact**：
- `docs/HARNESS_DATA_MODEL.md` v1.0
- `docs/adr/ADR-0010-sqlite-fts5.md`
- `docs/adr/ADR-0015-schema-migration.md`
- `packages/backend/src/migrations/0001_initial.sql`
- `packages/backend/src/harness-store.ts`
- `packages/backend/src/test-harness-schema.ts`
- `docs/HARNESS_PROTOCOL.md` v1.0（Zod / fixtures / Swift / round-trip 尚未实现）

**Verdict 文件**：
- [contract-1-2-arch-2026-05-03-0209.md](reviews/contract-1-2-arch-2026-05-03-0209.md) — harness-architecture-review（claude-opus-4-7，2 BLOCKER + 5 MAJOR + 4 MINOR）
- [contract-1-2-cross-2026-05-03-0207.md](reviews/contract-1-2-cross-2026-05-03-0207.md) — reviewer-cross（gpt-5.5-medium，1 BLOCKER + 7 MAJOR + 5 MINOR）

#### 辩论矩阵

| # | 主张（来源） | 严重度 | 判断 | 处理 |
|---|---|---|---|---|
| 1 | HARNESS_PROTOCOL.md §8 五条 [x] 撒谎，文件全部不存在（arch B1 升级 / cross m5）| BLOCKER | ✅ 接受 | §8 改 [ ]，INDEX 状态改 "doc only"，建 verify-m1-deliverables.mjs，ADR-0015 与 ADR-0011 协作段标 TBD |
| 2 | runMigrations re-exec 全部 SQL + 无事务（arch B2 / cross B1+M1）| BLOCKER | ✅ 接受 | 选 schema_migrations 表方案 + db.transaction 包裹；0001 顶部 `PRAGMA user_version=100` 移除，由 runner 控制；test 加重启回归 |
| 3 | `idx_stage_issue_kind` 应是 UNIQUE（cross M2）| MAJOR | ✅ 接受 | 改 UNIQUE INDEX |
| 4 | Artifact dedupe vs stage_id 语义冲突（cross M3 + arch 风险#12）| MAJOR | ✅ 接受 | 语义敲定为 "**file content** 通过 hash 共享存储；**row 不去重，每个 stage 一行**"；保留 stage_id NOT NULL，idx_hash 非 unique，文档措辞统一 |
| 5 | `superseded_by` 字段名方向反（cross M4）| MAJOR | ✅ 接受 | 文档语义改 "旧 row 在 superseded_by 上指向新 id；新 row 的 superseded_by 为 NULL" |
| 6 | issue.retrospective_id 文档有 FK 但 SQL 没（cross M5）| MAJOR | ✅ 接受 | SQL 加回 FK（SQLite 允许引用后定义的表） |
| 7 | test-harness-schema FK 错误命中 CHECK 是假阳性（cross M6）| MAJOR | ✅ 接受 | 修测试：先插 methodology→stage，再单独验 artifact CHECK；断言错误信息含 `CHECK constraint` |
| 8 | audit log 写盘失败语义未定义（arch 风险#11 / cross M7 / cross F?）| MAJOR | ✅ 接受 | ADR-0010 加段：**audit fail-open**（与 permission-hook.mjs 一致），warn log，业务不阻塞 |
| 9 | bool 字段缺 `CHECK IN(0,1)`（cross m1）| MINOR | ✅ 接受 | 加 CHECK 约束 |
| 10 | `harness_project.cwd` 缺 UNIQUE（cross m2）| MINOR | ✅ 接受 | 加 UNIQUE |
| 11 | FTS5 应叫 external-content 不是 contentless（cross m3）| MINOR | ✅ 接受 | 文档术语全局修 |
| 12 | 0001 顶部注释 v1 vs 100 矛盾（cross m4）| MINOR | ✅ 接受 | 修注释 |
| 13 | weight enum 应在 schema 强制 CHECK（arch 架构#3）| MAJOR | ⚠️ 部分接受 | M-1 不加 schema CHECK；改写到 methodology.default_weight 由 stage 创建时拷贝。**counter**：CHECK 把"轻量某 heavy stage"路径堵死，少留余地 |
| 14 | stage.{input,output,verdict}_artifact_ids_json 拆中间表（arch 架构#4）| MAJOR | ⚠️ 部分接受 | M-1 不改 schema；ADR-0010 加 "M2 dogfood 后视报表查询频率决定是否拆"。**counter**：现在拆增加 4 端同步成本，先观察 |
| 15 | context_bundle ↔ task 循环 FK 应在 ADR 显式写明（arch 架构#5）| MAJOR | ✅ 接受 | ADR-0010 加段 "环依赖由 harness-store 写入序列保证" |
| 16 | M-1 退出门槛"必产 4 契约" 与 #1/#2 异步推进矛盾（arch 里程碑#6）| MAJOR | ✅ 接受 | HARNESS_INDEX.md / HARNESS_ROADMAP.md §6.1 改 "M-1 分阶段"：契约按顺序产出，每契约自己的 ritual gate |
| 17 | ADR-0015 §3.3 CI 措辞从 "应该跑" 改 "M1+ 引入"（arch 里程碑#7）| MAJOR | ✅ 接受 | ADR-0015 / DATA_MODEL §3.3 措辞修 |
| 18 | Artifact 加 `metadata_json` 列（arch 垂直#8）| MAJOR | ⚠️ 部分接受 | minor bump：加 `metadata_json TEXT NOT NULL DEFAULT '{}'`；结构由 methodologies/01-spec.md 约定。**counter**：M-1 加列但不约束 schema，dogfood 时再看是否需要 typed |
| 19 | FTS5 大批写性能（arch 风险#13）| MAJOR | 🟡 挂起 | M2 Retrospective 加观察项；M3 评估是否换 fts5 + content 内嵌 |
| 20 | round-trip 测试不防语义漂移（arch 风险#14）| MAJOR | ⚠️ 部分接受 | HARNESS_PROTOCOL.md 加 "enum 锁" 段；M-1 不实跑 Swift round-trip（Swift 文件还没建）|
| 21 | M-1 4 项过多 → 砍 #3 #4 到 M0（arch Open Q #15）| 方向 | 🚫 反驳 | **counter**：ContextBundle 决定 agent 智商上限，PR/worktree 是 agent 改坏 main 的最后防线；M-1 不立则 M2 dogfood 风险大 |
| 22 | ADR-0011 立项即便 placeholder（arch Open Q #16）| MAJOR | ✅ 接受 | 建 docs/adr/ADR-0011-server-driven-thin-shell.md status=Proposed，决定推到 M0 |
| 23 | ADR-0010 显式承诺 "harness 不写 projects.json"（arch Open Q #17）| MINOR | ✅ 接受 | ADR-0010 加段 |
| 24 | F? migrations 生产路径（cross 不确定）| 不确定 | 🚫 反驳 | **counter**：tsx watch 不打包，`__dirname` 解析稳定（CLAUDE.md 现有约定），不是问题 |

**汇总**：✅ 14 / ⚠️ 5 / 🚫 2 / 🟡 1

#### 反向挑战 reviewer

1. **arch 给的 BLOCKER-2 修方案 A（user_version gate）在多 migration 场景仍脆**——0002 加 ALTER 时如果失败，user_version 已经在 SQL 里写死。下次重启会跳过 0002 但 schema 已损坏。我选方案 B（schema_migrations 表）+ 事务包裹更工程化。
2. **cross 把 PROTOCOL §8 [x] 撒谎标 minor 而不是 BLOCKER**——这是 cross 的视角盲点：5 lens 集中技术正确性，对里程碑出口判定机制无感。提示：reviewer-cross SKILL 可能要补一条 "里程碑契约完工状态自检" 的 lens 6（不强加，留给下次评审看是否复发）。
3. **arch 评审里 "weight enum 强制 CHECK" 与 "Methodology default_weight"** 的取舍其实是 reviewer 选择把约束放 schema vs 应用层——我选应用层，因为 M2 dogfood 时方法论会演化，schema CHECK 改起来比应用层贵。

#### Open Questions 留下一轮

- 🟡 FTS5 大批写延迟：等 M2 dogfood 数据
- ⚠️ Artifact stage_artifact 中间表：等 M2 报表查询信号
- ⚠️ Artifact.metadata_json 是否要 typed schema：等 M2 dogfood toy 企业仓库

#### 用户拍板

（修复落地后由用户审视并签字）

#### 应用的 fix

见下面 commit history（修复中）。


---

### Round 2 — 8 未定项再评审

**日期**：2026-05-03 02:29
**Brief**：[reviews/round-2-brief.md](reviews/round-2-brief.md)
**Verdict 文件**：
- [contract-1-2-round2-arch-2026-05-03-0229.md](reviews/contract-1-2-round2-arch-2026-05-03-0229.md) — claude-opus-4-7
- [contract-1-2-round2-cross-2026-05-03-0229.md](reviews/contract-1-2-round2-cross-2026-05-03-0229.md) — gpt-5.5-medium

**结果**：8 项全部收敛（**0 still-disagree**）。规则：3 轮内不分歧才回报用户，本轮已收敛 → 无需 Round 3。

| 项 | arch Round 2 | cross Round 2 | 处理 |
|---|---|---|---|
| #1 weight enum | agree-with-author | refine: `methodology.default_weight` 单列承载不了 per-kind 默认 → 改 `stage_defaults_json: { design: "heavy", compliance: "checklist" }` map 或 `methodology_stage_template` 表 | ✅ counter 精炼 |
| #2 stage_artifact | agree + 加 retrospective 观察字段（reverse-query 频率） | refine: 三个 JSON 数组进了 DTO 等于 wire-format 锁定，M2 改要 wire migration | ✅ HARNESS_PROTOCOL.md 加 "provisional persistence-only" 注 |
| #3 metadata_json | agree | refine: 加 `CHECK (json_valid(metadata_json))` | ✅ 0001_initial.sql 加 CHECK |
| #4 round-trip 防漂移 | refine: enum 锁段必须显式列 UI-driving enums (Stage.weight/kind, Issue.priority, AgentProfile.modelHint) | (defers to arch) | ✅ HARNESS_PROTOCOL.md §1 已列全 enum |
| #5 M-1 分阶段 | agree | (not addressed) | ✅ 已 ship Round 1 |
| #6 M-1 4 项不砍 | **withdraw original finding** ContextBundle=§0#9 / PR=§0#7+#16 | refine: 给 #3 #4 列 minimum acceptance 物，避免 doc-only 完工 | ✅ HARNESS_INDEX.md 加每契约最小 acceptance 列表 |
| #7 migrations 路径 | (defer to cross) | refine: 反驳成立但边界应写清（tsx watch / 不打包 / 未来打包要复制 migrations）| ✅ harness-store.ts 加注释 + ADR-0015 加段 |
| #8 FTS5 性能 | agree + 加 retrospective 观察字段（FTS trigger 写延迟 p50/p95） | refine: 记录每批 artifact 写入数 / 总字节 / FTS trigger 耗时 / p95 insert latency | ✅ DATA_MODEL §5 加 FTS5 metric 规范 |

**Round 2 反向挑战（沉淀）**：
- arch Round 2 指出 Retrospective 方法论模板缺"carried-over observation items" 段——挂起项天然会被自然 deferral。methodologies 写入时补此段。
- 两位 reviewer 都把"项 #6 反驳"接受了，说明 reviewer 第一轮的 "M-1 项过多" 倾向于用一句 "窄腰" 抽象建议 + 一句 "ContextBundle 纸上写出来容易过设计" 不能撑住具体反驳。

#### Round 2 用户拍板状态

✅ **Round 2 自动收敛**——0 still-disagree，无需用户人审介入。继续推契约 #2 真实实现。

---

### Round 1 — 契约 #2 真实实现（Zod + fixtures + Swift + round-trip）

**日期**：2026-05-03 02:39 / 02:41
**待审 artifact**：
- `packages/shared/src/harness-protocol.ts`（Zod, 13 实体 + AuditLogEntry + HarnessEvent + 版本常量）
- `packages/shared/fixtures/harness/*.json`（16 fixture）
- `packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift`
- `packages/shared/src/__tests__/harness-protocol.test.ts`（42/42 绿）
- `docs/HARNESS_PROTOCOL.md` v1.0
- `docs/adr/ADR-0011-server-driven-thin-shell.md`（Proposed）

**Verdict 文件**：
- [contract-2-arch-2026-05-03-0241.md](reviews/contract-2-arch-2026-05-03-0241.md) — claude-opus-4-7（1 BLOCKER + 4 MAJOR + 4 MINOR）
- [contract-2-cross-2026-05-03-0239.md](reviews/contract-2-cross-2026-05-03-0239.md) — gpt-5.5-medium（0 BLOCKER + 3 MAJOR + 3 MINOR）

#### 辩论矩阵

| # | 主张（来源） | 严重度 | 判断 | 处理 |
|---|---|---|---|---|
| 1 | PROTOCOL.md §8 ship 后仍标"未起步"（arch B1）| BLOCKER | ✅ 接受 | §8 改 truthful 状态表 + verify 脚本守门 |
| 2 | AuditLogEntry null 字段 Swift 默认丢 nil-key（arch M1）| MAJOR | ✅ 接受 | Swift custom Codable 显式 encodeNil for before/after |
| 3 | ADR-0011 缺 minimum 协议层行为契约（arch M2）| MAJOR | ✅ 接受 | ADR-0011 加 "graceful skip / unknown enum / 版本比较" 段 |
| 4 | Swift HarnessEvent 未知 kind throw（arch M3）| MAJOR | ✅ 接受 | 加 `.unknown(kind, raw)` case + raw 保留 round-trip |
| 5 | HARNESS_PROTOCOL_VERSION lex 比较（arch M4）| MAJOR | ✅ 接受 | ADR-0011 写明 M0 加 compareVersion 工具 + M-1 范围内 1.0 暂安全 |
| 6 | ID 格式 UUIDv4 vs ULID-prefix（cross M1）| MAJOR | ✅ 接受 | 注释改 "opaque stable string，推荐 prefix" + PROTOCOL.md §8 加段 |
| 7 | HarnessEvent.stage_changed.status 无 enum 锁（cross M2）| MAJOR | ✅ 接受 | TS Zod + Swift 改用 StageStatus(Schema) |
| 8 | Swift round-trip 测试缺失（cross M3）| MAJOR | ⚠️ 部分接受 | M-1 不实跑（HARNESS_PROTOCOL.md §6 已声明）；PROTOCOL.md §8 加 M1+ 高风险点列表 |
| 9 | epoch ms 没非负约束（cross m1）| MINOR | ✅ 接受 | 加 EpochMsSchema helper + 全部 timestamp 字段使用 |
| 10 | dimensions 没 0..5 约束（cross m2）| MINOR | ✅ 接受 | 加 DimensionScoreSchema + dimensions: z.record(DimensionScoreSchema) |
| 11 | hash 无 sha256:hex 格式校验（cross m3）| MINOR | ✅ 接受 | 加 ContentHashSchema regex + Artifact.hash 使用 |
| 12-15 | arch m1-m4（fixture README rationale / worktreePath / Run.cost / namespace）| MINOR | 🟡 挂起 | M0/M1 引入 enum 锁 CI 时一并处理 |

**汇总**：✅ 10 / ⚠️ 1 / 🚫 0 / 🟡 4

#### 反向挑战 reviewer

1. **arch 把 §8 doc 撒谎判 BLOCKER**——这次方向反转（之前 [x] 为 false-positive，这次 [ ] 为 false-negative）。同一根因。**arch 与 cross 视角差异显著**：cross 视角下 §8 的不一致只是 minor `m5`，arch 视角下是 BLOCKER（流程层风险）。验证了 Round 1 的反向挑战："reviewer-cross 缺里程碑出口自检 lens"。
2. **cross M3 跨端 round-trip 缺 Swift 端**——评审挑得对。M-1 范围内不实跑是 HARNESS_PROTOCOL.md §6 既定，但 cross 强调"风险点要列出"是合理细化。已补到 §8 高风险点列表。

#### Round 1 用户拍板状态

✅ **作者自动收敛**：所有 ✅ 接受 已落地；1 ⚠️ 部分接受写明边界；4 🟡 挂起项写到 PROTOCOL.md M1+ 段；0 still-disagree。**无需用户介入**，可继续推契约 #3 + #4 + 方法论。

42/42 vitest 通过；prod-guard 22/22 通过；git-guard 4/4 通过。

---

### Round 1 — 契约 #3 ContextBundle + #4 PR/worktree + 方法论

**日期**：2026-05-03 02:53 / 03:01 (arch retry)
**待审 artifact**：
- `docs/HARNESS_CONTEXT_PROTOCOL.md` + `docs/adr/ADR-0014-context-bundle-explicit.md`
- `docs/HARNESS_PR_GUIDE.md` + `docs/adr/ADR-0013-worktree-pr-double-reviewer.md` + `docs/COMMIT_CONVENTION.md` + `docs/branch-naming.md` + PR template
- `packages/backend/scripts/git-guard.mjs` + `prod-guard.mjs` + 配套测试
- `methodologies/00-discovery.md` + `01-spec.md`

**Verdict 文件**：
- [contract-3-4-method-cross-2026-05-03-0253.md](reviews/contract-3-4-method-cross-2026-05-03-0253.md) — gpt-5.5-medium（**2 BLOCKER + 5 MAJOR + 4 MINOR**）
- [contract-3-4-method-arch-2026-05-03-RETRY.md](reviews/contract-3-4-method-arch-2026-05-03-RETRY.md) — claude-opus-4-7（0 BLOCKER + 4 MAJOR + 5 MINOR；首次 stream 超时，retry 成功）

#### 辩论矩阵（合并 cross + arch 共 18 项独立 finding）

| # | 主张（来源） | 严重度 | 判断 | 处理 |
|---|---|---|---|---|
| 1 | ContextBundle 允许 grep worktree 与"绝不读非 Bundle 文件"冲突（cross B1）| BLOCKER | ✅ 接受 | HARNESS_CONTEXT_PROTOCOL §6 加 materialize Bundle 到只读目录 + spawn cwd=BundleDir 实施细则；M2 落地 |
| 2 | git-guard 不能拦截 `--no-verify`（cross B2）| BLOCKER | ✅ 接受 | HARNESS_PR_GUIDE §9 重写"多层防御"表 + 标 git-guard 为 dev guardrail 不是安全沙箱 + 标真不可绕过守门转移到 layer 1/3/4 |
| 3 | §3 表非 ArtifactKindGlob 形式化（cross M1）| MAJOR | ✅ 接受 | §2 加 Selector schema TypeScript 定义；§3 表说明是 Selector 实例 |
| 4 | fail-loud 与新项目首轮空 source 冲突（cross M2）| MAJOR | ✅ 接受 | 加 `requiredButMayBeEmpty` 语义 + §4 加详细解释（字段必须存在；内容可空） |
| 5 | Review gate 数字评分但 reviewer-cross markdown 没数字（cross M3）| MAJOR | ✅ 接受 | reviewer-cross SKILL.md "Verdict Output Format" 段加 Numeric Score 表（5 lens × 0..5 + Overall + blocker 上限 3.9） |
| 6 | prod-guard regex 漏覆盖 rm -fr / 变量路径 / quoted（cross M4）| MAJOR | ✅ 接受 | prod-guard.mjs 顶部注释降级为"dev guardrail，不是安全沙箱"；test-prod-guard.mjs 加 known-issue 注释；M2 改 tokenizer |
| 7 | 复制 .env 不阻止子进程继承 prod secrets（cross M5）| MAJOR | ✅ 接受 | HARNESS_PR_GUIDE §9 重写：M2 worktree.ts spawn 必须用 env allowlist + 默认清空 `*_API_KEY` / `*_TOKEN` 等敏感变量 |
| 8 | M-1 dogfood 与 M2 enforce 窗口断层（arch MAJOR-1）| MAJOR | 🟡 挂起 | 写到 ROADMAP M2 准入 Round 2 待补：M-1.5 enforce 落地子里程碑 OR 加最小 context-manager preflight script。当前实施超 M-1 范围，已记入 [carried-over observation items] |
| 9 | ContextBudget maxTokens "SHA-256 后估算" 语义不通（arch MAJOR-2）| MAJOR | ✅ 接受 | HARNESS_CONTEXT_PROTOCOL §2 改 `maxBytes`（精确字节预算）+ 注释解释 M3 后再切 token-aware |
| 10 | Retrospective → v2 ritual 流程缺细节（arch MAJOR-5）| MAJOR | ✅ 接受 | 建 [methodologies/EVOLUTION.md](../methodologies/EVOLUTION.md) v1.0 placeholder：用户启动 / v1+v2 并存窗口锁版本 / 反刷分需 ≥2 维度阈值 / toy Issue 先验证 / 失败回退 / 单调演化（不允许 v3+v2 并存） |
| 11 | enterprise 4 段 discovery + spec 都硬填重复（arch MAJOR-7）| MAJOR | ✅ 接受 | 00-discovery §7 降级为"指向 + 标记"（businessEntities/permissionMatrix/approvalSteps/reportSchemas 各标 true/false/unknown），具体 diff 推 spec 阶段 |
| 12 | artifactRefs GC 语义未定（arch MINOR-3）| MINOR | ✅ 接受 | HARNESS_CONTEXT_PROTOCOL §1 加段：Artifact 一旦被 Bundle 引用即不可变（M-1 已对齐 superseded_by）+ snapshot 必须 inline content 不只 hash |
| 13 | Reviewer §3 行 mayInclude 应显式空（arch MINOR-4）| MINOR | ✅ 接受 | §3 review 行 mayInclude 改 `[]（强制空，覆盖默认表）` |
| 14 | Discovery output kind=spec 错（arch MINOR-6）| MINOR | 🟡 挂起 | issue_draft 作为 Artifact.kind 是 minor bump（加 enum 值）；M0 启用 Coder Stage 时一并加 schema migration 0002 |
| 15 | reportSchemas 无最小 schema（arch MINOR-8）| MINOR | 🟡 挂起 | 01-spec §2 metadata_json 处可加示例；推到 M2 dogfood toy 企业仓库时按真实需求落定 |
| 16 | Hotfix 默认 risk=high（arch MINOR-9）| MINOR | ✅ 接受 | ADR-0013 §3 加：`harness/hotfix-*` 默认 risk=high 强制双 reviewer，除非用户在 PR 显式标 `hotfix-risk: low` 并写理由 |
| 17 | commit subject 大小写规则与示例冲突（cross m1）| MINOR | ✅ 接受 | COMMIT_CONVENTION §1 改"英文普通词小写；代码标识符 / 专有名词保留原大小写" |
| 18 | branch-naming discovery 无 issueId 例外未定（cross m2）| MINOR | ✅ 接受 | branch-naming §2 加例外段：discovery/spike/sweep 用 stageRunId/initiativeId/scope+date 作 owner key |
| 19 | git-guard all-zero localSha 未处理（cross m3）| MINOR | ✅ 接受 | git-guard.mjs 加 ZERO_SHA 常量 + 删除 protected ref 直接阻止 + 删除非 protected ref 跳过 author 检查 |
| 20 | prod-guard test 缺 reject 覆盖（cross m4）| MINOR | ✅ 接受 | test-prod-guard.mjs 加 known-issue 注释 + M2 改 tokenizer |

**汇总**：✅ 14 / 🟡 3 / ⚠️ 0 / 🚫 0（**0 still-disagree → 1 轮收敛**）

#### 反向挑战（沉淀）

1. **arch retry 通过快速短读完成**：原因是 12 文件全读时超 stream timeout。修复 SKILL/Agent prompt 应在大批文件评审时拆任务而不是要求一次过——这是 Round 2 经验。
2. **cross B1 + arch MINOR-4 联手击中"reviewer 间接污染"** —— 验证了"独立 lens 但合作捕错"的 multi-reviewer 设计有效。reviewer-cross 找出 grep worktree 漏洞，arch 找出 review row mayInclude 矛盾，两者拼合才形成完整修复。
3. **arch MAJOR-1（M-1 → M2 enforce 窗口断层）是当前 M-1 真硬伤**——本轮判挂起是因为修复需要写 minimum context-manager preflight script，超出 M-1 doc-only 范围。**carried-over observation items** 写到 retrospective placeholder，下次 dogfood 撞墙后立即处理。

#### Round 1 用户拍板状态

✅ **作者自动收敛**：14 ✅ 接受全部已落地（test 全绿 + verify 23/23），3 🟡 挂起项写明边界 + 触发条件 + 时间窗口，0 still-disagree。**无需用户介入**，M-1 4 契约 + 2 方法论全部完成。

---

(后续 Round / Round N ... 在此追加)
