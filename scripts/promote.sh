#!/usr/bin/env bash
# Promote a tagged release to the stable backend (prod worktree on :3030).
# Usage: ./scripts/promote.sh v0.4.1
#
# Flow:
#   1. Verify tag, in prod worktree fetch + checkout that tag
#   2. Hard-validate launchd's Node binary exists (no soft PATH fallback —
#      lesson cross M1 2026-05-05: export PATH=NEW:OLD lets pnpm fall back
#      to Homebrew when nvm v24 dir is missing → re-creates D1/D5)
#   3. pnpm install + full rebuild (covers all native deps, not just
#      better-sqlite3 — lesson cross m2)
#   4. launchctl kickstart, smoke /health AND /api/harness/initiatives
#      (lesson cross B1: /api/harness/config is mounted BEFORE DB init in
#      index.ts, so it's not a DB-health probe; /api/harness/initiatives is)
#   5. Warn if system sleep enabled (lesson cross M2: removed caffeinate;
#      KeepAlive=true doesn't fire across sleep)
#
# Rollback: ./scripts/rollback.sh <previous-tag>

set -euo pipefail

PROD_DIR="$HOME/Desktop/claude-web-prod"
SERVICE="gui/$(id -u)/com.claude-web.backend"
# Hard-pin to launchd's Node (must match plist ProgramArguments).
NODE_BIN_DIR="/Users/yongqian/.nvm/versions/node/v24.12.0/bin"
NODE_BIN="$NODE_BIN_DIR/node"
PNPM_BIN="$NODE_BIN_DIR/pnpm"

# Validate before doing anything destructive.
if [[ ! -x "$NODE_BIN" || ! -x "$PNPM_BIN" ]]; then
  echo "✗ Expected Node toolchain missing at $NODE_BIN_DIR"
  echo "  Update NODE_BIN_DIR in promote.sh AND scripts/launchd/com.claude-web.backend.plist"
  echo "  to match the nvm version actually installed."
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <git-tag>"
  echo "  e.g. $0 v0.4.1"
  echo ""
  echo "To create and promote in one step:"
  echo "  git tag v0.4.1 && $0 v0.4.1"
  exit 1
fi

TAG="$1"

echo "→ Promoting $TAG to stable (:3030)…"
echo "  Pinned Node: $($NODE_BIN --version) at $NODE_BIN_DIR"

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

# Install deps using pinned pnpm (not whatever PATH might find first).
"$PNPM_BIN" install --frozen-lockfile --reporter=silent 2>/dev/null \
  || "$PNPM_BIN" install --frozen-lockfile
echo "  ✓ pnpm install done"

# Rebuild ALL native bindings against pinned Node. Prebuilt binaries cached
# against a different NODE_MODULE_VERSION load fine in some shells but break
# under launchd. Full rebuild covers any native dep added later.
"$PNPM_BIN" rebuild --reporter=silent 2>/dev/null || "$PNPM_BIN" rebuild
echo "  ✓ Native bindings rebuilt against $($NODE_BIN --version)"

# Restart stable backend
launchctl kickstart -k "$SERVICE"
echo "  ✓ Stable backend restarting from $TAG"

# Smoke test:
# - /health: backend listening at all
# - /api/harness/initiatives: harness DB-backed route. /api/harness/config is
#   NOT DB-backed (mounted before openHarnessDb), so probing it would miss the
#   exact failure mode this whole fix is supposed to catch.
sleep 4
probe() {
  local url="$1"
  local code
  code=$(curl -sS --max-time 5 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null) || true
  # curl prints 000 itself on failure; only fall back if output empty/non-numeric
  if [[ -z "$code" || ! "$code" =~ ^[0-9]+$ ]]; then code="000"; fi
  echo "$code"
}
HEALTH=$(probe "http://127.0.0.1:3030/health")
HARNESS=$(probe "http://127.0.0.1:3030/api/harness/initiatives?projectId=__nonexistent__")

if [[ "$HEALTH" == "200" && "$HARNESS" == "200" ]]; then
  echo "  ✓ :3030 healthy — /health=$HEALTH /api/harness/initiatives=$HARNESS"
elif [[ "$HEALTH" == "200" && "$HARNESS" == "503" ]]; then
  echo "  ✗ :3030 up but /api/harness/initiatives=503 — harness DB init failed"
  echo "    Likely cause: native binding NODE_MODULE_VERSION mismatch with launchd Node"
  echo "    Check:  tail -30 ~/Library/Logs/claude-web-backend.stderr.log"
  exit 1
else
  echo "  ✗ :3030 not responding (/health=$HEALTH /api/harness/initiatives=$HARNESS)"
  echo "    Check:  tail -30 ~/Library/Logs/claude-web-backend.stderr.log"
  exit 1
fi

# Soft warning: caffeinate is gone, so KeepAlive can't fire across sleep.
SLEEP_MIN=$(pmset -g 2>/dev/null | awk '/^[[:space:]]*sleep[[:space:]]+[0-9]/ {print $2; exit}')
if [[ -n "${SLEEP_MIN:-}" && "$SLEEP_MIN" != "0" ]]; then
  echo "  ⚠ pmset 'sleep' = ${SLEEP_MIN} min (system will sleep when idle)"
  echo "    Scheduler won't tick during sleep. Run once to disable:"
  echo "      sudo pmset -a sleep 0"
fi

echo "  ✓ promote $TAG complete"
