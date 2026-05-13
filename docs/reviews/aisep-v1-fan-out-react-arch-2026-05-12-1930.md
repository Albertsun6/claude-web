# Phase 2 React — architecture-fit lens reacting to cross-correctness verdict
> Reviewer: harness-architecture-review (Claude Opus 4.7)
> Date: 2026-05-12
> Phase 2 (cross-pollinate)
> Target: `docs/proposals/aisep-v1-fan-out.md`
> Reacting to: `docs/reviews/aisep-v1-fan-out-cross-2026-05-12-1930.md`

## Note on B's independence disclaimer

B's report opens with a self-disclosure that independence is "tainted" because B accidentally read fragments of my Phase 1 during a repo-wide `rg`. I am reacting to the substantive content anyway — the findings are concrete + fact-checkable + most agree with mine in places I'd written independently. I flag the contamination so the arbitration phase can decide whether to discount agreement-with-A signals. **For Phase 2 purposes I treat B's findings as advisory but substantively valid where the underlying source code supports them.**

## React to Reviewer B's findings

### B.F1 (verify fan-in semantics conflict) — **agree (with a refinement)**

**B's original** (quoted): "proposal 一边说 v1 不做 fan-in + partial recovery，一边要求 verify 消费所有 parallel patch。当前 runner 只有一个 `predecessorId`，没有 `predecessors[]`，也没有 parent stage 汇总 artifact。"

**My reaction**: B is correct, and this is **a stronger finding than anything in my Phase 1**. I missed it. My A.F1 noticed the schema `subStages` collision but did NOT notice the symmetric problem on the **predecessor** side. v1 needs at least *some* form of fan-in to make "verify consumes all 3 patches" work — even if "partial recovery" is deferred to v2.

**Fact-check** (runner.ts predecessorId + AisepStageRunSchema):

Verbatim from `packages/aisep-core/src/runner.ts:82-89`:
```ts
async runStage(args: {
    stage: AisepStage;
    phase?: AisepStagePhase;
    predecessorId?: string;
    /** Slice fields, required when phase = architecture-detail-slice. */
    sliceIndex?: number;
    sliceTotal?: number;
  }): Promise<AisepStageRun>
```

And `runner.ts:115-118`:
```ts
// 3. Gather upstream artifacts.
const upstreamArtifacts: AisepArtifact[] = run.predecessorId
  ? store.listArtifactsByStageRun(run.predecessorId)
  : [];
```

And `StageRunCommonShape` at `packages/aisep-protocol/src/stage.ts:53-65`:
```ts
const StageRunCommonShape = {
  ...
  /** v0: single predecessor; v2+: lift to array (separate field). */
  predecessorId: OpaqueIdSchema.optional(),
  ...
};
```

The schema comment **explicitly defers `predecessors[]` to v2+**, and the runner reads from exactly one `predecessorId`. B is factually correct: there is no implementation path for "verify consumes N patches" in v1 without ALSO shipping fan-in. The proposal §Scope item 4 ("verify consumes all of them") is inconsistent with §"Explicit non-scope" item that defers fan-in to v2.

**Reason**: This is a genuine **scope-internal contradiction**, not a documentation gap. v1's user-visible value (3 parallel patches → one verify) requires reading N predecessor artifacts in a single verify stage_run. The proposal needs to commit to one of three exits:

