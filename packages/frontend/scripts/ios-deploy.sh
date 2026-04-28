#!/usr/bin/env bash
# One-shot iOS dev cycle: rebuild web → sync → xcodebuild → install → launch.
#
# Modes:
#   ./ios-deploy.sh          → deploy to physical device DEVICE_ID
#   ./ios-deploy.sh --sim    → deploy to currently booted iOS Simulator
#                              (faster, ideal for UI iteration)
#
# Device-mode workarounds explained:
# - iOS storyboard compiler emits .storyboardc dirs with com.apple.FinderInfo
#   xattrs that xcodebuild's codesign step rejects ("resource fork…"). We let
#   xcodebuild fail at codesign, strip the xattrs ourselves, then re-sign with
#   the identity hash parsed from xcodebuild's failure log.
# - iCloud Desktop sync continuously re-adds those xattrs under ~/Desktop, so
#   derivedDataPath lives in ~/Library/Developer/Xcode/DerivedData/... which
#   iCloud doesn't touch.
# Sim mode skips both — simulator builds don't codesign.

set -uo pipefail

MODE="${1:-device}"

DEVICE_ID="${DEVICE_ID:-C6B030B2-E211-57C5-957F-F2A40831937A}"
BUNDLE_ID="${BUNDLE_ID:-com.albertsun6.claudeweb}"
SCHEME="App"
CONFIG="${CONFIG:-Debug}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$PROJECT_DIR/ios/App"
BUILD_DIR="$HOME/Library/Developer/Xcode/DerivedData/claude-web-ios"

cd "$PROJECT_DIR"

# Sim runs on the host Mac so it can hit localhost directly (and that avoids
# Tailscale's self-loopback dead-zone where the Mac can't reach its own
# tailnet IP). Device builds keep the Tailscale URL.
if [[ "$MODE" == "--sim" || "$MODE" == "sim" ]]; then
  echo "[1/6] Build web with localhost URL (sim mode)"
  pnpm build:ios-sim > /tmp/_web_build.log 2>&1 || { tail -20 /tmp/_web_build.log; exit 1; }
else
  echo "[1/6] Build web with Tailscale URL baked in"
  pnpm build:ios > /tmp/_web_build.log 2>&1 || { tail -20 /tmp/_web_build.log; exit 1; }
fi

echo "[2/6] Sync dist into iOS bundle"
pnpm exec cap sync ios > /dev/null

cd "$IOS_DIR"

if [[ "$MODE" == "--sim" || "$MODE" == "sim" ]]; then
  # ---------- Simulator path ----------
  SIM_ID=$(xcrun simctl list devices booted 2>/dev/null | grep -oE '[A-F0-9-]{36}' | head -1)
  if [[ -z "$SIM_ID" ]]; then
    echo "no booted simulator. Boot one first:"
    echo "  xcrun simctl list devices available | grep iPhone"
    echo "  xcrun simctl boot <UDID>"
    echo "  open -a Simulator"
    exit 1
  fi
  APP_BUNDLE="$BUILD_DIR/Build/Products/$CONFIG-iphonesimulator/App.app"

  echo "[3/6] xcodebuild for simulator $SIM_ID"
  xcodebuild -project App.xcodeproj -scheme "$SCHEME" -configuration "$CONFIG" \
    -destination "platform=iOS Simulator,id=$SIM_ID" \
    -derivedDataPath "$BUILD_DIR" \
    -sdk iphonesimulator \
    CODE_SIGNING_ALLOWED=NO \
    build > /tmp/_xcodebuild.log 2>&1 || {
      echo "xcodebuild failed:"; tail -30 /tmp/_xcodebuild.log; exit 1;
    }

  echo "[4/6] (sim: no xattr / codesign needed)"
  echo "[5/6] Bring Simulator to front"
  open -a Simulator >/dev/null 2>&1 || true

  echo "[6/6] Install + launch in simulator"
  xcrun simctl install "$SIM_ID" "$APP_BUNDLE"
  xcrun simctl launch "$SIM_ID" "$BUNDLE_ID" > /tmp/_launch.log 2>&1 || {
    echo "launch failed:"; cat /tmp/_launch.log; exit 1;
  }

  echo
  echo "✓ launched in simulator $SIM_ID"
  echo "  inspect WebView: Safari → Develop → Simulator → Claude Web"
  echo "  log stream:      xcrun simctl spawn $SIM_ID log stream --predicate 'process == \"App\"'"
  exit 0
fi

# ---------- Physical device path ----------
APP_BUNDLE="$BUILD_DIR/Build/Products/$CONFIG-iphoneos/App.app"

echo "[3/6] xcodebuild (codesign step expected to fail; we re-sign manually)"
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
SIGN_HASH=$(grep -oE 'codesign[^\n]+--sign [A-F0-9]{40}' /tmp/_xcodebuild.log | head -1 \
  | grep -oE '[A-F0-9]{40}')
if [[ -z "$SIGN_HASH" || -z "$ENTITLEMENTS" ]]; then
  echo "could not resolve signing identity / entitlements"
  echo "  SIGN_HASH=$SIGN_HASH"
  echo "  ENTITLEMENTS=$ENTITLEMENTS"
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
