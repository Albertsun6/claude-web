#!/usr/bin/env bash
# One-shot iOS dev cycle: rebuild web → sync → xcodebuild → strip xattrs →
# re-codesign → install on phone → launch.
#
# Why the xattr dance: iOS's storyboard compiler emits .storyboardc dirs that
# carry com.apple.FinderInfo xattrs, which xcodebuild's own codesign step
# rejects ("resource fork, Finder information, or similar detritus not allowed").
# Workaround: run xcodebuild WITH codesigning (expect codesign to fail but the
# rest of the build to succeed and generate App.app + .xcent), strip xattrs,
# then run codesign ourselves with the team's identity.

set -uo pipefail

DEVICE_ID="${DEVICE_ID:-C6B030B2-E211-57C5-957F-F2A40831937A}"
BUNDLE_ID="${BUNDLE_ID:-com.albertsun6.claudeweb}"
SCHEME="App"
CONFIG="${CONFIG:-Debug}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$PROJECT_DIR/ios/App"
BUILD_DIR="$HOME/Library/Developer/Xcode/DerivedData/claude-web-ios"
APP_BUNDLE="$BUILD_DIR/Build/Products/$CONFIG-iphoneos/App.app"

cd "$PROJECT_DIR"

echo "[1/6] Build web with Tailscale URL baked in"
pnpm build:ios > /tmp/_web_build.log 2>&1 || { tail -20 /tmp/_web_build.log; exit 1; }

echo "[2/6] Sync dist into iOS bundle"
pnpm exec cap sync ios > /dev/null

cd "$IOS_DIR"

echo "[3/6] xcodebuild (codesign step expected to fail; we re-sign manually)"
# Expect non-zero exit (codesign failure) — keep going. The .app and .xcent
# files exist after the failure.
xcodebuild -project App.xcodeproj -scheme "$SCHEME" -configuration "$CONFIG" \
  -destination "id=$DEVICE_ID" \
  -allowProvisioningUpdates \
  -derivedDataPath "$BUILD_DIR" \
  build > /tmp/_xcodebuild.log 2>&1 || true

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "build never produced $APP_BUNDLE — real failure:"
  tail -30 /tmp/_xcodebuild.log
  exit 1
fi

echo "[4/6] Strip xattrs from .app bundle"
find "$APP_BUNDLE" -exec xattr -c {} + 2>/dev/null || true

echo "[5/6] Manually codesign the .app"
ENTITLEMENTS=$(find "$BUILD_DIR" -name "App.app.xcent" | head -1)
# Derive signing identity hash from showBuildSettings → use whatever team is wired up
SIGN_HASH=$(grep -oE 'codesign[^\n]+--sign [A-F0-9]{40}' /tmp/_xcodebuild.log | head -1 \
  | grep -oE '[A-F0-9]{40}')
if [[ -z "$SIGN_HASH" || -z "$ENTITLEMENTS" ]]; then
  echo "could not resolve signing identity / entitlements"
  echo "  SIGN_HASH=$SIGN_HASH"
  echo "  ENTITLEMENTS=$ENTITLEMENTS"
  echo "  inspect /tmp/_xcodebuild.log for the codesign line"
  exit 1
fi
codesign --force --sign "$SIGN_HASH" \
  --entitlements "$ENTITLEMENTS" \
  --timestamp=none \
  --generate-entitlement-der \
  "$APP_BUNDLE"

echo "[6/6] Install + launch on device"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_BUNDLE" > /tmp/_install.log 2>&1 || {
  echo "install failed:"; tail -20 /tmp/_install.log; exit 1;
}
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" --terminate-existing > /tmp/_launch.log 2>&1 || {
  echo "launch failed:"; tail -20 /tmp/_launch.log; exit 1;
}

echo
echo "✓ deployed + launched on $DEVICE_ID"
echo "  log stream: xcrun devicectl device console --device $DEVICE_ID"
