#!/usr/bin/env bash
# run-debate-phase.sh — Review Mechanism v2 phase 2 cross-pollinate
#
# 给定 phase 1 的 arch + cross verdict，让两位 reviewer 互相阅读对方 verdict，
# 各产 react verdict。fresh context (新进程)，不复用对话历史。
#
# **本脚本是 M2 review-orchestrator 的 stub**（Round 1 arch m1 修复）：
# 当前是简单 cat 拼 prompt + 调 cursor-agent 的薄包装，不是 daemon。
# M2 实施 review-orchestrator.ts 时升级。
#
# 用法：
#   ./run-debate-phase.sh <artifact-name> <arch-verdict> <cross-verdict> <artifact-file1> [<artifact-file2>...]
#
# 例：
#   ./run-debate-phase.sh review-mech-v2 \
#     docs/reviews/review-mech-v2-arch-2026-05-03-1059.md \
#     docs/reviews/review-mech-v2-cross-2026-05-03-1058.md \
#     docs/proposals/REVIEW_MECHANISM_V2.md
#
# 输出：
#   docs/reviews/<artifact>-arch-react-<TS>.md  (cross 读 arch verdict 后的 react)
#   docs/reviews/<artifact>-cross-react-<TS>.md (arch 读 cross verdict 后的 react)
#
# 注意 swap：cross 的 react 由"看 arch verdict 的角度"产生，反之亦然。
# Cross-pollinate = A 看 B 写 + B 看 A 写。

set -euo pipefail

if [ $# -lt 4 ]; then
  echo "Usage: $0 <artifact-name> <arch-verdict> <cross-verdict> <artifact-file...>" >&2
  exit 64
fi

ARTIFACT_NAME="$1"; shift
ARCH_VERDICT="$1"; shift
CROSS_VERDICT="$1"; shift
ARTIFACT_FILES=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

PHASE2_PROMPT=~/.claude/skills/debate-review/PHASE_2_PROMPT.md
TS=$(date +%Y-%m-%d-%H%M)

# 检查输入
for f in "$ARCH_VERDICT" "$CROSS_VERDICT" "$PHASE2_PROMPT" "${ARTIFACT_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: file not found: $f" >&2
    exit 66
  fi
done

if ! command -v cursor-agent >/dev/null 2>&1; then
  echo "ERROR: cursor-agent not in PATH" >&2
  exit 69
fi

mkdir -p docs/reviews

# 拼 cross 的 phase 2 prompt（cross 读 arch verdict 后写 react）
build_prompt() {
  local reviewer_role="$1"
  local own_verdict="$2"
  local sibling_verdict="$3"

  cat "$PHASE2_PROMPT"
  echo
  echo "---"
  echo
  echo "## 实际填入"
  echo
  echo "### Artifact files (phase 1 已读)"
  echo
  for f in "${ARTIFACT_FILES[@]}"; do
    echo "#### \`$f\`"
    echo
    echo '```'
    cat "$f"
    echo '```'
    echo
  done
  echo
  echo "### 你 phase 1 的 verdict ($reviewer_role)"
  echo
  cat "$own_verdict"
  echo
  echo "### Sibling reviewer 的 phase 1 verdict"
  echo
  cat "$sibling_verdict"
  echo
  echo "---"
  echo
  echo "现在产出你的 phase 2 react verdict。"
}

# cross 读 arch（cross 是 own，arch 是 sibling）
CROSS_REACT_PROMPT=$(mktemp -t cross-react-prompt.XXXXXX)
build_prompt "reviewer-cross" "$CROSS_VERDICT" "$ARCH_VERDICT" > "$CROSS_REACT_PROMPT"

CROSS_REACT_OUT="docs/reviews/${ARTIFACT_NAME}-cross-react-${TS}.md"
echo "==> Running cross-pollinate: cross reads arch verdict (model: gpt-5.5-medium)"
cursor-agent --print --mode plan --model gpt-5.5-medium --output-format text \
  "$(cat "$CROSS_REACT_PROMPT")" > "$CROSS_REACT_OUT"
echo "==> $CROSS_REACT_OUT"
rm -f "$CROSS_REACT_PROMPT"

# arch 读 cross 的 react verdict 由 Agent (Claude) 产
# 不能从 shell 直接 spawn 一个 fresh-context Claude Agent；这部分由 author 在调用层 spawn
# 当前脚本仅产 cross 的 react；arch 的 react 由 author 通过 Agent tool 单独 spawn
echo
echo "==> NEXT STEP (manual, by author):"
echo "    Spawn Agent (subagent_type=general-purpose, fresh context) with prompt:"
echo "      Read $PHASE2_PROMPT"
echo "      You are reviewer-architecture (harness-architecture-review)."
echo "      Own verdict: $ARCH_VERDICT"
echo "      Sibling verdict: $CROSS_VERDICT"
echo "      Artifact files: ${ARTIFACT_FILES[*]}"
echo "      Output: docs/reviews/${ARTIFACT_NAME}-arch-react-${TS}.md"
echo
echo "    (M2 review-orchestrator.ts 会自动化这一步；当前 stub 范围内由 author 手动 spawn)"
