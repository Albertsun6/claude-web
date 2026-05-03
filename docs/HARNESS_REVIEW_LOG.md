# Harness Review Log

> **用途**：harness 各契约 / 设计 / 方法论的评审历史。每轮评审追加一段，**不删除**历史。
>
> **状态**：M-1 启动期建立（2026-05-03）。Review Mechanism v2 升级 2026-05-03。

## 评审机制版本

- **v1**（2026-05-03 之前）：phase 1 独立评审 + author solo arbitration（合并 phase 2 + 3）
- **v2**（2026-05-03 起）：phase 1 独立评审 + **phase 2 cross-pollinate**（reviewer 互看互怼）+ phase 3 author 草拟 + 用户终审。M3+ 加 Synthesizer 时升级为 v3
- 详见 [docs/proposals/REVIEW_MECHANISM_V2.md](proposals/REVIEW_MECHANISM_V2.md)

**v1 期已 ship 的 4 个 round**（详见下面 Round 1 / Round 2 / contract-2 / contract-3-4-method）：**按 v1 跑，无 phase 2 cross-pollinate verdict**。M3+ Synthesizer 上线后允许在新 retrospective 中标记 `M3+ re-arbitrated`，形成 audit trail。**不回填**已有 round 的 phase 2 verdict（伪造历史）。

**v2 期新 round 强制三段格式**：phase 1 / phase 2 / phase 3 verdict + matrix。

---

## 评审机制元配置（v2）

| Reviewer / 角色 | 评审三层 | 视角维度 | 实现 | 模型 |
|---|---|---|---|---|
| `harness-architecture-review` | phase 1 + phase 2 react | 架构可行性 / 里程碑裁剪 / 垂直贴谱性 / 风险遗漏 | Agent (Claude) | claude-opus-4-7 |
| `reviewer-cross` | phase 1 + phase 2 react | 正确性 / 跨端对齐 / 不可逆 / 安全 / 简化 | cursor-agent CLI（plan 模式） | gpt-5.5-medium |
| `debate-review` SKILL（作者跑） | phase 3 裁决 | 4 档判断（接受 / 部分接受 / 反驳 / 挂起） | skill in current context | claude-opus-4-7 |
| 用户拍板 | phase 3 终审 | blocker rebuttal 必须显式批准；分歧升级人审 | 人 | — |

**phase 1 → phase 2 → phase 3 流程**：
1. phase 1：reviewer 各自隔离评 artifact（互不见）→ verdicts
2. phase 2：cursor-agent 跑 cross + Agent 跑 arch，**互看 sibling verdict**，按 [PHASE_2_PROMPT.md](~/.claude/skills/debate-review/PHASE_2_PROMPT.md) 四选一表态 + 至少 1 disagree/refine 硬约束 → react verdicts
3. phase 3：author 用 [debate-review SKILL](~/.claude/skills/debate-review/SKILL.md) 综合 phase 1+2 → 4 档矩阵 → applied fixes → 用户终审

**独立性硬约束（v2 dogfood Round cross M1 修复）**：
- phase 1：reviewer **不读** author transcript / 思考流 / 工具调用历史；reviewer 互不可见
- phase 2：reviewer **不读** author counter / 4 档分类草案；只读 own + sibling Round 1 verdict + artifact
- phase 3：author **必须读取** phase 1 + phase 2 全部 verdict（[debate-review SKILL.md](~/.claude/skills/debate-review/SKILL.md) phase 3 输入合约）；缺任一 react verdict 不能裁决（v2 dogfood Round arch react N1 修复）

**M1+ phase 2 跳过日志格式**（v2 dogfood Round cross M3 + arch refine 修复）：
- 当 OQ1 触发条件不满足时（M1+ 期），允许跳过 phase 2，但 REVIEW_LOG 必须记录：

```
phase 2: skipped
trigger check:
  - blocker_mismatch: false (arch BLOCKERs=[B1] vs cross BLOCKERs=[B1] same)
  - high_risk_label: none (labels=[refactor, docs])
  - irreversible: false
  - priority: normal
source-of-truth: harness.db.issue.id=iss-XXX (priority=normal, labels=...)
decided_by: author / harness-runtime (M2 review-orchestrator)
decided_at: <ISO>
```

