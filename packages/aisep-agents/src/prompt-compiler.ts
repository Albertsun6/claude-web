// PromptCompiler — renders per-stage Handlebars templates with the active
// agent profile's system prompt + context bundle.
//
// Template lookup order (v0.2, Phase 2.C-2):
//   1. `templates/<stage>.hbs`  — stage-specific template (preferred)
//   2. `templates/<profile>.hbs` — profile-level fallback
//
// Stage-specific templates exist for: intake / research / plan / retrospect
// (carved out from planner.hbs) + architect / coder / reviewer / tester
// (per-profile, used by their respective stage groups).

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

type CompiledTemplate = (data: Record<string, unknown>) => string;

/** Cache keyed by `<stage>:<profile>` (lookup order baked in). */
const templateCache = new Map<string, CompiledTemplate>();

Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

async function tryLoad(filename: string): Promise<CompiledTemplate | undefined> {
  try {
    const source = await readFile(join(TEMPLATE_ROOT, filename), "utf-8");
    return Handlebars.compile(source, { noEscape: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw err;
  }
}

async function loadTemplate(
  stage: AisepStage,
  profile: AisepAgentProfile,
): Promise<CompiledTemplate> {
  const cacheKey = `${stage}:${profile}`;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;

  // Try stage-specific first, then profile-level fallback.
  const stageTemplate = await tryLoad(`${stage}.hbs`);
  if (stageTemplate) {
    templateCache.set(cacheKey, stageTemplate);
    return stageTemplate;
  }

  const profileTemplate = await tryLoad(`${profile}.hbs`);
  if (profileTemplate) {
    templateCache.set(cacheKey, profileTemplate);
    return profileTemplate;
  }

  throw new Error(
    `No template found for stage=${stage} or profile=${profile}. ` +
      `Expected one of templates/${stage}.hbs or templates/${profile}.hbs`,
  );
}

/** One upstream artifact with its content already read + truncated. */
export interface UpstreamArtifactWithContent {
  ref: AisepArtifactRef;
  contentPreview: string;
  truncated: boolean;
  truncatedBytes: number;
}

export interface CompilerRenderArgs {
  stage: AisepStage;
  phase: AisepStagePhase;
  /**
   * Refs of upstream stage artifacts (for the template to enumerate when
   * inline content is not provided / claude is expected to Read them).
   */
  upstreamArtifacts: AisepArtifactRef[];
  /**
   * v0.2 Phase 2.C-3: full upstream artifacts with content inlined for
   * each. If provided, templates render content directly in the prompt
   * (no reliance on claude's Read tool). If absent, only refs are listed.
   *
   * The caller (claude-executor) is responsible for reading from disk +
   * applying per-artifact and total budget caps.
   */
  upstreamArtifactsWithContent?: UpstreamArtifactWithContent[];
  /** Memory hits to inject as past-failure warnings. */
  memoryHits: AisepMemoryRecord[];
  sliceIndex?: number;
  sliceTotal?: number;
  stageGoal?: string;
  /**
   * v0.3 (v1 fan-out Stage 2.cli-B): when this stage is a fan-out child
   * (`fanOutRole === "child"`), this is the sub-stage name declared by
   * the parent (e.g. "backend" / "frontend" / "tests"). Template uses
   * this to:
   * - name the output file `implement-<subStageName>.md` (instead of
   *   `implement.md`)
   * - emit context like "this is the {{subStageName}} sub-implement"
   *
   * Caller responsibility: matches /^[A-Za-z0-9_.:-]+$/ (RISK-Q4-c
   * shell-safe constraint; same regex as AisepReviewVerdict
   * .requestReverify.checkId).
   *
   * Absent for `fanOutRole === "normal" | "parent"`.
   */
  subStageName?: string;
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
    const template = await loadTemplate(args.stage, profile);

    const data = {
      systemPrompt: SYSTEM_PROMPTS[profile],
      stage: args.stage,
      phase: args.phase,
      isPhaseA: args.phase === "architecture-brief",
      isPhaseB: args.phase === "architecture-detail-slice",
      upstreamArtifacts: args.upstreamArtifacts,
      upstreamArtifactsWithContent: args.upstreamArtifactsWithContent ?? [],
      memoryHits: args.memoryHits,
      sliceIndex: args.sliceIndex,
      sliceTotal: args.sliceTotal,
      stageGoal: args.stageGoal ?? `Execute the AISEP ${args.stage} stage.`,
      /** v0.3 (v1 fan-out Stage 2.cli-B): fan-out child sub-stage name. */
      subStageName: args.subStageName,
      isFanOutChild: args.subStageName !== undefined,
    };

    const promptText = template(data);
    const promptHash = hashString(promptText);

    return { promptText, promptHash, profile };
  }
}
