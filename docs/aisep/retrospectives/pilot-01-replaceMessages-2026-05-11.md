# AISEP Pilot-01 — replaceMessages bug fix (intake → architecture)

> Workspace: `/tmp/aisep-pilot-replaceMessages-v2`
> Date: 2026-05-11
> Mode: `--real` (`claude --print` ClaudeExecutor)
> Stages run: intake → research → plan → architecture (Phase A, phase=none)
> Stages NOT run: contract / implement / verify / review / integrate / retrospect
> (stopped to avoid touching vessel mainline code per R3/R4 red lines)
> Source bug: vessel `docs/IMPROVEMENTS.md` P1 #3 — `SessionList.tsx` N store updates per history switch

## Outcome at a glance

| Stage | Duration | Output size | Status |
|-------|---------|------------|--------|
| intake | 71s | 8668 B (~2000 words, slightly over 1800 budget) | ✅ succeeded |
| research | 85s | 1226 B | ✅ succeeded |
| plan | 81s | 1184 B | ✅ succeeded |
| architecture (phase=none) | 100s | 11222 B (claude self-write) + 1478 B (executor redirect) | ✅ succeeded |
| **Chain total** | **~5.6 min** | **22.7 KB** | **4/4 succeeded** |

## What went RIGHT (validated)

1. **End-to-end integration works** — claude-cli (subscription auth) → spawn → stdin prompt → stdout capture → file artifact → state.json persistence. Zero engine crashes across 4 stages.

2. **7-question anchor gate prompt actually shapes output** — claude's architecture.md filled all Q1-Q7 with specific answers, not boilerplate. Q4 (irreversible decisions) correctly limited to 3, matching the `≤ 3 ADR` hard limit in `architect.hbs`.

