#!/usr/bin/env -S npx tsx
/**
 * Eva → Vessel 一次性数据迁移脚本
 *
 * 按 ADR-013 §2 Stage 2 + EVA_TO_VESSEL_MAPPING §2 + ADR-006 schema 演进策略：
 *  - 复制 ~/.claude-web/ → ~/.vessel/（**不删源**，按 0-pre E1 owner 决议）
 *  - 默认 --dry-run（看会复制什么）；显式加 --apply 才实迁
 *  - 跳过 eva.json（worktree orchestration，Vessel 不复用，按 ADR-000 §3）
 *  - migration 0004（v103）schema 升级由 vessel-core 启动时自动跑
 *
 * 用法：
 *   pnpm migrate:eva-to-vessel              # dry-run（默认）
 *   pnpm migrate:eva-to-vessel --apply      # 实际复制
 *   pnpm migrate:eva-to-vessel --apply --force-overwrite  # 覆盖已存在的 ~/.vessel/ 文件
 *
 * **v0A.1 risk-officer M-R1 警告**：当前实现用 `fs.copyFileSync` 而非 `sqlite3 .backup`。
 * SQLite WAL 三件套（.db / .db-wal / .db-shm）在 Eva vessel-core **正在运行**时复制
 * 可能 corruption。**调用 `--apply` 前必须先 stop 所有 Eva 进程**：
 *   pkill -f "tsx src/index.ts"   # 或对应 vessel-core 启动命令
 * v0.1 release prep 时改用 `sqlite3 ~/.claude-web/harness.db ".backup ~/.vessel/memory.db"`。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const HOME = os.homedir();
const SRC = path.join(HOME, '.claude-web');
const DEST = path.join(HOME, '.vessel');

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = !ARGS.has('--apply');
const FORCE = ARGS.has('--force-overwrite');

interface MigrationItem {
  src: string;
  dest: string;
  description: string;
  mode?: 'copy-file' | 'copy-dir' | 'rename';
}

const ITEMS: MigrationItem[] = [
  { src: 'harness.db',           dest: 'memory.db',                   description: 'SQLite database (Eva harness.db → Vessel memory.db)', mode: 'rename' },
  { src: 'harness.db-wal',       dest: 'memory.db-wal',               description: 'SQLite WAL', mode: 'rename' },
  { src: 'harness.db-shm',       dest: 'memory.db-shm',               description: 'SQLite shared memory', mode: 'rename' },
  { src: 'inbox.jsonl',          dest: 'inbox.jsonl',                 description: 'Inbox (JSONL)', mode: 'copy-file' },
  { src: 'projects.json',        dest: 'projects.json',               description: 'Projects registry', mode: 'copy-file' },
  { src: 'telemetry.jsonl',      dest: 'traces/telemetry-legacy.jsonl', description: 'Telemetry → Vessel traces/', mode: 'copy-file' },
  { src: 'telemetry.jsonl.1',    dest: 'traces/telemetry-legacy.jsonl.1', description: 'Telemetry rotation', mode: 'copy-file' },
  { src: 'work.jsonl',           dest: 'work.jsonl',                  description: 'Work registry', mode: 'copy-file' },
  { src: 'notify.json',          dest: 'notify.json',                 description: 'Notification settings', mode: 'copy-file' },
  { src: 'artifacts',            dest: 'artifacts',                   description: 'Artifacts directory', mode: 'copy-dir' },
  // eva.json 不迁（按 ADR-000 §3 排除清单：Eva worktree orchestration）
];

const EXCLUDE: string[] = ['eva.json'];  // 显式排除

function fileExists(p: string): boolean {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function copyFile(src: string, dest: string): void {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function getSize(p: string): number {
  try {
    const stat = fs.statSync(p);
    if (stat.isFile()) return stat.size;
    if (stat.isDirectory()) {
      let total = 0;
      for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
        total += getSize(path.join(p, entry.name));
      }
      return total;
    }
  } catch { /* ignore */ }
  return 0;
}

function main(): void {
  console.log(`Eva → Vessel data migration`);
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY-RUN' : '⚡ APPLY'}${FORCE ? ' (--force-overwrite)' : ''}`);
  console.log(`Source: ${SRC}`);
  console.log(`Destination: ${DEST}`);
  console.log();

  if (!fs.existsSync(SRC)) {
    console.log(`✓ ${SRC} doesn't exist — no Eva data to migrate. Done.`);
    return;
  }

  const evaItems = fs.readdirSync(SRC);
  console.log(`Found ${evaItems.length} items in ${SRC}`);

  // EXCLUDE 检查
  for (const excl of EXCLUDE) {
    if (evaItems.includes(excl)) {
      console.log(`  ⚠ ${excl} (excluded — not migrated, see ADR-000 §3)`);
    }
  }

  console.log();
  console.log('Migration plan:');

  let total = 0;
  let conflicts = 0;
  const toRun: MigrationItem[] = [];

  for (const item of ITEMS) {
    const srcPath = path.join(SRC, item.src);
    const destPath = path.join(DEST, item.dest);

    if (!fileExists(srcPath)) {
      console.log(`  ⊘ ${item.src} → not in source (skip)`);
      continue;
    }

    const size = getSize(srcPath);
    total += size;

    if (fileExists(destPath) && !FORCE) {
      console.log(`  ⚠ ${item.src} → ${item.dest}: dest already exists (skip; use --force-overwrite)`);
      conflicts++;
      continue;
    }

    console.log(`  ${DRY_RUN ? '◯' : '✓'} ${item.src} → ${item.dest} (${fmtBytes(size)}) [${item.description}]`);
    toRun.push(item);
  }

  console.log();
  console.log(`Total: ${toRun.length} items, ${fmtBytes(total)}; ${conflicts} conflicts skipped`);

  if (DRY_RUN) {
    console.log();
    console.log('🔍 DRY-RUN — no changes made');
    console.log(`Re-run with --apply to execute (or --apply --force-overwrite to overwrite existing dest files)`);
    return;
  }

  // 实迁
  if (!fs.existsSync(DEST)) {
    fs.mkdirSync(DEST, { recursive: true });
    console.log(`✓ Created ${DEST}`);
  }

  for (const item of toRun) {
    const srcPath = path.join(SRC, item.src);
    const destPath = path.join(DEST, item.dest);

    if (item.mode === 'copy-dir') {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
    console.log(`  ✓ ${item.src} → ${item.dest}`);
  }

  console.log();
  console.log(`✅ Migration complete. Source ${SRC} preserved (not deleted).`);
  console.log();
  console.log(`Next steps:`);
  console.log(`  1. Set env vars: VESSEL_DATA_DIR (default ~/.vessel) / VESSEL_TOKEN / VESSEL_ALLOWED_ROOTS / VESSEL_PUBLIC_URL`);
  console.log(`     (Old CLAUDE_WEB_* env vars are NOT auto-fallback — see ADR-013 §2 修订)`);
  console.log(`  2. Start vessel-core; migration 0004 (schema_version=103) will auto-run on first boot`);
  console.log(`  3. Verify with vessel-core --health`);
}

main();
