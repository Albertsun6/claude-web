// Option E Stage E.1 — AisepReport builder (pure function).
//
// Builds an AisepReport projection from stage_runs + artifacts.
// Pure: no fs/spawn/net. Caller passes data; we project.

import type {
  AisepReport,
  AisepReportContractGrepCheck,
  AisepReportParallelGroup,
  AisepReportStage,
  AisepReportTraceRow,
  BuildReportInput,
} from "./types.js";

/** Anchor id regexes — REQ-001 / ADR-001 / ZOD-Foo / RISK-Q1 / FIX-001 / TEST-001 / G-1 / D-1 / C-1 / P-1 / S-1. */
const ANCHOR_RE = /\b(REQ|ADR|ZOD|RISK|FIX|TEST|G|D|C|P|S)-[A-Za-z0-9]+\b/g;
const ADR_RE = /\bADR-[A-Za-z0-9]+\b/g;
const ZOD_RE = /\bZOD-[A-Za-z0-9]+\b/g;

/** Stage-run projection: just the fields the HTML template reads. */
function projectStage(run: BuildReportInput["stageRuns"][number], artifactKey?: string): AisepReportStage {
  const start = run.startedAt;
  const end = run.endedAt;
  return {
    id: run.id,
    stage: run.stage,
    status: run.status,
    phase: run.phase,
    ...(start !== undefined ? { startedAt: start } : {}),
    ...(end !== undefined ? { endedAt: end } : {}),
    ...(start !== undefined && end !== undefined ? { durationMs: end - start } : {}),
    ...(artifactKey ? { outputKey: artifactKey } : {}),
    ...(run.parentStageRunId ? { parentStageRunId: run.parentStageRunId } : {}),
    fanOutRole: run.fanOutRole,
    // subStageName is not on AisepStageRun directly; derive from artifact key if present.
    ...(artifactKey && /-([A-Za-z0-9_.:-]+)\.md$/.exec(artifactKey)
      ? { subStageName: /-([A-Za-z0-9_.:-]+)\.md$/.exec(artifactKey)![1] }
      : {}),
  };
}

/**
 * v0.3 Stage E.1: pure-function projection from store-shape data to
 * AisepReport (consumed by EJS template in Stage E.2).
 *
 * Trace extraction: scan all provided artifact contents for ANCHOR_RE
 * matches; group by anchor id; record where each anchor appeared
 * (declaredIn = first stage seen) and which ADR/ZOD/patch artifacts
 * reference it.
 *
 * contract_grep extraction: parse verify.md JSON block (best-effort
 * regex; falls back silently if format drifts).
 */
