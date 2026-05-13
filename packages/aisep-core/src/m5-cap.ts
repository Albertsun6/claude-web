// M5 ping-pong cap check (Phase 2.E #1 baseline, methodology L343).
//
// aisep-protocol v0.2 widened M5 counter set from `revise_required` only
// to `revise_required` ∪ `request_reverify` — see proposal §Change 6.
// This module implements the counter check as a pure function so the
// runner / future cycle scheduler can wire it without coupling to
// AisepStore internals or fs.
//
// R6 boundary: zero fs / spawn / net. Pure function on the verdict
// list provided by the caller (typically derived from
// `store.listAttemptsByStageRun(stageRunId)` + artifact parse, done in
// the CLI / runner layer).
//
// v0 caveat: `aisep run` is currently single-pass per stage_run — the
// counter never accumulates under normal CLI use because each stage
// gets a fresh stageRunId. M5 enforcement is **future-ready** for the
// v3 review→implement cycle (Phase 2.E #2). Until then, `checkM5Cap`
// is exercised only via unit tests; runner.runStage does NOT call it
// (avoids regression risk on the single-pass path).

import type { AisepReviewVerdictKind } from "@vessel/aisep-protocol";

/** M5 cap threshold — 2 blocking verdicts per stageRunId is the limit. */
export const M5_CAP_THRESHOLD = 2;

/** Subset of AisepReviewVerdictKind that counts toward M5. */
export type M5BlockingVerdict = "revise_required" | "request_reverify";

/** Type guard for verdicts that count toward the M5 counter. */
export function isM5BlockingVerdict(v: AisepReviewVerdictKind): v is M5BlockingVerdict {
  return v === "revise_required" || v === "request_reverify";
}

export interface M5CheckResult {
  /** Count of `revise_required` ∪ `request_reverify` in the input list. */
  blockedCount: number;
  /** True iff blockedCount >= M5_CAP_THRESHOLD. */
  capExceeded: boolean;
  /** The blocking verdicts in input order (for audit / error message). */
  blockingVerdicts: M5BlockingVerdict[];
}

/**
 * Check whether the M5 ping-pong cap is exceeded for a given stage_run.
 *
 * Caller responsibility: pass ONLY verdicts on a single `stageRunId`
 * (M5 is keyed on `stageRunId`). Don't mix verdicts across stage_runs.
 *
 * Caller responsibility: derive the verdict list from review_verdict
 * artifacts via the protocol schema. Example:
 *
 * ```typescript
 * const artifacts = store.listArtifactsByStageRun(stageRunId);
 * const reviewArtifacts = artifacts.filter(a => a.ref.kind === "review_verdict");
 * const verdicts: AisepReviewVerdictKind[] = [];
 * for (const a of reviewArtifacts) {
 *   const content = a.storage === "inline" ? a.contentInline : await workspace.readFile(a.contentUri);
 *   const parsed = AisepReviewVerdictSchema.parse(JSON.parse(content));
 *   verdicts.push(parsed.verdict);
 * }
 * const m5 = checkM5Cap(verdicts);
 * if (m5.capExceeded) { ...refuse new attempt, cut scope... }
 * ```
 *
 * Returns the count + verdict list + whether cap exceeded. Pure.
 */
export function checkM5Cap(priorVerdicts: AisepReviewVerdictKind[]): M5CheckResult {
  const blockingVerdicts = priorVerdicts.filter(isM5BlockingVerdict);
  return {
    blockedCount: blockingVerdicts.length,
    capExceeded: blockingVerdicts.length >= M5_CAP_THRESHOLD,
    blockingVerdicts,
  };
}
