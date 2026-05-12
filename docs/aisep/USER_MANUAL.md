# AISEP CLI — User manual

> **Audience**: 1 super-individual building enterprise-class management
> systems. AISEP's outputs (stages, ADRs, patches, contract_grep verify
> reports, trace matrices) are first-class artifacts for:
> 1. **Self-review** — developer-facing progress + state-of-project
> 2. **Client demo** — show evidence chain on delivery
> 3. **Compliance audit** — ISO/SOC2 evidence trail
>
> Last updated: 2026-05-13. Version: `aisep-protocol@0.3.0`.

## Install (worktree dev mode)

AISEP is currently bootstrapped under the `feat/aisep-bootstrap` worktree
of the Vessel monorepo. No global `aisep` binary yet — invoke via `pnpm
exec tsx`:

```bash
cd /path/to/Vessel-aisep          # the worktree root
pnpm install
pnpm exec tsx packages/aisep-cli/src/cli.ts --help
```

For convenience, alias:

```bash
alias aisep='pnpm exec tsx /path/to/Vessel-aisep/packages/aisep-cli/src/cli.ts'
```

All subsequent examples assume the alias.

## 5 subcommands at a glance

| Subcommand | What it does |
|------------|--------------|
| `aisep run`     | Execute one or more stages of the 10-stage chain on a workspace |
| `aisep memory`  | Inspect / record AlphaEvolve memory entries (cross-project) |
| `aisep verify`  | Deterministically re-run a single `contract_grep` check on disk |
| `aisep report`  | Generate single-file HTML report (visual + audit-ready) |
| `aisep --help`  | Show overall usage |

---

## `aisep run` — execute the 10-stage chain

```bash
aisep run --workspace <path> --real
aisep run --workspace <path> --dry          # use MockStageExecutor (no token spend)
aisep run --workspace <path> --real --stage architecture
aisep run --workspace <path> --real --stages intake,research,plan
aisep run --workspace <path> --real --phase architecture-brief
aisep run --workspace <path> --real --claude-timeout-ms 900000   # 15min per attempt
```

### `--claude-timeout-ms` (v0.3, Pilot-10 finding)

Per-attempt `claude --print` subprocess timeout. Default **600,000 ms
(10 min)**; range `[60000, 1800000]` (1 min to 30 min). Bump for heavy
implement stages on real-business tasks; ratchet down for quick smoke runs.

Pilot-10 (2026-05-13) found the old 5-min default insufficient for real
implement work — the chain stopped at SIGTERM after 5 min before the
patch.diff finished rendering. Bumped to 10 min as the new default; if
your task hits the wall again, raise it per-run.

### Fan-out (v1, aisep-protocol ≥ 0.3.0)

For tasks naturally split into 2–4 parallel sub-implements (backend +
frontend + tests, or 3 domain modules), the implement stage can fan out:

```bash
# Manual children
aisep run --workspace <path> --real \
  --parallel --children backend,frontend,tests --concurrency 3

# Auto-detect: plan stage emits `parallel: [...]` YAML block in plan.md
# → aisep run picks it up without --children flag (Stage 2.cli-C)
aisep run --workspace <path> --real --parallel
```

Concurrency cap is 4 (plan-roadmap hard ceiling — SmartBear reviewer-
load research). Child sub-stage names must match `/^[A-Za-z0-9_.:-]+$/`.

### Output

For each stage, AISEP writes `<workspace>/<stage>.md` (or
`<workspace>/implement-<subName>.md` for fan-out children). Workspace
state (stage_runs / artifacts / attempts) persists to
`<workspace>/.aisep/state.json` for the report command to consume.

---

## `aisep memory` — AlphaEvolve two-tier memory inspection

```bash
aisep memory show workspace        # pending entries in <cwd>/.aisep/evolution_log.json
aisep memory show global           # human-verified entries in ~/.aisep/governance-log/evolution_log.json
aisep memory stats                  # counts per tier + per stage
aisep memory retrieve --stage architecture [--tier global|workspace] [--limit N]
aisep memory record --tier global --stage <name> --pattern "..." --fix "..."
aisep memory promote --stage <name> --fix "<verified text>" [--pattern <substring>]
```

The global tier is workspace-shared (per `~/.aisep/governance-log/`); used
as the AlphaEvolve cross-project lesson library. Memory is **tier-explicit
on retrieve** (R11 trust boundary — never implicit union across tiers).

---

## `aisep verify` — deterministic on-disk re-check

When a `contract_grep` check in `<workspace>/verify.md` failed due to a
hand-off truncation (NOT a real content gap), re-run the check against
the on-disk artifact in 30 seconds — no full stage re-issue.

```bash
aisep verify --recheck --workspace <path>                              # re-run all checks
aisep verify --recheck --workspace <path> --check-name <substring>     # subset
```

Result rewrites the JSON block in `verify.md` with updated `ok` flags
+ `contract_grep.ok` overall recomputed.

---

## `aisep report` — single-file HTML visual report

The flagship visualization. Generates a self-contained `report.html`
that opens in any browser without a server — for self-review, client
demo, and compliance audit.