**New suggestion** (refinement of B's): I prefer B's first option ("parent implement stage 在所有 children 成功后产出一个 `patch_set` manifest, verify 只依赖 parent") because it preserves the v0-style single-predecessor invariant. Concretely:

1. When parent implement stage completes successfully (all children succeeded), runner synthesizes a **parent-level `patch_set.manifest.json` artifact** attached to the parent stageRunId (NOT a child stageRunId).
2. verify stage's `predecessorId` points at the **parent** implement stage_run.
3. `listArtifactsByStageRun(parent)` returns one artifact (the manifest), which references child patches by id.
4. verify reads the manifest, then traverses to child artifacts via `listArtifactsByStageRun(child_id)`. This is one new store helper, NOT a schema lift to `predecessors[]`.

This keeps `predecessors[]` truly v2-scoped while making v1's verify-consumes-all-patches story implementable. Update §Scope item 4 to spell out this manifest-indirection.

### B.F2 (schema collision) — **agree**

**B's original**: "当前 StageRun 用 `phase` 区分 `none` / `architecture-brief` / `architecture-detail-slice`，且 `.strict()`。proposal 写 `subStages?: OpaqueId[]` + `parentStageRunId?: OpaqueId`，但没说明这些字段加到哪里、如何禁止 nested fan-out、如何避免 architecture slice 也意外带 subStages。"

**My reaction**: This is the same finding as my A.F1, arrived at independently with overlapping diagnosis. B adds a **sharper concrete suggestion** I did not have: introduce `fanOutRole: "normal" | "parent" | "child"` as an explicit discriminant, with `superRefine` for nested-fan-out fail-closed.

I prefer B's `fanOutRole` framing over my A.F1's "lift fields into StageRunCommonShape OR widen the union" binary. `fanOutRole` is type-level expressible (each role has different field requirements), composes cleanly with the existing `phase` discriminator (orthogonal axes), and the v1-only-on-implement constraint can be enforced via zod `superRefine` rather than at runtime.

**Reason**: I agree with B's finding and B's suggestion. Updating my A.F1 to adopt `fanOutRole` as the recommendation — see Self-revision section below.

**New suggestion**: combine my A.F1's "Schema diff (zod) section in proposal" requirement with B's `fanOutRole` discriminant. Specifically:
- `fanOutRole: "normal" | "parent" | "child"` as a new field (`"normal"` default for back-compat).
- `parent` requires `subStages.length >= 1`, forbids `parentStageRunId`.
- `child` requires `parentStageRunId`, forbids `subStages`.
- v1: `superRefine` forbids `fanOutRole !== "normal"` when `stage !== "implement"`.
- Nested fan-out forbidden via `superRefine`: if a stage_run has `parentStageRunId !== null`, its `subStages` must be empty/absent.

### B.F3 (version mismatch) — **agree (this is a real fact-finding that I missed entirely)**

**B's original**: "proposal 假设 fan-out 是 `0.3.0 → 0.4.0`，但当前 package 是 `0.2.0`，`AISEP_PROTOCOL_VERSION` 仍是 `0.1.0`。"

**My reaction**: I did NOT catch this in Phase 1. B is **fully correct on both halves of the claim**. This is also a **secondary integrity finding**: package.json and version.ts are themselves split. Even before v1 fan-out lands, that drift is a bug.

**Fact-check** (verbatim cite of both files' current state):

Verbatim from `packages/aisep-protocol/package.json` line 3:
```json
"version": "0.2.0",
```

Verbatim from `packages/aisep-protocol/src/version.ts` lines 14-15:
```ts
export const AISEP_PROTOCOL_VERSION = "0.1.0";
export const MIN_CLIENT_VERSION = "0.1.0";
```

So the current state is:
- `package.json` version field = **`0.2.0`**
- `AISEP_PROTOCOL_VERSION` constant = **`0.1.0`**
- `MIN_CLIENT_VERSION` constant = **`0.1.0`**

B's claim is confirmed verbatim. The proposal's "0.3.0 → 0.4.0" assumption is wrong on both fronts: (a) the package is at 0.2.0, not 0.3.0; (b) the runtime constant is at 0.1.0, lagging the package by a minor version even before v1 ships.

**Reason**: This is two findings, not one:
1. **Wire version target**: v1 should bump `0.2.0 → 0.3.0` (assuming v3 cycle has not landed first). If v3 cycle ships first, v1 becomes `0.3.0 → 0.4.0`. The proposal must commit to one ordering OR write the version as a placeholder pending v3-cycle-resolution.
2. **Pre-existing drift**: `version.ts` constant is at 0.1.0 while package.json is at 0.2.0. **This is a real bug** in the v0.2 ship (Phase 2.E #1 baseline). It should be fixed independently of v1 fan-out, but v1's Migration section should include a "fix the pre-existing constant lag" step OR file a separate issue.

**New suggestion** (combining my and B's):
- Update proposal §Q2 + §Migration to say: "If v1 ships before v3 cycle, version target is `0.2.0 → 0.3.0`; both `package.json` and `AISEP_PROTOCOL_VERSION` constant updated together. If v3 cycle ships first, version target shifts to `0.3.0 → 0.4.0`. Fix pre-existing `version.ts` lag (currently `0.1.0` while package is `0.2.0`) as v1's first commit."
- Open question for user: "v1 first or v3 cycle first?" — this becomes a hard decision dependency, not just an ordering preference (B.F3 makes the protocol-version implication concrete).

### B.F4 (M5 composition) — **agree (this is the same finding as my A.F3, with more force)**

**B's original**: "proposal 说 `checkM5Cap` per-sub-stage zero change，但当前 M5 只是纯函数，没有 runner caller。更关键的是：parallel implement 后的 review 是一个总 review，还是每个 child patch 一个 review？"

**My reaction**: This is the same finding as my A.F3 from independent diagnosis. B adds one important nuance I did not articulate: **`checkM5Cap` is not yet wired into runner**. The proposal claim of "zero change" is doubly wrong — first because the per-sub-stage keying is unstated (my A.F3), second because runner doesn't even call checkM5Cap today (B's nuance).

This is a strengthening of my finding. No disagreement.

**Reason**: M5 cap landed as a primitive in Phase 2.E #1 but **wiring it to runner** is still spiral-pending. v1 cannot legitimately claim "M5 enforcement applies per-sub-stage with zero change" because the runner caller doesn't exist yet at any cardinality. The proposal should either (a) include the runner-wiring as part of v1's scope, OR (b) state "M5 cap remains advisory pure function in v1; runner integration deferred to <X>" and accept that v1's M5 story is documentation-only.

**New suggestion** (combining my A.F3 + B.F4):
- Add §"M5 composition under fan-out" with my 3 worked cases (sibling failures / same-sub-stage retry / parent-level review) AND B's runner-caller question.
- Explicitly answer: "v1 does NOT wire checkM5Cap into runner; v1 leaves it as a pure function callable from CLI / dogfood scripts. v1 fan-out does not introduce a regression to M5's status because there IS no runtime enforcement yet."
- File a follow-on issue "wire checkM5Cap into runner" as v1.1 or v2 prerequisite. This separates the fan-out delivery from the M5-runner-binding delivery.

### B.F5 (concurrency=4 evidence) — **agree (refines my Phase 1)**

**B's original**: "roadmap 里确实写了并发上限 4，但 proposal 又把它绑定到 SmartBear '超过 4 concurrent contexts reviewer attention degrades sharply'。已读材料没有看到这个具体来源。SmartBear 400 LOC 阈值和'4 个并发上下文'不是同一个结论。"

**My reaction**: B is correct that the proposal **conflates two SmartBear findings**: (a) the 400-LOC review threshold (which IS a real cited finding) and (b) "reviewer attention degrades past 4 concurrent contexts" (which is NOT a SmartBear finding that I can verify; SmartBear's research is about per-review LOC, not parallel review contexts).

I did not catch this in my Phase 1 — F4 (plan-roadmap consistency) checked only that the proposal honors the v1 row's `concurrency=4` cap, not that the **citation for why 4** is valid.

This is a minor but real intellectual-honesty finding. Concurrency=4 is justifiable as "what the roadmap says" + "what a Mac mini can handle" + "what dogfood will validate" — NOT as a SmartBear-derived hard rule.

**Reason**: I agree. The fix is text-only: change line 19-20 of the proposal from
> "SmartBear 400-LOC threshold ... reviewer attention degrades sharply past 4 concurrent contexts"

to something like:
> "SmartBear 400-LOC reviewer-cognition threshold (per-patch size). Concurrency cap = 4 is a roadmap-stated default that Pilot-09 will validate; the SmartBear research supports keeping per-sub-stage patches small (which fan-out does), but does NOT directly support `N=4` as the right concurrency number."

**New suggestion**: this is a strict refinement of my A.F4. Adding a new minor finding **A.F9 (citation honesty)** in self-revision section.

### B.F6 (withStateLock boundary) — **agree (overlaps my A.F5 with sharper framing)**

**B's original**: "若所有 sub-stage 都在一个 Node runner 进程里，in-process mutex 可以；若未来多个 `aisep run` 或 worker 进程同时写同一 workspace，in-process mutex 不够。"

**My reaction**: B's finding is sharper than my A.F5 in one specific way: my A.F5 worried about runner's role expanding to "potentially N parallel stage_runs" and suggested R6 affirmation. B worried about **`withStateLock`'s scope (in-process vs cross-process)** — a tighter, more concrete issue.

Both are valid. B's is about lock semantics; mine is about runner-role documentation. They compose.

**Reason**: I agree with B. The fix is to add an explicit "single runner process owns all child scheduling" invariant in §Q6 (resource contention) AND a cross-process rejection mechanism (workspace lockfile fail-closed).

**New suggestion** (combining):
- §Q6 gains "`withStateLock` is in-process only; concurrent `aisep run` invocations against the same workspace must fail-fast via a workspace lockfile (e.g. `.aisep/run.lock` with pid+timestamp). Cross-process scheduling is out of scope for v1; v1 enforces single-runner-per-workspace at startup time."
- Update RISK-LOCK row to mention the lockfile fail-fast as the mitigation for the cross-process case (not just the in-process case).

## Self-revision of my Phase 1

After seeing B's findings, here is the disposition of my A.F1–A.F8:

- **A.F1 (Schema collision)** — **keep, but adopt B's `fanOutRole` framing as the recommended fix**. My binary "lift OR widen union" framing is less type-clean than B's explicit role discriminant. The substance of the finding is unchanged.

- **A.F2 (R7 self-host claim asserted not analyzed)** — **keep, unchanged**. B did not engage R7. This is a finding from the architecture-fit lens that B's correctness lens did not surface; remains MAJOR.

- **A.F3 (M5 composition under retries-vs-siblings)** — **keep, strengthen with B.F4's runner-caller nuance**. The finding stands; B added that M5 isn't even wired to runner yet, which doubles the force of the original claim.

- **A.F4 (Plan-roadmap consistency holds)** — **downgrade conclusion**: my Phase 1 declared this a FALSE-POSITIVE-CANDIDATE (no issue). B.F5 shows there IS a real issue inside this verification: the SmartBear citation for `concurrency=4` is wrong. So plan-roadmap **enum compliance** holds (still no scope creep), but the **evidence cited for the cap value** does not. I'm splitting this:
  - **A.F4-a (scope creep check)** — keep as FALSE-POSITIVE-CANDIDATE (no creep). Plan v1 row honored.
  - **A.F4-b (citation accuracy)** — new MINOR finding, see "New findings" below.

- **A.F5 (R6 boundary holds; runner JSDoc needs update)** — **keep, augment with B.F6's lock-scope framing**. My finding was about JSDoc + R6; B's is about `withStateLock`'s in-process scope. Both fit; both stay.

- **A.F6 (R11 memory trust boundary unaffected)** — **keep as FALSE-POSITIVE-CANDIDATE**. B did not engage R11; nothing in B's findings changes my conclusion that per-sub-stage memory retrieval inherits R11 cleanly.

- **A.F7 (Dogfood Phase 9c cancelled-vs-orphaned siblings)** — **keep, unchanged**. B did not engage Pilot-09's cancellation semantics. This stays MINOR.

- **A.F8 (ADR-lite Non-decisions list)** — **keep, unchanged**. B did not engage ADR-lite completeness. Stays MINOR.

## New findings (after seeing B's lens)

### A.F9 (citation honesty: SmartBear N=4 conflation) — [MINOR]

**Where**: Proposal §Context (line 19-20) and §Plan-derived constraint (line 38).

**Issue**: The proposal grounds `concurrency=4` in "SmartBear ... reviewer attention degrades sharply past 4 concurrent contexts". SmartBear's published research covers per-patch LOC thresholds (the 400-LOC line is real and cited correctly elsewhere). I have not seen — in any AISEP-tagged source material — a SmartBear finding specifically about **N=4 parallel review contexts**. The proposal conflates two different SmartBear claims.

**Why it matters**: AISEP's design ethos is "cite the actual research; spiral the values that aren't strongly evidence-backed". Misciting evidence for a hard-coded cap erodes trust in the proposal's other empirical claims. Concurrency=4 is defensible on **roadmap + dogfood-to-validate + Mac-mini-RAM** grounds; it does not need (and should not borrow) a SmartBear citation.

**Suggested fix**: rewrite §Context lines 19-20 and §Plan-derived constraint to drop the SmartBear-N=4 link. Keep SmartBear-400-LOC where it is. New phrasing: "Concurrency cap = 4 per plan/roadmap; sweet-spot value to be validated in Pilot-09 §Phase 9b (resource profile). SmartBear 400-LOC threshold remains relevant to **per-sub-stage patch size**, which fan-out helps achieve (smaller patches per sub-stage), but is independent of the N=4 concurrency number."

### A.F10 (predecessor side of schema collision: fan-in is required, not optional) — [MAJOR]

**Where**: Proposal §Scope item 4 (line 73-75); current `runner.ts:82-118` reads exactly one `predecessorId`.

**Issue**: This is the architecture-fit framing of B.F1, but with a different conclusion: my A.F1 caught the subStages-side schema collision; B caught the predecessorId-side **scope contradiction** that I missed entirely. The proposal cannot ship v1 fan-out **without** some form of fan-in (manifest indirection OR `predecessors[]`), because verify needs ALL parallel patches. Listing fan-in as "v2 non-scope" while requiring verify-consumes-all-patches in v1 is a self-contradiction.

I am promoting this as a separate finding (not just absorbing it into A.F1) because the **architecture-fit** lens here is: the proposal's "DAG" framing is fundamentally fan-OUT-then-fan-IN; v1 cannot ship only one half. Either v1's scope expands to include the manifest-indirection path (my preferred fix from B.F1 react), OR v1's deliverable scope shrinks (e.g. "implement runs in parallel but produces N independent verify stage_runs" — no fan-in, no merged verify; consequences far-reaching).

**Suggested fix**: same as B.F1 + my refinement — adopt manifest-indirection path. Update §Scope item 4 to make the manifest artifact explicit:
> "Per-sub-stage artifact namespacing — each parallel implement sub-stage produces its own patch artifact (`patch-backend.diff`, etc.). On all-children-succeed, parent stage_run synthesizes a `patch_set.manifest.json` artifact referencing child patches by id. verify stage_run's predecessorId points at the parent; verify reads the manifest, then traverses child artifacts via `store.listArtifactsByStageRun(child_id)`. v1 does NOT lift `predecessorId` to `predecessors[]` (that remains v2 scope)."

### A.F11 (pre-existing version.ts drift is independent of v1) — [MINOR]

**Where**: `packages/aisep-protocol/package.json` (version 0.2.0) vs `packages/aisep-protocol/src/version.ts` (AISEP_PROTOCOL_VERSION = "0.1.0").

**Issue**: While fact-checking B.F3, I confirmed the package.json/version.ts split. This drift exists in `main` (or at least in the current `feat/aisep-bootstrap` worktree) **before** v1 fan-out is even considered. It is a Phase 2.E #1 follow-on bug.

**Why it matters**: integration-test fixtures, MIN_CLIENT_VERSION negotiation, and any future iOS-side `minClientVersion` check rely on runtime constants matching declared package version. Letting v1 inherit this drift is risk-stacking.

**Suggested fix**: file a separate hotfix issue "sync `version.ts` to `package.json@0.2.0`" — this is independent of v1 and should land NOW, not as part of v1's first commit. v1's Migration section then assumes a clean baseline (0.2.0 → 0.3.0).