export function buildReport(input: BuildReportInput): AisepReport {
  const artifactByRunId = new Map<string, BuildReportInput["artifacts"]>();
  for (const a of input.artifacts) {
    const list = artifactByRunId.get(a.stageRunId) ?? [];
    list.push(a);
    artifactByRunId.set(a.stageRunId, list);
  }

  // Stages projection (in stageRuns order — caller-provided ordering preserved).
  const stages: AisepReportStage[] = input.stageRuns.map((run) => {
    const runArts = artifactByRunId.get(run.id) ?? [];
    const primaryArt =
      runArts.find((a) => a.ref.kind === "patch_set") ??
      runArts.find((a) => a.ref.kind !== "patch_set");
    return projectStage(run, primaryArt?.ref.key);
  });

  // Parallel groups (fan-out parents + their children, with fan-in
  // direction detection per ADR-022 Q6 F10).
  const parallelGroups: AisepReportParallelGroup[] = [];
  const parentById = new Map(input.stageRuns.map((r) => [r.id, r]));
  for (const run of input.stageRuns) {
    if (run.fanOutRole !== "parent") continue;
    const childRuns = input.stageRuns.filter(
      (r) => r.fanOutRole === "child" && r.parentStageRunId === run.id,
    );
    const childNames: Record<string, string> = {};
    const affectsByChildId: Record<string, string[]> = {};
    const upstreamPredecessorByChildId: Record<string, string> = {};
    for (const c of childRuns) {
      const arts = artifactByRunId.get(c.id) ?? [];
      const patch = arts.find((a) => a.ref.kind === "patch");
      const m = patch?.ref.key ? /-([A-Za-z0-9_.:-]+)\.md$/.exec(patch.ref.key) : null;
      childNames[c.id] = m ? m[1]! : c.id.slice(-6);
      affectsByChildId[c.id] = Array.isArray((c as { affects?: unknown }).affects)
        ? ((c as { affects: string[] }).affects)
        : [];
      // Fan-in linkage: child.predecessorId points at its upstream
      // counterpart (Q3 stage-pair).
      if (c.predecessorId) {
        upstreamPredecessorByChildId[c.id] = c.predecessorId;
      }
    }
    // Direction: "in" iff this parent's own predecessorId resolves to
    // another fan-out parent (Q3 stage-pair fan-in). "out" otherwise.
    let direction: "out" | "in" = "out";
    if (run.predecessorId) {
      const upstreamParent = parentById.get(run.predecessorId);
      if (upstreamParent && upstreamParent.fanOutRole === "parent") {
        direction = "in";
      }
    }
    parallelGroups.push({
      parentId: run.id,
      parentStage: run.stage,
      direction,
      childIds: childRuns.map((c) => c.id),
      childNames,
      upstreamPredecessorByChildId,
      affectsByChildId,
    });
  }

  // Trace matrix — scan artifact contents for anchor refs.
  const traceMatrix: AisepReportTraceRow[] = [];
  if (input.artifactContents) {
    const anchorMap = new Map<string, AisepReportTraceRow>();
    const stageOfArtifact = new Map<string, string>();
    for (const a of input.artifacts) {
      const run = input.stageRuns.find((r) => r.id === a.stageRunId);
      if (run) stageOfArtifact.set(a.ref.key, run.stage);
    }
    for (const [key, content] of Object.entries(input.artifactContents)) {
      const stage = stageOfArtifact.get(key) ?? "unknown";
      const seen = new Set<string>();
      for (const match of content.matchAll(ANCHOR_RE)) {
        const id = match[0];
        if (seen.has(id)) continue;
        seen.add(id);
        const row =
          anchorMap.get(id) ??
          ({
            anchorId: id,
            adrRefs: [],
            zodRefs: [],
            patchRefs: [],
            verifyChecks: [],
          } as AisepReportTraceRow);
        if (!row.declaredIn) row.declaredIn = stage;
        const isPatch = key.startsWith("implement");
        if (isPatch && !row.patchRefs.includes(key)) row.patchRefs.push(key);
        // ADR / ZOD refs (within this artifact body — not the anchor id itself)
        for (const m of content.matchAll(ADR_RE)) {
          if (m[0] !== id && !row.adrRefs.includes(m[0])) row.adrRefs.push(m[0]);
        }
        for (const m of content.matchAll(ZOD_RE)) {
          if (m[0] !== id && !row.zodRefs.includes(m[0])) row.zodRefs.push(m[0]);
        }
        anchorMap.set(id, row);
      }
    }
    traceMatrix.push(...anchorMap.values());
    traceMatrix.sort((a, b) => a.anchorId.localeCompare(b.anchorId));
  }

  // contract_grep checks from verify.md JSON.
  const contractGrepChecks: AisepReportContractGrepCheck[] = [];
  if (input.artifactContents) {
    const verifyRun = input.stageRuns.find((r) => r.stage === "verify");
    const verifyContent = input.artifactContents["verify.md"];
    if (verifyRun && verifyContent) {
      const jsonMatch = verifyContent.match(/```json\s*\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const obj = JSON.parse(jsonMatch[1]!) as {
            contract_grep?: { checks?: AisepReportContractGrepCheck[] };
          };
          for (const c of obj.contract_grep?.checks ?? []) {
            contractGrepChecks.push({
              stageRunId: verifyRun.id,
              name: c.name,
              command: c.command,
              ok: c.ok,
              ...(c.readFromDisk !== undefined ? { readFromDisk: c.readFromDisk } : {}),
            });
          }
        } catch {
          // verify.md JSON block malformed — skip drill-down; stays empty.
        }
      }
    }
  }

  return {
    workspace: input.workspace,
    generatedAt: input.generatedAt ?? Date.now(),
    stages,
    parallelGroups,
    traceMatrix,
    contractGrepChecks,
    memoryHits: [], // v0.3 MVP — full timeline requires retrieve() artifact persistence
  };
}