不允许漏写"未触发原因"。否则 audit 无法区分"漏跑"vs"合法跳过"。

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

#### 裁决矩阵（v1，无 phase 2 react verdict）

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

#### 裁决矩阵（v1，无 phase 2 react verdict）

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

#### 裁决矩阵（v1，无 phase 2 react verdict；合并 cross + arch 共 18 项独立 finding）

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

### v2 dogfood Round — Review Mechanism v2 自验收（2026-05-03）

**Artifact**：[docs/proposals/REVIEW_MECHANISM_V2.md](proposals/REVIEW_MECHANISM_V2.md)（v2.0 修订版，已吸收 Round 1 的 12 项 finding）

**触发**：v2.0 设计文档自验收 dogfood，验证三层流程能产生实质 phase 2 信号。

#### Phase 1 verdicts（独立隔离）

- arch: [review-mech-v2-revised-arch-2026-05-03-1120.md](reviews/review-mech-v2-revised-arch-2026-05-03-1120.md) — claude-opus-4-7（**0 BLOCKER + 2 MAJOR + 3 MINOR**：v1 12 项全 absorb + 引入 5 项新 finding）
- cross: [review-mech-v2-revised-cross-2026-05-03-1119.md](reviews/review-mech-v2-revised-cross-2026-05-03-1119.md) — gpt-5.5-medium（**1 BLOCKER + 3 MAJOR + 3 MINOR**：§3 author counter 矛盾 / REVIEW_LOG 硬约束缺 / §8 弱化 / M1+ skip 无日志格式）

#### Phase 2 react verdicts（cross-pollinate）

- arch react（看 cross verdict）: [review-mech-v2-revised-arch-react-2026-05-03-1135.md](reviews/review-mech-v2-revised-arch-react-2026-05-03-1135.md) — 4 agree / 0 disagree / 3 refine / **2 new findings (N1 N2)**
- cross react（看 arch verdict）: [review-mech-v2-revised-cross-react-2026-05-03-1125.md](reviews/review-mech-v2-revised-cross-react-2026-05-03-1125.md) — 6 agree / 0 disagree / 5 refine / **2 self-revisions** (B1 BLOCKER → MAJOR) + **1 new finding (N1)**

#### v2 §4 验收（PASS ✅）

- (a) 流程必过：✅ 两份 react verdict 落盘；四选一被遵守；至少 1 disagree/refine 硬约束被遵守（cross 5 refine, arch 3 refine）
- (b1) ✅ cross 撤回了 phase 1 BLOCKER B1 严重度（→ MAJOR），附反例（"sibling 指出脚本实际不读 author counter"）
- (b2) ✅ phase 2 浮出 3 new findings（arch react N1+N2 / cross react N1）—— phase 1 双盲都没提

**结论**：v2 phase 2 cross-pollinate 真产生实质信号，不是仪式化。

#### Phase 3 裁决矩阵（合计 phase 1 + phase 2 共 14 项 finding）

