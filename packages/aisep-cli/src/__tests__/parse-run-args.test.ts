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
