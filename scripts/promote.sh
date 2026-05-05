#!/usr/bin/env bash
# Promote a tagged release to the stable backend (prod worktree on :3030).
# Usage: ./scripts/promote.sh v0.3.1
#
# Flow:
#   1. Verify tag, in prod worktree fetch + checkout that tag
#   2. Pin PATH to launchd's node so rebuild + smoke test use the same binary
#      that backend will run (lesson 2026-05-05: bash login shell rewrites PATH
#      and makes shell-rebuild target a different Node than backend → ENOENT/
#      ERR_DLOPEN_FAILED loop)
#   3. pnpm install + rebuild better-sqlite3 against current Node
#      (prebuilt binaries cached against old NODE_MODULE_VERSION otherwise)
#   4. launchctl kickstart, smoke /health AND /api/harness/config (harness
#      DB init failure returns 503 silently while /health stays 200)
#
# Rollback: ./scripts/rollback.sh <previous-tag>

set -euo pipefail

PROD_DIR="$HOME/Desktop/claude-web-prod"
SERVICE="gui/$(id -u)/com.claude-web.backend"
# Pin to the node the launchd plist uses (must match plist ProgramArguments).
NODE_BIN_DIR="/Users/yongqian/.nvm/versions/node/v24.12.0/bin"
export PATH="$NODE_BIN_DIR:$PATH"

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <git-tag>"
  echo "  e.g. $0 v0.3.1"
  echo ""
  echo "To create and promote in one step:"
  echo "  git tag v0.3.1 && $0 v0.3.1"
  exit 1
fi

TAG="$1"

echo "→ Promoting $TAG to stable (:3030)…"

# Verify the tag exists
git -C "$PROD_DIR" fetch --tags --quiet 2>/dev/null || git fetch --tags --quiet
if ! git -C "$PROD_DIR" rev-parse "$TAG" &>/dev/null; then
  echo "✗ Tag '$TAG' not found locally or in origin."
  echo "  Run: git tag $TAG && $0 $TAG"
  exit 1
fi

# Update prod worktree to the tag
cd "$PROD_DIR"
git checkout --detach "$TAG" --quiet
echo "  ✓ Checked out $TAG ($(git rev-parse --short HEAD))"

# Install deps if lockfile changed relative to previous checkout
pnpm install --frozen-lockfile --reporter=silent 2>/dev/null || pnpm install --frozen-lockfile
echo "  ✓ pnpm install done ($(node --version))"

# Rebuild native bindings against current Node (prebuilt binaries cached against
# different NODE_MODULE_VERSION will load fine for shell-node but fail for
# launchd-node when versions diverge)
pnpm rebuild better-sqlite3 --reporter=silent 2>/dev/null || pnpm rebuild better-sqlite3
echo "  ✓ better-sqlite3 rebuilt against $(node --version)"

# Restart stable backend
launchctl kickstart -k "$SERVICE"
echo "  ✓ Stable backend restarting from $TAG"

# Quick health probe — both /health AND /api/harness/config so harness DB
# init failures (silent 503 on /api/harness/*) don't slip through
sleep 4
HEALTH=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/health || echo "000")
HARNESS=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/api/harness/config || echo "000")
if [[ "$HEALTH" == "200" && "$HARNESS" == "200" ]]; then
  echo "  ✓ :3030 healthy — /health=$HEALTH /api/harness/config=$HARNESS — promote complete"
elif [[ "$HEALTH" == "200" && "$HARNESS" == "503" ]]; then
  echo "  ✗ :3030 up but /api/harness/config=503 — harness DB init failed"
  echo "    Likely cause: better-sqlite3 NODE_MODULE_VERSION mismatch with launchd Node"
  echo "    Check:  tail -30 ~/Library/Logs/claude-web-backend.stderr.log"
  exit 1
else
  echo "  ✗ :3030 not responding (/health=$HEALTH /api/harness/config=$HARNESS) — check logs:"
  echo "    tail -30 ~/Library/Logs/claude-web-backend.stderr.log"
  exit 1
fi
