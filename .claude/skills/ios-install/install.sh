#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../packages/ios-native" && pwd)"
BUNDLE_ID="com.albertsun6.claudeweb-native"
SCHEME="ClaudeWeb"

echo "🔧 iOS App Installer for Seaidea"
echo "=================================="

# 检测设备
echo ""
echo "📱 Detecting devices..."

# 模拟器列表
SIMULATORS=$(xcrun simctl list devices available 2>/dev/null | grep -E "iPhone|iPad" | grep -v "Shutdown" | awk '{print $NF}' | tr -d '()' | sort -u)

# 真机列表（如果连接）
DEVICES=$(system_profiler SPUSBDataType 2>/dev/null | grep -A 3 "iPad\|iPhone" | grep "Serial" | awk '{print $3}' || echo "")

# 汇总设备列表
if [ -z "$SIMULATORS" ] && [ -z "$DEVICES" ]; then
    echo "❌ No devices found. Please connect a device or start a simulator."
    exit 1
fi

echo "Available devices:"
if [ -n "$SIMULATORS" ]; then
    echo "  Simulators:"
    echo "$SIMULATORS" | nl
fi
if [ -n "$DEVICES" ]; then
    echo "  Connected Devices:"
    echo "$DEVICES" | nl
fi

# 如果提供了设备名，直接使用
if [ -n "$1" ]; then
    DEVICE_NAME="$1"
    echo ""
    echo "📍 Target: $DEVICE_NAME"
else
    echo ""
    read -p "📍 Enter device name or number: " DEVICE_INPUT
    
    # 如果是数字，转换为设备名
    if [[ "$DEVICE_INPUT" =~ ^[0-9]+$ ]]; then
        DEVICE_NAME=$(echo "$SIMULATORS" | sed -n "${DEVICE_INPUT}p")
    else
        DEVICE_NAME="$DEVICE_INPUT"
    fi
fi

# 构建应用
echo ""
echo "🔨 Building app for $DEVICE_NAME..."
cd "$PROJECT_ROOT"

if echo "$SIMULATORS" | grep -q "$DEVICE_NAME"; then
    # 模拟器
    PLATFORM="iOS Simulator"
    DEST="generic/platform=iOS Simulator,name=$DEVICE_NAME"
else
    # 真机
    PLATFORM="iOS"
    DEST="generic/platform=iOS"
fi

xcodebuild \
    -scheme "$SCHEME" \
    -configuration Debug \
    -destination "$DEST" \
    -derivedDataPath build_install \
    build \
    | grep -E "Build complete|error:" || true

echo "✅ Build complete"

# 启动应用
echo ""
echo "🚀 Launching app..."

if echo "$SIMULATORS" | grep -q "$DEVICE_NAME"; then
    # 模拟器启动
    UDID=$(xcrun simctl list devices available | grep "$DEVICE_NAME" | awk -F'[()]' '{print $(NF-1)}')
    xcrun simctl launch "$UDID" "$BUNDLE_ID" > /dev/null 2>&1 || echo "⚠️  App may not be installed. Try manual installation via Xcode."
else
    # 真机启动 (需要 ios-deploy)
    if command -v ios-deploy &> /dev/null; then
        ios-deploy -i "$DEVICE_NAME" -m
    else
        echo "⚠️  ios-deploy not found. Please install: npm install -g ios-deploy"
    fi
fi

echo "✅ Done!"
