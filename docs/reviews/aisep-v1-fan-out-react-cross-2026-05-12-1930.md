我读完三份正式输入了。关键点是：A 和 B 在 schema、M5、R7 上基本交叉确认；B 独有的 fan-in / version / lock-boundary 仍然需要保留进仲裁。Backlog: 0 in_progress · 3 planned · 4 blocked

```markdown
# Phase 2 React — cross-correctness lens reacting to architecture-fit verdict
> Reviewer: reviewer-cross (cursor-agent gpt-5.5-medium)
> Date: 2026-05-12
> Phase 2 (cross-pollinate)

## React to Reviewer A's findings

### A.F1 (schema collision) — refine
**A's original**: `AisepStageRunSchema` is not a flat object; `.strict()` variants reject extras.
**My reaction**: A is right on the bug, but I would refine the fix.
**Reason**: Adding optional fields to every phase is cheap but weak. Expanding 3 phases into 6 variants is explicit but noisy. My preferred fix remains a small `fanOutRole: "normal" | "parent" | "child"` plus `superRefine` rules: parent has `subStages`, child has `parentStageRunId`, nested fan-out rejected, and v1 only permits parent/child on `stage === "implement"`.

### A.F2 (R7 self-host edge) — refine
**A's original**: "force re-plan" may smuggle a primitive cycle if runner auto-loops plan-stage.
**My reaction**: The risk is real, but the proposal text is ambiguous rather than definitely wrong.
**Reason**: Proposal `RISK-FAN-IN` says "user re-plans", which is R7-safe. But adversarial #3 says "plan-stage refuse + force re-plan", which could be read as runner auto-re-spawning plan. Fix should state: validator failure exits with structured errors; user or outer human-controlled invocation reruns plan. No runner-driven auto re-plan in v1.

### A.F3 (M5 composition) — agree
**A's original**: M5 per-sub-stage is asserted, but retries, re-plan, and post-parallel review shape are not specified.
**My reaction**: Agree. My B.F4 wording is not sufficient by itself.
**Reason**: The proposal needs a worked example. It should explicitly define child-stage counters, re-plan reset behavior, and whether post-parallel review is one combined review or N per-child reviews. I recommend one review stage over a parent `patch_set` manifest for v1; per-child review can wait for v2/v3.

### A.F4 (plan-roadmap consistency FALSE-POSITIVE) — agree
**A's original**: v1 scope matches static fan-out, ready queue, concurrency cap, and defers dynamic fan-out.
**My reaction**: Agree.
**Reason**: This is not roadmap overreach. My B.F1 fan-in concern should be framed narrowly: v1 still needs a minimal artifact aggregation contract so verify can read all child patches. That is not "fan-in + partial recovery"; it is the parent implement stage producing a `patch_set` manifest.

### A.F5 (R6 boundary OK) — refine
**A's original**: scheduler and runner can stay R6-clean if all side effects remain injected.
**My reaction**: Agree with the direction, refine the contract.
**Reason**: The cancellation path in A.F7 means scheduler should emit scheduling/cancel intents only. Process signaling belongs to the injected executor/agent layer. Also, runner docs must stop saying "run a single stage" without explaining parent fan-out semantics.

### A.F6 (R11 unaffected FALSE-POSITIVE) — agree
**A's original**: parallel sub-stages do not introduce memory trust-tier mixing.
**My reaction**: Agree.
**Reason**: Each sub-stage retrieval is still tier-explicit. I do not see a new R11 issue unless a future optimization shares retrieved memory across children without preserving tier metadata, which v1 does not propose.

### A.F7 (Pilot-9c sibling cancel) — refine
**A's original**: Phase 9c must define cancelled-vs-orphaned sibling behavior, ideally SIGTERM then SIGKILL.
**My reaction**: Agree it is important, refine where the requirement lives.
**Reason**: The dogfood gate needs observable timing, but the mechanism should be stated as executor contract, not core scheduler behavior. Suggested wording: parent failure emits cancel intents immediately; executor sends SIGTERM to in-flight child processes within 10s, SIGKILL after 5s if still alive, and records sibling stage_runs as `cancelled`.

### A.F8 (ADR-lite Non-decisions) — refine
**A's original**: Add Non-decisions and promotion gate to ADR-lite.
**My reaction**: Agree, but be careful not to defer v1-critical choices.
**Reason**: Non-decisions should defer dynamic fan-out, partial recovery, distributed execution, and cross-stage parallelism. It should not defer "post-parallel review verdict shape" or "verify input shape", because v1 cannot run Pilot-09 without those.

## Self-revision of my Phase 1 verdict

- B.F1 (verify fan-in conflict): keep, refine wording. It is not v2 fan-in if v1 adds a parent `patch_set` manifest and no partial recovery.
- B.F2 (schema discriminated union): keep, strengthened by A.F1. Prefer explicit `fanOutRole` plus validation over loose optional fields.
- B.F3 (version route): keep. A did not cover this, and it remains a real protocol-release issue.
- B.F4 (M5 composition): keep, strengthened by A.F3. Proposal needs a worked example and review verdict shape.
- B.F5 (concurrency=4 evidence): keep as minor. A's own risk notes support softening the SmartBear claim.
- B.F6 (`withStateLock` boundary): keep. It composes with A.F5/A.F7: v1 should say single runner process owns child scheduling; cross-process lock is out of scope or fail-closed.

## New findings (after seeing A's lens)

1. **Validator failure must be a terminal plan error in v1**: write this into CLI behavior. No automatic plan retry loop.
2. **`patch_set` manifest should become a named v1 artifact**: parent implement succeeds only after all children succeed and writes the manifest; verify depends on parent, not on `predecessorIds[]`.
3. **ADR Non-decisions need a "not deferred" list too**: v1 must decide schema role, verify input, review verdict shape, cancellation contract, and version bump before implementation.
```

