#!/usr/bin/env bash
set -e

# iOS app semantic versioning + changelog automation
# Bumps version based on conventional commits since last git tag
# Usage: bash scripts/release.sh [--dry-run]

DRY_RUN=0
if [ "$1" = "--dry-run" ]; then
    DRY_RUN=1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROJECT_YML="$SCRIPT_DIR/../project.yml"
CHANGELOG="$REPO_ROOT/CHANGELOG.md"

# ==================== Step 1: Get last tag and commits ====================

LAST_TAG=$(git -C "$REPO_ROOT" describe --tags --abbrev=0 2>/dev/null || echo "")

if [ -z "$LAST_TAG" ]; then
    COMMITS=$(git -C "$REPO_ROOT" log --format="%s" --reverse)
    echo "[*] First release — analyzing all commits"
else
    COMMITS=$(git -C "$REPO_ROOT" log --format="%s" --reverse "$LAST_TAG"..HEAD)
    echo "[*] Found last tag: $LAST_TAG"
fi

# ==================== Step 2: Determine version bump ====================

BUMP="none"
BREAKING=0

while IFS= read -r line; do
    [ -z "$line" ] && continue

    if echo "$line" | grep -qE "^(feat|fix|refactor|docs|perf|chore|style|test)(\(.+\))?!:|BREAKING CHANGE"; then
        BREAKING=1
    fi

    if echo "$line" | grep -qE "^feat(\(.+\))?:"; then
        [ "$BUMP" != "minor" ] && [ "$BUMP" != "major" ] && BUMP="minor"
    elif echo "$line" | grep -qE "^(fix|refactor|perf|chore|style)(\(.+\))?:"; then
        [ "$BUMP" = "none" ] && BUMP="patch"
    fi
done <<< "$COMMITS"

if [ "$BREAKING" = "1" ]; then
    BUMP="major"
fi

if [ "$BUMP" = "none" ]; then
    echo "[!] No conventional commits found — aborting"
    exit 1
fi

# ==================== Step 3: Calculate new version ====================

CURRENT_VERSION=$(grep 'MARKETING_VERSION:' "$PROJECT_YML" | sed 's/.*"\(.*\)".*/\1/')
BUILD_NUMBER=$(grep 'CURRENT_PROJECT_VERSION:' "$PROJECT_YML" | sed 's/.*"\(.*\)".*/\1/')

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case $BUMP in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
NEW_BUILD=$((BUILD_NUMBER + 1))

echo "[*] Version bump: $BUMP ($CURRENT_VERSION → $NEW_VERSION, build $BUILD_NUMBER → $NEW_BUILD)"

# ==================== Step 4: Generate changelog entry ====================

DATE=$(date +%Y-%m-%d)

CHANGELOG_ENTRY="## [$NEW_VERSION] - $DATE"$'\n'"### Changes"$'\n'

# Features
FEATURES=$(echo "$COMMITS" | grep -E "^feat(\(.+\))?:" || true)
if [ -n "$FEATURES" ]; then
    CHANGELOG_ENTRY="${CHANGELOG_ENTRY}#### Features"$'\n'
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        MSG=$(echo "$line" | sed 's/^feat(\(.*\)): /\1: /' | sed 's/^feat: //')
        CHANGELOG_ENTRY="${CHANGELOG_ENTRY}- $MSG"$'\n'
    done <<< "$FEATURES"
    CHANGELOG_ENTRY="${CHANGELOG_ENTRY}"$'\n'
fi

# Fixes
FIXES=$(echo "$COMMITS" | grep -E "^fix(\(.+\))?:" || true)
if [ -n "$FIXES" ]; then
    CHANGELOG_ENTRY="${CHANGELOG_ENTRY}#### Bug Fixes"$'\n'
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        MSG=$(echo "$line" | sed 's/^fix(\(.*\)): /\1: /' | sed 's/^fix: //')
        CHANGELOG_ENTRY="${CHANGELOG_ENTRY}- $MSG"$'\n'
    done <<< "$FIXES"
    CHANGELOG_ENTRY="${CHANGELOG_ENTRY}"$'\n'
fi

# Other commits (refactor, docs, perf)
OTHERS=$(echo "$COMMITS" | grep -E "^(refactor|docs|perf|chore|style)(\(.+\))?:" || true)
if [ -n "$OTHERS" ]; then
    CHANGELOG_ENTRY="${CHANGELOG_ENTRY}#### Other"$'\n'
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        MSG=$(echo "$line" | sed -E 's/^(refactor|docs|perf|chore|style)(\(([^)]*)\))?: /\3: /' | sed -E 's/^(refactor|docs|perf|chore|style): //')
        CHANGELOG_ENTRY="${CHANGELOG_ENTRY}- $MSG"$'\n'
    done <<< "$OTHERS"
    CHANGELOG_ENTRY="${CHANGELOG_ENTRY}"$'\n'
fi

CHANGELOG_ENTRY="${CHANGELOG_ENTRY}---"$'\n'

echo ""
echo "Changelog entry:"
echo "================"
echo -e "$CHANGELOG_ENTRY"
echo "================"

# ==================== Step 5: Dry run check ====================

if [ "$DRY_RUN" = "1" ]; then
    echo ""
    echo "[DRY RUN] Would update:"
    echo "  • project.yml: MARKETING_VERSION=$NEW_VERSION, CURRENT_PROJECT_VERSION=$NEW_BUILD"
    echo "  • CHANGELOG.md: prepend entry for $NEW_VERSION"
    echo "  • git commit: chore(release): v$NEW_VERSION"
    echo "  • git tag: v$NEW_VERSION"
    exit 0
fi

# ==================== Step 6: Update project.yml ====================

# macOS sed uses -i '' syntax
sed -i '' "s/MARKETING_VERSION: \"$CURRENT_VERSION\"/MARKETING_VERSION: \"$NEW_VERSION\"/" "$PROJECT_YML"
sed -i '' "s/CURRENT_PROJECT_VERSION: \"$BUILD_NUMBER\"/CURRENT_PROJECT_VERSION: \"$NEW_BUILD\"/" "$PROJECT_YML"

# ==================== Step 7: Update CHANGELOG.md ====================

if [ ! -f "$CHANGELOG" ]; then
    echo "# Changelog" > "$CHANGELOG"
    echo "" >> "$CHANGELOG"
fi

# Prepend changelog entry
{
    echo -e "$CHANGELOG_ENTRY"
    cat "$CHANGELOG"
} > /tmp/changelog_new.md
mv /tmp/changelog_new.md "$CHANGELOG"

# ==================== Step 8: Commit + tag ====================

git -C "$REPO_ROOT" add "$PROJECT_YML" "$CHANGELOG"
git -C "$REPO_ROOT" commit -m "chore(release): v$NEW_VERSION

Automatic version bump based on conventional commits"

git -C "$REPO_ROOT" tag "v$NEW_VERSION"

# ==================== Done ====================

echo ""
echo "✓ Released v$NEW_VERSION (build $NEW_BUILD)"
echo "  Tag: v$NEW_VERSION"
echo "  Next step: bash packages/ios-native/scripts/deploy.sh"
