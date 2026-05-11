// Conventional paths for AlphaEvolve memory storage.
//
// Workspace layer: <cwd>/.aisep/evolution_log.json (per project, pending only)
// Global layer:    ~/.aisep/governance-log/evolution_log.json (cross-project, verified)
//
// R10 red line: ~/.aisep/ MUST NOT be committed to any vessel git repo.
// R11 red line: workspace layer ≠ global layer; they are separate files with
// separate trust levels (workspace = pending, possibly noisy; global = verified).

import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

export function workspaceLogPath(workspaceCwd: string): string {
  return join(resolvePath(workspaceCwd), ".aisep", "evolution_log.json");
}

export function defaultGlobalLogPath(): string {
  return join(homedir(), ".aisep", "governance-log", "evolution_log.json");
}
