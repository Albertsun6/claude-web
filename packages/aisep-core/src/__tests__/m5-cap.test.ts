// Phase 2.E #1 — M5 ping-pong cap unit tests.
//
// Verifies: counter accumulates revise_required + request_reverify across
// the same stageRunId verdict list; pass / pass_with_comments do NOT
// count; cap exceeded at exactly threshold (2).

import { describe, expect, it } from "vitest";

import {
  checkM5Cap,
  isM5BlockingVerdict,
  M5_CAP_THRESHOLD,
} from "../m5-cap.js";

describe("M5 ping-pong cap (Phase 2.E #1)", () => {
  it("threshold is 2 (methodology L343)", () => {
    expect(M5_CAP_THRESHOLD).toBe(2);
  });

  it("empty verdict list → not exceeded", () => {
    const r = checkM5Cap([]);
    expect(r.blockedCount).toBe(0);
    expect(r.capExceeded).toBe(false);
    expect(r.blockingVerdicts).toEqual([]);
  });

  it("only pass verdicts → not exceeded", () => {
    const r = checkM5Cap(["pass", "pass", "pass_with_comments"]);
    expect(r.blockedCount).toBe(0);
    expect(r.capExceeded).toBe(false);
  });

  it("1 revise_required → not exceeded (counter = 1 < 2)", () => {
    const r = checkM5Cap(["pass", "revise_required"]);
    expect(r.blockedCount).toBe(1);
    expect(r.capExceeded).toBe(false);
    expect(r.blockingVerdicts).toEqual(["revise_required"]);
  });

  it("2 revise_required → exceeded (counter = 2 >= 2, cut scope)", () => {
    const r = checkM5Cap(["revise_required", "revise_required"]);
    expect(r.blockedCount).toBe(2);
    expect(r.capExceeded).toBe(true);
  });

  it("1 revise_required + 1 request_reverify → exceeded (widened counter — v0.2 §Change 6)", () => {
    const r = checkM5Cap(["revise_required", "request_reverify"]);
    expect(r.blockedCount).toBe(2);
    expect(r.capExceeded).toBe(true);
    expect(r.blockingVerdicts).toEqual(["revise_required", "request_reverify"]);
  });

  it("2 request_reverify → exceeded (widened counter)", () => {
    const r = checkM5Cap(["request_reverify", "request_reverify"]);
    expect(r.blockedCount).toBe(2);
    expect(r.capExceeded).toBe(true);
  });

  it("3 blocking interleaved with pass → exceeded, count=3", () => {
    const r = checkM5Cap([
      "revise_required",
      "pass_with_comments",
      "request_reverify",
      "pass",
      "revise_required",
    ]);
    expect(r.blockedCount).toBe(3);
    expect(r.capExceeded).toBe(true);
    expect(r.blockingVerdicts).toEqual([
      "revise_required",
      "request_reverify",
      "revise_required",
    ]);
  });

  it("isM5BlockingVerdict type guard", () => {
    expect(isM5BlockingVerdict("revise_required")).toBe(true);
    expect(isM5BlockingVerdict("request_reverify")).toBe(true);
    expect(isM5BlockingVerdict("pass")).toBe(false);
    expect(isM5BlockingVerdict("pass_with_comments")).toBe(false);
  });
});
