// Smoke test for /api/pim CRUD routes (M0-PIM Day 3).
//
// 跑法: pnpm --filter @vessel/backend exec tsx src/test-pim-routes.ts
// 退出码: 0 = 全过; 1 = 失败
//
// 用 Hono 的 .fetch() (Web standard Request/Response) 在内存里测路由，
// 不真启 HTTP server。Tmp DATA_DIR 隔离 prod 数据。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "pim-routes-test-"));
process.env.VESSEL_DATA_DIR = tmpDir;
process.env.HARNESS_DISABLED = "";
console.log(`[test] using tmp DATA_DIR: ${tmpDir}`);

const { openHarnessDb } = await import("./harness-store.js");
const { pimRouter, setPimDbForRoutes } = await import("./routes/pim.js");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const harness = openHarnessDb();
setPimDbForRoutes(harness);

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await pimRouter.fetch(new Request(`http://x${url}`, init));
  const json = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : null;
  return { status: res.status, json };
}

// 1. POST /api/pim (create)
const created = await call("POST", "/", {
  content: "Day 3 smoke test item",
  source: "test",
  commitmentState: "inbox",
  domainTags: ["学习"],
  peopleRefs: [{ personRef: "自己" }],
});
assert(created.status === 201, `POST / returns 201 (got ${created.status})`);
assert(typeof created.json?.item?.id === "string", `POST / returns item.id`);
assert(created.json.item.commitmentState === "inbox", `commitmentState defaulted to 'inbox'`);
assert(created.json.item.modality === "text", `modality defaulted to 'text'`);
assert(created.json.item.aiStatus === "pending", `aiStatus defaulted to 'pending'`);
const itemId: string = created.json.item.id;

// 2. POST / 拒绝空 content
const empty = await call("POST", "/", { content: "" });
assert(empty.status === 400, `POST with empty content rejected (got ${empty.status})`);

// 3. GET /api/pim/list
const listed = await call("GET", "/list");
assert(listed.status === 200, `GET /list returns 200`);
assert(Array.isArray(listed.json?.items), `GET /list returns items array`);
assert(listed.json.items.length === 1, `GET /list contains 1 item (got ${listed.json.items.length})`);
assert(listed.json.items[0].id === itemId, `GET /list contains our created item`);

// 4. GET /api/pim/:id
const got = await call("GET", `/${itemId}`);
assert(got.status === 200, `GET /:id returns 200`);
assert(got.json?.item?.id === itemId, `GET /:id returns correct item`);

// 5. GET /api/pim/sanity-report (路由顺序 — sanity-report 不被 :id 抢)
const sanity = await call("GET", "/sanity-report");
assert(sanity.status === 200, `GET /sanity-report returns 200 (NOT 404 from :id route)`);
assert(Array.isArray(sanity.json?.commitment), `sanity-report has commitment array`);
assert(
  sanity.json.commitment.some((r: any) => r.value === "inbox" && r.count === 1),
  `sanity-report shows 1 inbox item`,
);

// 6. PATCH /api/pim/:id (commitmentState change)
const patched = await call("PATCH", `/${itemId}`, { commitmentState: "action" });
assert(patched.status === 200, `PATCH commitmentState returns 200`);
assert(patched.json?.item?.commitmentState === "action", `commitmentState updated to 'action'`);

// 验证 history table 写入
const historyCount = (harness.db
  .prepare("SELECT COUNT(*) c FROM pim_commitment_state_history WHERE pim_item_id = ?")
  .get(itemId) as { c: number }).c;
assert(historyCount === 2, `pim_commitment_state_history has 2 rows (create + PATCH change), got ${historyCount}`);

// 7. PATCH 拒绝空 body
const emptyPatch = await call("PATCH", `/${itemId}`, {});
assert(emptyPatch.status === 400, `PATCH with empty body rejected (got ${emptyPatch.status})`);

// 8. PATCH partial — 只改 content 不改 commitmentState
const partial = await call("PATCH", `/${itemId}`, { content: "updated content" });
assert(partial.status === 200, `partial PATCH returns 200`);
assert(partial.json.item.content === "updated content", `content updated`);
assert(partial.json.item.commitmentState === "action", `commitmentState unchanged from prior PATCH`);

// 9. DELETE soft delete
const deleted = await call("DELETE", `/${itemId}`);
assert(deleted.status === 200, `DELETE returns 200`);
assert(deleted.json?.ok === true, `DELETE returns ok=true`);

// 验证 default list 不含 deleted item
const listAfterDelete = await call("GET", "/list");
assert(listAfterDelete.json.items.length === 0, `default GET /list excludes deleted (got ${listAfterDelete.json.items.length})`);

const listIncludeDeleted = await call("GET", "/list?includeDeleted=1");
assert(listIncludeDeleted.json.items.length === 1, `GET /list?includeDeleted=1 contains deleted`);

// 10. 404 cases
const notFound = await call("GET", "/pim-doesnotexist");
assert(notFound.status === 404, `GET unknown id returns 404`);

const deleteNotFound = await call("DELETE", "/pim-doesnotexist");
assert(deleteNotFound.status === 404, `DELETE unknown id returns 404`);

harness.close();
rmSync(tmpDir, { recursive: true, force: true });
console.log("");
console.log("pim routes smoke test OK ✅");
