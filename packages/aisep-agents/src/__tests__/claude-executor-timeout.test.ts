// F3 (Phase 2.F, 2026-05-13): SIGTERM timeout retry decision unit tests.
//
// The retry-loop *behavior* (replay spawnClaude with bumped timeoutMs)
// is harder to unit-test without mocking child_process.spawn; we cover
// the pure decision function `nextTimeoutRetry` here and rely on live
// dogfood (Pilot-11+) for end-to-end retry behavior — same pattern as
// F6 burst-limit tests.

import { describe, expect, it } from "vitest";

import { nextTimeoutRetry } from "../claude-executor.js";

describe("nextTimeoutRetry (F3)", () => {
  it("returns 1.5× bumped timeout on first retry from default 10min", () => {
    // 10min = 600,000ms → 1.5× = 900,000ms (15min)
    expect(nextTimeoutRetry(600_000, 0)).toEqual({ nextTimeoutMs: 900_000 });
  });

  it("returns null on second retry (single-retry policy)", () => {
    expect(nextTimeoutRetry(600_000, 1)).toBeNull();
    expect(nextTimeoutRetry(900_000, 1)).toBeNull();
    expect(nextTimeoutRetry(1_200_000, 5)).toBeNull();
  });

  it("respects the 30min hard ceiling (matches CLI --claude-timeout-ms upper bound)", () => {
    // 20min × 1.5 = 30min, exactly at ceiling → allowed
    expect(nextTimeoutRetry(20 * 60 * 1000, 0)).toEqual({
      nextTimeoutMs: 30 * 60 * 1000,
    });
    // 21min × 1.5 = 31.5min, over ceiling → null
    expect(nextTimeoutRetry(21 * 60 * 1000, 0)).toBeNull();
  });

  it("handles the F1 default (10min) → F3 retry (15min) end-to-end path", () => {
    // Default 10min times out → F3 bumps to 15min → also times out → no more retry
    const first = nextTimeoutRetry(10 * 60 * 1000, 0);
    expect(first).toEqual({ nextTimeoutMs: 15 * 60 * 1000 });
    const second = nextTimeoutRetry(first!.nextTimeoutMs, 1);
    expect(second).toBeNull();
  });

  it("handles CLI-flag-raised timeoutMs (e.g. user set 15min)", () => {
    // User runs with --claude-timeout-ms 900000 → F3 bumps to 22.5min (still under 30min)
    expect(nextTimeoutRetry(15 * 60 * 1000, 0)).toEqual({
      nextTimeoutMs: 22 * 60 * 1000 + 30 * 1000,
    });
  });

  it("floors fractional ms (deterministic integer result)", () => {
    // 7min × 1.5 = 10.5min → floor → 630,000ms exact
    expect(nextTimeoutRetry(7 * 60 * 1000, 0)).toEqual({
      nextTimeoutMs: 630_000,
    });
    // 1000 × 1.5 = 1500 (already integer)
    expect(nextTimeoutRetry(1000, 0)).toEqual({ nextTimeoutMs: 1500 });
    // odd number: 1001 × 1.5 = 1501.5 → floor → 1501
    expect(nextTimeoutRetry(1001, 0)).toEqual({ nextTimeoutMs: 1501 });
  });

  it("rejects when even the first bump exceeds ceiling (close-to-ceiling start)", () => {
    // 25min × 1.5 = 37.5min > 30min → null on retriedCount=0
    expect(nextTimeoutRetry(25 * 60 * 1000, 0)).toBeNull();
  });
});
