// Stage-run status state machine.
// M1 invariant from aisep-protocol: pending → running → {succeeded | failed | cancelled | skipped}
//
// v0.4 (ADR-022 Decision 4): caller-marker amendment — `assertTransition`
// accepts an optional `{ retryChild: true }` marker that permits
// `failed → running` for the named call. All non-retry callers retain
// the strict terminal-status invariant. The retry-marker is forensic
// (always appends a new attempt log entry per Q5) and is the ONLY
// authorized path for re-entering `running` from a terminal status.

import type { AisepStageStatus } from "@vessel/aisep-protocol";

/**
 * Allowed transitions per source status. Empty arrays mean terminal.
 * (Strict baseline; the retry-marker amendment widens this for one
 * specific source→target only.)
 */
const VALID_TRANSITIONS: Record<AisepStageStatus, readonly AisepStageStatus[]> = {
  pending: ["running", "cancelled", "skipped"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
  skipped: [],
};

const TERMINAL: ReadonlySet<AisepStageStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);

export function isTerminal(status: AisepStageStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * v0.4 (ADR-022 Decision 4): optional caller marker. Pass
 * `{ retryChild: true }` to authorize the single retry-specific
 * transition `failed → running`. No other relaxations are exposed; the
 * marker is forensic-only and the caller (runner.runRetryChild) is
 * responsible for also acquiring the workspace lock + verifying parent
 * status terminal per Q5.
 */
export interface TransitionMarker {
  /** Authorizes `failed → running` for a single call. Defaults to false. */
  retryChild?: boolean;
}

export function canTransition(
  from: AisepStageStatus,
  to: AisepStageStatus,
  marker: TransitionMarker = {},
): boolean {
  if (marker.retryChild === true && from === "failed" && to === "running") {
    return true;
  }
  return VALID_TRANSITIONS[from].includes(to);
}

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly from: AisepStageStatus,
    public readonly to: AisepStageStatus,
  ) {
    super(`Illegal stage_run status transition: ${from} → ${to}`);
    this.name = "IllegalStateTransitionError";
  }
}

export function assertTransition(
  from: AisepStageStatus,
  to: AisepStageStatus,
  marker: TransitionMarker = {},
): void {
  if (!canTransition(from, to, marker)) {
    throw new IllegalStateTransitionError(from, to);
  }
}
