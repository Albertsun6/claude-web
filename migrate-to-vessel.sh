#!/bin/bash
# migrate-to-vessel.sh
# 把项目从 ~/Desktop/AIOS/ 改名到 ~/Desktop/Vessel/
# 同时把 Claude Code 的 project memory 目录也改名（保留 conversation log + memory）
#
# ⚠️ 必须在「关闭当前 Claude Code session」之后再运行

set -euo pipefail

OLD_PROJECT="/Users/yongqian/Desktop/AIOS"
NEW_PROJECT="/Users/yongqian/Desktop/Vessel"
OLD_CC_DIR="/Users/yongqian/.claude/projects/-Users-yongqian-Desktop-AIOS"
NEW_CC_DIR="/Users/yongqian/.claude/projects/-Users-yongqian-Desktop-Vessel"

echo "=== Vessel 迁移脚本 ==="
echo ""
echo "将要执行："
echo "  $OLD_PROJECT  →  $NEW_PROJECT"
echo "  $OLD_CC_DIR  →  $NEW_CC_DIR"
echo "  + 更新 memory 文件里的绝对路径引用"
echo ""

# Pre-flight checks
echo "→ Pre-flight checks..."
[ -d "$OLD_PROJECT" ] || { echo "❌ 旧项目目录不存在: $OLD_PROJECT"; exit 1; }
[ ! -e "$NEW_PROJECT" ] || { echo "❌ 新目录已存在，请先处理: $NEW_PROJECT"; exit 1; }
[ -d "$OLD_CC_DIR" ] || { echo "❌ 旧 Claude Code 目录不存在: $OLD_CC_DIR"; exit 1; }
[ ! -e "$NEW_CC_DIR" ] || { echo "❌ 新 Claude Code 目录已存在: $NEW_CC_DIR"; exit 1; }

# 检查是否还有 Claude Code 进程在跑
if pgrep -f "claude-code" > /dev/null 2>&1; then
  echo "⚠️  检测到 claude-code 进程还在运行——请先关闭所有 Claude Code session 再运行此脚本"
  echo "    可用 'pkill -f claude-code' 强制关闭（数据安全），或手动退出"
  exit 1
fi

echo "✓ Pre-flight 通过"
echo ""

# Step 1: 移动项目目录
echo "→ Step 1/3: 移动项目目录"
mv "$OLD_PROJECT" "$NEW_PROJECT"
echo "   ✓ $NEW_PROJECT"

# Step 2: 移动 Claude Code 项目目录（含 conversation log 和 memory）
echo "→ Step 2/3: 移动 Claude Code project 目录"
mv "$OLD_CC_DIR" "$NEW_CC_DIR"
echo "   ✓ $NEW_CC_DIR"

# Step 3: 更新 memory 文件里写死的绝对路径
echo "→ Step 3/3: 更新 memory 文件里的路径引用"
find "$NEW_CC_DIR/memory" -name "*.md" -type f -exec sed -i '' \
  's|/Users/yongqian/Desktop/AIOS|/Users/yongqian/Desktop/Vessel|g' {} \;
echo "   ✓ memory/*.md 已批量更新"

echo ""
echo "✅ 迁移完成"
echo ""
echo "下一步："
echo "  1. cd $NEW_PROJECT"
echo "  2. 重启 Claude Code（在 Vessel 目录下打开新 session）"
echo "  3. 检查 ARCHITECTURE.md 能正常打开、memory 能被加载"
echo ""
echo "如要确认改动："
echo "  ls $NEW_PROJECT"
echo "  ls $NEW_CC_DIR"
echo "  grep -r 'Desktop/AIOS' $NEW_CC_DIR  # 应该没输出，全改成 Vessel 了"
