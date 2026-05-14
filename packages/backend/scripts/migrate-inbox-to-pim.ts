// migrate-inbox-to-pim — 把 inbox.jsonl 迁到 pim_item 表 (ADR-020 D3)
//
// 使用：
//   tsx packages/backend/scripts/migrate-inbox-to-pim.ts --dry-run
//   tsx packages/backend/scripts/migrate-inbox-to-pim.ts             # 实跑 (从 $DATA_DIR/inbox.jsonl 读)
//   tsx packages/backend/scripts/migrate-inbox-to-pim.ts --source ~/.claude-web/inbox.jsonl   # 一次性迁老 Eva 数据
//
// 行为：
//   1. 打开 harness.db (会触发 migration 0008_pim_item.sql 自动 apply)
//   2. 读 --source 指定 (或默认 $DATA_DIR/inbox.jsonl), 每行 InboxItem 转成 pim_item INSERT
//   3. 用 INSERT OR IGNORE — 已经存在的 id 不重复插
//   4. dry-run 模式只输出 count 不 INSERT
//
// 字段映射 (ADR-020 D3 + plan §Day 2):
//   body                                 → content
//   source                               → source (保留)
//   capturedAt                           → captured_at + created_at + updated_at
//   triage.destination='archive' OR
//   status='archived'                    → commitment_state='archived'
//   else                                 → commitment_state='inbox'
//   (默认)                               → modality='text', ai_status='disabled', visibility='private'
//
// 不迁字段 (Day 2 范围内忽略, 后续可补):
//   cwd                                  → pim_item 无此字段 (TODO Day 2+: 加 source 后缀或 meta JSON 列)
//   processedIntoConversationId          → 需要 conversation 对应 PimItem (Day 2+: harness Issue 联动)
//   meta                                 → pim_item 无 meta JSON 列 (TODO if needed)

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { openHarnessDb } from "../src/harness-store.js";
import { DATA_DIR } from "../src/data-dir.js";

interface InboxItem {
  id: string;
  body: string;
  source?: string;
  capturedAt: number;
  cwd?: string;
  processedIntoConversationId?: string;
  status?: "open" | "archived";
  triage?: { destination?: string; note?: string; triagedAt?: number };
  meta?: Record<string, unknown>;
}

interface PimItemRow {
  id: string;
  content: string;
  captured_at: number;
  source: string;
  commitment_state: "inbox" | "archived";
  modality: "text";
  ai_status: "disabled";
  visibility: "private";
  created_at: number;
  updated_at: number;
}

function mapInboxToPim(item: InboxItem): PimItemRow | null {
  if (typeof item.id !== "string" || typeof item.body !== "string") {
    console.warn(`[migrate] skip invalid item (missing id or body):`, item);
    return null;
  }
  const archived =
    item.status === "archived" || item.triage?.destination === "archive";
  return {
    id: item.id,
    content: item.body,
    captured_at: item.capturedAt,
    source: item.source ?? "unknown",
    commitment_state: archived ? "archived" : "inbox",
    modality: "text",
    ai_status: "disabled", // 历史数据不再触发 AI 建议
    visibility: "private",
    created_at: item.capturedAt,
    updated_at: item.capturedAt,
  };
}

function parseArgs(): { dryRun: boolean; sourcePath: string } {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  // --source <path> override; expand ~ to homedir
  const srcIdx = args.indexOf("--source");
  let sourcePath: string;
  if (srcIdx >= 0 && srcIdx + 1 < args.length) {
    const raw = args[srcIdx + 1];
    sourcePath = raw.startsWith("~/") || raw === "~"
      ? path.join(homedir(), raw.slice(2))
      : path.resolve(raw);
  } else {
    sourcePath = path.join(DATA_DIR, "inbox.jsonl");
  }
  return { dryRun, sourcePath };
}

function main(): void {
  const { dryRun, sourcePath } = parseArgs();

  console.log(`[migrate-inbox-to-pim] source: ${sourcePath}`);
  console.log(`[migrate-inbox-to-pim] mode: ${dryRun ? "dry-run" : "ACTUAL"}`);

  if (!existsSync(sourcePath)) {
    console.log(`[migrate-inbox-to-pim] inbox.jsonl not found at ${sourcePath} — nothing to migrate`);
    console.log(`[migrate-inbox-to-pim] hint: use --source ~/.claude-web/inbox.jsonl for one-time Eva→Vessel migration`);
    process.exit(0);
  }

  const lines = readFileSync(sourcePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  console.log(`[migrate-inbox-to-pim] read ${lines.length} jsonl lines`);

  const handle = openHarnessDb(); // triggers migration 0008 auto-apply
  console.log(`[migrate-inbox-to-pim] harness.db opened (schema v${handle.schemaVersion})`);

  // Stmt prepared once
  const insertStmt = handle.db.prepare(`
    INSERT OR IGNORE INTO pim_item
      (id, content, captured_at, source, commitment_state, modality, ai_status, visibility, created_at, updated_at)
    VALUES
      (@id, @content, @captured_at, @source, @commitment_state, @modality, @ai_status, @visibility, @created_at, @updated_at)
  `);

  let parsed = 0;
  let skipped = 0;
  let willInsert = 0;
  let inserted = 0;
  let alreadyExists = 0;
  let archivedCount = 0;

  const sampleMapped: PimItemRow[] = [];

  for (const line of lines) {
    let rawItem: InboxItem;
    try {
      rawItem = JSON.parse(line);
    } catch (err) {
      console.warn(`[migrate-inbox-to-pim] skip malformed JSON line: ${line.slice(0, 80)}...`);
      skipped += 1;
      continue;
    }
    parsed += 1;
    const mapped = mapInboxToPim(rawItem);
    if (mapped == null) {
      skipped += 1;
      continue;
    }
    willInsert += 1;
    if (mapped.commitment_state === "archived") archivedCount += 1;
    if (sampleMapped.length < 3) sampleMapped.push(mapped);

    if (!dryRun) {
      const result = insertStmt.run(mapped);
      if (result.changes === 1) {
        inserted += 1;
      } else {
        alreadyExists += 1;
      }
    }
  }

  console.log("");
  console.log("=== migration summary ===");
  console.log(`  parsed:           ${parsed}`);
  console.log(`  skipped (bad):    ${skipped}`);
  console.log(`  will-insert:      ${willInsert}`);
  console.log(`  → archived:       ${archivedCount}`);
  console.log(`  → inbox (active): ${willInsert - archivedCount}`);
  if (!dryRun) {
    console.log(`  actually inserted: ${inserted}`);
    console.log(`  already existed (ignored): ${alreadyExists}`);
  }

  console.log("");
  console.log("=== sample mapped rows ===");
  for (const s of sampleMapped) {
    console.log(`  ${s.id}  [${s.commitment_state}, ${s.source}]  ${s.content.slice(0, 60)}...`);
  }

  // Verify count
  if (!dryRun) {
    const finalCount = (handle.db.prepare("SELECT COUNT(*) as c FROM pim_item").get() as { c: number }).c;
    console.log("");
    console.log(`[migrate-inbox-to-pim] final pim_item row count: ${finalCount}`);
  }

  handle.close();
  console.log("");
  console.log(dryRun ? "[migrate-inbox-to-pim] dry-run done (no changes)" : "[migrate-inbox-to-pim] done ✅");
}

main();
