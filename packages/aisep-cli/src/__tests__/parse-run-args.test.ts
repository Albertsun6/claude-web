// parseRunArgs unit tests — focused on --claude-timeout-ms (Pilot-10 finding F2)
// and existing flag surface (light coverage; runner-fanout.test.ts covers
// the runner-side semantics).

import { describe, expect, it, vi } from "vitest";

import { parseRunArgs } from "../commands/run.js";

describe("parseRunArgs --claude-timeout-ms (F2)", () => {
  it("accepts a valid timeout in the [60000, 1800000] ms range", () => {
    const args = parseRunArgs(["--workspace", "/tmp/x", "--real", "--claude-timeout-ms", "600000"]);
    expect(args).toBeDefined();
    expect(args!.claudeTimeoutMs).toBe(600000);
  });

  it("accepts the lower bound (60000)", () => {
    const args = parseRunArgs(["--real", "--claude-timeout-ms", "60000"]);
    expect(args!.claudeTimeoutMs).toBe(60000);
  });

  it("accepts the upper bound (1800000)", () => {
    const args = parseRunArgs(["--real", "--claude-timeout-ms", "1800000"]);
    expect(args!.claudeTimeoutMs).toBe(1800000);
  });

  it("rejects values below 60000 ms", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const args = parseRunArgs(["--real", "--claude-timeout-ms", "30000"]);
    expect(args).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("--claude-timeout-ms must be in"));
    spy.mockRestore();
  });

  it("rejects values above 1800000 ms", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const args = parseRunArgs(["--real", "--claude-timeout-ms", "3600000"]);
    expect(args).toBeUndefined();
    spy.mockRestore();
  });

  it("rejects non-numeric values", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const args = parseRunArgs(["--real", "--claude-timeout-ms", "ten-minutes"]);
    expect(args).toBeUndefined();
    spy.mockRestore();
  });

  it("leaves claudeTimeoutMs undefined when flag is not passed", () => {
    const args = parseRunArgs(["--real", "--workspace", "/tmp/x"]);
    expect(args!.claudeTimeoutMs).toBeUndefined();
  });
});

describe("parseRunArgs --retry-child / --bump-timeout (ADR-022 Decision 4)", () => {
  it("accepts --retry-child <id> and sets retryChild", () => {
    const args = parseRunArgs(["--dry", "--retry-child", "sr-01HJK5XH0CHILD0BE"]);
    expect(args).toBeDefined();
    expect(args!.retryChild).toBe("sr-01HJK5XH0CHILD0BE");
    expect(args!.bumpTimeout).toBeUndefined();
  });

  it("accepts --retry-child + --bump-timeout combined", () => {
    const args = parseRunArgs([
      "--dry",
      "--retry-child",
      "sr-X",
      "--bump-timeout",
    ]);
    expect(args!.retryChild).toBe("sr-X");
    expect(args!.bumpTimeout).toBe(true);
  });

  it("rejects --bump-timeout WITHOUT --retry-child", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const args = parseRunArgs(["--dry", "--bump-timeout"]);
    expect(args).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("--bump-timeout requires --retry-child"),
    );
    spy.mockRestore();
  });

  it("rejects --retry-child without an id value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const args = parseRunArgs(["--dry", "--retry-child"]);
    expect(args).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("--retry-child requires a stage_run id"),
    );
    spy.mockRestore();
  });
});
