# AISEP Pilot-02 — replaceMessages v2 (post Phase 2.C fixes)

> Workspace: `/tmp/aisep-pilot-v2-full`
> Date: 2026-05-12
> Mode: `--real` (`claude --print --tools "Read"`)
> Stages: intake → research → plan → architecture (Phase A, phase=`architecture-brief`)
> Same seed.txt as Pilot-01 → direct A/B comparison of v0.1 vs v0.2 prompts

## Pilot-01 vs Pilot-02 quantitative comparison

| Stage | v1 size | v2 size | Δ | v1 duration | v2 duration | Δ duration |
|-------|---------|---------|---|------------|------------|-----------|
| intake | 8668 B | 9703 B | +12% | 71.0s | 47.8s | **−33%** |
| research | 1226 B | **9823 B** | **+8.0x** | 85.2s | 49.3s | **−42%** |
| plan | 1184 B | **8727 B** | **+7.4x** | 80.7s | 44.0s | **−46%** |
| architecture | 11222 B (claude self-write) + 1478 B (executor redirect) | **14438 B** (single brief.md) | one file vs two | 99.8s | 93.5s | −6% |
| **Chain total** | 22.7 KB / 336s | **42.7 KB / 234s** | **+88% content, −30% time** | | | |

## Issue fix validation

### Issue #1 — claude `Write` tool created duplicate artifact files ✅ FIXED

v1: `architecture.md` (11.2 KB, claude self-write) + `architecture/index.md` (1.5 KB, executor redirect) — two files for one stage.
v2: only `architecture/brief.md` (14.4 KB). state.json `attempt.invocation.argv` = `["--print", "--tools", "Read"]` — claude can read but not write.

### Issue #2 — Upstream content not inlined in prompts ✅ FIXED

