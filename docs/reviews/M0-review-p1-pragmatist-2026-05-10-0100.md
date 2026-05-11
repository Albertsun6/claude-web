# M0 Phase 1 Review — vessel-pragmatist

- **Date**: 2026-05-10 01:00
- **Reviewer**: vessel-pragmatist (lens: YAGNI / Eva 优先复用 / 个人单机硬约束)
- **Scope**: 6 M0 artifacts under `packages/backend/src/{migrations,memory,observability,skills,cli}/` + `orchestrator.ts`
- **Calibration acknowledged**:
  - 5 接口先于实现已 0B 落地，不质疑接口 stub 本身
  - `harness.db` vs `memory.db` 分库 是 0-pre EVA_TO_VESSEL_MAPPING §2 的设计决策，**不质疑分库本身**
  - `unknown` placeholder 在 0B 已被标 defer 到 M0；M0 用 `unknown` 仍是延迟（可质疑落地形态）

---

## Findings

### F-P1 [BLOCKER] `0004_m0_sessions.sql` 会被 `openHarnessDb()` 错误地灌进 harness.db

**严重程度**：BLOCKER（污染 Eva 现有数据库；首次跑 vessel-core 起就埋雷）

**事实**：
- `harness-store.ts` L40：`MIGRATIONS_DIR = join(__dirname, "migrations")`
- `session-store.ts` L25：`MIGRATIONS_DIR = join(__dirname, '..', 'migrations')`
- **同一个目录**。两个 runner 共用 `packages/backend/src/migrations/`。
- `harness-store.ts` L120-122 用 glob `^\d{4}_.*\.sql$` + sort 拉所有 migration。它会把 `0004_m0_sessions.sql` 当作 harness.db 的下一个 migration 应用。
- 后果：harness.db 里平白多出 `sessions / intents / skill_invocations` 三张表，且 `user_version` 被推到 200（vs EVA_TO_VESSEL_MAPPING §1.5 规划的 103）。后续 `0004_workflow_state.sql`（M1C-A 计划占用 0004 编号）落盘那一刻 file-name 冲突 + version 冲突，要么手动 patch 要么 nuke harness.db。

**这一条同时也是 F-A1（编号冲突）的真正机制层成因**：编号冲突不只是 *预期未来文件* 的冲突，是 **当下 0004_m0_sessions.sql 已经在污染 harness.db**。

**修复方向（按 YAGNI 排序）**：
1. **首选（Eva 复用 + 最小代价）**：放弃独立 DB，把 sessions/intents/skill_invocations 加进 `harness.db`，session-store.ts 整体删掉，改成 `harness-queries.ts` 里多三个 helper。M0 = 0 行新 runner 代码。
2. **次选（保留分库）**：拆 migrations 目录 — `migrations/harness/` + `migrations/memory/`，两个 runner 各扫各的；`session-store.ts` 不再硬编码单文件名，按目录扫描沿用 harness-store.ts 的 schema_migrations 表逻辑。
3. **下下策（保留现状）**：把 `0004_m0_sessions.sql` 改名加前缀（如 `mem_0001_sessions.sql`）+ harness-store.ts 的 glob 改成只接受 `^\d{4}_.*\.sql$`（不变）+ session-store.ts 的 glob 改成 `^mem_\d{4}_.*\.sql$`。**但这条把"分库通过 prefix 隔离"作为约束写死，等于又要加文档 + cross review，不如方案 1**。

**强烈推荐方案 1**：分库决策本身没错（Eva harness.db 是稳定 schema，混入 Vessel 实验表不好），但 M0 这一刻 sessions 表只有 4 列、intents 6 列、skill_invocations 10 列，规模上是 harness.db 13 表的 1/4 尺寸。**M0 没有 embedding / vector / 大 blob 写入**——分库带来的 IO/锁优势此刻为 0，分库的成本（双 runner / 双备份策略 / 双迁移测试）此刻 = 100%。等 M1C-B 真要接 sqlite-vec 时再分（M1C-B 那时分库的 ROI 是正的）。

**这正是工程方法论原则 #8（Reuse before rewrite）的典型违反**：session-store.ts 的 31-52 行（openMemoryDb）几乎逐字复制 harness-store.ts 的 90-105 行；MEMORY_SCHEMA_VERSION 常量、user_version pragma 推进、WAL/FK 设置、mkdirSync 兜底都是 harness-store 已经实现并跑过 4 次 migration 的代码。M0 写一份"简化版" runner 的论证强度不足以盖过复用论。