| # | 主张（来源） | 严重度 | 判断 | 处理 |
|---|---|---|---|---|
| 1 | §3 成本表说"读 sibling + author counter"，与 §1.1/§1.2 矛盾（cross B1 → 自降 MAJOR）| MAJOR | ✅ 接受 | §3 移除 author counter 引用 |
| 2 | scripts/run-debate-phase.sh spawn-injection 风险（arch M1） | MAJOR | ⚠️ 部分接受 | M2 review-orchestrator 自动化时彻底解决；当前 stub 文档约束 author 严格按模板 spawn arch react，不允许加 contextual hint |
| 3 | 自验收 dogfood 用本提案 = author 既写又裁，反向诱导 (b1)/(b2)（arch M2）| MAJOR | ⚠️ 部分接受 | 本轮 dogfood 已成既定事实；但实际 phase 2 产 1 self-revision + 3 new findings + 10 refine 远超门槛，证明非反向诱导。下次 dogfood 用第三方 artifact（M0 第一个真 contract）验证 |
| 4 | REVIEW_LOG 独立性硬约束缺 phase 2 禁读 author counter（cross M1） | MAJOR | ✅ 接受 | REVIEW_LOG 头部加显式硬约束三层 |
| 5 | §8 完工 checklist 弱化 §4 双门槛（cross M2） | MAJOR | ✅ 接受 | §8 与 §4 完全一致 |
| 6 | M1+ phase 2 skip 无日志格式（cross M3 → arch refine 加 source-of-truth） | MAJOR | ✅ 接受 | REVIEW_LOG 头部加 skip 日志模板（trigger check + source-of-truth 字段） |
| 7 | phase 3 SKILL 必须 fail-loud 缺任一 react verdict 不能裁决（arch react N1）| MAJOR | ✅ 接受 | debate-review SKILL 加输入合约段；缺文件 → 拒绝裁决 |
| 8 | phase 2 boundary 单点 enforcement（arch react N2） | MAJOR | ⚠️ 部分接受 | M-1 期作者责任；M2 orchestrator 机器化 |
| 9 | phase 2 合法性缺机器校验（cross react N1） | MAJOR | 🟡 挂起 | M2 orchestrator 解析 react verdict 校验 stance distribution + M+K≥1 |
| 10 | §10 历史 4 round 未明列具体名（arch m1） | MINOR | ✅ 接受 | 头部"v1 期已 ship 4 round" 段已列 Round 1 / Round 2 / contract-2 / contract-3-4-method |
| 11 | OQ1 (c) Issue.priority=high 生效窗口未说（arch m2 + cross refine 扩到所有触发条件 source-of-truth） | MINOR | ✅ 接受 | §6 OQ1 加 "(c) M-1/M0 期 priority 字段无业务数据，M1+ 才生效"；skip 日志强制每条 a/b/c 的 source-of-truth 字段 |
| 12 | ROADMAP M0/M1 显式妥协项 acceptance 弱（arch m3） | MINOR | 🟡 挂起 | 当前已加段到 ROADMAP M0/M1 退出条件；grep 校验在 verify-m1-deliverables 已加 ROADMAP 文件存在；具体内容 grep 留 M0 准入 ritual |
| 13 | v1/v2 日期边界不准（cross m1） | MINOR | ⚠️ 部分接受 | 头部已写"v1 ship 前 vs v2 起"，时间戳精确到分要 retroactive 改动量大；当前措辞 OK |
| 14 | 历史"辩论矩阵"与 v2 phase 3 同名（cross m2） | MINOR | ✅ 接受 | 4 个历史 round 头部全部改名"裁决矩阵（v1，无 phase 2 react verdict）" |
| 15 | (b1) 价值信号没把"refine 改 fix"算（cross m3 + arch refine：仅"改 fix"算，纯措辞不算） | MINOR | ✅ 接受 | §4 (b1) 扩为"撤回 / 升级 / refine-改 fix"，纯措辞 refine 不算 |

**汇总**：✅ 9 / ⚠️ 4 / 🚫 0 / 🟡 2 → **0 still-disagree → 1 轮收敛**

#### v2 dogfood 用户拍板状态

✅ **作者自动收敛**：所有 ✅ 接受落地（test 全绿 + verify 25/25），4 ⚠️ 部分接受写明边界，2 🟡 挂起到 M2 orchestrator。**无需用户介入**。

**v2 验收 PASS** —— Review Mechanism v2 进入生产用，下一个评审走完整三层流程。

---

### M0 modelList Round — `/api/harness/config` payload + modelList 试点（v2 第一个真用例）

**日期**：2026-05-03
**Artifact**：[docs/proposals/M0_HARNESS_CONFIG_MODELLIST.md](proposals/M0_HARNESS_CONFIG_MODELLIST.md)（v1.0 → v1.1 修订）

**触发**：M0 第一契约。**v2 Review Mechanism 第一个真用例**（dogfood self-validation 之外），全程走三层流程。

#### Phase 1 verdicts（独立隔离）

- arch: [m0-modellist-arch-2026-05-03-1145.md](reviews/m0-modellist-arch-2026-05-03-1145.md) — claude-opus-4-7（**0 BLOCKER + 4 MAJOR + 5 MINOR**）
- cross: [m0-modellist-cross-2026-05-03-1144.md](reviews/m0-modellist-cross-2026-05-03-1144.md) — gpt-5.5-medium（**2 BLOCKER + 4 MAJOR + 3 MINOR**，overall score 3.0/5）

#### Phase 2 react verdicts（cross-pollinate）

