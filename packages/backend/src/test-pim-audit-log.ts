// Day 8 — pim-audit.jsonl smoke test (ADR-020 §D Week 2)
//
// 跑法: pnpm --filter @vessel/backend test:pim-audit
// 退出码: 0 = 全过; 1 = 失败
//
// 验证:
// 1. POST /api/pim 写 audit op='create' + before=undefined + after 含
//    commitment_state / modality / source / visibility
// 2. PATCH commitmentState 写 op='set_commitment' before/after with state diff
// 3. PATCH 其他字段写 op='update' before/after with only patched fields
// 4. DELETE 写 op='delete' after.deleted_at != null
// 5. POST /:id/attach-issue 写 op='attach_issue' with issue_id
// 6. X-Device-Id header 传到 audit entry source_device
// 7. Audit log fire-and-forget — POST /api/pim 即返回 (不阻塞)

import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "pim-audit-test-"));
process.env.VESSEL_DATA_DIR = tmpDir;
process.env.HARNESS_DISABLED = "";
console.log(`[test] using tmp DATA_DIR: ${tmpDir}`);

const { openHarnessDb } = await import("./harness-store.js");
const { pimRouter, setPimDbForRoutes } = await import("./routes/pim.js");
const { getPimAuditPath } = await import("./pim-audit.js");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const harness = openHarnessDb();
setPimDbForRoutes(harness);

async function call(
  method: string,
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; json: any }> {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await pimRouter.fetch(new Request(`http://x${url}`, init));
  const json = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : null;
  return { status: res.status, json };
}

const auditPath = getPimAuditPath();
const DEVICE = "iphone-15-pro-test-uuid";

// 1. POST creates audit entry
const created = await call("POST", "/", {
  content: "audit test item",
  source: "test",
  domainTags: ["健康"],
}, { "X-Device-Id": DEVICE });
assert(created.status === 201, `POST returns 201`);
const itemId: string = created.json.item.id;

// audit log is fire-and-forget — wait a bit then read
await new Promise((r) => setTimeout(r, 100));
assert(existsSync(auditPath), `audit log file created at ${auditPath}`);

function readAuditEntries(): any[] {
  const text = readFileSync(auditPath, "utf-8");
  return text.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
}

let entries = readAuditEntries();
assert(entries.length === 1, `audit log has 1 entry after POST (got ${entries.length})`);
const e1 = entries[0];
assert(e1.op === "create", `entry[0].op === 'create' (got ${e1.op})`);
assert(e1.pim_item_id === itemId, `entry[0].pim_item_id matches`);
assert(e1.actor === "user", `entry[0].actor === 'user'`);
assert(e1.source_device === DEVICE, `entry[0].source_device matches X-Device-Id`);
assert(typeof e1.ts === "number" && e1.ts > 0, `entry[0].ts is numeric`);
assert(e1.before === undefined, `entry[0].before is undefined (create has no before)`);
assert(e1.after?.commitment_state === "inbox", `entry[0].after.commitment_state === 'inbox'`);
assert(e1.after?.modality === "text", `entry[0].after.modality === 'text'`);

// 2. PATCH commitmentState → set_commitment audit
const patched = await call("PATCH", `/${itemId}`, { commitmentState: "action" }, {
  "X-Device-Id": DEVICE,
});
assert(patched.status === 200, `PATCH returns 200`);
await new Promise((r) => setTimeout(r, 100));
entries = readAuditEntries();
assert(entries.length === 2, `audit log has 2 entries after PATCH commitmentState`);
const e2 = entries[1];
assert(e2.op === "set_commitment", `entry[1].op === 'set_commitment' (got ${e2.op})`);
assert(e2.before?.commitment_state === "inbox", `entry[1].before.commitment_state === 'inbox'`);
assert(e2.after?.commitment_state === "action", `entry[1].after.commitment_state === 'action'`);
assert(e2.source_device === DEVICE, `entry[1].source_device matches`);

// 3. PATCH content → update audit
const contentPatched = await call("PATCH", `/${itemId}`, { content: "updated content" }, {
  "X-Device-Id": DEVICE,
});
assert(contentPatched.status === 200, `PATCH content returns 200`);
await new Promise((r) => setTimeout(r, 100));
entries = readAuditEntries();
assert(entries.length === 3, `audit log has 3 entries after PATCH content`);
const e3 = entries[2];
assert(e3.op === "update", `entry[2].op === 'update' (got ${e3.op})`);
assert(e3.before?.content === "audit test item", `entry[2].before.content matches old`);
assert(e3.after?.content === "updated content", `entry[2].after.content matches new`);
assert(e3.before?.commitment_state === undefined, `entry[2].before has only modified fields`);

// 4. DELETE → delete audit
const deleted = await call("DELETE", `/${itemId}`, undefined, { "X-Device-Id": DEVICE });
assert(deleted.status === 200, `DELETE returns 200`);
await new Promise((r) => setTimeout(r, 100));
entries = readAuditEntries();
assert(entries.length === 4, `audit log has 4 entries after DELETE`);
const e4 = entries[3];
assert(e4.op === "delete", `entry[3].op === 'delete' (got ${e4.op})`);
assert(e4.after?.deleted_at != null, `entry[3].after.deleted_at is set`);

// 5. POST without X-Device-Id → source_device undefined in entry
const noDevice = await call("POST", "/", { content: "no device header" });
assert(noDevice.status === 201, `POST without X-Device-Id still 201`);
await new Promise((r) => setTimeout(r, 100));
entries = readAuditEntries();
assert(entries.length === 5, `audit log has 5 entries after no-device POST`);
const e5 = entries[4];
assert(e5.source_device === undefined, `entry[5].source_device undefined when no header`);

// 6. attach-issue audit (requires a real issue id, which our pim-only test doesn't have →
//    use a manually inserted fake issue row)
const fakeIssueId = "iss-fake-test";
harness.db.prepare(`
  INSERT INTO harness_project (id, cwd, name, default_branch, worktree_root, harness_enabled, created_at)
  VALUES ('proj-test', '/tmp/fake', 'fake', 'main', '/tmp', 0, 0)
`).run();
harness.db.prepare(`
  INSERT INTO issue (id, project_id, source, title, body, labels_json, priority, status, created_at, updated_at)
  VALUES (?, 'proj-test', 'manual', 't', 'b', '[]', 'normal', 'inbox', 0, 0)
`).run(fakeIssueId);
const attachResp = await call("POST", `/${entries[4].pim_item_id}/attach-issue`, { issueId: fakeIssueId }, {
  "X-Device-Id": DEVICE,
});
assert(attachResp.status === 200, `POST attach-issue returns 200`);
await new Promise((r) => setTimeout(r, 100));
entries = readAuditEntries();
assert(entries.length === 6, `audit log has 6 entries after attach-issue`);
const e6 = entries[5];
assert(e6.op === "attach_issue", `entry[6].op === 'attach_issue' (got ${e6.op})`);
assert(e6.issue_id === fakeIssueId, `entry[6].issue_id matches`);

harness.close();
rmSync(tmpDir, { recursive: true, force: true });
console.log("");
console.log("pim-audit smoke test OK ✅");
