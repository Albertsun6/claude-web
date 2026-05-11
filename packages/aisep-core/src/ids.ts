// ULID-like ID generator. ULIDs are timestamp-sortable, but for v0 we use
// a simpler approach: `<prefix>-<timestampBase36>-<randomBase36>`. Deterministic
// tests can inject a clock.

import { randomBytes } from "node:crypto";

export interface IdClock {
  now(): number;
  random(bytes: number): Uint8Array;
}

const realClock: IdClock = {
  now: () => Date.now(),
  random: (bytes: number) => randomBytes(bytes),
};

export function generateId(prefix: string, clock: IdClock = realClock): string {
  const ts = clock.now().toString(36);
  const rand = Array.from(clock.random(8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}-${ts}${rand}`;
}

/** Convenience generators for common entities. */
export const ids = {
  workspace: (clock?: IdClock) => generateId("ws", clock),
  stageRun: (clock?: IdClock) => generateId("sr", clock),
  artifact: (clock?: IdClock) => generateId("art", clock),
  attempt: (clock?: IdClock) => generateId("att", clock),
  memoryRecord: (clock?: IdClock) => generateId("mr", clock),
  reviewVerdict: (clock?: IdClock) => generateId("rv", clock),
};