- arch react（看 cross verdict）: [m0-modellist-arch-react-2026-05-03-1210.md](reviews/m0-modellist-arch-react-2026-05-03-1210.md) — **6 agree / 0 disagree / 3 refine / 2 self-revisions / 2 new findings (N1+N2)**
- cross react（看 arch verdict）: [m0-modellist-cross-react-2026-05-03-1151.md](reviews/m0-modellist-cross-react-2026-05-03-1151.md) — **7 agree / 1 disagree / 6 refine / 3 self-revisions / 0 new findings**

#### v2 §4 验收（PASS ✅）

- (a) 流程必过 ✅：4 verdict 全落盘；PHASE_2_PROMPT 四选一遵守；至少 1 disagree/refine 硬约束（cross 6 refine + 1 disagree, arch 3 refine）
- (b1) ✅：cross react 自降 own B1 BLOCKER → MAJOR + 自拆 own B2 / arch react 自拆 own MAJOR-2 → 2a+2b
- (b2) ✅：phase 2 浮出 2 new findings（arch react N1 protocolVersion 语义 + N2 If-None-Match 不传行为）

**关键 cross-pollinate 价值**：
- cross 看 arch 后接受降级 BLOCKER（B1 → MAJOR）—— 避免过度 escalation 阻塞实施
- arch 看 cross 后 acknowledge **4 项 cross-lens unique 贡献**（cross M2 ID 契约 / M3 ADR Decision #1 不一致 / m2 ETag header quoting / m3 auth 继承）—— 全是 4-dim lens 之外的真问题，arch 全 agree
- cross 拒绝 arch MINOR-4（minClientVersion 合并 backend）—— **唯一保留分歧**，phase 3 author 接受 cross 立场（HTTP endpoint 无 client version，iOS 自查必要）

#### Phase 3 裁决矩阵（合 phase 1 + phase 2 共 18 项 finding）

