# vessel-architect Phase 1 verdict — M0 (2026-05-10 01:00)

Reviewer: vessel-architect (Claude main session, opus-4.7-1m)
Scope: M0 内核骨架 closeout — 5 focus items per user brief.

## Summary

- **Overall**: **PASS-WITH-FIXES** (one BLOCKER must land before M0 closeout; one MAJOR before M0.5; rest MINOR.)
- **BLOCKER count**: 1
- **MAJOR count**: 2
- **MINOR count**: 4

The single BLOCKER is real and load-bearing: `0004_m0_sessions.sql` will be picked up
and applied to **harness.db** by `harness-store.ts`, corrupting the existing Eva
schema and burning migration slots 103-199. Everything else is correctness polish.

---

## 5 focus items 逐条结论

### Focus 1 (migration 编号): **FAIL** — collision + cross-DB pollution

Two distinct problems:

1. **File-name collision with planned M1C-A migration.**
   ROADMAP §M1C-A-1 (line 125) explicitly reserves `migration 0004 (v103): workflow_state 表`,
   and ADR-006 §3 reserves `0004_workflow_state.sql (v103) M1C-A`. M0 has now claimed
   `0004_m0_sessions.sql (v200)`. When M1C-A lands, the author must either rename
   one (breaking referenced docs / ADR) or pick `0005_workflow_state.sql` and accept
   that `ADR-006 §3` is now wrong. Either way an ADR amendment is required.

2. **Cross-DB pollution via shared `migrations/` directory** (the actually dangerous one).
   `harness-store.ts:119-201` calls `readdirSync(MIGRATIONS_DIR)` and applies **every**
   `\d{4}_*.sql` it finds. `MIGRATIONS_DIR = packages/backend/src/migrations/`. The new
   `0004_m0_sessions.sql` sits in that exact directory. So on the next `openHarnessDb()`:
   - harness-store reads 0004, parses `-- TARGET_VERSION = 200`, runs the SQL inside
     a transaction against **harness.db**.
   - `CREATE TABLE IF NOT EXISTS sessions / intents / skill_invocations` succeed
     (no name collision with existing 0001 tables — verified `harness_project / stage / etc.`,
     no plain `sessions` table in 0001).
   - `INSERT INTO schema_migrations(file='0004_m0_sessions.sql', target_ver=200, …)` writes.
   - `PRAGMA user_version = 200` runs — **jumping from v102 to v200 in harness.db**, permanently
     skipping 103-199. Future M1C-A 0004_workflow_state.sql will then be *re-numbered* to
     0005 (TARGET_VERSION 103), but harness-store's `target < user_version` is implicit:
     it only filters `applied.has(file)` not version comparison, so the v103 file applies
     fine — but `user_version` would *go backward* via `PRAGMA user_version = 103` after
     having been 200, leaving the DB in an inconsistent state.
   - session-store.ts's own minimal runner is unaffected (it uses `current < MEMORY_SCHEMA_VERSION`
     gate), but harness.db is now polluted with three M0-only tables AND user_version
     bookkeeping is wrecked.

This is a real boot-time crash path the next time anyone starts Eva backend after
checking out the M0 branch. Verified by reading `harness-store.ts:39-40, 119-122, 174-178`.

### Focus 2 (DB 冲突): **FAIL** (subsumed by Focus 1) — same root cause

session-store.ts correctly opens a separate `memory.db` at the same `DATA_DIR` and
the path-level isolation is fine. The collision is not in DB *connection* but in the
**migrations directory layout**. As long as both stores read from the same
`packages/backend/src/migrations/` directory, every new file affects both DBs.