---

### F-P2 [MAJOR] `session-store.ts` 是否能容纳 EVA_TO_VESSEL_MAPPING §1.5 的后续 schema 演进路径？

**严重程度**：MAJOR（架构债务，但 M0 不阻塞）

**事实**：
- session-store.ts L42-48：迁移逻辑只支持 *单文件 + user_version 比较*：

```typescript
const current = db.pragma('user_version', { simple: true }) as number;
if (current < MEMORY_SCHEMA_VERSION) {
  const sql = readFileSync(join(MIGRATIONS_DIR, '0004_m0_sessions.sql'), 'utf-8');
  db.transaction(() => {
    db.exec(sql);
    db.pragma(`user_version = ${MEMORY_SCHEMA_VERSION}`);
  })();
}
```

- 假设接受 F-P1 方案 2（分库保留），M0+ 加第二个 memory migration（如 M1C-B 的 embedding 表）时这段就要全部重写：要么变 directory scan + schema_migrations 表，要么硬编码两个文件名 if-else（明显坏味道）。
- **这是迟早要补的 work**，本次 M0 既然写了 runner 就应该一次写对。harness-store.ts 已经踩过 schema-rebuild 模式坑（0002 v0.4.4 prod 失败的根因）—— 重写一份"简化版 runner"等于把 Eva 流过的血再流一次。

**相关 calibration**：M0 是骨架不是 v1，但**骨架长出来后会被沿用，不是丢弃**。这条 30-60 行新代码会在 M1+ 直接 mute 掉所有未来 memory schema work——属于"现在简化导致未来必返工"，不属于 YAGNI 中合理的"等用到再写"。

**与 F-P1 的关系**：如果接受 F-P1 方案 1（不分库），F-P2 自动消失，session-store.ts 这 112 行 90% 删掉。**F-P1 + F-P2 合起来强烈倾向方案 1**。

---

### F-P3 [MAJOR] orchestrator.ts 的边界保持得不错，但 SkillContext 几个"假手"是 over-engineering

**严重程度**：MAJOR（M0 范围争议；不阻塞 acceptance 但偏离 YAGNI）

**M0 该有 → 该没有 的对照**：

| 项 | M0 该有 | orchestrator.ts 实际 | 评价 |
|---|---|---|---|
| bootSession | ✅ | L40 `bootSession(input.sessionId)` | ✅ |
| writeIntent | ✅ | L48 | ✅ |
| trace.write(intent.received) | ✅ | L53-62 | ✅ |
| dispatch echo | ✅ | L68-81 | ✅ |
| trace.write(skill.completed) | ✅ | L83-93 | ✅ |
| writeSkillInvocation | ✅ | L95-104 | ✅ |
| AgentResult discriminated union | ✅ | L106 / L136 | ✅ |
| **systemPromptPrefix / Workflow resume / SoulSpec injection / Capability namespace lookup** | ❌ | **缺席** | ✅ 干净 |
| Tool registry full surface | ❌ | L78 `tools: { get: () => null }` | ⚠️ 见下 |
| Memory full surface | ❌ | L79 `memory: {} as never` | ❌ 见下 |
| workspaceDir | ❌ | L80 `workspaceDir: ''` | ⚠️ 见下 |

**问题：`memory: {} as never`** —— 这是把 `Memory` 接口的运行时实例伪造成空对象，TypeScript 编译期靠 `as never` 钻过去。如果 EchoSkill 不读 memory 就没事，但 M0.5 加 CodingSkill 时它**一定会**触 `ctx.memory.read()`，那一刻就是运行时 TypeError。

**问题：`tools: { get: () => null }`** —— 同样，EchoSkill 不调 tool 没事，但相比直接传 `null` 或不传，造了个假 registry 对象 *暗示存在但永远 return null*。M0 没有 Tool（`packages/backend/src/interfaces/tool.ts` 也只是接口），更直接的做法是把 `SkillContext.tools / memory / workspaceDir` 在接口层就标 optional + EchoSkill 只用 traceCtx：

```typescript
// interfaces/skill.ts
export interface SkillContext {
  traceCtx: TraceContext;
  tools?: ToolRegistry;     // M1B+ 接 MCP 时变必填
  memory?: Memory;           // M1C+ 接 Memory full surface
  workspaceDir?: string;     // M0.5 CodingSkill 起需要
}
```

这样 orchestrator.ts L74-81 简化到：

