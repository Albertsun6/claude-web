# claude-web

Personal mobile-friendly web UI for the `claude` CLI — uses your Claude Pro/Max **subscription** by spawning the CLI as a subprocess (no API key billing).

## Prerequisites

- `claude` CLI installed and logged in (run `claude auth login` once)
- Node 20+, pnpm 9+

## Quick start

```bash
pnpm install
cp packages/backend/.env.example packages/backend/.env  # optional, no key needed

# 终端 1：跑后端 (port 3000)
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
