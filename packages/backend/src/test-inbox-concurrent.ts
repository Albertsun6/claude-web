// Concurrency smoke test for inbox-store.ts withLock.
//
// Verifies that promise-queue write lock + atomic temp+rename prevent the
// lost-update race that existed in the pre-Stage-A version (raw appendFileSync
// + writeFileSync). Run via:
//   pnpm --filter @claude-web/backend test:inbox-concurrent
//
// Strategy:
//   1. Backup user's real ~/.claude-web/inbox.jsonl, redirect tests to TMP path
//   2. 100 parallel appendInbox → assert all 100 ids present + unique
//   3. 100 parallel setTriage on those items (mix archive + ideas) → assert
//      file is valid JSONL + every item has correct status
//   4. Restore user's real inbox.jsonl

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Redirect store to a tmp dir BEFORE importing the store (it caches paths
// via module-level consts).
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-concurrent-"));
process.env.HOME = TEST_HOME;

// Dynamic import after env override so STORE_PATH binds to TEST_HOME.
const storeMod = await import("./inbox-store.js");
const { appendInbox, listInbox, setTriage, markProcessed } = storeMod;

async function main(): Promise<void> {
  console.log(`[test] using TEST_HOME=${TEST_HOME}`);

  // ─────────── Test 1: 100 concurrent appends ───────────
  console.log("[test] T1: 100 concurrent appendInbox …");
  const appended = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      appendInbox({
        body: `concurrent test item ${i}`,
        source: "text",
        meta: { i },
      }),
    ),
  );

  if (appended.length !== 100) {
    fail(`appendInbox returned ${appended.length} items, want 100`);
  }
  const ids = new Set(appended.map((it) => it.id));
  if (ids.size !== 100) {
    fail(`appendInbox produced ${ids.size} unique ids, want 100 (race detected)`);
  }
  // Re-load from disk (clear cache) and verify all 100 made it
  // (memoryCache is module-internal; we just re-read via list)
  const list1 = listInbox({ limit: 500 });
  if (list1.length !== 100) {
    fail(`listInbox returned ${list1.length} after appends, want 100 (file-level race?)`);
  }
  const fileIds = new Set(list1.map((it) => it.id));
  for (const id of ids) {
    if (!fileIds.has(id)) {
      fail(`id ${id} returned from append but missing from file`);
    }
  }
  console.log("[test] T1 PASS — 100 ids, all unique, all on disk");

  // ─────────── Test 2: 100 concurrent setTriage ───────────
  console.log("[test] T2: 100 concurrent setTriage …");
  const triaged = await Promise.all(
    appended.map((it, i) =>
      setTriage(it.id, {
        destination: i % 2 === 0 ? "archive" : "ideas",
      }),
    ),
  );

  if (triaged.some((t) => t === null)) {
    fail("at least one setTriage returned null");
  }
  // Reload and check every item has expected status
  const list2 = listInbox({ limit: 500, includeArchived: true });
  if (list2.length !== 100) {
    fail(`listInbox returned ${list2.length} after triage, want 100 (rewrite lost data)`);
  }
  for (const it of list2) {
    if (it.triage === undefined) {
      fail(`item ${it.id} has no triage block after setTriage`);
    }
    const expectedStatus = it.triage.destination === "archive" ? "archived" : "open";
    if (it.status !== expectedStatus) {
      fail(`item ${it.id}: status=${it.status} but triage.destination=${it.triage.destination}`);
    }
  }
  console.log("[test] T2 PASS — all 100 items survived concurrent triage");

  // ─────────── Test 3: 100 concurrent markProcessed ───────────
  console.log("[test] T3: 100 concurrent markProcessed …");
  await Promise.all(
    appended.map((it, i) => markProcessed(it.id, `conv-${i}`)),
  );
  const list3 = listInbox({ limit: 500, includeArchived: true });
  if (list3.length !== 100) {
    fail(`listInbox returned ${list3.length} after markProcessed, want 100`);
  }
  for (const it of list3) {
    if (!it.processedIntoConversationId) {
      fail(`item ${it.id} not marked processed`);
    }
  }
  console.log("[test] T3 PASS — all 100 items survived concurrent markProcessed");

  // ─────────── Test 4: file integrity ───────────
  console.log("[test] T4: file is valid JSONL …");
  const filePath = path.join(TEST_HOME, ".claude-web", "inbox.jsonl");
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length !== 100) {
    fail(`file has ${lines.length} non-empty lines, want 100`);
  }
  for (let i = 0; i < lines.length; i++) {
    try {
      JSON.parse(lines[i]);
    } catch {
      fail(`line ${i + 1} not valid JSON: ${lines[i].slice(0, 80)}`);
    }
  }
  console.log("[test] T4 PASS — file is 100 lines of valid JSON");

  console.log("\n✅ All inbox-store concurrency tests passed");
}

function fail(msg: string): never {
  console.error(`\n❌ FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function cleanup(): void {
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ unexpected error:", err);
    cleanup();
    process.exit(1);
  });