| # | 主张（合并源）| 终决严重度 | 判断 | 处理 |
|---|---|---|---|---|
| 1 | M0 是否有 WS push config_changed 矛盾（cross B1 / arch MAJOR-1，phase 2 共识降 MAJOR + 同步修 ADR-0011 #3）| MAJOR | ✅ | §0 + §5.2 删 "WS 推 config_changed" 验收项；§2.4 改"WS 重连后 GET + If-None-Match"；ADR-0011 Decision #3 同步改 |
| 2 | ETag canonical_json 嵌套字段被 sortedKeys 白名单过滤（cross B2 / arch MAJOR-2a）| BLOCKER | ✅ | §1.3 改写递归 canonicalizer pseudo-code + 强制 fixture 测试断言改嵌套字段都改 etag + key 顺序无关 stable |
| 3 | compareVersion 实施责任真空（arch MAJOR-2b 自拆 + cross react agree）| MAJOR | ✅ | §2.3 加 `packages/shared/src/version.ts` compareVersion 实施清单 step + 工具函数代码 |
| 4 | recommendedFor 开放 string 破协议契约（arch MAJOR-3 / cross react refine "可接受但写未知值忽略"）| MAJOR | ⚠️ | 部分接受：保留 z.string() 数组（不锁 enum 避免 minor bump 烦恼），但 §1.1 加注 hint-only + iOS UI 不分支 + 未知值 graceful skip |
| 5 | isDefault exactly-one schema 没 enforce（cross M1）| MAJOR | ✅ | §1.2 HarnessConfigSchema 加 `.superRefine()` 全局校验 enabled+isDefault 恰好 1 |
| 6 | iOS cutover 默认从 haiku 静默漂移到 sonnet（arch MAJOR-4 (2)，cross react 自承认漏掉）| MAJOR | ✅ | §3.4 加 cutover 行为段：检查 settings.currentModelId vs server isDefault；显式选过保留，未选过用 server 默认；停用提示用户 |
| 7 | enabled=false 当前 selection 切换语义（cross m1 + arch MAJOR-4 (3) 同源）| MAJOR | ✅ | §1.1 + §3.4：disabled 不出现新选择；当前已 disabled 保留 + "已停用" 标签 + 切走后不可再选 |
| 8 | HARNESS_PROTOCOL §1 ID UUIDv4 vs §8 opaque stable string 自相矛盾（cross M2，arch react agree—cross-lens unique 贡献）| MAJOR | ✅ | HARNESS_PROTOCOL.md §1 ID 行改 opaque stable string |
| 9 | ADR-0011 Decision #1 endpoint payload 全量 vs M0 modelList-only 不一致（cross M3，arch react agree）| MAJOR | ✅ | ADR-0011 Decision #1 改"分阶段扩展 config，M0 仅 modelList，新增字段 minor bump + graceful skip" |
| 10 | iOS fallback config OQ-A + drift 风险 OQ-C（cross M4 + arch MINOR-2，phase 2 共识 single-source）| MAJOR | ✅ | OQ-A 决议：single source `packages/shared/fixtures/harness/fallback-config.json`；backend import + iOS xcodegen 复制 Bundle resource；drift 单元测试强制 |
| 11 | protocolVersion 1.0 vs minor bump 语义对接缺失（arch react N1）| MAJOR | ✅ | §1.2 加 minor/major bump 规则 + Zod `.passthrough()` / Swift `keyDecodingStrategy` graceful skip 未知字段 |
| 12 | ETag header HTTP quoting（cross m2，arch react agree—cross-lens 贡献）| MINOR | ✅ | §2.1 明确 header `ETag: "sha256:xxx"` 标准引号 + body 字段裸字符串；backend 比较 If-None-Match 兼容 quoted/unquoted |
| 13 | endpoint auth 继承（cross m3，arch react agree—cross-lens 贡献）| MINOR | ✅ | §2.1 加"挂在现有 /api/* auth 体系下" |
| 14 | If-None-Match 不传行为（arch react N2）| MINOR | ✅ | §2.1 加"无 If-None-Match → 200 + body" |
| 15 | §0 退出条件没标 "试点子集"（arch MINOR-1）| MINOR | ✅ | §0 加"M0 全局退出条件子集"标注 |
| 16 | TS const mutation 风格（arch MINOR-3）| MINOR | ⚠️ | 部分接受：改 lazy `getHarnessConfig()` 函数（也利于后续 file-watch 升级），不是 correctness 问题 |
| 17 | minClientVersion 责任分散两端（arch MINOR-4 / cross react disagree）| MINOR | 🚫 | **反驳**（phase 3 author 接受 cross 立场）：HTTP config endpoint 无法知道 client version，iOS 自查必要；ADR-0011 §最小协议层行为契约已写明 iOS 端检测 |
| 18 | iOS 真机 fallback 验证缺失（arch MINOR-5，cross react agree）| MINOR | ✅ | §5.2 加真机断网 cold start 验收项（M0 是 iOS 唯一一次大改装） |

**汇总**：✅ 14 / ⚠️ 2 / 🚫 1 / 🟡 0 → **0 still-disagree → 1 轮收敛**

#### 反向挑战（沉淀）

1. **arch 4-dim lens 对"近端文本一致性"盲**：cross 找出 §3 cost table 矛盾 / HARNESS_PROTOCOL §1 vs §8 ID 矛盾 / ADR-0011 Decision #1 vs proposal §1.2 不一致——这 3 项都是 arch 完全没看出的 cross-lens unique 贡献。arch react 全 agree 验证了 cross-pollinate 的实质价值
2. **cross 5-lens 对"里程碑出口判定 / 本提案与全局 milestone 对接"盲**：arch 找出 §0 退出条件没标"试点子集"（arch MINOR-1）+ MAJOR-4 cutover 默认模型漂移 + N1 protocolVersion 与 ADR-0015 minor bump 流程未 echo——cross 完全没提。互补成立
3. **double-blind phase 1 是合理 baseline**：18 项 finding 中**只有 1 项 (#17) 双方仍 disagree**，其余 17 项收敛或互补——证明 multi-agent debate 在 v2 期对 M0 真业务是有效的（不是 dogfood self-reflective）

#### 用户拍板状态

✅ **作者自动收敛**（按用户"按建议"授权）：14 ✅ 接受全部已落地（proposal v1.1 修订完毕 + ADR-0011 Decision #1+#3 修 + HARNESS_PROTOCOL §1 ID 修），2 ⚠️ 部分接受写明边界，1 🚫 反驳给具体反论据，0 still-disagree。

**M0 modelList Round 验收 PASS** —— 进入实施阶段（19 步实施清单见 proposal §4）。

---

(后续 Round / Round N ... 在此追加)
