// Smoke test: ADR-020 D3 POST /api/inbox dual-write jsonl + pim_item.
//
// 跑法：pnpm --filter @vessel/backend exec tsx src/test-inbox-dual-write.ts
// 退出码：0 = 全过；1 = 失败
//
// 用 tmp DATA_DIR (VESSEL_DATA_DIR env override) 避免污染 prod data.

import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 必须在 import 任何其他模块之前设置 env, 因为 data-dir.ts 在模块加载时
// 就读 VESSEL_DATA_DIR.
const tmpDir = mkdtempSync(path.join(tmpdir(), "inbox-dual-write-test-"));
process.env.VESSEL_DATA_DIR = tmpDir;
process.env.HARNESS_DISABLED = ""; // 确保 harness 启用

console.log(`[test] using tmp DATA_DIR: ${tmpDir}`);

// Dynamic import 让 env 在加载前生效
const { openHarnessDb } = await import("./harness-store.js");
const { setPimDbForInbox, appendInbox } = await import("./inbox-store.js");

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const harness = openHarnessDb();
assert(harness.schemaVersion === 103, `schema v${harness.schemaVersion} = 103`);

// dual-write 关闭时, 单写 jsonl
{
  const item = await appendInbox({ body: "before dual-write enable", source: "text" });
  const pimCount = (harness.db.prepare("SELECT COUNT(*) c FROM pim_item").get() as { c: number }).c;
  assert(pimCount === 0, `pim_item count = 0 before setPimDbForInbox (got ${pimCount})`);
  const jsonlContent = readFileSync(path.join(tmpDir, "inbox.jsonl"), "utf-8");
  assert(jsonlContent.includes(item.id), `jsonl contains item before dual-write enable`);
}

// 启用 dual-write
setPimDbForInbox(harness);

// dual-write 开启后, 每次 appendInbox 同时写 pim_item
const items: { id: string }[] = [];
for (let i = 0; i < 5; i++) {
  const item = await appendInbox({ body: `dual-write smoke #${i}`, source: i % 2 === 0 ? "text" : "ios" });
  items.push(item);
}

// 验证 jsonl 和 pim_item 都有 5 + 1 = 6 行
const finalJsonl = readFileSync(path.join(tmpDir, "inbox.jsonl"), "utf-8");
const jsonlLines = finalJsonl.split("\n").filter((l) => l.trim().length > 0);
assert(jsonlLines.length === 6, `jsonl now has 6 lines (got ${jsonlLines.length})`);

const pimCount = (harness.db.prepare("SELECT COUNT(*) c FROM pim_item").get() as { c: number }).c;
assert(pimCount === 5, `pim_item count = 5 after enabling dual-write (got ${pimCount})`);

// 验证每条 dual-write 的 item 都对应 pim_item row
for (const it of items) {
  const row = harness.db.prepare("SELECT id, content, commitment_state, modality FROM pim_item WHERE id = ?").get(it.id) as
    | { id: string; content: string; commitment_state: string; modality: string }
    | undefined;
  assert(row !== undefined, `pim_item has row for inbox.id=${it.id.slice(0, 8)}`);
  assert(row?.commitment_state === "inbox", `pim_item.commitment_state = 'inbox' for ${it.id.slice(0, 8)}`);
  assert(row?.modality === "text", `pim_item.modality = 'text' for ${it.id.slice(0, 8)}`);
}

// 验证 INSERT OR IGNORE 不会重复插（如果同一 jsonl 经迁移脚本 + dual-write 双跑）
const beforeDupe = (harness.db.prepare("SELECT COUNT(*) c FROM pim_item").get() as { c: number }).c;
// 模拟重复迁移: 用 appendInbox 已经写入的 item id 再调一次同样 id 的 dual-write
// 这个真实 case 不应该发生 (appendInbox randomUUID每次新)，但 migration script 用 INSERT OR IGNORE 防御
const duplicateInsertStmt = harness.db.prepare(`
  INSERT OR IGNORE INTO pim_item (id, content, captured_at, source, commitment_state, modality, ai_status, visibility, created_at, updated_at)
  VALUES (?, 'dup', 0, 'test', 'inbox', 'text', 'pending', 'private', 0, 0)
`);
const result = duplicateInsertStmt.run(items[0].id);
assert(result.changes === 0, `INSERT OR IGNORE skips duplicate id (changes=0, got ${result.changes})`);
const afterDupe = (harness.db.prepare("SELECT COUNT(*) c FROM pim_item").get() as { c: number }).c;
assert(beforeDupe === afterDupe, `pim_item count unchanged after duplicate INSERT OR IGNORE`);

harness.close();
rmSync(tmpDir, { recursive: true, force: true });
console.log("");
console.log("inbox dual-write smoke test OK ✅");
