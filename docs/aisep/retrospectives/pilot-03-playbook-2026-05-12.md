# AISEP Pilot-03 — full 10-stage chain (docs-only seed)

> Workspace: `/tmp/aisep-pilot-03-playbook`
> Date: 2026-05-12
> Mode: `--real` (full 10-stage chain, no `--stages` subset)
> Templates: v0.2 (Phase 2.C-2 stage-specific for intake/research/plan/retrospect; profile-fallback for implement/verify/review/integrate — Phase 2.C-7 templates were written AFTER this run started)
> Seed task: ship `docs/aisep/05_pilot-playbook.md` (docs-only, ≤ 200 lines)

## Outcome

| Stage | Duration | Status |
|-------|---------|--------|
| intake | 60s | ✓ |
| research | 58s | ✓ |
| plan | 46s | ✓ |
| architecture | 87s (phase=architecture-brief) | ✓ |
| contract | 83s | ✓ |
| implement | **245s** (4 min — longest stage) | ✓ |
| verify | 26s | ✓ (correctly reports build/lint/tests all failed) |
| review | 26s | ✓ verdict = **`revise_required`** |
| integrate | 20s | ✓ **`ready_to_integrate: false`** |
| retrospect | 61s | ✓ (claude self-written, see §5) |
| **Total** | **~12 min** | All 10 stages technically succeeded |

**Headline**: zero artifacts merged — but this is a SUCCESSFUL pilot.
AISEP correctly refused to ship a broken patch. The gate machinery worked
end-to-end.

## The negative case is the point

Seed asked for a 200-line markdown file. Architect over-engineered the
deliverable into a TypeScript schema + lint tooling + 11 unit tests.
Implement produced a truncated patch importing zod without adding it to
package.json. Verify caught build/lint/tests all failed. Review issued
3 critical + 2 major + 1 minor → `revise_required`. Integrate read the
review verdict and set `ready_to_integrate: false`, recording the
rollback path defensively.

This validates that AISEP's gates work even (especially) on a chain
where the architecture itself was wrong. The runtime didn't silently
ship bad code despite every preceding stage technically "succeeding".

## What was validated (system-level)

1. **All 10 stages produced their canonical artifact** at their canonical
   filename per `ClaudeExecutor.artifactKey_()` mapping. No surprises.
2. **Phase A architecture default (`phase=architecture-brief`)** triggered
   the 7-question anchor gate + 3-ADR + 2-figure hard limits via prompt
   template. Output `architecture/brief.md`.
3. **Integrate gate refused to ship** when upstream review verdict was
   `revise_required` AND verify reported failures. Output JSON included
   mandatory `rollback_path: "git revert --no-edit HEAD && git push origin dev"`.
4. **Retrospect stage produced 1410-word structured output** with 5
   non-obvious findings + 5 verifiable memory candidates. Claude's
   `retrospect.hbs` template did its job.
5. **M4 ping-pong cap surfaced** — though, per claude's own retro, the
   *naming* of M4 is confusing: it fires on entry to `revise_required`
   not after N rounds (this is a real bug in AISEP docs / template
   wording, NOT in the run).

## Claude's 5 non-obvious findings (verbatim quality)

From `/tmp/aisep-pilot-03-playbook/retrospect.md` §4. These are surprising
enough that I would NOT have predicted them before the run:

1. **"Test-failure counts are an unreliable severity signal when the
   build is broken."** 0/11 looks worse than 8/11 but is actually a less
   informative outcome — the runner never started. Verify needs
   `build_failed | tests_failed | tests_passed` classification.

2. **"Truncation is contagious across stages."** Implement truncated →
   contract_grep also truncated → review couldn't confirm anchor → integrate
   blocked on multiple items that share one root cause. Stage outputs are
   NOT independent.

3. **"The most expensive blocker was the cheapest to prevent."**
   `npm install --dry-run` would have caught the missing zod dep in
   seconds. Argues for a cheap pre-flight check between implement and
   verify.

4. **"Size budgets without measured reference implementations fail by
   single-digit deltas."** 205 vs 200 isn't carelessness — it's a guess.
   A 5-LOC overshoot is statistical noise.

5. **"M4 ping-pong cap fires on entry, not on exit."** The cap name
   implies "after N rounds" but `revise_required` triggers it
   immediately. Future agents reading M4 will be wrong.

## Memory promote — first real AlphaEvolve activation

