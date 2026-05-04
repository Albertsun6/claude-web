# Phase 1 Review — Cross-correctness lens
> Reviewer: reviewer-cross · Date: 2026-05-03 · Phase 1 (independent)

## Summary verdict
ACCEPT-WITH-CHANGES — proposal is sound research, no irreversible commitments. 2 MAJOR factual claims to soften, 4 MINOR cross-end / scope corrections, 1 false-positive candidate I cannot verify offline.

## Findings

### F1. pnpm workspace + node_modules symlink claim is hand-wavy — [MAJOR]
**Lens**: correctness
**Where**: §5.A bullet 3 ("node_modules symlink 复用主 cwd") + §9 Q3
This is a pnpm v9 workspace (root `pnpm-workspace.yaml` → `packages/*`). pnpm symlinks each package's `node_modules` into a shared `.pnpm/` content store at the **workspace root**, AND every workspace package has its own `node_modules` symlinked to siblings (e.g. `packages/backend/node_modules/@claude-web/shared` → `../../shared`). A single root-level `ln -s ../main-cwd/node_modules` in a worktree therefore breaks: (a) the worktree's `packages/backend/node_modules/@claude-web/shared` symlink still points at the **main cwd's** `packages/shared`, so editing `packages/shared/src/*.ts` in the worktree is invisible to the worktree's backend at runtime; (b) any `pnpm install` inside the worktree mutates the shared `.pnpm` store, racing the main cwd; (c) `package.json` edits in the worktree won't trigger reinstall.
**Suggested fix**: §5.A change "symlink 复用" → "Stage A 起步策略：worktree 复制（不 symlink）`node_modules` + `pnpm-lock.yaml`，禁止在 worktree 里跑 `pnpm install`；Stage B 再决定要不要做 pnpm-aware sharing"。Promote §9 Q3 from "open question" to "Stage A 准入门槛"。

### F2. "One spectacular crash" attribution overstated — [MAJOR / FALSE-POSITIVE-CANDIDATE]
**Lens**: correctness
**Where**: §3 row 1 + §2.a bullet 3
Claim: Microsoft article title "就是 'One spectacular crash'". I cannot fetch the URL in this independent phase, but the Microsoft Tech Community blog series is titled "The Swarm Diaries". "One spectacular crash" reads like a sub-heading or pulled quote, not the article title. The framing turns one anecdote into a load-bearing argument for "5 agents = bad". If the actual conclusion is more nuanced (e.g. "5 swarm survived 8/10 tasks; one integration cascade failed"), the report's `MAX_PARALLEL hard cap = 4` (§6.2) loses its empirical backing.
**Suggested fix**: replace exact-title quote with paraphrase ("Microsoft 的 swarm 实验里 5-agent 集成阶段出现一次集成失败"); add direct paste of the conclusion paragraph from the article into §3 footnote so reviewers can verify without re-fetching.

### F3. `issue_dependencies(parent, child, kind)` is over-modeled for Stage B — [MINOR]
**Lens**: simplification
**Where**: §5.B bullet 1
Schema has a 2-row enum (`blocks | related`) and a junction table for an N-to-N edge that, in §6.4, is hard-capped to "blocks/related 两类" only. For "blocks", a single nullable FK `issue.blocks_issue_id REFERENCES issue(id)` covers the common-case single upstream, costs zero migration risk, and survives drop-and-replace if the model proves wrong. The junction table only earns its keep when an Issue legitimately has multiple `blocks` parents — which the report does not justify. "related" is bidirectional non-blocking metadata that arguably belongs in `labels_json`, not a relational edge.
**Suggested fix**: §5.B change to "加 `issue.blocks_issue_id TEXT NULL REFERENCES issue(id)` 单列。多上游需求出现 ≥3 次再升级到 `issue_dependencies` 中间表（参考 HARNESS_DATA_MODEL §1.10 stage_artifact 同款 dogfood gate）"。

