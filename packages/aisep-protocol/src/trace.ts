// trace.yaml — REQ → ADR → ZOD → RISK trace chains for machine-verifiable lineage.
// Phase A architecture stage MUST produce trace.yaml; orphans break CI.

import { z } from "zod";

import { AisepArtifactRefSchema } from "./artifact.js";
import { OpaqueIdSchema, TraceIdSchema } from "./common.js";

/**
 * One trace chain: requirement → ADRs → contracts (zod schemas) → risks.
 * Optional artifact list points to concrete files/sections that realize the chain.
 */
export const AisepTraceChainSchema = z.object({
  id: TraceIdSchema,
  /** REQ-xxx — the requirement at the top. */
  requirement: TraceIdSchema,
  /** ADR-xxx list — decisions that realize the requirement. */
  adrs: z.array(TraceIdSchema).default([]),
  /** ZOD-xxx list — zod schemas (in contracts-seed.ts) that encode the decision. */
  contracts: z.array(TraceIdSchema).default([]),
  /** RISK-xxx list — risks mitigated by this chain. */
  risks: z.array(TraceIdSchema).default([]),
  /** Concrete artifact pointers (e.g. ADR file paths). */
  artifacts: z.array(AisepArtifactRefSchema).default([]),
});
export type AisepTraceChain = z.infer<typeof AisepTraceChainSchema>;

/**
 * Orphan = artifact NOT covered by any chain. MUST be empty for Phase A
 * to pass anchor gate; otherwise CI fails `aisep architecture verify-trace`.
 */
export const AisepTraceOrphanSchema = z.object({
  artifact: AisepArtifactRefSchema,
  reason: z.string().min(1),  // why the orphan exists (filled by author for human review)
});
export type AisepTraceOrphan = z.infer<typeof AisepTraceOrphanSchema>;

/** Full content of trace.yaml. */
export const AisepTraceFileSchema = z.object({
  workspaceId: OpaqueIdSchema,
  chains: z.array(AisepTraceChainSchema).default([]),
  orphans: z.array(AisepTraceOrphanSchema).default([]),
});
export type AisepTraceFile = z.infer<typeof AisepTraceFileSchema>;
