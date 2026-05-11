import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NodeWorkspace } from "../node-workspace.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "aisep-ws-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function makeWorkspace(): NodeWorkspace {
  return new NodeWorkspace(cwd, {
    id: "ws-test",
    name: "test",
    cwd,
    status: "active",
    techStack: [],
    createdAt: Date.now(),
    shipCount: 0,
    adoptedPatterns: [],
  });
}

describe("NodeWorkspace", () => {
  it("writeFile + readFile round-trips", async () => {
    const ws = makeWorkspace();
    await ws.writeFile("hello.txt", "world");
    expect(await ws.readFile("hello.txt")).toBe("world");
    expect(readFileSync(join(cwd, "hello.txt"), "utf-8")).toBe("world");
  });

  it("writeFile creates intermediate directories", async () => {
    const ws = makeWorkspace();
    await ws.writeFile("nested/deep/file.json", "{}");
    expect(await ws.readFile("nested/deep/file.json")).toBe("{}");
  });

  it("listDir returns entries", async () => {
    const ws = makeWorkspace();
    await ws.writeFile("a.txt", "1");
    await ws.writeFile("b.txt", "2");
    const entries = (await ws.listDir(".")).sort();
    expect(entries).toEqual(["a.txt", "b.txt"]);
  });

  it("exec returns stdout/exitCode on success", async () => {
    const ws = makeWorkspace();
    const result = await ws.exec("echo hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.timedOut).toBe(false);
  });

  it("exec respects timeoutMs and sets timedOut=true (R11 contract)", async () => {
    const ws = makeWorkspace();
    const result = await ws.exec("sleep 5", { timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
    // Natural exit code on SIGTERM/SIGKILL varies by shell; we don't assert on it.
  });

  it("exec on natural exit has timedOut=false even with non-zero exitCode", async () => {
    const ws = makeWorkspace();
    const result = await ws.exec("exit 42");
    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });
});
