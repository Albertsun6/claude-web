# L1-minimal lessons closeout — pragmatist verdict

**Date**: 2026-05-10 05:00
**Lens**: YAGNI / 守边界 / Eva 复用 / 个人单机
**Reviewer**: vessel-pragmatist (Phase 1)

---

## 0. 总体口风

**B-级 review 已经把烈度按下去了** — 提案从"独立 module + Memory interface 兼容性论证 + writer 抽象层"裁到 460 LOC 估算。实际产出 ~800 LOC，**1.7x 超估算**，但不属于"复杂功能蔓延"，主要是 redact 测试矩阵 + 一次性 importer 把单元拉胖。骨干 (lesson-store + 0002 migration) 紧贴用户原话"先不做复杂的"。

但 **import-debate-log.ts 把 Eva 时代 137 个 verdict 文件一锅炖进 lessons 表**，这是 noise > signal 的典型。值得叫停一次。

---

## 1. 实际 LOC vs 估算 (≈ 1.7x 超)

| 产物 | 估算 | 实际 | Δ | 评 |
|---|---|---|---|---|
| `0002_m1_lessons.sql` | 70 | 63 | -7 | OK |
| `memory/lesson-store.ts` | 80 | 136 | +56 | 接口胖 (见 §2) |
| `observability/redact-helpers.ts` | 30 | 110 | +80 | PASS-1 relativize + 5 pattern + whitelist 函数；spike B2 case-by-case 拉胖了 |
| `cli/vessel-core.ts` lesson/closeout 增量 | 90 | ~125 | +35 | help text + 3 子命令 + appendFileSync |
| `scripts/import-debate-log.ts` | 80 | 203 | +123 | **scope creep** (§5) |
| `test-lessons.ts` | 80 | 165 | +85 | 21 assert (§4) |
| HTTP `/api/vessel/lessons` | 30 | 0 | -30 | **未实现** — 但 arbiter doc 列了 |
| **Total (新增)** | **~460** | **~800** | **+340 (1.7x)** | |

膨胀主要来自：
- redact-helpers PATTERN 数量从 trace-redactor 复用扩到 6 条 + path PASS-1 normalize；
- importer 一次性脚本写得跟产品代码一样规整；
- test 重复 redact case (5 条 sk/AWS/email/~/$HOME/abs path 各一 assert)。

**HTTP layer 没做反而是好事** — arbiter doc 列了但实际 YAGNI 砍掉，说明实施者有边界感。但是**应在 ROADMAP / arbiter doc 标注"deferred to M1B"**，否则后续看 doc 的人会以为有这个端点。

---

## 2. Interface 面积：addLesson / getLesson / searchLessons / computeImportFingerprint — 部分超前

```ts
addLesson(input)            // ✅ v0.1 必需 (cmdLessonAdd / cmdCloseoutFinalize / importer)
getLesson(id)               // ⚠️ v0.1 仅在 addLesson 内部用一次回读
searchLessons(opts)         // ✅ v0.1 必需 (cmdLessonSearch / importer dedup 复用)
computeImportFingerprint    // ⚠️ 仅 importer + closeout finalize 用；externalize 过早
```

- **`getLesson`**：v0.1 唯一调用点是 `addLesson` 末尾的 `return getLesson(id)!`。`addLesson` 完全可以直接 `return { id, ...input, created_at: <now> }` 自己组装行返回，省掉一次 SELECT round-trip + export。**可裁，但 LOC 收益小 (~5 行)，留着 v1+ 兜底也行**。
- **`computeImportFingerprint`**：只被 importer + closeout finalize 用。export 让它出现在公共 API 表面。**可挪到 `lesson-store.ts` 文件内 private** 然后两处需要时各自 inline 一行 sha256，不影响功能。当前 export 是为"未来谁还要复用 fingerprint"准备 — 典型 YAGNI。
- **`LessonSearchOpts.tag` 用 `LIKE '%' || @tag || '%'`** — 把 tags 当 substring 匹配是 v0.1 的快糙猛实现，importer 用 fingerprint 当 tag 来做 dedup 检查 (`searchLessons({ tag: fp })`) 是**两次磁盘扫**，应该直接走 `import_fingerprint` 列 + UNIQUE INDEX。importer 第 106 行的 dedup 逻辑用错了 channel — UNIQUE INDEX 已经在 INSERT 时硬挡，importer 那次预查多此一举 (§5)。

