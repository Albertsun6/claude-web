#!/usr/bin/env bash
# cursor-review.sh — Vessel B' Phase 1 cross-reviewer (异质评审)
#
# 用 cursor-agent (gpt-5.5-medium, plan 模式) 跑 Phase 1 cross-review，作为
# vessel-architect / vessel-pragmatist / vessel-risk-officer (都在 Claude 主会话)
# 之外的第 4 位异质 reviewer。
#
# v5.4 lite 范围：仅 Phase 1（cross 单跑）。Phase 2 cross-pollinate 暂手动。
#
# 用法：
#   ./scripts/cursor-review.sh <artifact-name> <artifact-file1> [<artifact-file2>...]
#
# 例：
#   ./scripts/cursor-review.sh adr-017 \
#     docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md \
#     .claude/skills/reviewer-cross/SKILL.md \
#     scripts/cursor-review.sh
#
# 输出：
#   docs/reviews/<artifact-name>-cross-<YYYY-MM-DD-HHmm>.md
#
# 详见 docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md

set -euo pipefail

# --- 参数检查 ---
if [ $# -lt 2 ]; then
  cat >&2 <<EOF
ERROR: insufficient arguments

Usage: $0 <artifact-name> <artifact-file1> [<artifact-file2>...]

Example:
  $0 adr-017 \\
    docs/adr/vessel/ADR-017-cursor-cli-cross-reviewer.md \\
    .claude/skills/reviewer-cross/SKILL.md
EOF
  exit 64
fi

ARTIFACT_NAME="$1"; shift
ARTIFACT_FILES=("$@")

# m3 fix (self-dogfood 2026-05-09): 限制 ARTIFACT_NAME 字符防路径注入
if ! [[ "$ARTIFACT_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "ERROR: ARTIFACT_NAME must match [A-Za-z0-9._-]+; got: '$ARTIFACT_NAME'" >&2
  exit 64
fi

# 解析 --allow-private-paths（M2 fix preflight escape hatch）
ALLOW_PRIVATE_PATHS=0
NEW_FILES=()
for arg in "${ARTIFACT_FILES[@]}"; do
  if [[ "$arg" == "--allow-private-paths" ]]; then
    ALLOW_PRIVATE_PATHS=1
  else
    NEW_FILES+=("$arg")
  fi
done
ARTIFACT_FILES=("${NEW_FILES[@]}")

# --- 路径解析（脚本所在目录的上级 = Vessel 项目根） ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

SKILL_FILE=".claude/skills/reviewer-cross/SKILL.md"
LEARNINGS_FILE=".claude/skills/reviewer-cross/LEARNINGS.md"
TS=$(date +%Y-%m-%d-%H%M)
OUTPUT_FILE="docs/reviews/${ARTIFACT_NAME}-cross-${TS}.md"

# --- 工具 / 文件存在性检查 ---
if ! command -v cursor-agent >/dev/null 2>&1; then
  echo "ERROR: cursor-agent not in PATH (expected at ~/.local/bin/cursor-agent)" >&2
  echo "Install: open Cursor → Settings → CLI tools (or download from cursor.com/cli)" >&2
  exit 69
fi

CURSOR_VER=$(cursor-agent --version 2>&1 | head -1)
echo "==> cursor-agent version: $CURSOR_VER"

# M3 fix (self-dogfood 2026-05-09): 检查关键 flag 是否仍受支持
HELP_OUT=$(cursor-agent --help 2>&1)
for required_flag in "--print" "--mode" "--model" "--output-format"; do
  if ! echo "$HELP_OUT" | grep -q -- "$required_flag"; then
    echo "WARNING: cursor-agent --help does not mention '$required_flag'" >&2
    echo "         Version may have changed; review may fail. Continuing..." >&2
  fi
done
if ! echo "$HELP_OUT" | grep -q "plan:"; then
  echo "WARNING: 'plan' mode may no longer exist in cursor-agent; verify before reviewing sensitive artifacts" >&2
fi

for f in "$SKILL_FILE" "$LEARNINGS_FILE" "${ARTIFACT_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: file not found: $f" >&2
    exit 66
  fi
done

mkdir -p docs/reviews

# M2 fix (self-dogfood 2026-05-09): preflight 脱敏检查
# 在把 prompt 外发到 Cursor 服务器之前，扫 secrets / token / 私人路径
echo "==> Preflight: scanning artifacts for secrets / private paths ..."
PREFLIGHT_TMP=$(mktemp -t vessel-preflight.XXXXXX)
trap "rm -f $PREFLIGHT_TMP" EXIT
cat "${ARTIFACT_FILES[@]}" "$SKILL_FILE" "$LEARNINGS_FILE" > "$PREFLIGHT_TMP"

PREFLIGHT_FAIL=0

# Token-like 字符串（按 trace-redaction-spec §3b）
if grep -qE '\b(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{40,}|AKIA[0-9A-Z]{16})\b' "$PREFLIGHT_TMP"; then
  echo "ERROR: token-like string detected (sk- / AKIA prefix). Aborting outbound." >&2
  PREFLIGHT_FAIL=1
fi

# 私人路径（除 Vessel / claude-web / /tmp 外的 /Users/<name>/）
if [ "$ALLOW_PRIVATE_PATHS" -eq 0 ]; then
  PRIVATE_PATHS=$(grep -oE '/Users/[^/[:space:]]+/' "$PREFLIGHT_TMP" 2>/dev/null \
    | sort -u \
    | grep -vE '/Users/yongqian/(Desktop/Vessel|Desktop/claude-web|\.claude|\.cursor)' \
    || true)
  if [ -n "$PRIVATE_PATHS" ]; then
    echo "WARNING: detected user paths outside whitelist:" >&2
    echo "$PRIVATE_PATHS" | sed 's/^/  /' >&2
    echo "Pass --allow-private-paths to proceed (acknowledge they will be sent to Cursor servers)." >&2
    echo "Or sanitize artifacts before re-running." >&2
    PREFLIGHT_FAIL=1
  fi
fi

# gitleaks 兜底（如已装）
if command -v gitleaks >/dev/null 2>&1; then
  if ! gitleaks detect --no-git --source "$PREFLIGHT_TMP" --no-banner 2>&1 | tail -1 | grep -q "no leaks found"; then
    echo "ERROR: gitleaks detected potential secrets. Aborting outbound." >&2
    echo "Run: gitleaks detect --no-git --source $PREFLIGHT_TMP -v   to inspect." >&2
    PREFLIGHT_FAIL=1
  fi
fi

if [ "$PREFLIGHT_FAIL" -ne 0 ]; then
  echo "" >&2
  echo "Preflight failed. cursor-agent NOT invoked." >&2
  exit 65
fi

echo "==> Preflight passed; proceeding with cursor-agent invocation."
echo

# --- 拼装 prompt（SKILL + LEARNINGS + artifacts + task） ---
PROMPT_FILE=$(mktemp -t vessel-cross-prompt.XXXXXX)
trap "rm -f $PROMPT_FILE" EXIT

{
  echo "# Vessel Cross Review — Phase 1"
  echo
  echo "你是 vessel-cross-reviewer。读完下面的 SKILL 定义 + LEARNINGS + artifact 文件，"
  echo "按 SKILL 里的 Verdict Output Format 输出 markdown verdict。**不要修改任何文件**。"
  echo
  echo "---"
  echo
  echo "## SKILL 定义"
  echo
  cat "$SKILL_FILE"
  echo
  echo "---"
  echo
  echo "## 累积 LEARNINGS"
  echo
  cat "$LEARNINGS_FILE"
  echo
  echo "---"
  echo
  echo "## Files to review"
  echo
  for f in "${ARTIFACT_FILES[@]}"; do
    echo "### \`$f\`"
    echo
    echo '```'
    cat "$f"
    echo '```'
    echo
  done
  echo
  echo "---"
  echo
  echo "## Your task"
  echo
  echo "1. 按 5 个 Lens（正确性 / 跨端对齐 / Eva 改造+硬约束 / 安全+4 类硬触发 / 集体盲区检测）扫一遍上述 artifact"
  echo "2. **Lens 5（集体盲区检测）必须每次至少尝试一条**——你是异质 GPT 模型，专找其他 3 个 Claude reviewer 共有偏见"
  echo "3. 按 SKILL 的 Verdict Output Format 输出 markdown"
  echo "4. 列至少 3 条 finding（minor 也算）；如 5 lens 都搜了 0 finding，明说 'no findings'"
  echo "5. 不允许 'looks good overall' 廉价批准"
  echo "6. 每条 finding 必须有具体引用（文件:行号 / 字段名 / 段落 §）"
  echo "7. 拿不准的标 'F? uncertain' 而不是直接打 BLOCKER"
} > "$PROMPT_FILE"

PROMPT_BYTES=$(wc -c < "$PROMPT_FILE")
echo "==> Prompt size: $PROMPT_BYTES bytes"

# --- 调用 cursor-agent ---
echo "==> Running cursor-agent --print --mode plan --model gpt-5.5-medium ..."
echo "    Output → $OUTPUT_FILE"
echo

cursor-agent --print \
             --mode plan \
             --model gpt-5.5-medium \
             --output-format text \
             "$(cat "$PROMPT_FILE")" \
             > "$OUTPUT_FILE"

VERDICT_BYTES=$(wc -c < "$OUTPUT_FILE")
echo
echo "==> Verdict written: $OUTPUT_FILE ($VERDICT_BYTES bytes)"

# --- 后续提示 ---
cat <<EOF

==> Next steps (manual, v5.4 lite):
    1. Read $OUTPUT_FILE
    2. If you also want vessel-architect / vessel-pragmatist / vessel-risk-officer
       Phase 1 verdicts (Claude reviewers), run them in main session by playing
       the prompts in docs/adr/vessel/ADR-014-review-workflow.md Appendix A
    3. Phase 2 cross-pollinate: manually pass each reviewer's verdict to others
       and ask for react verdict (4 档: agree/disagree-with-evidence/refine/not-reviewed)
    4. Phase 3: use ~/.claude/skills/debate-review/SKILL.md to arbitrate
    5. Run Verify Gate 5 项 (manual)

==> v5.4 lite intentionally does NOT automate Phase 2 / 3 / Verify Gate.
    See docs/adr/vessel/ADR-014-review-workflow.md §「v5.4 lite 收缩边界」
EOF
