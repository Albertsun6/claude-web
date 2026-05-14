// requirements.yaml horizontal layer — ArchiMate Motivation Layer inspired.
// Crosscuts ALL 10 stages (TOGAF Requirements Management → AISEP horizontal).

import { z } from "zod";
import { TraceIdSchema } from "./common.js";

export const AisepGoalSchema = z.object({
  id: TraceIdSchema,       // G-xxx
  name: z.string().min(1),
  successCriteria: z.string().optional(),
});
export type AisepGoal = z.infer<typeof AisepGoalSchema>;

export const AisepDriverSchema = z.object({
  id: TraceIdSchema,       // D-xxx
  name: z.string().min(1),
});
export type AisepDriver = z.infer<typeof AisepDriverSchema>;

export const AisepRequirementSchema = z.object({
  id: TraceIdSchema,       // REQ-xxx
  /** Reference to AisepGoal.id this requirement realizes. */
  realizes: TraceIdSchema,
  description: z.string().min(1),
});
export type AisepRequirement = z.infer<typeof AisepRequirementSchema>;

export const AisepConstraintSchema = z.object({
  id: TraceIdSchema,       // C-xxx
  description: z.string().min(1),
});
export type AisepConstraint = z.infer<typeof AisepConstraintSchema>;

export const AisepPrincipleSchema = z.object({
  id: TraceIdSchema,       // P-xxx
  description: z.string().min(1),
});
export type AisepPrinciple = z.infer<typeof AisepPrincipleSchema>;

export const AisepStakeholderSchema = z.object({
  id: TraceIdSchema,       // S-xxx
  role: z.string().min(1),
});
export type AisepStakeholder = z.infer<typeof AisepStakeholderSchema>;

/**
 * AisepRequirements — full content of <workspace>/requirements.yaml.
 *
 * Horizontal rule: any downstream stage that wants to add a new
 * requirement MUST trace back to update requirements.yaml — no inline
 * inventing.
 */
export const AisepRequirementsSchema = z.object({
  goals: z.array(AisepGoalSchema).default([]),
  drivers: z.array(AisepDriverSchema).default([]),
  requirements: z.array(AisepRequirementSchema).default([]),
  constraints: z.array(AisepConstraintSchema).default([]),
  principles: z.array(AisepPrincipleSchema).default([]),
  stakeholders: z.array(AisepStakeholderSchema).default([]),
});
export type AisepRequirements = z.infer<typeof AisepRequirementsSchema>;