```typescript
const artifact = await skill.invoke({ text: input.text }, { traceCtx: skillCtx });
```

**少 7 行假手代码 + 接口语义诚实（"M0 真的没接 Tool/Memory/workspace"）**。

**注意**：这条**不**与 0B 的"接口先于实现"决策矛盾——接口 stub 已落，本条是说 M0 实例化时不要凭空造假对象去满足接口。把字段标 optional 是对接口的微调，不是偷换接口。

**Calibration**：可以接受 owner 选择 *"宁可现在写 `{} as never` 让 5 个月后 M1C 改接口时只改 1 处"* 的取舍，但 **`as never` 写法本身在 TS 里被视为 type-system escape hatch**，建议至少加一行 `// FIXME(M1C): real Memory injection` 注释，方便未来 grep。

---

### F-P4 [MAJOR] trace-writer.ts 完全没做 redaction，与 spec §3 / §7 直接冲突

**严重程度**：MAJOR（trace-redaction-spec 的 M0 acceptance C-3 会 fail；不是 M1+ 推迟项）

**事实**：
- trace.ts L97-99 注释明说 "M0 落地时必须在 write() 内强制做 redaction（不是依赖 caller 自行脱敏）"。
- trace-writer.ts L8-9 自陈："NOT yet do redaction. M0 acceptance doesn't require redaction yet"。两条文档**直接矛盾**，且 trace-writer.ts 的自陈错误。
- trace-redaction-spec.md §7 的 M0 Acceptance：

```bash
# Acceptance C-3：payload 不出现 user_prompt 全文
grep -q "user_prompt" instance/traces/<trace_id>/*.json && exit 1 || exit 0
```

  当前 EchoSkill payload 里只放 `text_len: input.text.length`（L60），所以**碰巧**测不出 redaction 缺失（user_prompt 字段没写过）。但这不等于 redaction 实现了——只是没暴露而已。

- 同样空缺：
  - §6 trace 目录权限 0700 — `mkdirSync(dir, { recursive: true, mode: 0o700 })` ✅ L46 做了
  - §6 文件权限 0600 — `writeFileSync(file, JSON.stringify(event, null, 2), { mode: 0o600 })` ✅ L49 做了
  - §3 黑名单 / §3b 内容模式匹配（sk-ant-* / OpenAI key / AWS key / email / 用户路径）—— **完全缺**
  - §5 大输出 → artifact_refs 协议 — **完全缺**（payload schema 已经在 trace.ts L43-49 加了 4096 byte 上限，但 trace-writer.ts 不会自动切到 stdout 文件 + 写 artifact_refs）

**这是用户指定 review focus #3 的核心质问**：`trace-writer.ts 是否完全遵守 trace-redaction-spec`。**答：完全没遵守 §3 / §5；只遵守 §6**。

**修复优先级（按 YAGNI）**：
- **P0（M0 必修）**：装 fast-redact（spec §9 推荐），加一层 `redact()` wrapper 在 `write()` 入口对 payload 跑黑名单字段路径 + 内容模式匹配。spec §9 已经把库选好（fast-redact MIT），M0 增加 ~30 行 + 1 个 dep。
- **P1（M0.5 再加也合理）**：§5 artifact_refs 4 KiB 切割 — M0 EchoSkill payload 永远 < 100 byte，不会触发；M0.5 CodingSkill spawn CC CLI 会有 stdout 大块，那时再加。

**注意**：spec §10 把"trace-redaction-spec"标为 0A FRAMEWORK 前置笔记 + status: superseded-by-FRAMEWORK 后归档。但 spec §11 的 0A checklist 第 1 条要求 "把本文件 §2/§3/§4/§5/§6 写入 FRAMEWORK.md 并加到 plan v5.4 M0 acceptance"——**0A 是否完成这个 checklist 没在 trace-writer.ts 找到证据**。如果 0A FRAMEWORK 已写入，trace-writer.ts 应是 spec 的实现而不是空 stub；如果 0A 没写入，trace-writer.ts 自陈"M0 不需要"是直接 contradicts spec §7。**两种情况都需要补**。

---

### F-P5 [MINOR] vessel-core.ts SIGINT 处理基本稳定但有 2 处轻微缺陷

**严重程度**：MINOR（不影响 M0 acceptance；M1A 加 HTTP server 时会暴露）

