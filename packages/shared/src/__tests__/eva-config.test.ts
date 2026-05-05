// eva.json schema validation tests.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseEvaConfig,
  summarizeEvaConfig,
  EvaConfigSchema,
  EvaWorktreeEntrySchema,
} from "../eva-config.js";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const EVA_JSON_PATH = path.resolve(REPO_ROOT, "eva.json");

describe("eva-config schema", () => {
  it("parses minimal valid config", () => {
    const cfg = parseEvaConfig({ version: 1, worktrees: [] });
    expect(cfg.worktrees).toHaveLength(0);
  });

  it("rejects missing version", () => {
    expect(() => parseEvaConfig({ worktrees: [] })).toThrow();
  });

  it("rejects version != 1", () => {
    expect(() => parseEvaConfig({ version: 2, worktrees: [] })).toThrow();
  });

  it("parses full worktree entry with all fields", () => {
    const cfg = parseEvaConfig({
      version: 1,
      worktrees: [
        {
          name: "M1-test",
          branch: "feat/eva-M1-test",
          path: "~/Desktop/claude-web-test",
          port: 3033,
          dataDir: "~/.claude-web-test",
          owns: ["packages/backend/src/foo.ts", "packages/backend/src/bar.ts#section"],
          status: "active",
          since: "2026-05-05T16:00:00Z",
          note: "test entry",
        },
      ],
    });
    expect(cfg.worktrees[0].port).toBe(3033);
    expect(cfg.worktrees[0].owns).toHaveLength(2);
  });

  it("defaults owns to [] when omitted", () => {
    const entry = EvaWorktreeEntrySchema.parse({
      name: "minimal",
      branch: "feat/minimal",
      path: "~/path",
      status: "done",
    });
    expect(entry.owns).toEqual([]);
  });

  it("rejects invalid status enum", () => {
    expect(() =>
      parseEvaConfig({
        version: 1,
        worktrees: [
          {
            name: "x",
            branch: "feat/x",
            path: "~/x",
            status: "pending", // invalid — only active/done/released
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects port outside valid range", () => {
    expect(() =>
      parseEvaConfig({
        version: 1,
        worktrees: [
          {
            name: "x",
            branch: "feat/x",
            path: "~/x",
            port: 100, // < 1024
            status: "active",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseEvaConfig({
        version: 1,
        worktrees: [
          {
            name: "x",
            branch: "feat/x",
            path: "~/x",
            port: 99999, // > 65535
            status: "active",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects bad since datetime (cross M4)", () => {
    expect(() =>
      parseEvaConfig({
        version: 1,
        worktrees: [
          {
            name: "x", branch: "feat/x", path: "~/x", status: "done",
            since: "2026-05-05 12:00", // missing T + Z
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts ISO 8601 since with Z or offset", () => {
    parseEvaConfig({
      version: 1,
      worktrees: [
        { name: "a", branch: "feat/a", path: "~/a", status: "done", since: "2026-05-05T16:00:00Z" },
        { name: "b", branch: "feat/b", path: "~/b", status: "done", since: "2026-05-05T16:00:00+08:00" },
      ],
    });
  });

  it("rejects owns with '..' (cross M3)", () => {
    expect(() =>
      parseEvaConfig({
        version: 1,
        worktrees: [
          {
            name: "x", branch: "feat/x", path: "~/x", status: "active",
            owns: ["../../etc/passwd"],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects owns starting with / (cross M3)", () => {
    expect(() =>
      parseEvaConfig({
        version: 1,
        worktrees: [
          {
            name: "x", branch: "feat/x", path: "~/x", status: "active",
            owns: ["/Users/foo/bar.ts"],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects owns with multiple #", () => {
    expect(() =>
      parseEvaConfig({
        version: 1,
        worktrees: [
          {
            name: "x", branch: "feat/x", path: "~/x", status: "active",
            owns: ["foo.ts#bar#baz"],
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts owns: path or path#symbol", () => {
    parseEvaConfig({
      version: 1,
      worktrees: [
        {
          name: "x", branch: "feat/x", path: "~/x", status: "active",
          owns: [
            "packages/backend/src/foo.ts",
            "packages/backend/src/foo.ts#computeNextStage",
            "packages/shared/fixtures/harness/fallback-config.json#agentProfiles",
          ],
        },
      ],
    });
  });

  it("rejects active worktrees colliding on branch (cross M2)", () => {
    expect(() =>
      parseEvaConfig({
        version: 1,
        worktrees: [
          { name: "a", branch: "feat/same", path: "~/a", status: "active" },
          { name: "b", branch: "feat/same", path: "~/b", status: "active" },
        ],
      }),
    ).toThrow();
  });

  it("rejects active worktrees colliding on port (cross M2)", () => {
    expect(() =>
      parseEvaConfig({
        version: 1,
        worktrees: [
          { name: "a", branch: "feat/a", path: "~/a", port: 3032, status: "active" },
          { name: "b", branch: "feat/b", path: "~/b", port: 3032, status: "active" },
        ],
      }),
    ).toThrow();
  });

  it("allows done/released worktrees to share name/port (history archive)", () => {
    parseEvaConfig({
      version: 1,
      worktrees: [
        { name: "a", branch: "feat/a1", path: "~/a", port: 3032, status: "done" },
        { name: "a", branch: "feat/a2", path: "~/a", port: 3032, status: "done" },
      ],
    });
  });

  it("summarizeEvaConfig counts by status", () => {
    const cfg = parseEvaConfig({
      version: 1,
      worktrees: [
        { name: "a", branch: "feat/a", path: "~/a", status: "active" },
        { name: "b", branch: "feat/b", path: "~/b", status: "done" },
        { name: "c", branch: "feat/c", path: "~/c", status: "done" },
        { name: "d", branch: "feat/d", path: "~/d", status: "released" },
      ],
    });
    const sum = summarizeEvaConfig(cfg);
    expect(sum).toEqual({ active: 1, done: 2, released: 1, total: 4 });
  });
});

describe("eva-config repo file (eva.json)", () => {
  it("repo eva.json parses against schema", () => {
    const raw = JSON.parse(readFileSync(EVA_JSON_PATH, "utf-8"));
    const cfg = parseEvaConfig(raw);
    expect(cfg.version).toBe(1);
    expect(cfg.worktrees).toBeInstanceOf(Array);
  });
});
