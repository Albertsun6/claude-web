# Phase 2 React — Architecture lens
> Reviewer: harness-architecture-review · Date: 2026-05-13 17:55 · Phase 2 (cross-pollinate)
> Model: claude-opus-4-7 (1M ctx)
> Round 1 verdict: `aisep-v2-fan-in-arch-2026-05-13-1750.md` (mine)
> Sibling Round 1: `aisep-v2-fan-in-cross-2026-05-13-1750.md` (vessel-cross-reviewer / cursor-agent gpt-5.5-medium)

---

## React to Reviewer B's findings

### B.B1 — ADR citation confabulated, 0.4.0 bump rationale not grounded

**Quote**: "The proposal repeatedly cites 'ADR-0010 schema migration rules' and a '`MAJOR.MINOR` rule', but the actual `ADR-0010` is about SQLite + FTS5 persistence, not AISEP protocol/schema versioning."

**My verdict**: **refine**

**Reasoning**: B is **dead right that the citation is wrong**, and his diagnosis of which ADR exists (`docs/adr/ADR-0010-sqlite-fts5.md`) is more accurate than mine. My Phase 1 BLOCKER-1 jumped to `docs/adr/vessel/ADR-006-schema-evolution.md` as "the real schema-migration ADR" without scanning the top-level `docs/adr/` directory. There are actually **two candidates**:
- `docs/adr/ADR-0015-schema-migration.md` (top-level, explicitly has major/minor/patch table — the **closest fit** to the proposal's "MAJOR.MINOR bump" language)
- `docs/adr/vessel/ADR-006-schema-evolution.md` (vessel namespace, has "5 条原则" including "breaking change 仅跨 major")

The author's "ADR-0010" almost certainly meant **ADR-0015** (similar number-shape, schema-migration topic), not the ADR-006 I suggested in Phase 1. B's "if it exists or add ADR-lite" is the safer recommendation — he's neutral on which ADR to point at, just demands the citation be real. Severity-wise BLOCKER is correct from both sides (contract mode, schema decision is central).

**Concrete edit** (if refine): Promote my Phase 1 BLOCKER-1 §Suggested fix from "全文 ADR-0010 → ADR-006" to "全文 ADR-0010 → **ADR-0015** (the top-level schema-migration ADR with explicit major/minor/patch table that matches the proposal's `MAJOR.MINOR` language); cross-reference ADR-006 (vessel namespace, '5 条原则') only as a supporting constraint, not the primary citation". Also, the "0.x supersede" caveat I drafted is still useful but should attach to ADR-0015's "major bump = delete field / change semantics" row, not ADR-006's "breaking change 仅跨 major".

---

### B.B2 — Required `affects` contradicts the stated v0.3 workspace compatibility

**Quote**: "Existing v0.3 fan-out child rows cannot have `affects`, because `StageRunCommonShape` currently has only `fanOutRole`, `subStages`, and `parentStageRunId`. ... old v0.3 fan-out state becomes invalid even when the user does not invoke fan-in."

**My verdict**: **agree**

**Reasoning**: This is a precise schema/compat finding I **missed**. My Phase 1 BLOCKER-2 ("superRefine implement-only must be torn out") covered the *new* schema surface but didn't notice the **backwards-compat hole on existing v0.3 child rows**. The proposal §7-anchor "Compatibility" claims "existing v0.3 workspaces continue to load; fan-in path is opt-in", but B is correct: an existing v0.3 workspace with a fan-out parent + 3 children would have child rows missing `affects`, so the v0.4 zod schema (which makes `affects` required on `fanOutRole === 'child'`) would refuse to load them on first read — even before any fan-in is invoked.

This is a genuine BLOCKER and concrete, with file:line evidence (`packages/aisep-protocol/src/stage.ts:75`). It also tightens the case for my MAJOR-4 (cross-version round-trip dogfood gate) — without that gate, B2 wouldn't be caught until a user hit it in dogfood.

**Concrete edit**: None — B's suggested fix ("gate `affects` by protocol/state version and only require it for newly-created v0.4 fan-out children, OR mandate migration step before any v0.3 fan-out state can load") is exactly right. I'll fold B2 into my Phase 1 BLOCKER-2 as a paired finding when I update.

---

### B.B3 — Id-stable retry cannot work with the current terminal state machine

**Quote**: "The current state machine makes `failed`, `succeeded`, `cancelled`, and `skipped` terminal, and `store.updateStageRunStatus()` enforces that transition."

**My verdict**: **agree**

**Reasoning**: This is **stronger** than my MAJOR-1 (which said "Q5 α论据反了, F3 retry semantics ≠ Q5 α semantics") because B grounds the issue in **an enforced invariant of the current state machine**: `state-machine.ts:9` + `store.ts:153`. My MAJOR-1 was about论据 inconsistency between Q5 and F3; B's B3 is about an **impossibility under the current invariants** — flipping `failed → running` would require explicit state-machine amendment, not just retry-semantic clarification.

This is correctly a BLOCKER. The fix path forks (new-row vs invariant-amendment) and the proposal currently doesn't commit to either with the rigor it needs. B's "pick one contract" framing is exactly right.

**Concrete edit**: None — B's fix matrix (option A: new row with `predecessorId`/`retryOfStageRunId`; option B: extend state model with attempt-level lifecycle; option C: keep id-stable but explicitly amend state-machine invariant) is complete. I'll **upgrade my MAJOR-1 to align with B3** (essentially absorb mine into his).

---

### B.M1 — `fan_in` role named but not specified in actual enum model

**Quote**: "Scope says '`fan_in` stage_run role', but the actual role enum is `normal | parent | child`."

**My verdict**: **agree**

**Reasoning**: I **missed this entirely**. The proposal §Scope #1 says "`fan_in` stage_run role + downstream wiring" — phrasing that implies a new enum value. But `stage.ts:72` enum is `normal | parent | child`. The proposal body then talks through `fanOutRole`, `subStages`, downstream parent — never resolving whether `fan_in` is (a) a new role enum value, (b) a new field (`fanInRole`?), or (c) just derived behavior from `parent` + `subStages` filled on a successor stage.

This is a real contract gap. My Phase 1 BLOCKER-2 talked about the *superRefine white-list* but didn't notice the **role enum naming itself is ambiguous**. B caught this; I didn't. MAJOR severity feels right (it's a clarity gap not a correctness one — the implementer could pick a sane interpretation, but the contract should pin it down).

**Concrete edit**: None — B's fix ("Add explicit v0.4 schema sketch: keep `fanOutRole` unchanged and add `fanInSourceParentId` / `fanInGroupId`, OR rename to neutral `parallelRole`, OR define `fanInRole`. Show exact Zod shape and invariants.") is the right ask. I'll add this as a new finding in my Self-correction section.

---

### B.M2 — Conflict detection source of truth inconsistent; manifest can't support it

**Quote**: "Scope says conflict detection matches `affects` regex against post-implement on-disk state; Q4 says runner extracts modified-file lists from each child's manifest header. The actual `AisepPatchSetManifestSchema` only stores `subStageId`, `subStageName`, `patchFile`, `contentHash`, and `byteCount`; it has no modified-file list."

**My verdict**: **agree**

**Reasoning**: I called out the related issue in my **minor-1** ("§Context patch_set artifact schema改动 omitted") but **understated severity**. B correctly raises this to MAJOR because the contradiction isn't about omission — it's that **the proposal cites two different sources of truth** for conflict detection (declared `affects` vs actual modified-file list) and **neither source matches what the current manifest schema can express**. My minor-1 suggested "patch_set manifest 结构在 v2 不变" — that's actually **incorrect** if Q4's "modified-file list" path is real; the manifest would need to grow `modifiedFiles: string[]`.

This is a self-correction trigger: my minor-1 was too lenient. B's MAJOR severity is right.

**Concrete edit**: None — B's fix ("Decide source of truth: declared overlap vs actual file conflict; if actual, add `modifiedFiles: string[]` to patch_set manifest") is the correct ask. I will **upgrade my minor-1 to MAJOR** to align with B.M2 and revise my recommendation (patch_set manifest **may need to change** depending on which source-of-truth the author picks).

---

### B.M3 — Report contract under-specifies multiple verify children

**Quote**: "Current report builder finds only the first `stage === 'verify'` run and reads only `artifactContents['verify.md']`. That model cannot represent `verify-backend.md`, `verify-frontend.md`, `verify-tests.md` without schema changes."

**My verdict**: **agree**

**Reasoning**: I **did not look at `report/builder.ts`** in Phase 1 (acknowledged in §What I Did Not Look At). B did, and found the report layer has hardcoded single-verify assumption. This is a concrete contract gap with file:line evidence. The proposal's §Scope #5 talks about "report.html per-child stage breakdown" but glosses over that **the current report data model is single-stage-per-name**, so the contract needs to extend (per B's suggestion: collect contract_grep checks from every verify stage_run, key by `stageRunId` + child name).

MAJOR severity right. Schema-touching but not a state-machine blocker.

**Concrete edit**: None — B's fix is concrete and correct. This is **new finding territory** for me — I'll list it in §New findings.

---

### B.M4 — Migration CLI names promised before command surface exists

**Quote**: "The proposal uses `--accept-schema-bump` and `aisep migrate --to 0.4` in user migration steps, but the CLI currently has no `migrate` command and no schema-bump flag... migration utility is simultaneously 'deferred' and required in the path for existing v0.3 workspace + fan-in."

**My verdict**: **agree**

**Reasoning**: My Phase 1 §"里程碑可执行性" called out this exact contradiction ("(c) §Migration path 第 4 条 + §Open issues 第 2 条措辞矛盾, 前者写 'deferred to first user request', 后者列为 open issue"). B promoted it to MAJOR with concrete file:line (`packages/aisep-cli/src/commands/run.ts:226`, `packages/aisep-cli/src/cli.ts:77`) confirming the CLI surface doesn't yet have `migrate`. B's framing — **reclassify scope, or commit to fresh-only workspaces in v2** — is sharper than my Phase 1 "诉求矛盾" diagnosis.

I should have **upgraded** my Phase 1 §"里程碑可执行性" gap to a MAJOR finding. B caught the severity right.

**Concrete edit**: None — B's "reclassify migration utility scope" is the correct ask. I'll fold this into a new MAJOR in my Self-correction.

---

### B.m1 — Baseline test count internally inconsistent (333 vs 366)

**Quote**: "The proposal cites '333 monorepo tests' as current stability evidence, then later sets the dogfood gate at 'current baseline (366 tests)'."

**My verdict**: **agree**

**Reasoning**: I **did not catch this**. Both numbers appear in the proposal (line 42: "333 monorepo tests"; line 184: "current baseline (366 tests)"). MINOR severity is right — it's a copy-edit/freshness issue, not a contract issue. B's fix ("Use one verified baseline, or phrase it as '>= baseline at implementation start'") is the right ask.

**Concrete edit**: None.

---

### B.m2 — Emergency bypass listed as open but should be decided pre-implementation

**Quote**: "The conflict detector is terminal-fail-by-design, but the bypass path is deferred as an open issue... false positives can block the whole fan-in chain."

**My verdict**: **agree**

**Reasoning**: My Phase 1 Open Questions §Q4 noted "mitigation 要补'如果 affects 写错怎么 escape'(见 §Open issues 第 5 条)" — same observation, framed as Open Q strong opinion rather than a finding. B promoting it to MINOR finding with the framing "operability concern (not security)" is correct for a 1-user-1-binary tool.

B's recommendation ("prefer plan.md edit over `--force` for v2, unless proposal defines a logged `--force-conflict` with report.html evidence") is the right pragmatic call. I agree.

**Concrete edit**: None.

---

## Self-correction of my own Phase 1 verdict

### My BLOCKER-1 (ADR-0010 mis-cited, suggested ADR-006 replacement): **refine self**
B got the citation diagnosis more accurate. My recommendation "ADR-0010 → ADR-006" pointed at the wrong replacement ADR. The right replacement is **ADR-0015** (top-level, has major/minor/patch table matching the proposal's "MAJOR.MINOR" language). ADR-006 is supporting, not primary. The BLOCKER severity stands; the suggested fix narrows.

### My BLOCKER-2 (superRefine implement-only must be torn out): **stand + pair with B.B2**
B's B2 is a sibling finding that I missed: the *new required `affects` field* breaks v0.3 child row backwards-compat even before fan-in is invoked. My BLOCKER-2 (the *whitelist of fan-out-allowed stages*) and B's B2 are **both real, complementary** schema BLOCKERs. The proposal needs to address both. My BLOCKER-2 stands; B's B2 adds to the same arbitration bucket.

### My MAJOR-1 (Q5 retry-child "consistent with F3" 论据反了): **upgrade**
B's B3 is **stronger** than my MAJOR-1. I framed it as "论据 inconsistency between Q5 α and F3 actual implementation". B grounded it as "id-stable retry is **impossible** under `state-machine.ts:9` terminal invariant + `store.ts:153` enforcement". B's framing makes it a BLOCKER (impossibility), not a MAJOR (论据 sloppiness). **I upgrade my MAJOR-1 to BLOCKER and absorb into B.B3.**

### My MAJOR-2 (`predecessorIds[]` v0 注释 + v1 plan 路径需显式 revoke): **stand**
B did not raise this. It's a downstream-Claude-correctness finding — schema notes in `stage.ts:120-121` explicitly promise `predecessorIds[]` will be added in v2+, and v2 proposes a different mechanism (`subStages` mirroring on both sides). This is a genuine architecture-lens finding B didn't cover (his 5th lens "collective blindspot detection" came in on different issues). MAJOR severity holds.

### My MAJOR-3 (R1 retry-races-with-parent-settling mitigation 太单薄): **stand**
B did not specifically cover the **retry × cancel × cross-process** state space. His B3 covers the terminal-state invariant axis; mine covers the **operational** race during cancel/settle window + cross-worktree second-process. Both real, both MAJOR. Mine stands.

### My MAJOR-4 (cross-version round-trip 缺硬门禁): **stand + reinforced**
B.B2 is the **smoking gun** for why my MAJOR-4 is necessary. Without a cross-version round-trip dogfood gate, the v0.3 child-row breakage B identified wouldn't be caught until a real user hit it. MAJOR severity holds; B.B2 strengthens the case.

### My minor-1 (patch_set artifact schema改动 在 v2 不变): **upgrade to MAJOR (via B.M2)**
I called it minor and **wrote that `patch_set` manifest doesn't change**. B's M2 directly contradicts: if conflict detection uses "actual modified-file list" (the Q4 path), the manifest **must** grow `modifiedFiles: string[]`. My minor-1 was wrong-direction; B's MAJOR is right. **Upgrade.**

### My minor-2 (Q1 "any new required field is a MAJOR.MINOR bump" 空气引文): **stand**
B's B1 covers the broader citation issue. My minor-2 is a sub-finding (specific to that quote) that should be folded into the BLOCKER-1 fix work but doesn't need a separate severity.

### My minor-3 (Open Issue 第4条 850 cells 算式虚高): **stand**
B did not check the algebra. Mine stands as a non-blocking cosmetic correction.

---

## New findings revealed by reading B

### NEW-1 [MAJOR] — `fan_in` role name vs `fanOutRole` enum mismatch (from B.M1)

**Where**: aisep-v2-fan-in.md:50 ("`fan_in` stage_run role + downstream wiring") vs `packages/aisep-protocol/src/stage.ts:72` (enum: `normal | parent | child`).

**Lens**: 架构可行性

**Issue**: The proposal's §Scope #1 invokes a "`fan_in` stage_run role" that has no matching enum value in the current schema. Subsequent body text talks through `fanOutRole`, `subStages`, "downstream parent" — never resolving whether `fan_in` is a new enum value, a new field, or derived behavior. This is the kind of naming-ambiguity that LEARNINGS.md §1 (schema lock) explicitly warns against in M0/M-1 era ("schema is the 阶梯层"). v0.2 must commit to one of: (a) add `fanInRole` enum field, (b) extend existing `fanOutRole` with a new value, or (c) declare it derived from `fanOutRole === 'parent' && subStages.length > 0` on a downstream stage. Pick one; write the Zod diff.

**Why MAJOR (not BLOCKER)**: an implementer could read the body of the proposal and infer (c) is the intended interpretation, but the contract should pin it. Not a correctness gate, but a v0.2 must-fix.

**Suggested fix**: Same as B.M1 — add an explicit v0.4 Zod schema sketch in §Scope #1 showing the exact field shape + invariants.

### NEW-2 [MAJOR] — Report data model can't represent N verify-children (from B.M3)

**Where**: aisep-v2-fan-in.md:58 (Scope #5: "report.html per-child stage breakdown ... per-child contract_grep tables") vs `packages/aisep-cli/src/report/builder.ts:135` (single-stage-per-name lookup) + `packages/aisep-cli/src/report/types.ts:52` (`AisepReportFanOutGroup`).

**Lens**: 架构可行性 / 里程碑可执行性

**Issue**: I missed this in Phase 1 because I didn't read the report builder. B did. Current report data model finds **only the first** `stage === 'verify'` run and reads only `artifactContents['verify.md']` — there's no shape for `verify-backend.md`, `verify-frontend.md`, `verify-tests.md` to coexist under one report. The proposal's §Scope #5 + §Dogfood gate "report.html renders the per-child sub-timeline" implicitly requires extending `AisepReportFanOutGroup` (or adding a fan-in group type), which is a report-layer schema change not currently scoped.

**Why MAJOR (not BLOCKER)**: report.html is build-output, not state — adding fields is additive, no migration. But the scope of the change is non-trivial and must be in the contract before implement starts.

**Suggested fix**: Per B.M3 — extend `AisepReportFanOutGroup` or add a fan-in group type; key contract_grep checks by `stageRunId` + child name.

---

## Convergence assessment

**Of B's 9 findings**:
- **Clear consensus** (verdict = agree, severity-matched, fix-matched): B2, B3, M1, M2, M3, M4, m1, m2 → **8 of 9**.
- **Refine** (correct in spirit, fix narrows): B1 (citation diagnosis ✓, my replacement ADR was wrong — B's "find real ADR or write new" is safer than my "use ADR-006") → **1 of 9**.
- **Disagree-with-evidence / not-reviewed**: **0 of 9**.

**Convergence count**: 8 + 1 (refined) = **9 convergent**, 0 divergent.

**Honesty check** (per SKILL.md §"phase 2 react verdict 硬约束"): I have exactly 1 `refine` (B1). That satisfies the "≥ 1 disagree or refine" hard constraint — but the refine is **substantive** (B caught my Phase 1 ADR citation was off-target, pointing to ADR-006 when ADR-0015 was the closer match), not a fig-leaf to dodge rubber-stamp flagging. The deep convergence on 8/9 reflects that **B and I are reading the same artifact through partly overlapping lenses** and the proposal has **real, clear, named gaps** rather than us hallucinating different problems.

**Self-corrections summary**:
- 1 BLOCKER refined (BLOCKER-1, ADR replacement narrows from ADR-006 to ADR-0015)
- 1 MAJOR upgraded to BLOCKER (MAJOR-1 → absorbed into B.B3 territory)
- 1 minor upgraded to MAJOR (minor-1 → upgraded via B.M2)
- 2 new MAJORs added (NEW-1 from B.M1, NEW-2 from B.M3)
- 4 findings stand unchanged (BLOCKER-2, MAJOR-2, MAJOR-3, MAJOR-4, minor-3)

**Phase 3 arbitration scope**: Author should treat all 8 consensus-finding fixes as **non-negotiable** (both reviewers landed independently). The 1 refined finding (ADR citation) needs author to pick a target — ADR-0015 is my updated recommendation, but author may have a different ADR in mind or wish to write a new ADR-lite section. My MAJOR-2 (`predecessorIds[]` revocation) and MAJOR-3 (cross-process retry race + R7) are **arch-lens-only**; author should accept as v0.2 additions without requiring further debate.

---

## What I Did Not Look At (delta from Phase 1)

Same as Phase 1 §What I Did Not Look At — Phase 2 added no new reads beyond B's verdict + my Phase 1 verdict + the artifact + LEARNINGS.md + SKILL.md.

Specifically did NOT examine (despite B referencing them) — relied on B's grep accuracy:
- `packages/aisep-core/src/state-machine.ts:9` (terminal status enforcement — B's B3 evidence)
- `packages/aisep-core/src/store.ts:153` (`updateStageRunStatus` enforcement)
- `packages/aisep-cli/src/report/builder.ts:135` (single-verify lookup — B's M3 evidence)
- `packages/aisep-cli/src/report/types.ts:52` (`AisepReportFanOutGroup`)
- `packages/aisep-protocol/src/artifact.ts:139` (`AisepPatchSetManifestSchema` shape — B's M2 evidence)

If author wants independent verification of B's grep-based findings, a third pass (Phase 3 arbiter) should confirm before accepting B2/B3/M2/M3 as ship-blocking.
