// NodeWorkspace — reference implementation of AisepWorkspace for Node.js.
//
// R6 boundary: this is the ONLY package allowed to perform fs / process /
// network side effects inside the aisep-* cluster. aisep-core's runner
// receives this as an injected dependency, never imports node fs directly.
//
// Implementation contract for `exec` (per aisep-protocol JSDoc):
// - timedOut = true iff the kill was triggered by opts.timeoutMs
// - timedOut = false for any natural exit (regardless of exit code)

import { spawn } from "node:child_process";
import {
  mkdir,
  readFile as fsReadFile,
  readdir,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";

import type {
  AisepExecOptions,
  AisepExecResult,
  AisepWorkspace,
  AisepWorkspaceMeta,
} from "@claude-web/aisep-protocol";

const KILL_GRACE_MS = 5_000;

export class NodeWorkspace implements AisepWorkspace {
  constructor(
    public readonly cwd: string,
    public readonly meta: AisepWorkspaceMeta,
  ) {}

  async readFile(path: string): Promise<string> {
    return fsReadFile(this.resolve(path), "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const abs = this.resolve(path);
    await mkdir(dirname(abs), { recursive: true });
    await fsWriteFile(abs, content, "utf-8");
  }

  async listDir(path: string): Promise<string[]> {
    return readdir(this.resolve(path));
  }

  async exec(cmd: string, opts: AisepExecOptions = {}): Promise<AisepExecResult> {
    const effectiveCwd = opts.cwd ? resolvePath(this.cwd, opts.cwd) : this.cwd;
    const startedAt = Date.now();
    let timedOut = false;

    return new Promise<AisepExecResult>((resolve) => {
      const child = spawn(cmd, {
        shell: true,
        cwd: effectiveCwd,
        env: { ...process.env, ...(opts.env ?? {}) },
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      let timeoutHandle: NodeJS.Timeout | undefined;
      let killGraceHandle: NodeJS.Timeout | undefined;

      if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          killGraceHandle = setTimeout(() => {
            child.kill("SIGKILL");
          }, KILL_GRACE_MS);
        }, opts.timeoutMs);
      }

      const finalize = (exitCode: number) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (killGraceHandle) clearTimeout(killGraceHandle);
        resolve({
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      };

      child.on("close", (code) => finalize(code ?? -1));
      child.on("error", (err) => {
        stderr += `\n${(err as Error).message}`;
        finalize(-1);
      });
    });
  }

  private resolve(relative: string): string {
    return join(this.cwd, relative);
  }
}
