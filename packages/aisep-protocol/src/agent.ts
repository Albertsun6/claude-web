// Agent profile, agent call, and context bundle.
//
// AgentProfile is defined here (semantic home); attempt.ts re-imports it
// via the barrel. Memory + Artifact refs flow into ContextBundle for
// each spawn `claude --print` invocation.

import { z } from "zod";

import { AisepArtifactRefSchema } from "./artifact.js";
import { AisepMemoryRecordSchema } from "./memory.js";

/**
 * Five AISEP agent profiles. Each maps to a prompt template in
 * ~/.aisep/reference-library/prompt-templates/<profile>.hbs.
 */
export const AisepAgentProfileSchema = z.enum([
  "ba",          // intake / research helper
  "architect",   // architecture stage (Phase A + B)
  "coder",       // implement stage
  "reviewer",    // review stage (also used for cross-reviewer)
  "tester",      // verify / test stage
]);
export type AisepAgentProfile = z.infer<typeof AisepAgentProfileSchema>;

/** One turn of upstream history fed into next stage. */
export const AisepHistoryEntrySchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});
export type AisepHistoryEntry = z.infer<typeof AisepHistoryEntrySchema>;

/**
 * AisepContextBundle — everything an agent sees BEFORE running.
 * Built by aisep-context package per (stage, workspace) pair.
 */
export const AisepContextBundleSchema = z.object({
  /** Relevant files retrieved from workspace cwd. */
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
  /** Prior turns within the same stage_run (when looping). */
  history: z.array(AisepHistoryEntrySchema).default([]),
  /** Memory hits from AlphaEvolve (workspace-pending + global-verified mixed). */
  memoryHits: z.array(AisepMemoryRecordSchema).default([]),
  /** ADR refs by ref key (e.g. ["decisions/0001-use-zod.md"]). */
  adrs: z.array(z.string()).default([]),
  /** Other artifact refs from upstream stages. */
  artifacts: z.array(AisepArtifactRefSchema).default([]),
});
export type AisepContextBundle = z.infer<typeof AisepContextBundleSchema>;

/**
 * AisepAgentCall — the request envelope handed to spawn-claude / spawn-cursor-agent.
 */
export const AisepAgentCallSchema = z.object({
  profile: AisepAgentProfileSchema,
  /** Concrete model id, optional. If absent, profile-default is used. */
  model: z.string().optional(),
  prompt: z.string().min(1),
  contextBundle: AisepContextBundleSchema.optional(),
});
export type AisepAgentCall = z.infer<typeof AisepAgentCallSchema>;
