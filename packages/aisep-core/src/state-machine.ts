// Stage-run status state machine.
// M1 invariant from aisep-protocol: pending → running → {succeeded | failed | cancelled | skipped}

import type { AisepStageStatus } from "@claude-web/aisep-protocol";

/**
 * Allowed transitions per source status. Empty arrays mean terminal.
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

export function canTransition(from: AisepStageStatus, to: AisepStageStatus): boolean {
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

export function assertTransition(from: AisepStageStatus, to: AisepStageStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalStateTransitionError(from, to);
  }
}