**判断**：interface 不算严重过宽，但 `getLesson` export + `computeImportFingerprint` export + `tag LIKE` 全是 v1+ 痕迹，可以 minor 整改。**不阻塞 closeout**。

---

## 3. CLI `lesson list` vs `lesson search` — 真 alias，价值 borderline

```ts
if (argv[0] === 'lesson' && (argv[1] === 'search' || argv[1] === 'list')) return cmdLessonSearch(args);
```

- `lesson list`（无 q）= `lesson search`（无 q）= 按 created_at desc 出最近 20 条；
- `lesson search foo` = FTS5 MATCH + ranked。

**两者实现完全 share 同一函数，分歧只是是否带 positional q**。Help text 没列 `lesson list`，但代码接受。

- ✅ **保留好**：让用户 `lesson list` 时不必用怪异空查询；UX-friendly。
- ⚠️ **没文档**：HELP 字符串里看不到 `lesson list`。要么删 alias，要么补 HELP 行。**推荐补 HELP**（成本 1 行）。

**verdict**：保留，加 HELP 说明 — minor。

---

## 4. 21 assertions：5 条可裁，非过度

按"机器证明个面向用户的不变量"标准过一遍：

| # | Assert | 必要 |
|---|---|---|
| 1-2 | lessons / lessons_fts table 存在 | ✅ schema 烟测 |
| 3 | user_version === 2 | ✅ migration 跑了 |
| 4 | sk-ant-* redacted | ✅ B2 BLOCKER 直接挂钩 |
| 5 | AWS key redacted | ✅ B2 |
| 6 | email redacted | ✅ B2 |
| 7 | `~/.ssh` redacted | ✅ B2 (cursor 抓出的核心 case) |
| 8 | `$HOME/...` redacted | ⚠️ 与 #7 同分支 — 可合并到一条 "home shorthand" |
| 9 | non-whitelisted abs path redacted | ✅ B2 |
| 10 | whitelisted Vessel path 保留 | ✅ 防 over-redact |
| 11 | inserted.id 是 uuid | ⚠️ 弱 assert (length === 36) — 可裁 |
| 12 | inserted body sk-ant redacted | ⚠️ 与 #4 重叠（test addLesson 路径而已） |
| 13 | inserted body ~/.ssh redacted | ⚠️ 与 #7 重叠 |
| 14-15 | FTS5 search "redaction" 命中 | ✅ |
| 16 | milestone filter | ✅ |
| 17 | kind filter | ✅ |
| 18 | UPDATE trigger 重新索引 | ✅ Eva pattern 验证 |
| 19 | DELETE trigger 清掉 ghost | ✅ |
| 20 | UNIQUE INDEX 拒重复 fingerprint | ✅ idempotent 关键 |
| 21 | re-open 后 table 仍在 | ✅ migration idempotent |