**做对的**：
- L80-87 SIGINT handler 用 `sigintHandled` guard 防重入 ✅
- L84 `try { closeMemoryDb(); } catch { /* ignore */ }` 防 close 抛错卡死 ✅
- L86 `process.exit(130)` 用了正确的 SIGINT exit code ✅
- 5 秒 budget 由 process.exit 直接保证（手工调 closeMemoryDb 不会 hang，SQLite WAL 关闭是同步的）

**问题 1**：**没注册 SIGTERM**（launchd 或 ADR-011 §8 daemon 路径会发 SIGTERM 而非 SIGINT）。M0 是前台 CLI 跑（ADR-011 §3），SIGINT 够用；但 ADR-011 §5 说 v1+ 要 launchd。**M0 不修无碍，但加一行 `process.on('SIGTERM', onSigint)` 几乎零成本，建议加**。

**问题 2**：**main 的 `.catch` 路径（L120-123）漏了 `process.removeListener`** —— 不严重因为 process 都要 exit 了，但严格讲 SIGINT handler 应该是 `process.once('SIGINT', onSigint)` 而不是 `process.on(...)`，避免如果未来 main 不直接 exit 而是 return-to-event-loop 时残留 handler。M0 不会触发，但是 nit。

**问题 3（这一条更靠 risk-officer）**：`closeMemoryDb()` 在 L96/L101/L106/L111/L121 共 5 处显式调用 —— 重复。可以把 close 集中到一个 `finally` 或 `process.on('exit', closeMemoryDb)`，让 5 个分支不操心 cleanup。**但 M0 5 处明示 close 反而调试时直观**，YAGNI 角度可以不动。

**总评**：稳定，足够 M0；M1A daemon/HTTP server 启动前补 SIGTERM。

---

### F-P6 [MINOR] env check 静态导入顺序对，但有副作用 import 模式偏离 Eva 风格

**严重程度**：MINOR（运行无误；风格一致性）

**事实**：
- vessel-core.ts L16-19：

```typescript
import 'dotenv/config';
import { checkRenamedEnvVars } from '../startup-env-check.js';

checkRenamedEnvVars();

import { runIntent } from '../orchestrator.js';
import { closeMemoryDb } from '../memory/session-store.js';
```

  在 import 之间插入 statement —— TypeScript / ESM 都允许，但**ES modules 是 hoisted**：所有 import 会在 `checkRenamedEnvVars()` 之前 evaluate。看上去"先 check 再 import 后续模块"是错觉。

- 实际行为：
  1. `'dotenv/config'` 副作用 import（设 process.env）—— 第一执行
  2. 所有其他 import 静态 hoisted —— 实际全部先 evaluate
  3. `checkRenamedEnvVars()` 才跑

- 后果：如果 `orchestrator.ts` 或 `memory/session-store.ts` 在 module top-level 读 env（如 `DATA_DIR`），它们读到的是 dotenv 加载**后**但 env-check **跑之前**的状态。当前 `data-dir.ts` 用 lazy resolveDataDir() 在调用点读 `process.env.VESSEL_DATA_DIR`，所以**目前没问题**；但如果未来加一个 module top-level 的 `const DATA_DIR_RESOLVED = ...`，env-check 的 alert 就会被绕过（它已经 set 完了）。

**修复**：把 import 顺序改成 import 全部在前，env-check 紧跟其后；或更清晰，把 env-check 放进 `main()` 第一行。M0 不修无碍（lazy 读保命），但作为骨架代码这种"看起来对实际靠隐式契约保命"的写法应避免。

---

### F-P7 [INFO] echo.ts 实现非常干净，0 改动建议

**严重程度**：INFO

**事实**：
- 16 行核心逻辑，零外部依赖（不读 ctx.tools / ctx.memory / ctx.workspaceDir）
- 类型 narrow `intent.text !== string` 抛错 ✅
- artifact 是 `{ kind: 'echo', text: ... }` —— `kind` 字段未来给 discriminated artifact 用 ✅
- M0 reference Skill 的最小定义

**唯一观察**：与 F-P3 配合 —— 如果 SkillContext 改成 optional，echo.ts 内部完全不变，但 orchestrator.ts L74-81 假手对象就消掉了。

---

## Severity Summary

