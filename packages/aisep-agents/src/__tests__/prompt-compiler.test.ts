import { describe, expect, it } from "vitest";

import { PromptCompiler } from "../prompt-compiler.js";

const SAMPLE_MEMORY_HIT = {
  id: "mr-1",
  stage: "architecture" as const,
  failurePattern: "Phase A missed Q7 rollback",
  fix: "Always include RISK-Q7",
  source: "global-verified" as const,
  verifiedBy: "human" as const,
  appliesTo: { domain: ["*"], stage: ["architecture" as const], techStack: ["*"] },
  shipCount: 3,
  promoteCount: 1,
};

describe("PromptCompiler", () => {
  it("renders planner template for intake stage", async () => {
    const compiler = new PromptCompiler();
    const { promptText, profile, promptHash } = await compiler.render({
      stage: "intake",
      phase: "none",
      upstreamArtifacts: [],
      memoryHits: [],
    });

    expect(profile).toBe("planner");
    expect(promptText).toContain("AISEP planner agent");
    expect(promptText).toContain("Stage: intake");
    expect(promptText).toContain("Token budget");
    expect(promptHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("renders architect Phase A with 7-question gate + adversarial self-review", async () => {
    const compiler = new PromptCompiler();
    const { promptText, profile } = await compiler.render({
      stage: "architecture",
      phase: "architecture-brief",
      upstreamArtifacts: [],
      memoryHits: [SAMPLE_MEMORY_HIT],
    });

    expect(profile).toBe("architect");
    expect(promptText).toContain("Phase A architecture brief");
    expect(promptText).toContain("7-Question Anchor Gate");
    expect(promptText).toContain("3 strongest counter-arguments");
    expect(promptText).toContain("Phase A missed Q7 rollback");
    expect(promptText).toContain("≤ 5 pages");
  });

  it("renders architect Phase B with slice fields", async () => {
    const compiler = new PromptCompiler();
    const { promptText } = await compiler.render({
      stage: "architecture",
      phase: "architecture-detail-slice",
      upstreamArtifacts: [],
      memoryHits: [],
      sliceIndex: 2,
      sliceTotal: 3,
    });

    expect(promptText).toContain("Phase B");
    expect(promptText).toContain("slice 2 of 3");
    expect(promptText).toContain("≤ 4 pages");
  });

  it("renders coder template with diff-fence requirement", async () => {
    const compiler = new PromptCompiler();
    const { promptText, profile } = await compiler.render({
      stage: "implement",
      phase: "none",
      upstreamArtifacts: [
        { kind: "contract_frozen", key: "contracts/stage.ts" },
      ],
      memoryHits: [],
    });

    expect(profile).toBe("coder");
    expect(promptText).toContain("```diff");
    expect(promptText).toContain("400 LOC");
    expect(promptText).toContain("contracts/stage.ts");
  });

  it("renders reviewer template with logic-only focus", async () => {
    const compiler = new PromptCompiler();
    const { promptText, profile } = await compiler.render({
      stage: "review",
      phase: "none",
      upstreamArtifacts: [
        { kind: "patch", key: "impl-backend.diff" },
      ],
      memoryHits: [],
    });

    expect(profile).toBe("reviewer");
    expect(promptText).toContain("Logic-only review focus");
    expect(promptText).toContain("pass_with_comments");
    expect(promptText).toContain("impl-backend.diff");
  });

  it("renders tester template requiring repro per failed assertion", async () => {
    const compiler = new PromptCompiler();
    const { promptText, profile } = await compiler.render({
      stage: "verify",
      phase: "none",
      upstreamArtifacts: [],
      memoryHits: [],
    });

    expect(profile).toBe("tester");
    expect(promptText).toContain("verify report");
    expect(promptText).toContain("repro");
  });

  it("promptHash is deterministic for same inputs", async () => {
    const compiler = new PromptCompiler();
    const args = {
      stage: "intake" as const,
      phase: "none" as const,
      upstreamArtifacts: [],
      memoryHits: [],
    };
    const r1 = await compiler.render(args);
    const r2 = await compiler.render(args);
    expect(r1.promptHash).toBe(r2.promptHash);
  });

  it("promptHash differs when memoryHits change", async () => {
    const compiler = new PromptCompiler();
    const a = await compiler.render({
      stage: "architecture",
      phase: "architecture-brief",
      upstreamArtifacts: [],
      memoryHits: [],
    });
    const b = await compiler.render({
      stage: "architecture",
      phase: "architecture-brief",
      upstreamArtifacts: [],
      memoryHits: [SAMPLE_MEMORY_HIT],
    });
    expect(a.promptHash).not.toBe(b.promptHash);
  });
});
