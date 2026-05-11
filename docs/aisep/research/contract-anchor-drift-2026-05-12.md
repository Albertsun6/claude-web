# Contract Anchor Drift Analysis (Phase 2.D #15)

> Date: 2026-05-12
> Branch: `feat/aisep-bootstrap`
> Data source: Pilot-04 / 05 / 06 verify.md `contract_grep.checks[]`
> Disposition: **DOCUMENTED-AS-ACCEPTABLE** (not a bug; close #15 wontfix-with-rationale)

## Question raised

Pilot-04 / 05 / 06 跑了**完全相同的 seed + memory**（docs-only playbook ship task）
三次。同 seed 应该 → 同 anchor 列表（contract 阶段产出）？实际三次跑出了
三套**完全不重合**的 anchor 列表。这是 bug 还是 feature？

Pilot-04 retro §3 把这个标为 Phase 2.D #15: "contract anchor non-determinism"。

## Evidence (verbatim from `<workspace>/verify.md`)

### Pilot-04 — 8 anchors

| # | anchor (verify check name) |
|---|----------------------------|
| 1 | references pilot-01 retro anchor |
| 2 | references pilot-02 retro anchor |
| 3 | references contract/SectionAnchors ADR-02 |
| 4 | references contract/CaseStudy D6 self-ref |
| 5 | SmartBear 400-LOC threshold cited |
| 6 | halt-condition table present |
| 7 | frontmatter lists all three source pilots |
| 8 | cross-references section present and non-empty *(this one failed under truncated hand-off — see Pilot-04 retro §3.1)* |

### Pilot-05 — 8 anchors

| # | anchor |
|---|---|
| 1 | patch creates docs/aisep/05_pilot-playbook.md |
| 2 | frontmatter declares source-pilots pilot-01 and pilot-02 |
| 3 | all 10 stages enumerated (intake..promote) |
| 4 | five CLI flags documented (--dry, --real, --stage, --stages, --phase) |
| 5 | halt-conditions table covers plan, architecture-Phase-A, review |
| 6 | cross-reference to methodology doc 02_methodology-v0.1.md |
| 7 | cross-references to pilot-01 and pilot-02 retros |
| 8 | memory-promote command pair (dry + real) present |

### Pilot-06 — 18 anchors

| # | anchor |
|---|---|
| 1 | manifest matches diff (new_files referenced in diff body) |
| 2 | runtime_imports_added empty (no package.json check needed) |
| 3-7 | frontmatter key: title / stage / status / pilot / updated |
| 8-14 | SECTION_SPEC idx=1..7 exact heading |
| 15 | section count == 7 (no 8th H2) |
| 16 | retro citations >= 1 (markdown link to retrospectives/) |
| 17 | ADR-001 docs-only scope respected (no non-md files in manifest) |
| 18 | single targetFile == docs/aisep/05_pilot-playbook.md (PatchManifest) |

### Overlap matrix (exact-string-match)

- Pilot-04 ∩ Pilot-05: **0** exact-match anchors
- Pilot-04 ∩ Pilot-06: **0**
- Pilot-05 ∩ Pilot-06: **0**

### Conceptual overlap (allowing paraphrase)

- frontmatter check: present in all 3 pilots, but different field sets
- section headings: present in Pilot-04 (implicit) + Pilot-06 (explicit 7),
  absent in Pilot-05
- retro cross-refs: present in all 3 pilots, but different fixed strings
- halt-conditions: present in Pilot-04 + 05, absent in Pilot-06

## Root cause

LLM sampling noise at the **contract stage**. Each run, claude reads the
architecture brief (which itself drifts per run) and chooses a different
subset of "what's contractually load-bearing" to anchor on. Same seed +
same memory does NOT produce same architecture brief, which does NOT
produce same contract anchor list.

## Is it a bug?

**No, under the v0 ship gate.** Each pilot's anchor list is **internally
consistent**: the anchors that contract chose ARE the anchors that verify
checked, and on Pilot-05 / 06 every check passed → review pass →
`ready_to_integrate: true`. The chain converges to a valid solution
every run.

The drift would be a bug if:

- Two runs of the same seed produced **contradictory contracts** (one says
  "must have X", another says "must NOT have X"). They don't — drift is
  in *which subset* of valid checks is selected, not in conflicting
  requirements.
- A run's contract chose anchors the architecture brief did NOT support.
  This hasn't been observed — every Pilot-05/06 anchor was traceable to
  an ADR in the same run's architecture brief.
- Drift caused integrate to flip false. **It didn't** in Pilot-05 / 06.
  Pilot-04's `ready_to_integrate: false` was caused by hand-off truncation
  (now fixed by #9), NOT by anchor drift.

## Why we're closing as acceptable

1. **Determinism is not a Layered-Spiral goal.** The vessel CLAUDE.md
   "Layered Spiral Delivery" rule says skeleton decisions need up-front
   ADR + cross-review; capability decisions can iterate via spiral.
   "Which exact anchors are load-bearing for this playbook" is capability
   not skeleton — drift across runs is acceptable.
2. **Fix would either move the responsibility wrong way or under-constrain.**
   Three considered fixes:
   - **architect freezes anchor list in ADR**: violates the architect/
     contract boundary (architect should ship brief, not pre-cook the
     contract surface). Forces architect into verify-level detail.
   - **plan stage emits "contract MUST anchor on X/Y/Z" checklist**: same
     problem, plan stage too early to know which anchors are load-bearing.
   - **contract adversarial-review its own anchor list**: still LLM
     sampling — doesn't actually converge.
3. **Pilot-06 already paid the cost of reducing drift**: Tier 1 batch
   (#4 manifest header + #6 size-budget calibration + #11 manifest
   cross-check) gave verify more structured anchors — Pilot-06's 18
   anchors are more verify-mechanical (manifest matches diff, frontmatter
   keys, section IDs) than Pilot-04's 8 (which were semantic claims like
   "SmartBear 400-LOC threshold cited"). So drift partially self-resolved
   as the upstream prompts got tighter.

## Decision

**Close #15 as documented-as-acceptable.** Add note to Phase 2.D backlog:

> #15 contract anchor non-determinism: **WONTFIX** (2026-05-12). Three-pilot
> A/B evidence shows drift is sampling noise that does not affect
> convergence to ship-able output. Anchor lists are internally consistent
> within each run. See [docs/aisep/research/contract-anchor-drift-2026-05-12.md].

## When to reopen

Reopen if any future Pilot exhibits any of these failure modes:

- `ready_to_integrate: false` with a `blocker` of category `anchor_drift`
  (i.e. verify's anchors don't align with architect's promises) — would
  prove drift broke internal consistency
- Two runs of the same seed produce contradictory contracts (one says
  "MUST include X", another says "MUST NOT include X")
- A retro identifies a load-bearing anchor that contract systematically
  forgets across multiple runs

## See also

- [Pilot-04 retrospective §3](../retrospectives/pilot-04-playbook-with-memory-2026-05-12.md)
  — original observation
- [Pilot-05 retrospective §"实验设计的诚实记录"](../retrospectives/pilot-05-verify-on-disk-readback-2026-05-12.md)
  — first explicit naming as #15
- [Pilot-06 retrospective](../retrospectives/pilot-06-batch-tier1-2026-05-12.md)
  — partial drift reduction via Tier 1 batch
