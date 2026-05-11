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