For the first time in any AISEP pilot, the global memory tier is
non-empty. Five verified records were promoted via a one-off seed
script (`/tmp/seed-memory-from-pilot03.mjs`) because v0 CLI lacks a
direct `aisep memory record --tier global --verified-by human` command.

```bash
$ aisep memory show global   # now returns 5 records
- [implement] New runtime import without package.json entry → ...
- [implement] Patch truncated at byte cap → ...
- [verify] Test runner reports 0/N when build broken → ...
- [architecture] Size budgets without reference impl fail by single digits → ...
- [architecture] Architect over-engineers docs-only deliverable → ...
```

The 5th record (architect scope creep on docs-only) directly addresses
the Pilot-03 root failure. **The next pilot run with a docs-only seed
will see this fix injected as a memoryHit into the architect stage
prompt** — AISEP's self-learning loop is now live.

## Phase 2.D + Phase 3-iter-2 backlog (from Pilot-03)

1. **`aisep memory record --tier global --verified-by human`** CLI command
   — current workflow requires a one-off script.
2. **`aisep memory record --tier workspace` (recordPending via CLI)** —
   same gap.
3. **Pre-implement dependency check** — diff imports against package.json;
   fail fast if undeclared. Prevents Pilot-03 root cascade.
4. **Implement-stage manifest header for large patches** — declare hunk
   count; review rejects if received < declared.
5. **Verify stage output classification fix** — `build_failed |
   tests_failed | tests_passed` instead of just pass-count.
6. **Size budget calibration policy** — provisional budget + measured
   reimplementation, no re-ADR for single-digit overshoots.
7. **M4 naming clarification** — `pass_with_comments` allows ≤ 1
   in-loop revise; `revise_required` allows 0 in-loop revise (immediate
   planner handback). Update `aisep-protocol/attempt.ts` JSDoc + plan
   template wording.
8. **Architect docs-only refusal** — when intake task_type=docs-only,
   architect template forbids introducing non-markdown artifacts. Memory
   record #5 is the AlphaEvolve hook for this.

## What did NOT change between Pilot-02 and Pilot-03

(Held-up invariants — these are now triple-validated.)

- R6 (aisep-core zero side-effects): runner orchestrated 10 stages
  without importing fs/process directly.
- R3 (vessel mainline untouched): main worktree zero modified files
  throughout.
- Stage state machine: pending → running → succeeded transitions all
  clean for 10/10 stages.
- AisepArtifact contentHash freshness: all 10 artifacts have valid
  sha256:<hex> hashes; state.json round-trips cleanly.

## Recommended next actions

**Option A — Pilot-04 with memory feedback** (recommended): re-run the
same Pilot-03 seed but with the new global memory in place. Expect
architect prompt to now contain the "docs-only refusal" fix as a
memoryHit; expect architect to either refuse to introduce TS code OR
escalate via question fence. This is the **first time AlphaEvolve will
actually inject a learned fix into a real run** — the killer demo.

**Option B — Phase 2.D verify stage hardening**: implement the deferred
Issue #3 (wc -w enforcement) + Pilot-03 backlog items 3+5+6 (pre-flight
dep check, build_failed classification, size-budget policy). ~4 hours
of work, no token burn.

**Option C — Ship docs/aisep/05_pilot-playbook.md the boring way**: just
write it by hand (it's 200 lines of markdown). The AISEP-generated
attempt failed, but the seed.txt itself is a decent outline — turn it
into the playbook directly. ~30 min.

## Source artifacts

- Workspace (preserved): `/tmp/aisep-pilot-03-playbook/`
- All 10 stage outputs: `intake.md`, `research.md`, `plan.md`,
  `architecture/brief.md`, `contract.md`, `implement.md`,
  `verify.md`, `review.md`, `integrate.md`, `retrospect.md`
- State + provenance: `.aisep/state.json` (10 stage_runs / 10 artifacts /
  10 attempts), `.aisep/tmp/task-*.md` (rendered prompts for replay)
- Run log: `/tmp/aisep-pilot-03-playbook.log`
- AISEP's own retrospect: `/tmp/aisep-pilot-03-playbook/retrospect.md`
  (1410 words, 6 sections, 5 non-obvious findings, 5 memory candidates,
  10-item ship/drop/defer matrix) — this is the canonical analysis;
  this doc is the human-side wrapper around it
- One-off memory seed: `/tmp/seed-memory-from-pilot03.mjs`
- AlphaEvolve global: `~/.aisep/governance-log/evolution_log.json` (5
  records, first-ever non-empty state)
