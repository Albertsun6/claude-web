---
description: Sync docs/USER_MANUAL.md with recent user-visible commits
---

Run the `update-manual` skill workflow:

1. `git log --oneline -1 docs/USER_MANUAL.md` to find the last manual update
2. `LAST=$(git log -1 --format=%H docs/USER_MANUAL.md)` then `git log --oneline "$LAST"..HEAD`
3. For each commit since, `git show <sha>` and classify user-visible vs internal
4. Read `docs/USER_MANUAL.md`, slot new entries into existing sections (don't bulk-rewrite)
5. Match the manual's existing prose style — voice commands in `**bold**`, file paths as links, terse 1-line section descriptions
6. Show me `git diff docs/USER_MANUAL.md` and a one-sentence summary, ask before committing
7. On approval: `git commit -m "docs: update user manual — <summary>"`

Hard rules: don't add features that aren't in the codebase, don't auto-commit before showing the diff, don't touch unrelated sections. See `.claude/skills/update-manual/SKILL.md` for the full style guide.
