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

(后续 Round 2 / Round 3 ... 在此追加)
