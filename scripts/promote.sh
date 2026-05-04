#!/usr/bin/env bash
# Promote a tagged release to the stable backend (prod worktree on :3030).
# Usage: ./scripts/promote.sh v0.3.1
#
# Flow:
#   1. Tag the current dev HEAD if no arg given, or use the provided tag
#   2. In the prod worktree, fetch + checkout that tag
#   3. pnpm install (only needed when lockfile changes)
#   4. launchctl kickstart → stable restarts from new code in < 5s
#
# Rollback: ./scripts/rollback.sh <previous-tag>

set -euo pipefail

PROD_DIR="$HOME/Desktop/claude-web-prod"
SERVICE="gui/$(id -u)/com.claude-web.backend"

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
echo "  ✓ pnpm install done"

# Restart stable backend
launchctl kickstart -k "$SERVICE"
echo "  ✓ Stable backend restarting from $TAG"

# Quick health probe
sleep 4
if curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/health | grep -q "200"; then
  echo "  ✓ :3030 healthy — promote complete"
else
  echo "  ✗ :3030 not responding after 4s — check logs:"
  echo "    tail -30 ~/Library/Logs/claude-web-backend.stderr.log"
  exit 1
fi