v1: claude relied on its Read tool to fetch upstream artifacts implicitly.
v2: `ClaudeExecutor.collectUpstreamContent()` reads each upstream artifact with budget caps (4 KB per artifact, 16 KB total) and passes `upstreamArtifactsWithContent` to PromptCompiler. Templates render content inline in ```code fences```. claude no longer needs Read for upstream artifacts (only for `seed.txt` at intake stage, where there's no upstream).

Side effect: **−30% chain duration**. Likely cause: claude doesn't burn turns invoking Read+seek; the content is already in the prompt context window.

### Issue #4 — research / plan stages were 1.2 KB thin ✅ FIXED (8x growth)

v1: generic `planner.hbs` produced minimum-viable output.
v2: stage-specific templates with mandatory structure:

**research.md (v2)** has all 6 mandatory sections:
- §1 Research questions (with intake unknowns refs)
- §2 Candidate approaches A + B (template requires ≥ 2)
- §3 Counter-evidence per candidate ("how it could fail" — even for the recommended one)
- §4 Adoption-fitness ranking table
- §5 Recommendation with explicit flip conditions
- §6 Carry-forward to plan stage

**plan.md (v2)** has all 6 mandatory sections:
- §1 Task DAG (mermaid `graph TD`)
- §2 Task descriptions T1..Tn with owner/inputs/output/acceptance
- §3 Risk register R1..R8 with likelihood/impact/mitigation/escalate-if
- §4 Decisions deferred to architecture
- §5 **LCO anchor commitment: ✅ GO** (template makes this mandatory)
- §6 Design-stage handoff paragraph

### Issue #5 — architecture stage phase defaulted to "none" ✅ FIXED

v1: phase="none" → Phase A hard limits (≤ 5 pages, ≤ 3 ADRs, ≤ 2 figures) only triggered by lucky overlap with system prompt.
v2: CLI `defaultPhaseFor("architecture")` returns `"architecture-brief"`. state.json shows `phase: "architecture-brief"`. Output `architecture/brief.md` (correct path per `artifactKey_()` switch).

The Phase A discipline is now observable in the output:
- 2 C4 figures (Context + Container) — hits the ≤ 2 limit exactly
- 3 ADRs (001/002/003) — hits the ≤ 3 limit exactly
- 14.4 KB ≈ 5 pages — at the upper edge but not over

## Quality signals (not just structure — actual reasoning quality)

These are findings I would NOT have predicted before running the pilot.

### F-1: Cross-stage cross-reference chain emerged organically

The intake/research/plan/architecture artifacts naturally **reference each other by ID**:
- intake → U3 (immer middleware unknown)
- research §6 carries U3 forward
- plan R1 mitigation says "T2 confirms middleware before T4"
- architecture ADR-001 body says "shape conditional on U3" + RISK-Q1 references it again
- architecture handoff §8 says "Phase B must resolve U3 before T4"

This is the **DAG topology** working as intended — without explicit prompt instructions to cross-reference. The stage-specific templates' "Inputs / Carry-forward" sections set up the conditioning for claude to pick up upstream ID conventions.

### F-2: Plan stage produces an explicit GO commitment line

Mandatory `✅ GO` / `❌ NO-GO` template in `plan.hbs` forces a binary statement before architecture invests in detailed ADRs. v2 plan.md ends with:

> "✅ GO — the task DAG is sufficient to deliver the intake success criteria ... The deferred decisions are well-bounded and do not threaten the core mechanic."

This is an LCO anchor that doesn't exist in v1. Future failed pilots will produce `❌ NO-GO + reason`, and the chain will halt rather than waste tokens on a doomed architecture stage.

### F-3: Adversarial self-review fed back into an ADR

architecture/brief.md §2 (adversarial self-review) produced Counter-Argument-2 ("F3 metric is bounded by selector hygiene, not just notification count"). The skeptical reading was then captured in **ADR-002** ("F3 assertion scope: store-notification count, not React commit count") with explicit narrowing of the success-criterion assertion. The counter wasn't ritualistic — it changed the design.

This validates the template design: adversarial section BEFORE the ADRs forces the agent to use the counters as inputs to the ADR decisions, not afterthoughts.

### F-4: Risk register Q5 = "N/A — no permissions / IPC / fs boundary touched"

claude explicitly marked RISK-Q5 as Not Applicable rather than hallucinating a permissions risk. This is a strong quality signal — the 7-question anchor gate prompt does NOT force every Q to have a concrete risk; it forces every Q to be ANSWERED. claude correctly distinguishes "no risk here" from "I should make one up".

### F-5: Plan stage absorbed risk-register responsibility from architecture

In v1, only architecture had a risk-register table; plan was 1.2 KB and risk-free. In v2, plan.md §3 has R1..R8 (8 risks), and architecture/brief.md §7 has RISK-Q1..RISK-Q7 (7 risks, one per anchor-gate Q). They are NOT duplicates — plan risks are about *task execution* (e.g. "test harness flakiness"), architecture risks are about *design decisions* (e.g. "byCwd reference identity changes"). The split is the right level — plan has work-product risk, architecture has decision-product risk.

This emerged from the template's mandatory `Risk register (LCO-style)` section in `plan.hbs`, with architecture's risk-register being the 7-question anchor gate output.

## What did NOT change between v1 and v2

These v0 design choices held up under direct A/B comparison and stay locked:

- The 5 agent profiles (planner / architect / coder / reviewer / tester) — both runs used the same profile mapping; output quality is profile-orthogonal.
- The 10-stage methodology — v2 only ran 4 stages but the chain wiring works identically.
- The R6 zero-side-effects boundary in aisep-core — runner orchestrated 4 stages without importing fs/process directly, identical to v1.
- The Workspace abstraction — single NodeWorkspace instance carried 4 stages with the new `--tools "Read"` argv unmodified.
- AlphaEvolve memory layer — not exercised this pilot either (still no failures to record); will surface in Phase 3 dogfood.

## New issues / observations (Phase 2.D candidates)

### Issue v2-#1 — claude still occasionally exceeds advisory word budgets

intake.md is 1335 words (under 2000 budget — good).
plan.md is 8.7 KB ≈ 1500-1800 words (around 1500 budget edge).
architecture/brief.md is 14.4 KB ≈ 2300-2500 words — **over** the implicit "≤ 5 pages" limit if a page is ~500 words.

Still falls within Issue #3 deferral (Phase 2.D verify-stage `wc -w` enforcement). No additional fix needed.

### Issue v2-#2 — No memoryHits exercised this pilot (chicken-and-egg)

Both v1 and v2 ran with empty memoryHits because `~/.aisep/governance-log/evolution_log.json` is still empty. The 4 candidate memory entries from Pilot-01 retro have not been manually promoted yet. AlphaEvolve memory injection won't be observable in pilot output until at least 1 round of promotion + 1 subsequent run that retrieves it.

Action: dogfood Phase 3 should explicitly run `aisep memory promote` after the first failure-pattern is recorded, then re-run a similar workspace to see memoryHits in the prompt.

### Issue v2-#3 — architecture/brief.md is one large file; not split per ADR

Phase A produces all 3 ADRs inside `architecture/brief.md` rather than `architecture/decisions/0001-*.md` (one file per ADR as MADR convention suggests). For a 3-ADR Phase A this is fine; but Phase B slices will need a different artifact key strategy if multiple slices each add ADRs.

Deferred: Phase 2.E (Phase B / slice machinery) — orthogonal to Phase 2.C scope.

## Recommended next actions

1. **Phase 2.D — verify stage implementation**: implement Issue #3 (`wc -w` budget enforcement); JSON-schema validate Risk register tables; check that GO/NO-GO line exists in plan.md. ~3-4 hours.

2. **Phase 3 dogfood — first real ship**: pick a vessel docs/ change (low-risk; not code) such that AISEP can actually ship via the `integrate` stage without touching backend code. Validates implement → verify → review → integrate stages end-to-end. Will surface real memoryHits.

3. **Phase 2.E — Phase B / slice machinery**: handle architecture-detail-slice stage runs (multiple ADRs across multiple slice files; sliceTotal accounting; pre-slice handoff inheritance). Only valuable once a workspace truly needs > 3 ADRs.

## Source artifacts

- Workspace: `/tmp/aisep-pilot-v2-full/`
- Stage outputs:
  - intake: `intake.md` (9703 B, 10 mandatory sections all present)
  - research: `research.md` (9823 B, 6 mandatory sections all present, 2 candidates + counter-evidence + ranking)
  - plan: `plan.md` (8727 B, 6 mandatory sections all present, R1-R8 risk register, ✅ GO commitment)
  - architecture: `architecture/brief.md` (14438 B, 8 sections, 2 C4 figures, 3 ADRs, RISK-Q1..Q7, adversarial CA-1..CA-3, Phase B handoff)
- State + provenance: `.aisep/state.json` (4 stage_runs / 4 artifacts / 4 attempts), `.aisep/tmp/task-*.md` (rendered prompts for replay)
- Run log: `/tmp/aisep-pilot-v2-full.log`
- Pilot-01 (v1) baseline for comparison: `/tmp/aisep-pilot-replaceMessages-v2/` (kept on disk)