3. **Adversarial self-review prompt produced GENUINE counter-arguments** — not "as an AI, I should consider..." filler. Counter-2 in particular ("set count is a proxy metric, you're moving the goalposts") is a sharp critique that a senior reviewer would actually make. Rebuttals include explicit asymmetry-of-reversal reasoning (ADR-2's defense).

4. **Stage chain wiring works without manual hand-off** — research/plan/architecture stages each consumed their predecessor artifact correctly (despite the prompt template only listing artifact refs, not inlining content — see Issue #2 below).

5. **State machine + artifact freshness preserved** — `state.json` shows clean pending → running → succeeded transitions, content_hash recorded for each artifact, attempt durations logged for cost analysis.

6. **R3/R4 invariants held** — vessel mainline working tree untouched throughout the pilot. AISEP wrote only to `/tmp/aisep-pilot-*`.

## What went WRONG / surprised

### Issue #1 — Two architecture files written (executor redirect collision)

- `architecture/index.md` (1478 B) — written by `ClaudeExecutor` redirecting stdout
- `architecture.md` (11222 B) — **claude wrote this itself** via its built-in Write tool

Cause: `claude --print` defaults to tools-enabled. claude saw `cwd` and decided to Write directly to the filesystem. ClaudeExecutor then redirected its (shorter) stdout to a separate file.

Fix paths for v0.2:
- **Option A**: pass `--allowedTools=""` to claude --print so it can't use Write (then stdout becomes the only artifact)
- **Option B**: prompt the agent to NEVER use Write, only emit text (fragile — relies on instruction following)
- **Option C**: detect duplicate output (one in stdout, one in cwd) and dedup at executor level
- Recommendation: **Option A** — explicit tool restriction. We control the executor.

### Issue #2 — Prompt templates reference artifacts but don't inline content

`research.hbs` / `plan.hbs` / `architect.hbs` enumerate upstream artifact REFs (kind + key path) but don't inline content. Claude figures out to use its Read tool to fetch them. **This is implicit, fragile, and breaks if tools are disabled (Issue #1 fix).**

Fix for v0.2: **PromptCompiler should inline a configurable amount of upstream artifact content** into the rendered prompt. E.g. first 2 KB of each upstream artifact, full content if total < 8 KB. Spec needs to live in `aisep-protocol/context.ts` (v0.2 work).

### Issue #3 — Token budget hard limit (≤ 1800 words) NOT enforced

intake.md is ~2000 words — over the 1800 word hard limit declared in `planner.hbs`. Claude treated it as soft.

Fix paths for v0.2:
- **Option A**: post-render verify step (count words in stdout, fail if over)
- **Option B**: tighter prompt language ("HARD ABORT if you exceed 1800 words")
- **Option C**: accept that "hard limit" in prompts is advisory and rely on `verify` stage to enforce
- Recommendation: **Option C** for v0.2 — push enforcement to the right stage rather than fighting prompt compliance.

### Issue #4 — research / plan stages produced THIN output (1.2 KB)

While intake (8.6 KB) and architecture (11.2 KB) were rich, research.md and plan.md were 1.2 KB each — visibly under-developed compared to their stage's importance.

Cause: `planner.hbs` is a generic template used for intake / research / plan / retrospect. It does NOT have stage-specific structural requirements like `architect.hbs` does (Phase A vs B, 7Q gate, adversarial). Claude produced the minimal viable output.

Fix for v0.2: **Per-stage prompt templates within the planner family**:
- `templates/intake.hbs` (Statement of Architecture Work shape, 10 sections)
- `templates/research.hbs` (≥ 2 sources horizontal review + counter-evidence + adoption-fitness ranking)
- `templates/plan.hbs` (task DAG + risk register, LCO-style)
- `templates/retrospect.hbs` (ship/drop/defer + non-obvious findings)
- Keep `templates/planner.hbs` only as fallback

This is a meaningful Phase 2.C task, not a v0.2 deferred item — bad outputs at intake/research will poison downstream stages.

### Issue #5 — `architecture` stage phase="none" instead of `architecture-brief`

In the pilot, `aisep run --stages architecture` defaults phase to "none". Phase A / Phase B is only entered if the runner is invoked with explicit `--phase architecture-brief`. The current CLI doesn't expose `--phase` yet.

The 7Q anchor gate prompt still triggered (it's outside the `{{#if isPhaseA}}` block in `architect.hbs`), so the pilot benefited regardless. But the **5-page hard limit** and **3-ADR limit** are Phase-A-conditional in the template — they triggered in this run anyway because claude found them in the system prompt of `SYSTEM_PROMPTS.architect`. Lucky alignment, not by design.

Fix for v0.2:
- CLI: add `--phase <none|architecture-brief|architecture-detail-slice>`
- Default phase for architecture stage: `architecture-brief` (not `none`)
- `phase="none"` for architecture should be reserved for the parent row in Phase-B-slicing mode

## Numbers worth filing

- **Cost per stage**: ~85 seconds wall-clock × 1 `claude --print` invocation. Token usage NOT instrumented yet (v0.2: capture via stdout JSON if claude offers usage block, or via `claude --usage` flag if available).
- **Stage chain warm-up**: each stage cold-starts a new claude process; no session continuation. v0.2 evaluation candidate: `claude --resume <session>` between adjacent stages to keep context warm. But this trades off determinism for warmth — a stage failure would carry mid-thinking context into the retry attempt. Default-off.

## Memory candidates (recordPending → promote after human verify)

These should land in `~/.aisep/governance-log/evolution_log.json` once human-verified (P2.5 work):

1. **stage=architecture, pattern**: "Phase A produced over the 5-page limit when phase=none falls back to generic template" → **fix**: CLI must default architecture phase to `architecture-brief`; never pass `none` for architecture stage
2. **stage=intake, pattern**: "Token budget ≤ 1800 words is advisory; claude exceeded by ~10%" → **fix**: enforce in verify stage with `wc -w`, not in prompt
3. **stage=architecture (cross-cutting), pattern**: "claude --print writes to cwd via Write tool, producing duplicate output alongside stdout" → **fix**: pass `--allowedTools=""` to claude when output should be stdout-only
4. **stage=research, pattern**: "Generic planner template produces thin output (~1 KB)" → **fix**: split into per-stage templates

## What this validates about AISEP v0 design

1. ✅ **Protocol design (Phase 1)** held up under real load — `AisepStageRun` / `AisepArtifact` / `AisepAttempt` zod schemas captured everything needed, no Round-3 schema bugs surfaced.
2. ✅ **R6 boundary (aisep-core zero side-effects)** held — runner orchestrated 4 stages without importing fs/process directly.
3. ✅ **Workspace abstraction** held — single `NodeWorkspace` instance carried 4 stages, persisted state.json correctly.
4. ✅ **Memory layer** unused this pilot (no failures, no promote candidates yet) — but `recordPending` API will be exercised in Pilot-02.
5. ✅ **Prompt template Handlebars renderer** works at production scale — 8 unit tests already passing, 4 real stages now confirm template logic survives real claude.

## Recommended next actions (priority order)

1. **Phase 2.C — per-stage prompt templates** (Issue #4): split `planner.hbs` into intake/research/plan/retrospect; ~2 hours work
2. **Phase 2.C — disable claude tools in executor** (Issue #1): add `--allowedTools=""` to argv default; ~30 min
3. **Phase 2.C — inline upstream artifact content** in prompts (Issue #2): PromptCompiler reads artifact files up to a budget cap and injects content; ~1.5 hours
4. **Phase 2.C — CLI `--phase` flag** (Issue #5): make architecture stage default to Phase A brief; ~30 min
5. **Phase 2.5 — Pilot-02 verify/review stages**: feed Pilot-01's intake.md + architecture.md as upstream into a new workspace; manually trigger review stage to validate the reviewer template
6. **Phase 3 — full 10-stage chain dogfood**: pick a different vessel-level trivial bug (or maintain a vessel pilot tracker), run all 10 stages to completion, generate retrospective auto-populated

## Source artifacts

- Workspace: `/tmp/aisep-pilot-replaceMessages-v2/`
- Stage outputs (read-only):
  - intake: `intake.md` (8668 B)
  - research: `research.md` (1226 B)
  - plan: `plan.md` (1184 B)
  - architecture: `architecture.md` (11222 B, claude self-write) + `architecture/index.md` (1478 B, executor redirect)
- State + provenance: `.aisep/state.json` (4 stage_runs / 4 artifacts / 4 attempts) + `.aisep/tmp/task-*.md` (rendered prompts for replay)
