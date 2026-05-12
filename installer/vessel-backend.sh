#!/bin/bash
# Vessel backend launcher — invoked by launchd via com.vessel.backend.plist.
# Uses the Node binary bundled into /usr/local/vessel/node and the backend
# payload produced by `pnpm deploy` so we are independent of system Node /
# nvm / Homebrew.
set -euo pipefail

VESSEL_PREFIX="/usr/local/vessel"
NODE_BIN="${VESSEL_PREFIX}/node/bin/node"
BACKEND_DIR="${VESSEL_PREFIX}/backend"
ENTRY="${BACKEND_DIR}/src/index.ts"

# launchd-spawned children inherit a minimal PATH. The backend shells out to
# `claude`, `whisper-cli`, `ffmpeg`, `edge-tts`, `git`, etc., so seed PATH with
# the locations users typically install them to.
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Defaults — overridable by the plist EnvironmentVariables block or by the
# user editing ~/.vessel.env (sourced below).
export PORT="${PORT:-3030}"

# Optional user override file. Not created by the installer; users who need
# to set VESSEL_TOKEN / BACKEND_HOST / CLAUDE_CLI / WHISPER_MODEL / ... drop
# them here and `launchctl kickstart -k gui/$UID/com.vessel.backend` to apply.
USER_ENV="${HOME}/.vessel.env"
if [ -f "${USER_ENV}" ]; then
  set -a
  # shellcheck source=/dev/null
  . "${USER_ENV}"
  set +a
fi

# `node --import tsx` resolves the `tsx` package starting from CWD, walking
# up through parent node_modules. We need it to find
# /usr/local/vessel/backend/node_modules/tsx, so cd into the backend first.
# Backend code uses absolute paths (~/.claude-web/...) or __dirname-anchored
# paths (../../frontend/dist), neither of which depends on CWD — safe to cd.
cd "${BACKEND_DIR}"

exec "${NODE_BIN}" --import tsx "${ENTRY}"
