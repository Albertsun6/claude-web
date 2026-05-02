#!/usr/bin/env bash
# Native iOS app build → install → launch.
#
# Modes:
#   ./deploy.sh         → physical device DEVICE_ID
#   ./deploy.sh --sim   → currently booted iOS Simulator
#   ./deploy.sh --all   → both (sim first, then device)
#
# Note vs the Capacitor deploy script: there's no web build step, no xattr
# dance (no .storyboardc — pure SwiftUI), and the sim path can use the host
# Mac's networking directly to reach localhost:3030.

set -uo pipefail

MODE="${1:-device}"
DEVICE_ID="${DEVICE_ID:-C6B030B2-E211-57C5-957F-F2A40831937A}"
BUNDLE_ID="${BUNDLE_ID:-com.albertsun6.claudeweb-native}"
SCHEME="ClaudeWeb"
CONFIG="${CONFIG:-Debug}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$HOME/Library/Developer/Xcode/DerivedData/claude-web-native"

cd "$PROJECT_DIR"

# Generate BuildInfo.swift + bump build number BEFORE xcodegen so the new
# .swift file is picked up and project.yml's CURRENT_PROJECT_VERSION is fresh.
bash "$PROJECT_DIR/scripts/buildinfo.sh"

# Regenerate Xcode project from yml in case sources / settings changed.
xcodegen generate > /dev/null

# --all: sim first, then device. Sim is faster + tells us if there's a
# build / runtime issue before we wait for the device install.
if [[ "$MODE" == "--all" || "$MODE" == "all" ]]; then
  echo ">>> deploying to simulator <<<"
  "$0" --sim || exit 1
  echo
  echo ">>> deploying to device <<<"
  exec "$0"
fi

if [[ "$MODE" == "--sim" || "$MODE" == "sim" ]]; then
  SIM_ID=$(xcrun simctl list devices booted 2>/dev/null | grep -oE '[A-F0-9-]{36}' | head -1)
  if [[ -z "$SIM_ID" ]]; then
    echo "no booted simulator. Boot one first:"
    echo "  xcrun simctl boot <UDID>; open -a Simulator"
    exit 1
  fi
  APP_BUNDLE="$BUILD_DIR/Build/Products/$CONFIG-iphonesimulator/$SCHEME.app"

  echo "[1/3] xcodebuild for simulator $SIM_ID"
  xcodebuild -project ClaudeWeb.xcodeproj -scheme "$SCHEME" -configuration "$CONFIG" \
    -destination "platform=iOS Simulator,id=$SIM_ID" \
    -derivedDataPath "$BUILD_DIR" \
    -sdk iphonesimulator \
    CODE_SIGNING_ALLOWED=NO \
    build > /tmp/_xcodebuild_native.log 2>&1 || {
      echo "xcodebuild failed:"; tail -40 /tmp/_xcodebuild_native.log; exit 1;
    }

  echo "[2/3] Install + launch in simulator"
  xcrun simctl install "$SIM_ID" "$APP_BUNDLE"
  open -a Simulator >/dev/null 2>&1 || true
  xcrun simctl launch "$SIM_ID" "$BUNDLE_ID" > /tmp/_launch.log 2>&1 || {
    echo "launch failed:"; cat /tmp/_launch.log; exit 1;
  }

  echo "[3/3] ✓ launched in simulator $SIM_ID"
  echo "  log:   xcrun simctl spawn $SIM_ID log stream --predicate 'subsystem contains \"ClaudeWeb\"'"
  exit 0
fi

# Physical device
APP_BUNDLE="$BUILD_DIR/Build/Products/$CONFIG-iphoneos/$SCHEME.app"

echo "[1/3] xcodebuild for device"
xcodebuild -project ClaudeWeb.xcodeproj -scheme "$SCHEME" -configuration "$CONFIG" \
  -destination "id=$DEVICE_ID" \
  -allowProvisioningUpdates \
  -derivedDataPath "$BUILD_DIR" \
  build > /tmp/_xcodebuild_native.log 2>&1 || {
    echo "xcodebuild failed:"; tail -40 /tmp/_xcodebuild_native.log; exit 1;
  }

echo "[2/3] Install + launch on device"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_BUNDLE" > /tmp/_install.log 2>&1 || {
  echo "install failed:"; tail -20 /tmp/_install.log; exit 1;
}
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" --terminate-existing > /tmp/_launch.log 2>&1 || {
  echo "launch failed:"; tail -20 /tmp/_launch.log; exit 1;
}

MV=$(grep marketingVersion "$PROJECT_DIR/Sources/ClaudeWeb/BuildInfo.swift" | sed -E 's/.*"([^"]+)".*/\1/')
BN=$(grep 'static let buildNumber' "$PROJECT_DIR/Sources/ClaudeWeb/BuildInfo.swift" | sed -E 's/.*"([^"]+)".*/\1/')
SHA=$(grep gitSha "$PROJECT_DIR/Sources/ClaudeWeb/BuildInfo.swift" | sed -E 's/.*"([^"]+)".*/\1/')
echo "[3/3] ✓ deployed Seaidea v${MV} (build ${BN}) · ${SHA} on $DEVICE_ID"
