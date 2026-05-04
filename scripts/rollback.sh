#!/usr/bin/env bash
# Roll stable backend back to a previous tag.
# Usage: ./scripts/rollback.sh v0.3.0
#
# Same mechanics as promote.sh — just passing an older tag.

set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <git-tag>"
  echo ""
  echo "Available tags (newest first):"
  git tag --sort=-version:refname | head -10
  exit 1
fi

exec "$(dirname "$0")/promote.sh" "$1"
