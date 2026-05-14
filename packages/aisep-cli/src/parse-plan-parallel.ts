// v0.3 v1 fan-out Stage 2.cli-C — parse `parallel:` YAML block from plan.md.
//
// plan.hbs §7 lets the planner emit an OPTIONAL block:
//
//     ```yaml
//     parallel:
//       - id: T-impl-a
//         name: backend
//         affects: ^packages/backend/
//       - id: T-impl-b
//         name: frontend
//         affects: ^packages/frontend/
//     ```
//
// This module locates that block in the plan stage output and returns the
// validated entry list, OR undefined if no block found, OR throws on
// malformed YAML / invalid entries.
//
// Pure function (R6-clean): string in → parsed list out. Caller
// (aisep-cli/run.ts) handles fs read.

import yaml from "js-yaml";

export interface PlanParallelEntry {
  id: string;
  name: string;
  /**
   * v0.4 (ADR-022 Decision 2): regex patterns declaring which paths the
   * child plans to touch. Accepts string or string[] in plan.md YAML; the
   * parser normalizes to string[] internally. v0.4 protocol requires
   * non-empty array on the resulting AisepStageRun.
   */
  affects: string[];
}

const SUB_NAME_RE = /^[A-Za-z0-9_.:-]+$/;
const MIN_ENTRIES = 2;
const MAX_ENTRIES = 4; // plan-roadmap concurrency cap

/**
 * Locate and parse the `parallel:` block from plan stage output.
 *
 * Behavior:
 * - returns `undefined` if the input has no recognizable `parallel:` block
 *   (plan didn't declare fan-out — caller falls back to single
 *   `runStage`)
 * - returns the parsed entry list on success (`length` in [MIN,MAX])
 * - throws Error on any of:
 *    - malformed YAML
 *    - entries missing required fields (id / name / affects)
 *    - name not matching `^[A-Za-z0-9_.:-]+$` (shell-safe per RISK-Q4-c)
 *    - duplicate names within the block
 *    - entries.length < 2 (a 1-entry parallel isn't a fan-out)
 *    - entries.length > 4 (plan-roadmap hard ceiling)
 *
 * Caller responsibility: feed entire plan.md string; this function
 * scans for the first YAML fenced block containing `parallel:` at top
 * level.
 */
export function parsePlanParallel(
  planMd: string,
): PlanParallelEntry[] | undefined {
  // Scan all ```yaml ... ``` fenced blocks.
  const fenceRe = /```(?:yaml|yml)\s*\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(planMd)) !== null) {
    const body = match[1]!;
    if (!/^\s*parallel\s*:/m.test(body)) continue;

    let parsed: unknown;
    try {
      parsed = yaml.load(body);
    } catch (e) {
      throw new Error(
        `parsePlanParallel: malformed YAML in plan.md fenced block: ${(e as Error).message}`,
      );
    }
    if (!parsed || typeof parsed !== "object" || !("parallel" in parsed)) {
      // Fence had `parallel:` substring but not at top-level key — skip.
      continue;
    }

    const rawEntries = (parsed as { parallel: unknown }).parallel;
    if (!Array.isArray(rawEntries)) {
      throw new Error(
        `parsePlanParallel: 'parallel' must be a YAML list, got ${typeof rawEntries}`,
      );
    }
    if (rawEntries.length < MIN_ENTRIES) {
      throw new Error(
        `parsePlanParallel: parallel list must have >= ${MIN_ENTRIES} entries (a 1-entry parallel isn't a fan-out); got ${rawEntries.length}`,
      );
    }
    if (rawEntries.length > MAX_ENTRIES) {
      throw new Error(
        `parsePlanParallel: parallel list exceeds plan-roadmap cap of ${MAX_ENTRIES}; got ${rawEntries.length}`,
      );
    }

    const seenNames = new Set<string>();
    const entries: PlanParallelEntry[] = [];
    for (let i = 0; i < rawEntries.length; i += 1) {
      const e = rawEntries[i];
      if (!e || typeof e !== "object") {
        throw new Error(`parsePlanParallel: entry #${i} is not an object`);
      }
      const ent = e as Record<string, unknown>;
      const id = ent.id;
      const name = ent.name;
      const affects = ent.affects;
      if (typeof id !== "string" || id.length === 0) {
        throw new Error(`parsePlanParallel: entry #${i} 'id' missing or empty`);
      }
      if (typeof name !== "string" || !SUB_NAME_RE.test(name)) {
        throw new Error(
          `parsePlanParallel: entry #${i} 'name' must match ${SUB_NAME_RE} (shell-safe per RISK-Q4-c); got "${String(name)}"`,
        );
      }
      // v0.4: accept string OR string[]; normalize to non-empty string[].
      let affectsArr: string[];
      if (typeof affects === "string") {
        if (affects.length === 0) {
          throw new Error(
            `parsePlanParallel: entry #${i} 'affects' missing or empty (must be a path regex literal or array)`,
          );
        }
        affectsArr = [affects];
      } else if (Array.isArray(affects)) {
        if (affects.length === 0) {
          throw new Error(
            `parsePlanParallel: entry #${i} 'affects' is an empty array (must declare ≥ 1 regex pattern)`,
          );
        }
        for (let j = 0; j < affects.length; j += 1) {
          const a = affects[j];
          if (typeof a !== "string" || a.length === 0) {
            throw new Error(
              `parsePlanParallel: entry #${i} 'affects[${j}]' must be a non-empty string`,
            );
          }
        }
        affectsArr = affects.slice();
      } else {
        throw new Error(
          `parsePlanParallel: entry #${i} 'affects' must be a string or string[] (got ${typeof affects})`,
        );
      }
      if (seenNames.has(name)) {
        throw new Error(`parsePlanParallel: duplicate name "${name}" at entry #${i}`);
      }
      seenNames.add(name);
      entries.push({ id, name, affects: affectsArr });
    }
    return entries;
  }
  return undefined;
}