```bash
aisep report --workspace <path>                           # → <workspace>/report.html
aisep report --workspace <path> --open                    # also open in default browser
aisep report --workspace <path> --out /Users/yongqian/Desktop/aisep-demo.html
```

### What's in the report

```
┌──────────────────────────────────────────────────────────────┐
│ Header: workspace.name + cwd + generatedAt + counts           │
├──────────────────────────────────────────────────────────────┤
│ § Summary          — workspace.id, techStack, shipCount,      │
│                     stages-succeeded ratio, contract_grep ok  │
│                     ratio, trace anchor count                 │
├──────────────────────────────────────────────────────────────┤
│ § Stage timeline   — Mermaid Gantt: per-stage duration bars,  │
│                     failed/cancelled in red                   │
├──────────────────────────────────────────────────────────────┤
│ § Fan-out tree     — Mermaid flowchart: parent + N children   │
│                     (one per parent stage_run)                │
├──────────────────────────────────────────────────────────────┤
│ § Stage_run table  — flat list with id / stage / role /       │
│                     status / duration / output key            │
├──────────────────────────────────────────────────────────────┤
│ § Trace matrix     — REQ → ADR → ZOD → RISK → PATCH 6-column  │
│                     (regex-extracted from artifact contents)  │
├──────────────────────────────────────────────────────────────┤
│ § Contract_grep    — <details> collapsible per check; failed  │
│                     checks open by default; shows command +   │
│                     `read_from_disk` flag                     │
└──────────────────────────────────────────────────────────────┘
```

The HTML embeds Mermaid via a single CDN `<script>`. If offline, the
Mermaid sections degrade gracefully to text source (still readable). The
underlying `AisepReport` JSON is inlined as `<script id="aisep-report-data"
type="application/json">` so downstream tools can re-parse without
re-running AISEP.

### Print to PDF (for client delivery / audit packets)

The template includes `@media print` rules with `page-break-inside:
avoid` and inline content for collapsed `<details>`. In a browser:

- Cmd+P → "Save as PDF" → output is print-friendly (no nav clutter,
  black-on-white, sections don't split across pages).

### Enterprise audit checklist (mapping example)

| Audit clause | AISEP evidence |
|---|---|
| Requirements traceability | Trace matrix `REQ-NNN → ADR-NNN → ZOD-* → PATCH` row in report |
| Change approval record | architecture/brief.md + ADR-NNN.md (linked from report) |
| Test coverage per change | Contract_grep drill-down `<details>` per check |
| Build / deploy gates | Stage table `verify` + `integrate` rows with status |
| Rollback procedure | `integrate.md` `rollback_path` field (linked from report) |
| Incident audit trail | `state.json` + `retrospect.md` per stage_run |

This is one mapping example. Your actual auditor's clauses may differ;
the building blocks (Trace matrix + contract_grep drill-down + stage_run
table) are designed to satisfy any
"evidence-per-requirement" framework.

---

## Workspace layout

After `aisep run`, a workspace directory looks like:

```
/path/to/workspace/
├── seed.txt                 # the task seed (user-provided)
├── intake.md                # stage 1 output
├── research.md              # stage 2
├── plan.md                  # stage 3 (may contain `parallel:` block)
├── architecture/
│   └── brief.md             # stage 4 (Phase A)
├── contract.md              # stage 5
├── implement.md             # stage 6 (linear)
├── implement-backend.md     # stage 6 fan-out child (when --parallel)
├── implement-frontend.md
├── implement-tests.md
├── verify.md                # stage 7
├── review.md                # stage 8
├── integrate.md             # stage 9
├── retrospect.md            # stage 10
├── report.html              # after `aisep report` (self-contained)
└── .aisep/
    ├── state.json           # stage_runs + artifacts + attempts
    └── tmp/                 # rendered prompts per stage (forensic replay)
```

## Cross-project memory

`~/.aisep/governance-log/evolution_log.json` is the global tier
(human-verified lessons across all projects). The CLI never auto-mixes
tiers — every `retrieve` is explicit about which tier (R11 trust
boundary).

## Limitations (v0.3)

- v3 cycle (review→implement retry loop) not yet implemented — `request_reverify` verdict + cycle scheduler proposal converged (`docs/proposals/aisep-v3-cycle-review-implement-loop.md`) but waits on next milestone
- Memory-hit timeline in report is empty MVP (requires retrieve() artifact persistence — future work)
- Report.html `report.html` is overwritten on each `aisep report` run (no versioning)
- Mermaid degrades to text when offline; for fully-self-contained reports without CDN, swap Mermaid CDN script for inline bundle (future Stage E.3 follow-up)

## Trouble-shooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `no state.json at <path>/.aisep/state.json` | Workspace not initialized by `aisep run` | Run `aisep run --workspace <path>` first |
| Report opens but Mermaid diagrams blank | Browser blocked CDN | Open with `--allow-file-access-from-files`, or run online once to cache Mermaid |
| `--parallel` rejects with "Unknown arg: --children" | Old build | `git pull` the worktree to ≥ commit `5641dbc` |
| `aisep memory record --tier global` says DEDUP | Pattern already in global memory | Use `aisep memory show global` to inspect existing entry |