### F4. iOS dependency picker assumes Issue table exists on iOS — [MAJOR]
**Lens**: cross-end
**Where**: §5.B bullet 2
`packages/ios-native/Sources/ClaudeWeb/Views/InboxListView.swift` is the current "triage UI". Today its rows show `InboxItem` (carbon copy of backend `inbox-store.ts`'s JSONL row). There is **no Issue model on iOS** — `Issue` lives only in `harness.db` server-side, with no iOS Codable, no `IssueAPI`, no list endpoint. A "depends-on which Issue" picker requires: backend `GET /api/harness/issues?status=planned`, Swift `IssueDTO`, list view, search-by-title (iOS row is small — picker needs full screen sheet), and offline cache invalidation rules. None of this is scoped in §5.B's "1 周".
**Suggested fix**: split §5.B into B1 (backend-only: schema + harness-store CRUD + `/api/harness/issues` list) and B2 (iOS picker, depending on B1 + cross-end DTO contract). B2 should explicitly list the new contract artifacts (Zod schema, Swift Codable, fixtures). Alternatively defer the iOS picker to Stage C and let Stage B be web-only.

### F5. Worktree path is server-supplied — needs allowlist + path-traversal guard — [MAJOR]
**Lens**: security
**Where**: §5.A "backend `POST /api/worktrees`"
Existing `verifyAllowedPath` in `auth.ts` gates `cwd` against `CLAUDE_WEB_ALLOWED_ROOTS`. A new worktree endpoint must:
1. Verify the **source** repo cwd is in the allowlist (so an attacker can't `git worktree add` from `/etc`).
2. Verify the **destination** path (`~/.claude-web-worktrees/<id>` per the proposal) is **not** user-supplied — generate it server-side from a UUID, never accept a `path` field in the POST body.
3. Add `~/.claude-web-worktrees/` to the allowlist automatically (or auto-treat it as allowed) so the new conversation that runs in the worktree doesn't fail `verifyAllowedPath` at WS `user_prompt` time. `index.ts:343` calls `verifyAllowedPath(msg.cwd)` on every prompt — this is the cross-end coupling the proposal misses.
4. **Discrepancy with IDEAS P1**: the existing P1 entry (IDEAS line 81) puts the worktree at `<cwd>/.claude-worktrees/<convId>`, the proposal puts it at `~/.claude-web-worktrees/`. Pick one and document why; otherwise H7 and the new proposal will collide.
**Suggested fix**: §5.A add a 4-line "API contract" sub-bullet listing the request shape (no path field; server picks), the allowlist semantics, and the auto-cleanup-on-finalize behavior. Reconcile with IDEAS P1 path choice.

### F6. Telegram fan-out has zero throttling — §9 Q4 is real, not hypothetical — [MAJOR]
**Lens**: cross-end / simplification
**Where**: §9 Q4 + §5.C bullet 4
Verified: `packages/backend/src/notifications/channels/telegram.ts:51` `sendSessionCompletion` does a synchronous `fetch` per call with **no batching, no throttle, no de-dup**. `index.ts:404` calls `notifyHub.publishSessionCompletion` on every `session_ended`. Stage C's "scheduler fan-out 4 worktree → 4 sessionEnded within seconds" produces 4 unbatched Telegram messages plus 4 ServerChan messages. Telegram's per-bot rate limit is ~30 msg/s globally but ~1 msg/s per chat; bursts of 4 are fine, bursts of 10+ from a runaway DAG will hit `429 Too Many Requests` and the channel currently throws on non-2xx (line 100), which `index.ts:404` swallows via `void` — silent telemetry loss.
**Suggested fix**: Stage C bullet 4 add: "fan-out 通知必须经过 batched-completion notifier (debounce ≥ 5s, 合并同一 Initiative 的 N 条 sessionEnded 成 1 条 Telegram 消息体)"。Also list "telegram 429 backoff" as Stage C 必修缺口。Without this, Stage C is not safe to ship.

### F7. P8 stacked diffs is duplicate of A3 + scope creep — [MINOR]
**Lens**: simplification
**Where**: §7 bullet 4
P8 ("Graphite-like stacked PR") solves dependency-chain UX **only for the linear sub-case** that §2.e already says "不直接适合多 agent 并行". Stage B already handles "blocks" via dependency picker; A3 already proposes per-Issue PR. Adding P8 as a separate IDEAS entry creates 3 overlapping anchors (P1 worktree / A3 PR-per-Issue / P8 stacked PR) for "how do PRs relate to each other". Pick one.
**Suggested fix**: §7 drop P8; instead append a 1-line note to A3: "follow-up: 当一条 Initiative 拆出 ≥3 个串行 Issue 时，evaluate stacked-PR (Graphite/Sapling) 作为 PR 组织方式，不开新 IDEAS 条目"。

### F8. `harness_enabled INTEGER DEFAULT 0` blocks Stage A worktree wiring — [MINOR]
**Lens**: irreversibility
**Where**: HARNESS_DATA_MODEL §1.1 + proposal §5.A
Stage A introduces worktrees for projects where `harness_enabled=0` (Stage A explicitly avoids harness scheduler). But the existing `harness_project.worktree_root TEXT NOT NULL` (line 51) requires every harness row to commit a worktree root, and the proposal does not explain whether Stage A creates a `harness_project` row or bypasses it entirely. If the latter, `worktree_root` ends up duplicated between `~/.claude-web/projects.json` (Stage A) and `harness_project.worktree_root` (Stage C), and migrating from "Stage A registry" to "harness registry" later is a manual reconciliation. Schema migration cost is real because `harness-store.ts` only supports forward `TARGET_VERSION` bumps (line 39, 117) — no rollback path.
**Suggested fix**: §5.A explicit decision: "Stage A 用现有 `~/.claude-web/projects.json`, **不写 `harness_project`**; Stage C 启用调度时再 INSERT 并把 worktree_root 一次性 reconcile 过去"。Add this to §6 不变量列表。

## Strong points

- §5 Stage A/B/C is correctly **monotonically reversible** — each stage's deliverable is a separate code surface (Stage A worktree CRUD ≠ Stage B schema ≠ Stage C scheduler) so abandoning later stages doesn't strand earlier ones. Aligns with the proposal's own §0 "不可逆度: 低" claim.
- §6.5 "DAG 失败时 fail loud" — naming "全停 + 通知用户决定" as the M0 default is the right anti-Microsoft-swarm choice and matches existing `cli-runner.ts` SIGTERM-then-SIGKILL philosophy.
- §10 phase 2/3 skip is correctly justified per HARNESS_REVIEW_LOG rules; "research/proposal" trigger check is applied properly. The escalation condition (BLOCKER conflict between phase-1 reviewers) is concrete enough to actually fire.
- §4 "对接现有 harness 数据模型" correctly identifies that `Issue.status='blocked'` already exists — the proposal does not re-invent a parallel state machine.

## Cross-end concerns (mobile / web / backend coherence)

1. **Conversation ↔ Issue mapping is undefined**. iOS `Conversation.id` (CLAUDE.md pitfall #8) is a client UUID for new chats and `sessionId` for loaded historical sessions. Stage C's "fan-out 自动开 worktree + 启 conversation" implicitly creates a 4th id (`Issue.id`) and never says how the 3 ids relate. Backend `runRegistry` keys on `runId`; iOS `runIdToConversation` table will need an `Issue.id` column too, or another lookup table. This is the single biggest hidden cross-end cost the proposal does not budget for.
2. **iOS offline-first cache invalidates by what?** Cache.swift currently keeps 50 session files LRU. If Stage C scheduler creates Issue + Stage + Task + ContextBundle + Run rows server-side without iOS being connected, what's the iOS sync model on reconnect? Server-driven push? Pull-on-foreground? Neither is in the proposal. Punt to Open Question Q5.
3. **Web frontend is unmentioned in §5.A "iOS / Web 新建对话表单加 checkbox"** — `packages/frontend/src/App.tsx` shell is the canonical web entry but the proposal does not name the file or component. If Stage A ships only on iOS (likely given recent velocity), say so explicitly so the web side doesn't quietly diverge. Per CLAUDE.md "iOS path policy" the mobile work is the priority, but web parity for `[ ] 隔离 worktree` checkbox should be an explicit no-op-for-now decision, not silent omission.
4. **CLAUDE.md pitfall #3 risk**: Stage A wiring on iOS must use **relative** `/api/worktrees` URL, not absolute `localhost:3030`, or Tailscale-served clients break. Worth a 1-line callout in §5.A.

## What I did not look at

- Did not WebFetch the Microsoft "Swarm Diaries" article — F2 is therefore a flagged false-positive candidate, not a confirmed BLOCKER.
- Did not read `harness-architecture-review` verdict (per independence rule).
- Did not read author's chat transcript or thinking history.
- Did not exercise schema migrations against a live DB; only static-read `harness-store.ts` and `0001_initial.sql` references.