Two acceptable architectural fixes (architect prefers #A):

- **A. Sub-directory split** — move M0 migration to `packages/backend/src/memory/migrations/0001_m0_sessions.sql` (TARGET_VERSION = 1, since memory.db starts fresh). Keep `packages/backend/src/migrations/` reserved for harness.db only. session-store.ts already constructs `MIGRATIONS_DIR` independently (line 25), so the change is one path edit. Reset version to 1 — the v200 → "Vessel 2.0" coding was meant for the harness.db path which is **not** what we're changing here.
- **B. File prefix split** — keep one directory but namespace by prefix: harness uses `H0001_*.sql` / memory uses `M0001_*.sql`, and each runner filters by prefix. More invasive (touches `harness-store.ts` regex).

Either way the BLOCKER must clear before M0 closes; option A is one-file move.

### Focus 3 (trace-redaction): **FAIL** — redaction not implemented

trace-writer.ts §1-66 has **zero** redaction. The module comment line 8-10
explicitly acknowledges this:
> "当前实现 NOT yet do redaction. M0 acceptance doesn't require redaction yet"

But `trace-redaction-spec.md §7 M0 Acceptance` lists three concrete acceptance
criteria including:
> "Acceptance C-3: payload 不出现 user_prompt 全文 — `grep -q "user_prompt" instance/traces/<trace_id>/*.json && exit 1`"

And ROADMAP M0-5 (line 74) says:
> "M0-5 Trace 协议落地（trace_id 贯穿 + 文件归档 + **脱敏**）"

And `trace.ts:96-98` (the contract) says:
> "**v0A.1 risk-officer M-R2**：M0 落地时**必须**在 write() 内强制做 redaction（不是依赖 caller 自行脱敏）"

So three independent docs (spec / roadmap / interface contract) all require redaction
in M0; the implementation deliberately punts. The orchestrator currently only writes
`text_len` (length, not text) into payload.intent.received, so a trivial dogfood run
won't trip C-3 — but the moment any future Skill puts user-derived content into
`payload`, the spec is violated and there's nothing to catch it.

Two positives that soften this:
- File mode 0o600 + dir mode 0o700 satisfy redaction-spec §6.
- TraceEventSchema (`trace.ts:43-49`) caps payload at 4 KiB and enforces JSON serializability — partial mechanical hygiene.

Severity: **MAJOR** rather than BLOCKER because the M0 echo path itself doesn't
emit user content into trace payload; the contract violation is latent. Must be
fixed before M0.5 introduces CodingDriver (which will dump CC stdout into trace).

### Focus 4 (orchestrator 边界): **PASS** — clean M0 boundaries

orchestrator.ts is genuinely M0-shaped:

- `SKILLS = { echo: EchoSkill }` (line 35-37) — single hardcoded entry, no
  registry / Capability App / dynamic loading. Correct for M0; a SkillRegistry
  with manifest-driven loading is M0.5+ territory per ADR-016.
- No Workflow / pause / resume code paths. AgentResult `paused` case is handled
  in vessel-core.ts (line 104) only as a forward-compat exit-code stub — the
  orchestrator itself never produces it. Good.
- No CodingDriver / MCP / Tool registry coupling. SkillContext is plumbed with
  trivial stubs (`tools.get: () => null`, `memory: {} as never`, `workspaceDir: ''`)
  and EchoSkill (line 21) doesn't read any of them. Clean.
- The OTEL convention comment (line 65-67) — emitting only `skill.completed` and
  not a separate `skill.invoked` because they'd share span_id and overwrite each
  other under file-per-span — is the right tradeoff and well-justified.
- Error path (line 107-137) writes both trace event and skill_invocations row with
  status='error', and returns `{status:'failed', error}` — discriminated-union-correct
  per agent.ts:49-53.

One MINOR comment on the boundary: orchestrator.ts hardcodes `runId = randomUUID()`
(line 41) but exports nothing for callers to await/cancel a specific run. That's
fine for M0 (vessel-core.ts is the only caller and runs synchronously) but the
contract for M1A's HTTP `/api/intent` will need to expose runId in the response.
Just don't accidentally lock the synchronous flow into something M1A has to undo.

### Focus 5 (SIGINT 稳定性): **PASS** with one MINOR concern

vessel-core.ts:79-87 SIGINT handler is correct in shape:
- Idempotent guard `sigintHandled` prevents double-fire.
- Closes DB inside try/catch with a swallowed error — appropriate for shutdown path.
- `process.exit(130)` matches POSIX SIGINT exit convention.
- ROADMAP M0-7 acceptance is "5 秒内退出 + SQLite 无锁残留": better-sqlite3's
  `db.close()` flushes WAL synchronously, and there's no in-flight async work
  to wait for in M0 (echo is sync). Easily satisfies 5s.

Concern (MINOR): the SIGINT path **does not await `runIntent()` to finish gracefully** —
it just closes the DB and exits. For M0/echo this is fine (intent runs in <10ms),
but ADR-011 §9 explicitly specifies a 5-second grace period for in-flight intents
before tearing down. When M0.5's CodingDriver lands, ctrl-c during a CC CLI run will
abruptly kill the trace writer and skill_invocations row — leaving a half-written run.
The handler's signature should evolve to: set a "draining" flag → wait for current
runIntent() to finish or 5s grace timeout → then close DB. M0 doesn't need this, but
flag it explicitly so M0.5 doesn't retrofit it.

env_check via `checkRenamedEnvVars()` at line 18-19 is correct and load-bearing — runs
before any DB open / orchestrator import. Good ordering.

---

## Findings (BLOCKER / MAJOR / MINOR)

### BLOCKER-1: 0004_m0_sessions.sql will be applied to harness.db on next backend boot

- **File**: `packages/backend/src/migrations/0004_m0_sessions.sql`
- **Mechanism**: `harness-store.ts:119-201` `readdirSync(MIGRATIONS_DIR)` matches
  every `\d{4}_*.sql` and applies it.
- **Impact**: harness.db gets `sessions / intents / skill_invocations` tables it
  shouldn't own; `user_version` jumps 102 → 200, permanently breaking M1C-A's
  v103 plan; ADR-006 §3 numbering scheme broken; future migration files have
  to either renumber (breaking docs) or accept a corrupted user_version monotonicity.
- **Fix (preferred)**: move M0 migration to a memory-only directory, e.g.
  `packages/backend/src/memory/migrations/0001_m0_sessions.sql`, set TARGET_VERSION = 1
  (memory.db is brand-new — no need to encode "Vessel 2.0" in user_version), and
  update `session-store.ts:25` to point at the new MIGRATIONS_DIR.
- **Why blocker**: this is a boot-time data-corruption bug, not a code-style issue.
  M0 closeout should not ship a state where `pnpm dev:backend` post-merge silently
  corrupts harness.db.

### MAJOR-1: trace-writer.ts ships without any redaction

- **File**: `packages/backend/src/observability/trace-writer.ts:41-50`
- **Spec violation**: `trace.ts:96-98` says "M0 落地时**必须**在 write() 内强制做 redaction";
  `trace-redaction-spec.md §7` lists C-3 as M0 acceptance.
- **Current state**: `write()` just JSON-stringifies the event and dumps it. No
  fast-redact, no path-whitelist, no token regex.
- **Why MAJOR not BLOCKER**: M0 echo path doesn't put user content into payload
  (`text_len` only, line 60), so the **observable** acceptance test C-3 passes by
  accident. The contract is still violated, and M0.5's CodingDriver will start
  emitting CC stdout into trace — at which point this becomes a leak.
- **Fix**: add a `redact()` call (fast-redact configured per spec §3) before
  `JSON.stringify(event)` and before writing to disk. Track in M0 closeout retro
  with explicit M0.5 entry-gate condition.

### MAJOR-2: SIGINT path doesn't drain in-flight runIntent before closing DB

- **File**: `packages/backend/src/cli/vessel-core.ts:79-87`
- **Spec violation**: ADR-011 §9 specifies "等待 in-flight Intent 完成（5 秒 grace period）"
  before SIGTERM helpers + closing SQLite.
- **Current state**: SIGINT immediately calls `closeMemoryDb()` and `process.exit(130)`.
  If runIntent is mid-write (between `writeIntent` and `writeSkillInvocation`), the
  intent is persisted but the run row is missing — DB consistent (FK ok, no orphan)
  but trace event for `skill.completed` may be half-written.
- **Why MAJOR not BLOCKER**: M0's only Skill (echo) runs in microseconds, so this
  is unobservable in M0 acceptance. The retrofit cost grows with M0.5 (CC CLI runs
  for minutes).
- **Fix**: introduce a top-level `currentRun: Promise<AgentResult> | null` reference,
  have SIGINT handler wait on it (with 5s timeout via `Promise.race`), then close.

### MINOR-1: ADR-006 §3 migration numbering needs amendment

If you adopt the BLOCKER-1 fix (move 0004 to memory/migrations/), ADR-006 §3 line 33-37
still says `0004_workflow_state.sql (v103) M1C-A` — that's now correct again. But add
a note that `memory.db` migrations live in `packages/backend/src/memory/migrations/`
with their own numbering starting at 0001, distinct from harness.db's series.

### MINOR-2: orchestrator runId not exposed for M1A future-proofing

`runIntent()` returns `AgentResult` but not the `runId` it generated (line 41).
For M0 CLI single-shot this is fine. For M1A HTTP `/api/intent`, the response will
need to surface runId so clients can correlate trace events. Consider returning
`{ runId, result }` now to avoid an M1A-time API change.

### MINOR-3: closeMemoryDb called 4 times in vessel-core.ts main()

vessel-core.ts:96, 101, 107, 111 — each switch arm calls `closeMemoryDb()`. The
unconditional call should live in a `finally` block around `await runIntent(...)`,
not be repeated per case. Also makes the early-throw path (between `runIntent` and
the switch) safer.

### MINOR-4: trace-writer.ts uses synchronous `writeFileSync` despite returning Promise

`write()` is `async` (returns `Promise<void>`) but uses `writeFileSync` (line 49).
Functionally fine for M0 (small files, called from CLI), but lying about the
async contract — under future load this becomes an unmarked event-loop block.
Use `fs/promises` `writeFile` to match the type signature, or change the contract
to synchronous in `trace.ts`.

---

## Positive observations

1. **AgentResult discriminated union (`agent.ts:49-53`) is correctly enforced end-to-end.**
   orchestrator.ts:106, 136 produce the right shape; vessel-core.ts:91-114 exhaustively
   handles all four variants with distinct exit codes (0 / 1 / 0 / 130 for success /
   failed / paused / cancelled). This is exactly the kind of structural invariant
   ADR-016 + cursor M3 wanted; the M0 code respects it.

2. **session-store.ts migration runner is minimal but correct.**
   The `current < MEMORY_SCHEMA_VERSION` gate (line 42) + transaction-wrapped exec
   + transactional `PRAGMA user_version` advance (line 44-47) hits the same
   atomicity invariant that harness-store.ts spent a Round-2 BLOCKER fixing in
   v0.4.5. Not bypassing the lesson, just inlining a smaller version of it.

3. **Orchestrator boundary discipline is genuinely M0-only.** No premature workflow
   / coding / MCP plumbing; SkillContext stubs (`tools.get: () => null`, `memory: {}
   as never`) are honest about what's not yet wired. The "OTEL one-span = one finalized
   record" comment (line 65-67) shows the author understood why a separate
   `skill.invoked` event would have stomped `skill.completed` under file-per-span
   layout — the right tradeoff with the right rationale.

4. **trace-writer file/dir permissions match redaction-spec §6 exactly** (mode 0o700 dir
   / 0o600 file, lines 46/49). Acceptance C-1 / C-2 will pass mechanically.

5. **vessel-core.ts CLI is appropriately spartan** — no unnecessary subcommands,
   `--help` / `--session=` / positional intent text only. Resists the temptation
   to pre-build `--version / --soul-show-prompt / --workflow-resume` etc. that
   roadmap reserves for later milestones.
