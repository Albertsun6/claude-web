---
name: update-manual
description: |
  Use when the claude-web project has user-visible changes that need to be reflected in
  docs/USER_MANUAL.md. Auto-trigger heuristics — fire this skill when ANY of these are true:
    1. The user just said one of: "完成了", "做完了", "搞定", "ship 了", "更新手册", "记到手册",
       "/update-manual", or asked you to add/document a feature.
    2. You just finished a multi-step feature implementation (≥ 2 file edits across user-facing
       areas like UI components, voice flow, slash commands, env vars, deployment, security).
    3. A `git commit` you just made has subject starting with `feat:`, `fix(ui):`, `docs:`,
       or otherwise touches user-visible behavior.
  Skip when changes are purely internal (refactor / typing / test-only / lint).
---

# update-manual skill

Keeps `docs/USER_MANUAL.md` in sync with reality.

## Step 1 — find the gap

Run:
```bash
git log --oneline -1 docs/USER_MANUAL.md   # last manual update
LAST=$(git log -1 --format=%H docs/USER_MANUAL.md)
git log --oneline "$LAST"..HEAD             # what's happened since
```

For each commit since the last manual update, run `git show <sha>` and skim the diff. Categorize each commit:

- **user-visible** (UI, voice, slash, env vars, deploy, security, persistence, mobile UX) → needs manual entry
- **internal** (refactor, types, tests-only, deps) → skip

## Step 2 — read the manual structure

Read `docs/USER_MANUAL.md`. Note its 16 top-level sections (索引). New features should slot into existing sections; only add a new top-level section if a genuinely new category appears (rare).

## Step 3 — surgical edits

For each user-visible commit:

- **New feature** → add an entry in the right section. Match the existing prose style:
  - Brief, direct
  - Concrete behaviors not marketing
  - Voice commands shown in `**bold**`, keys in `⌘+Enter` style, paths as `[file](packages/.../x.ts)` links
- **Removed feature** → strike from manual; if it left a redirect, mention what replaced it
- **Changed shortcut / endpoint / env var** → update the speed-table at bottom + body text where mentioned
- **New persistence key** → add row to "持久化清单"
- **New test command** → add to "测试命令"
- **New troubleshooting case** → add to "故障排查"

Never rewrite unrelated sections. Use `Edit` tool with anchored `old_string`.

## Step 4 — preview

Show the user a `git diff docs/USER_MANUAL.md`. Say something like:

> 更新了 N 处，主要是：[一句话总结]。提交吗？

## Step 5 — commit if approved

```bash
git add docs/USER_MANUAL.md
git commit -m "docs: update user manual — <feature summary>"
```

Use a single line subject. Reference the commits being documented if helpful.

## Don't

- Don't create a new manual file. Edit the existing one in place.
- Don't bulk-rewrite — only touch sections that need changing.
- Don't auto-commit without showing the diff first.
- Don't trigger if the most recent commits are already documented (idempotent).
- Don't add features that aren't in the codebase yet (manual reflects reality, not aspiration).

## Style anchors

The manual uses these conventions; preserve them:

- Top-level sections: `## 标题` with leading emoji-free Chinese names
- Tables for option matrices (`| 选项 | 说明 |`)
- Voice commands quoted with `**`: `**发送**`
- File paths as links: `[file.ts](packages/.../file.ts)`
- localStorage keys: `\`claude-web:key-name\``
- env vars: `\`CLAUDE_WEB_TOKEN\``
- 1-line section descriptions, not paragraphs
- Bullet lists max 5-7 items, otherwise table

## Companion docs

These have different purposes — don't confuse them:

- `docs/USER_MANUAL.md` — what works **today**. End-user reference.
- `docs/IDEAS.md` — what we **thought about but didn't build**. Future spike list.
- `docs/IMPROVEMENTS.md` — historic improvement audit (mostly done).
- `docs/MOBILE_VOICE.md` — voice strategy exploration (mostly captured in manual now).
- `docs/ENTERPRISE_INTERNAL.md` — speculative migration plan to multi-user.
- `CLAUDE.md` — architecture brief for new Claude sessions.

If a commit adds a new IDEA (deferred work), update `IDEAS.md` instead of the manual.
