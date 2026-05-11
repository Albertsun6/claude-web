// PromptCompiler — renders per-stage Handlebars templates with the active
// agent profile's system prompt + context bundle.
//
// Templates live in packages/aisep-agents/templates/<profile>.hbs.
// Templates are read on construction (lazy) and cached.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Handlebars from "handlebars";

import { hashString } from "@claude-web/aisep-core";
import type {
  AisepArtifactRef,
  AisepAgentProfile,
  AisepMemoryRecord,
  AisepStage,
  AisepStagePhase,
} from "@claude-web/aisep-protocol";

import { stageToProfile, SYSTEM_PROMPTS } from "./stage-prompts.js";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = join(here, "..", "templates");

/** Cached compiled Handlebars templates per profile. */
type CompiledTemplate = (data: Record<string, unknown>) => string;

const templateCache = new Map<AisepAgentProfile, CompiledTemplate>();

/** Register a custom helper (used by reviewer.hbs `{{#if (eq this.kind "x")}}`). */
Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

async function loadTemplate(profile: AisepAgentProfile): Promise<CompiledTemplate> {
  const cached = templateCache.get(profile);
  if (cached) return cached;
  const source = await readFile(join(TEMPLATE_ROOT, `${profile}.hbs`), "utf-8");
  const compiled = Handlebars.compile(source, { noEscape: true });
  templateCache.set(profile, compiled);
  return compiled;
}

export interface CompilerRenderArgs {
  stage: AisepStage;
  phase: AisepStagePhase;
  /** Refs of upstream stage artifacts (for the template to enumerate). */
  upstreamArtifacts: AisepArtifactRef[];
  /** Memory hits to inject as past-failure warnings. */
  memoryHits: AisepMemoryRecord[];
  /** Optional Phase B slice fields. */
  sliceIndex?: number;
  sliceTotal?: number;
  /** Optional stage-specific goal override. */
  stageGoal?: string;
}

export interface CompilerRenderResult {
  /** Fully rendered prompt text (system + user). */
  promptText: string;
  /** sha256 of promptText (UTF-8 bytes). */
  promptHash: string;
  /** Profile chosen for this stage. */
  profile: AisepAgentProfile;
}

export class PromptCompiler {
  async render(args: CompilerRenderArgs): Promise<CompilerRenderResult> {
    const profile = stageToProfile(args.stage, args.phase);
    const template = await loadTemplate(profile);

    const data = {
      systemPrompt: SYSTEM_PROMPTS[profile],
      stage: args.stage,
      phase: args.phase,
      isPhaseA: args.phase === "architecture-brief",
      isPhaseB: args.phase === "architecture-detail-slice",
      upstreamArtifacts: args.upstreamArtifacts,
      memoryHits: args.memoryHits,
      sliceIndex: args.sliceIndex,
      sliceTotal: args.sliceTotal,
      stageGoal: args.stageGoal ?? `Execute the AISEP ${args.stage} stage.`,
    };

    const promptText = template(data);
    const promptHash = hashString(promptText);

    return { promptText, promptHash, profile };
  }
}
