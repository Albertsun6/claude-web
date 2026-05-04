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