| ID | Severity | 文件 | 一句话 |
|---|---|---|---|
| F-P1 | **BLOCKER** | session-store.ts + harness-store.ts 共用 migrations dir | 0004_m0_sessions.sql 会被错误灌进 harness.db；推荐方案 1：放弃分库，sessions 三表加进 harness.db |
| F-P2 | MAJOR | session-store.ts | 单文件 if 分支的 runner 是技术债，M1C-B 加第二张表时一定要重写 |
| F-P3 | MAJOR | orchestrator.ts L75-80 + interfaces/skill.ts | `tools: {get: () => null}` / `memory: {} as never` / `workspaceDir: ''` 是假手对象；建议 SkillContext 三字段标 optional |
| F-P4 | MAJOR | trace-writer.ts | 完全没实现 trace-redaction-spec §3 / §5，与 spec §7 M0 acceptance C-3 直接矛盾 |
| F-P5 | MINOR | cli/vessel-core.ts | SIGTERM 没注册（M0 前台跑无影响；M1A daemon 必补） |
| F-P6 | MINOR | cli/vessel-core.ts L16-23 | import 之间插 statement 的写法是 hoisting trap，靠 lazy DATA_DIR 保命 |
| F-P7 | INFO | skills/echo.ts | 实现干净，无修改建议 |

---

## 用户 review focus 直接回答

| Q | 回答 |
|---|---|
| #1 migration 编号是否冲突 | **是**（见 F-P1）。0004 在 EVA_TO_VESSEL_MAPPING §1.5 已被 M1C-A workflow_state 占位；当下 0004_m0_sessions.sql 也借此 file 名混入 harness.db。 |
| #2 session-store 是否和 harness-store 冲突 | **是**，且严重（见 F-P1）。两个 DB 一个目录一个 glob——共享 migrations 即冲突。强烈建议 M0 直接合到 harness.db（方案 1）。 |
| #3 trace-writer 是否遵守 trace-redaction-spec | **否**（见 F-P4）。只做了 §6（文件权限），完全没做 §3 / §5（脱敏 + 大输出切割）。当前测不出来只因 EchoSkill payload 不含敏感字段；M0 spec §7 acceptance C-3 形式上 pass 但语义上 fail。 |
| #4 orchestrator 边界是否守住 | **大体守住**（见 F-P3）。没有偷塞 systemPromptPrefix / Workflow resume / Soul / Capability lookup / 真 Tool registry。**唯一偏移**是 `tools/memory/workspaceDir` 三个假手对象——属于"接口层 over-engineer 让 M0 实例化时被迫造假"，不是 orchestrator 越权。 |
| #5 vessel-core SIGINT/env 是否稳定 | **稳定但小瑕疵**（F-P5 + F-P6）。M0 acceptance 不阻塞；M1A daemon 化前补 SIGTERM + import 顺序整理。 |

---

## M0 是否过度工程化（YAGNI 总评）

**对 M0 总体**：**接受**。6 个文件总 ~580 行（含注释），骨架尺寸合理，没有偷塞 M0.5+ 字段。**但 580 行里大约 100 行（session-store.ts 整文件 - 复用 harness-store 的部分 + orchestrator.ts L75-80 假手对象）属于"不复用 Eva 直接造成的工程债"**——按方法论原则 #8 应该减下去。

**M0 真正应该有的尺寸**（按方案 1 + F-P3 + F-P4 修完后）：
- migrations/0004_m0_sessions.sql（保留，但 TARGET_VERSION 改成 103，按 EVA_TO_VESSEL_MAPPING 路径）
- session 三个 helper 加进 harness-queries.ts（~50 行）
- trace-writer.ts 加 fast-redact wrapper（~30 行）
- orchestrator.ts 删除 5 行假手对象（净 -5 行）
- echo.ts 不变
- vessel-core.ts 加 1 行 SIGTERM + 重排 import（净 +5 行）
- 总尺寸 ~430 行——**M0 骨架更轻、更诚实、未来 M1+ 工作量更小**。

---

## Top 3 推荐 owner 立即决断

1. **F-P1 修法选哪个？** 强烈推荐方案 1（合到 harness.db，删 session-store.ts）。如果坚持分库，必须立刻把两个 migrations 目录拆开 + session-store 用目录扫描。
2. **F-P4 redaction 是 M0 必修还是 M0.5 推迟？** spec §7 写的是 M0 必修；trace-writer.ts 自陈 M0 不需要。owner 拍板哪份是 truth。
3. **F-P3 SkillContext optional 化？** 5 行改动 + 接口语义更诚实，但触动 0B 已锁的接口契约。如果接口不动，至少加 FIXME 注释保证 M1C 改接口时能 grep 到。

---

End of pragmatist review.
