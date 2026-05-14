import { describe, expect, it } from "vitest";

import {
  assertTransition,
  canTransition,
  IllegalStateTransitionError,
  isTerminal,
} from "../state-machine.js";

describe("state-machine: status transitions", () => {
  it("pending → running is allowed", () => {
    expect(canTransition("pending", "running")).toBe(true);
  });

  it("pending → succeeded is rejected (must go through running)", () => {
    expect(canTransition("pending", "succeeded")).toBe(false);
  });

  it("running → succeeded is allowed", () => {
    expect(canTransition("running", "succeeded")).toBe(true);
  });

  it("running → pending is rejected (no backwards)", () => {
    expect(canTransition("running", "pending")).toBe(false);
  });

  it("succeeded is terminal — cannot transition out", () => {
    expect(canTransition("succeeded", "running")).toBe(false);
    expect(canTransition("succeeded", "failed")).toBe(false);
    expect(canTransition("succeeded", "cancelled")).toBe(false);
  });

  it("failed is terminal", () => {
    expect(isTerminal("failed")).toBe(true);
    expect(canTransition("failed", "running")).toBe(false);
  });

  it("pending can be skipped or cancelled directly", () => {
    expect(canTransition("pending", "skipped")).toBe(true);
    expect(canTransition("pending", "cancelled")).toBe(true);
  });

  it("assertTransition throws IllegalStateTransitionError on bad transition", () => {
    expect(() => assertTransition("pending", "succeeded")).toThrow(IllegalStateTransitionError);
  });
});

describe("state-machine: retry-child marker (ADR-022 Decision 4)", () => {
  it("failed → running is allowed WITH retryChild marker", () => {
    expect(canTransition("failed", "running", { retryChild: true })).toBe(true);
  });

  it("failed → running is rejected WITHOUT retryChild marker (default)", () => {
    expect(canTransition("failed", "running")).toBe(false);
    expect(canTransition("failed", "running", {})).toBe(false);
    expect(canTransition("failed", "running", { retryChild: false })).toBe(false);
  });

  it("retryChild marker does NOT widen other terminal transitions", () => {
    // succeeded/cancelled/skipped stay terminal regardless of marker.
    expect(canTransition("succeeded", "running", { retryChild: true })).toBe(false);
    expect(canTransition("cancelled", "running", { retryChild: true })).toBe(false);
    expect(canTransition("skipped", "running", { retryChild: true })).toBe(false);
    // failed → succeeded (skip the retry) also stays rejected.
    expect(canTransition("failed", "succeeded", { retryChild: true })).toBe(false);
  });

  it("assertTransition with retryChild marker does NOT throw for failed → running", () => {
    expect(() => assertTransition("failed", "running", { retryChild: true })).not.toThrow();
  });

  it("assertTransition still throws for retryChild marker on other illegal transitions", () => {
    expect(() => assertTransition("succeeded", "running", { retryChild: true })).toThrow(
      IllegalStateTransitionError,
    );
  });
});