**可裁 5 条 (#8 #11 #12 #13 + 一条合并)**，但每条都很短，删掉 LOC 收益 ~10 行。**建议保留** — 现状对 redactor 测试丰度反而是个好信号，比 "1 个测试覆盖 5 个 case 的 OR 表达式" 易诊断。**不视为过度**。

---

## 5. 137 verdict 文件 import：noise > signal — **建议挂起一次**

这是本次 review 我**最有意见**的点。

### 现状
- importer 扫 `docs/reviews/*.md` 全部 .md 文件（除 README/INDEX）= **137 候选**；
- Vessel-era 文件（M0/M0.5/M1A-α/β/L1/0A/0B/v5.4）共 **58 个**，其中很多是 architect/cross/risk-officer/verify-gate 子产物，**只有 arbiter + verify-gate 才是收敛态**；
- Eva-era 文件 **79 个**：`eva-as-personal-jarvis-*` (8)、`eva-multi-project-usage-*` (8)、`harness-meta-freeze-*`、`m0-modellist-*` lowercase = Eva harness、`tts-summary-*`、`parallel-work-*`、`promote-fix-*`、`scheduler-*`、`track1/2-*`、`contract-1-2/2/3-4-*`、`h12-19/h2/h3-*` 等。

### 问题
1. **粒度错配**：每篇 architect / cross / pragmatist / risk-officer **都被独立 INSERT 成一条 lesson**，但这些是同一个 review event 的多视角。一次 review 5 个 reviewer 文件 → 5 条 lesson 但语义只有 1 条收敛。**FTS 检索时这 5 条会一起命中，把真正的 arbiter 收敛淹掉**。
2. **kind 单一**：全部以 `kind: 'review_closeout'` 入库，但 architect 的初始判断 ≠ arbiter 的最终裁决。语义混淆。
3. **Eva-era 教训混入 Vessel kernel 教训**：用户语义把 Vessel 当个人单机助理重做，Eva harness 时期的 review 教训（multi-tenant / scheduler / orchestrator React）和 Vessel kernel L0/L1 教训混在一起搜。Search "redaction" 时会同时返回 Eva 和 Vessel 时期对 redaction 的不同结论（Vessel 后来才把 redact 抽到 generation layer），**新结论被旧结论稀释**。
4. **firstParagraph 800 字截断**：很多 review 文件第一段是 metadata header（`**Date**: ... **Reviewer**: ...`），根本不是核心结论。importer 取的"insight"是噪音 metadata。
5. **fingerprint 算 filename + kind + first200 chars**：filename 已含 date，重跑同一个文件不会 dup，但**改了文件标题或 first paragraph 就会重复入库** — 反而是反 idempotent。

### 建议（择一，**不阻塞 closeout 但建议 v0.1 范围内修**）

- **方案 A（推荐）**：importer 默认只扫 `*-arbiter-*.md` + `*-verify-gate-*.md`（约 **20-30 文件**），`--include-all` flag 才扫全部。一次 review event = 1 条 arbiter lesson。Eva-era 用 milestone filter 隔离（`searchLessons({ milestone: 'M0' })` 默认排除 lowercase m0 或加 `era: 'eva' | 'vessel'` 字段）。
- **方案 B（最小修）**：importer 加 `--milestone-prefix=M,L` 默认只导 Vessel-era 大写前缀，让 137 → 58 → 再过滤 arbiter ≈ 12-15 条 high-signal lesson。
- **方案 C（极简）**：先不批量导。让 `vessel-core closeout finalize` 在新 closeout 跑时自己写一条；既往 review 只在被 search 命中时手工 promote。**lessons 表从空开始建立信号，不污染**。

我倾向 **C** — 跟"先不做复杂的"严格对齐：v0.1 不需要历史 lesson backfill，反正 search "redaction" 现在主要会命中刚 finalize 的 L1-minimal closeout 自己，足够 dogfood 起步。Importer 留着但不在 closeout-gate 里跑。

---

## 6. 边界守得怎么样？

### ✅ 守住了
- 没碰 harness.db（migration 严格走 `migrations-memory/`，user_version 独立）
- 没引入 Memory interface 兼容论证（arbiter 部分接受 + ROADMAP defer M1C-B 评估，正确）
- 没建 HTTP layer（虽然 arbiter doc 列了 30 LOC，实际未实现 — YAGNI 胜利）
- 没引外部依赖（FTS5 + better-sqlite3 复用现成）

### ⚠️ 有点漂
- importer 把 137 文件批量灌库 (§5)
- redact-helpers 110 LOC 是 trace-redactor 复用 + 5 PATTERN 自定义；本来 arbiter 估 30 LOC = 只加 home shorthand，实际把 sk/AWS/email/abs path 从 trace-redactor 重新复制了一次（trace-redactor 那边的 PATTERN_RULES 没有 export 复用 → 复制粘贴而非真复用）。**未来两边漂移风险**。建议 trace-redactor 把 `PATTERN_RULES` 数组 export 出来 redact-helpers 直接 import + concat home shorthand，省 60-80 LOC + 永远同步。
- `getLesson` / `computeImportFingerprint` 提前 export

### ❌ 没违反
无。

---

## 7. 严重度

| Finding | Severity | Action |
|---|---|---|
| F1: importer 默认导 137 文件，Eva-era 79 + 多视角粒度错配，noise > signal | **MAJOR** | §5 方案 C：v0.1 不跑 importer，留脚本备 future opt-in；或方案 A：默认只扫 arbiter+verify-gate |
| F2: redact-helpers 与 trace-redactor PATTERN_RULES 复制而非复用，60-80 LOC duplicate | **MAJOR** | 把 trace-redactor 的 PATTERN_RULES export，redact-helpers 复用 + 加 home shorthand |
| F3: 实际 800 LOC vs 估算 460 (1.7x)，未在 retro 标注超估 | MINOR | retro 加 LOC delta 行；下次估算考虑 PATTERN 测试矩阵 + importer 现实成本 |
| F4: HTTP `/api/vessel/lessons` arbiter doc 列了但未实现 | MINOR | arbiter doc / ROADMAP 加 "deferred to M1B" 标注，避免后人以为有 |
| F5: `getLesson` + `computeImportFingerprint` export 过早；importer 用 `tag` 而非 `import_fingerprint` 列做 dedup | MINOR | private 化或保留；importer dedup 改走 INSERT + try/catch UNIQUE 异常 |
| F6: `lesson list` 是 `lesson search` 的 alias 但 HELP 没列 | MINOR | HELP 加一行 |
| F7: 21 assert 中 #8 #11 #12 #13 可合并；保留也 OK | TRIVIAL | 不动 |

---

## 8. 决策

⚠️ **PARTIAL PASS** — 骨干（schema / lesson-store / closeout finalize / redact 测试覆盖）紧扣"先不做复杂的"，可以入 closeout。但 **F1 importer noise > signal 建议在 closeout 内挂起 importer 自动跑**（即 closeout-gate 不强制跑 import-debate-log.ts；让 importer 留作可选脚本，或裁到只扫 arbiter+verify-gate）。F2 trace-redactor PATTERN duplicate 建议同 closeout 内修，否则下次 redact 规则演化两边漂移。

不接受用 "v0.1 先这样"放过 F1：因为 lessons 表一旦灌入 137 条 Eva-era 噪音，后续 search 体验从一开始就降级，会形成 "lessons 没用"的 dogfood 印象，反向危及 L1 机制本身。

---

## 9. 总结 (≤ 200 字)

骨干合格：lesson-store / 0002 schema / closeout finalize / redact 21 assert 紧贴"先不做复杂的"，没碰 harness.db、没建 Memory interface、没做 HTTP layer。但实际 800 LOC vs 估 460（1.7x），主要膨胀在 redact-helpers 与 trace-redactor PATTERN 复制、importer 写得过规整。**最大问题是 importer 默认扫 137 个 verdict 文件全灌进 lessons：Eva-era 79 个混 Vessel-era 58 个，且每次 review 的 architect/cross/risk/arbiter 全独立 INSERT 成同 review_closeout kind，FTS search 时 noise 淹收敛**。建议 v0.1 不跑批量 importer（方案 C），让 lessons 从 closeout finalize 自然增长；或至少默认只扫 arbiter+verify-gate（方案 A，~20 条）。次要：trace-redactor PATTERN 应 export 复用避漂移；`getLesson` / `computeImportFingerprint` export 过早。可入 closeout，但 importer 落地策略要锁。
