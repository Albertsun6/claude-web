// Week 3 Day 15-18 — FTS5 search + export (markdown/csv) smoke test
//
// 跑法: pnpm --filter @vessel/backend test:pim-list-export
// 退出码: 0 = 全过; 1 = 失败

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpDir = mkdtempSync(path.join(tmpdir(), "pim-list-export-test-"));
process.env.VESSEL_DATA_DIR = tmpDir;
process.env.HARNESS_DISABLED = "";
console.log(`[test] using tmp DATA_DIR: ${tmpDir}`);

const { openHarnessDb } = await import("./harness-store.js");
const { pimRouter, setPimDbForRoutes } = await import("./routes/pim.js");
const { createPimItem } = await import("./pim-queries.js");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const harness = openHarnessDb();
setPimDbForRoutes(harness);

// Seed: a few items with different content + domains
const itemA = createPimItem(harness.db, {
  content: "买菜 番茄 鸡蛋 面包",
  source: "test",
  domainTags: ["家庭"],
});
const itemB = createPimItem(harness.db, {
  content: "Vessel PIM ADR-020 implementation week 3",
  source: "test",
  commitmentState: "action",
  domainTags: ["工作"],
});
const itemC = createPimItem(harness.db, {
  content: "膝盖隐痛 跑了 5 公里",
  source: "test",
  domainTags: ["健康"],
});

async function call(method: string, url: string): Promise<{ status: number; json?: any; text?: string; headers: Headers }> {
  const res = await pimRouter.fetch(new Request(`http://x${url}`, { method }));
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return { status: res.status, json: await res.json(), headers: res.headers };
  }
  return { status: res.status, text: await res.text(), headers: res.headers };
}

// === Phase 1: FTS5 query ===
console.log("\n--- Phase 1: FTS5 ?q= ---");
const r1 = await call("GET", "/list?q=Vessel");
assert(r1.status === 200, `GET /list?q=Vessel → 200`);
assert(r1.json?.items.length === 1, `q='Vessel' matches 1 item (got ${r1.json?.items?.length})`);
assert(r1.json.items[0].id === itemB.id, `q='Vessel' returns itemB`);

// SQLite FTS5 默认 unicode61 tokenizer: 单字中文不自动前缀匹配, 需要 `*`
// (or future migration 0009 → tokenize='trigram' for transparent partial match).
// Document this limitation in test for callers; UI layer should append `*`
// to user CJK input.
const r2 = await call("GET", "/list?q=%E8%B7%91*"); // 跑*
assert(r2.json?.items.length === 1, `q='跑*' (prefix) matches itemC`);
assert(r2.json.items[0].id === itemC.id, `q='跑*' returns itemC`);

const r3 = await call("GET", "/list?q=Vessel%20OR%20%E8%B7%91*"); // FTS5 OR
assert(r3.json?.items.length === 2, `q='Vessel OR 跑*' matches 2 items (got ${r3.json?.items?.length})`);

const r4 = await call("GET", "/list?q=nomatch_xyz");
assert(r4.json?.items.length === 0, `non-matching q returns 0`);

// === Phase 2: ?q combined with ?commitment= filter ===
console.log("\n--- Phase 2: q + commitment filter ---");
const r5 = await call("GET", "/list?q=PIM&commitment=action");
assert(r5.json?.items.length === 1, `q+commitment intersection works (got ${r5.json?.items?.length})`);

const r6 = await call("GET", "/list?q=PIM&commitment=inbox");
assert(r6.json?.items.length === 0, `q+commitment mismatch returns 0`);

// === Phase 3: FTS5 syntax error → 400 ===
console.log("\n--- Phase 3: FTS5 invalid syntax → 400 ---");
const r7 = await call("GET", "/list?q=%22unclosed"); // unclosed quote
assert(r7.status === 400, `unclosed quote query returns 400 (got ${r7.status})`);
assert(typeof r7.json?.error === "string", `error message present`);

// === Phase 4: GET /export?format=markdown ===
console.log("\n--- Phase 4: export markdown ---");
const md = await call("GET", "/export?format=markdown");
assert(md.status === 200, `markdown export → 200`);
assert(md.headers.get("content-type")?.includes("text/markdown"), `content-type=text/markdown`);
assert(md.headers.get("content-disposition")?.includes("attachment"), `content-disposition=attachment`);
assert(md.headers.get("content-disposition")?.endsWith('.md"'), `filename ends .md`);
assert(typeof md.text === "string" && md.text.startsWith("# PIM Export"), `markdown starts with H1`);
assert(md.text!.includes("Total items: 3"), `markdown reports 3 items`);
assert(md.text!.includes(itemA.content), `markdown contains itemA content`);
assert(md.text!.includes(itemB.content), `markdown contains itemB content`);
assert(md.text!.includes("**domains**: 家庭"), `markdown emits domain tags`);

// === Phase 5: GET /export?format=csv ===
console.log("\n--- Phase 5: export csv ---");
const csv = await call("GET", "/export?format=csv");
assert(csv.status === 200, `csv export → 200`);
assert(csv.headers.get("content-type")?.includes("text/csv"), `content-type=text/csv`);
assert(csv.headers.get("content-disposition")?.endsWith('.csv"'), `filename ends .csv`);
const lines = csv.text!.split("\n").filter((l) => l.trim().length > 0);
assert(lines.length === 4, `csv has 4 lines (1 header + 3 rows, got ${lines.length})`);
assert(lines[0].startsWith("id,captured_at_iso,source"), `csv header correct`);
// 内容含逗号 / 引号的转义
assert(lines.some((l) => l.includes(itemB.id)), `csv row contains itemB id`);

// === Phase 6: export excludes soft-deleted by default ===
console.log("\n--- Phase 6: export excludes soft-deleted ---");
await call("DELETE", `/${itemA.id}`);
const md2 = await call("GET", "/export?format=markdown");
assert(md2.text!.includes("Total items: 2"), `markdown excludes deleted (now 2)`);
assert(!md2.text!.includes(itemA.content), `deleted itemA not in export`);

// includeDeleted=1 includes them
const md3 = await call("GET", "/export?format=markdown&includeDeleted=1");
assert(md3.text!.includes("Total items: 3"), `includeDeleted=1 brings deleted back`);

harness.close();
rmSync(tmpDir, { recursive: true, force: true });
console.log("");
console.log("pim list+export smoke test OK ✅");
