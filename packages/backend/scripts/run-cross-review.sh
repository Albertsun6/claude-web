#!/usr/bin/env bash
# run-cross-review.sh
#
# 调 cursor-agent (非 Claude judge) 跑 reviewer-cross skill 评审 harness 契约。
# 用 plan 模式（read-only）防 reviewer 误改文件。
# Verdict 写到 docs/reviews/<artifact-name>-cross-<YYYY-MM-DD-HHmm>.md。
#
# 用法：
#   ./run-cross-review.sh <artifact-name> <file1> [file2 ...]
#
# 例：
#   ./run-cross-review.sh contract-1-data-model \
#       docs/HARNESS_DATA_MODEL.md \
#       docs/adr/ADR-0010-sqlite-fts5.md \
#       docs/adr/ADR-0015-schema-migration.md \
#       packages/backend/src/migrations/0001_initial.sql

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <artifact-name> <file1> [file2 ...]" >&2
  exit 64
fi

ARTIFACT_NAME="$1"
shift
FILES=("$@")

# 锁定到项目根
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$ROOT"

SKILL_FILE=".claude/skills/reviewer-cross/SKILL.md"
LEARNINGS_FILE=".claude/skills/reviewer-cross/LEARNINGS.md"
TS=$(date +%Y-%m-%d-%H%M)
OUT_FILE="docs/reviews/${ARTIFACT_NAME}-cross-${TS}.md"

mkdir -p docs/reviews

# 检查必需工具
if ! command -v cursor-agent >/dev/null 2>&1; then
  echo "ERROR: cursor-agent not in PATH. Install Cursor and run install-shell-integration." >&2
  exit 69
fi

# 检查所有目标文件存在
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: file not found: $f" >&2
    exit 66
  fi
done

# 拼 prompt：SKILL + LEARNINGS + 待审 artifact 清单 + 待审内容
PROMPT_FILE=$(mktemp -t reviewer-cross-prompt.XXXXXX)
trap "rm -f $PROMPT_FILE" EXIT

{
  echo "## SKILL definition (你的角色)"
  echo
  cat "$SKILL_FILE"
  echo
  echo "---"
  echo
  echo "## Past LEARNINGS (历史评审沉淀的复用规则)"
  echo
  cat "$LEARNINGS_FILE"
  echo
  echo "---"
  echo
  echo "## Files to review (待审 artifact)"
  echo
  for f in "${FILES[@]}"; do
    echo "### \`$f\`"
    echo
    echo '```'
    cat "$f"
    echo '```'
    echo
  done
  echo "---"
  echo
  echo "## Your task"
  echo
  echo "Per SKILL.md 的 Verdict Output Format，输出 review markdown。直接打印到 stdout，不要修改任何文件，不要调用 shell 命令。"
  echo
  echo "Reviewer name: reviewer-cross"
  echo "Model: gpt-5.5-medium (via cursor-agent CLI)"
  echo "Date: $(date '+%Y-%m-%d %H:%M')"
  echo "Files reviewed: ${FILES[*]}"
  echo
  echo "如果 5 个 lens 都搜过 0 finding，明说"NO BLOCKERS, NO MAJORS, NO MINORS"。否则按 [BLOCKER]/[MAJOR]/[MINOR] 层级列。"
} > "$PROMPT_FILE"

echo "==> Running cursor-agent reviewer-cross on $ARTIFACT_NAME ($(wc -l < $PROMPT_FILE) line prompt)"
echo "==> Verdict will be written to: $OUT_FILE"
echo

# cursor-agent --print --mode plan：只读模式，不允许写 / 不允许 shell
# --model gpt-5.5-medium：1M context, 非 Claude judge
cursor-agent --print \
  --mode plan \
  --model gpt-5.5-medium \
  --output-format text \
  "$(cat "$PROMPT_FILE")" \
  > "$OUT_FILE"

echo
echo "==> Verdict written: $OUT_FILE"
wc -l "$OUT_FILE"
