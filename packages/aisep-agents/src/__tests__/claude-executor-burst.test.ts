// F6 (2026-05-13): burst-limit detection unit tests.
//
// The retry-loop *behavior* (3 attempts × backoff, abort-aware) is harder
// to unit-test without mocking child_process.spawn; we cover the pure
// detection helper here and rely on the live dogfood (Pilot-10/11) for
// end-to-end retry behavior.

import { describe, expect, it } from "vitest";

import { isBurstLimitError } from "../claude-executor.js";

describe("isBurstLimitError (F6)", () => {
  it("matches anthropics/claude-code#53922 wording", () => {
    expect(
      isBurstLimitError(
        "Server is temporarily limiting requests (not your usage limit) · Rate limited",
      ),
    ).toBe(true);
  });

  it("matches case-insensitive 'rate limited' as a standalone phrase", () => {
    expect(isBurstLimitError("Error: Rate limited; retry later")).toBe(true);
    expect(isBurstLimitError("RATE LIMITED")).toBe(true);
    expect(isBurstLimitError("rate limited")).toBe(true);
  });

  it("matches HTTP 429 status code", () => {
    expect(isBurstLimitError("HTTP 429 Too Many Requests")).toBe(true);
    expect(isBurstLimitError("status: 429")).toBe(true);
  });

  it("matches 'temporarily limiting requests' substring", () => {
    expect(
      isBurstLimitError(
        "Some prefix: server is TEMPORARILY LIMITING REQUESTS now",
      ),
    ).toBe(true);
  });

  it("does NOT match unrelated errors", () => {
    expect(isBurstLimitError("")).toBe(false);
    expect(isBurstLimitError("syntax error at line 42")).toBe(false);
    expect(isBurstLimitError("ENOENT: no such file or directory")).toBe(false);
    expect(isBurstLimitError("Connection refused")).toBe(false);
    expect(isBurstLimitError("model refused to answer")).toBe(false);
  });

  it("does NOT match 'rate' or 'limited' in unrelated context", () => {
    // Must be the bound phrase "rate limited" together, not "rate" alone or
    // "limited" alone — otherwise we'd retry on every "rate of change" or
    // "limited support" message.
    expect(isBurstLimitError("the rate of progress is slow")).toBe(false);
    expect(isBurstLimitError("limited disk space")).toBe(false);
  });

  it("does NOT match 4290 or 4291 (similar numbers, not 429)", () => {
    // \b word boundary should prevent 4290 / 14290 / etc. from matching.
    expect(isBurstLimitError("error code 4290")).toBe(false);
    expect(isBurstLimitError("error 14290")).toBe(false);
    // But '429' as bound number still matches:
    expect(isBurstLimitError("error 429 detail")).toBe(true);
  });
});
