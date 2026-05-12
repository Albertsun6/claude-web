# Eva (formerly claude-web)

Personal mobile-friendly web UI for the `claude` CLI — uses your Claude Pro/Max **subscription** by spawning the CLI as a subprocess (no API key billing).

## Prerequisites

- `claude` CLI installed and logged in (run `claude auth login` once)
- Node 20+, pnpm 9+
- (optional, for iOS-PWA / Firefox voice) `whisper-cpp` + `ffmpeg` and a model:
  ```bash
  brew install whisper-cpp ffmpeg
  mkdir -p ~/.whisper-models && curl -L -o ~/.whisper-models/ggml-large-v3-turbo-q5_0.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
  ```
  Override paths via `WHISPER_BIN`, `WHISPER_MODEL`, `FFMPEG_BIN` env vars.

## Quick start

```bash
pnpm install
cp packages/backend/.env.example packages/backend/.env  # optional, no key needed

# 终端 1：跑后端 (port 3030)
pnpm dev:backend

# 终端 2：跑前端 (port 5173)
pnpm dev:frontend

# 浏览器打开 http://localhost:5173
```

## Verify CLI subprocess works (no UI)

```bash
pnpm test:cli
```

Architecture plan: `~/.claude/plans/claude-code-cli-buzzing-starlight.md`.

---

## AISEP — AI Software Engineering Platform (bootstrap-in-progress)

This repo also bootstraps **AISEP**, a 7-package TypeScript CLI cluster
under `packages/aisep-*/` that helps a single super-individual ship
enterprise-class management systems (ERP / CRM / complex business apps).

**Status** (2026-05-13): `aisep-protocol@0.3.0` tagged. v0/v1 milestones
complete (10-stage chain + AlphaEvolve memory + static fan-out + SIGTERM
cancel + HTML report generator).

### Quick start

```bash
# 1. Run a workspace end-to-end (intake → research → ... → retrospect)
pnpm exec tsx packages/aisep-cli/src/cli.ts run \
  --workspace /tmp/my-task --real

# 2. Run with v1 fan-out (parallel sub-implements)
pnpm exec tsx packages/aisep-cli/src/cli.ts run \
  --workspace /tmp/my-task --real \
  --parallel --children backend,frontend,tests --concurrency 3

# 3. Visualize: generate single-file HTML report + open in browser
pnpm exec tsx packages/aisep-cli/src/cli.ts report \
  --workspace /tmp/my-task --open
# → produces /tmp/my-task/report.html (38KB self-contained, Mermaid Gantt +
#   fan-out tree + REQ→ADR→ZOD trace matrix + contract_grep drill-down)

# 4. Inspect AlphaEvolve memory
pnpm exec tsx packages/aisep-cli/src/cli.ts memory stats
pnpm exec tsx packages/aisep-cli/src/cli.ts memory show global

# 5. CLI help
pnpm exec tsx packages/aisep-cli/src/cli.ts --help
```

### Docs

- [`docs/aisep/01_vision_scope.md`](docs/aisep/01_vision_scope.md) — positioning + v0/v1 roadmap
- [`docs/aisep/02_methodology-v0.1.md`](docs/aisep/02_methodology-v0.1.md) — 10-stage methodology + DAG v0/v1/v2/v3 path + 7-question anchor gate
- [`docs/aisep/03_architecture-stage-spec.md`](docs/aisep/03_architecture-stage-spec.md) — architecture stage 2-phase spec
- [`docs/aisep/04_global-memory-ontology.md`](docs/aisep/04_global-memory-ontology.md) — AlphaEvolve cross-project memory ontology
- [`docs/aisep/USER_MANUAL.md`](docs/aisep/USER_MANUAL.md) — **CLI user manual (5 subcommands)**
- [`docs/aisep/retrospectives/`](docs/aisep/retrospectives/) — Pilot run retros (Pilot-04 / 05 / 06 / 07 / 09)
- [`docs/proposals/`](docs/proposals/) — design proposals (v1 fan-out / v3 cycle / aisep-protocol v0.2)

### Architecture

`packages/aisep-{protocol,core,workspace,memory,agents,cli}/` — 7-package
cluster with strict one-way deps enforced by `.dependency-cruiser.cjs`.
Zero imports from vessel mainline (`backend` / `frontend` / `ios-native`)
in either direction.

Branch: `feat/aisep-bootstrap` → PR #68. v1 milestone retro:
[`docs/aisep/retrospectives/v1-fan-out-milestone-complete-2026-05-12.md`](docs/aisep/retrospectives/v1-fan-out-milestone-complete-2026-05-12.md).
