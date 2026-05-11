/**
 * M1B+ — Claude CLI MCP wire-up integration test.
 *
 * Verifies:
 *  1. getMcpConfigPath() returns null when VESSEL_MCP_SERVERS unset/empty
 *  2. Writes a valid {mcpServers: {...}} JSON when env is set
 *  3. Cached path is stable across calls with same env
 *  4. cleanupMcpConfig() removes file
 *  5. buildCliMcpConfig() produces correct shape (incl. env field)
 *  6. Temp file mode is 0o600 (no group/world readable)
 *
 * No real Claude CLI invocation here — that requires manual smoke test (see
 * end of file). This test exercises the env→file bridge logic.
 */

import 'dotenv/config';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  getMcpConfigPath,
  cleanupMcpConfig,
  buildCliMcpConfig,
  _resetCacheForTest,
} from './mcp/cli-config.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    process.stdout.write(`  ✅ ${label}\n`);
    passed++;
  } else {
    process.stderr.write(`  ❌ FAIL: ${label}\n`);
    failed++;
  }
}

// Save original env so we can restore it later.
const originalEnv = process.env['VESSEL_MCP_SERVERS'];

// ── Test 1: empty / unset env returns null ────────────────────────────────
{
  delete process.env['VESSEL_MCP_SERVERS'];
  _resetCacheForTest();
  cleanupMcpConfig();
  assert(getMcpConfigPath() === null, 'returns null when VESSEL_MCP_SERVERS unset');

  process.env['VESSEL_MCP_SERVERS'] = '';
  _resetCacheForTest();
  assert(getMcpConfigPath() === null, 'returns null when VESSEL_MCP_SERVERS empty');

  process.env['VESSEL_MCP_SERVERS'] = '   ';
  _resetCacheForTest();
  assert(getMcpConfigPath() === null, 'returns null when VESSEL_MCP_SERVERS whitespace');

  process.env['VESSEL_MCP_SERVERS'] = 'not json';
  _resetCacheForTest();
  assert(getMcpConfigPath() === null, 'returns null when VESSEL_MCP_SERVERS invalid JSON');

  process.env['VESSEL_MCP_SERVERS'] = '{"not":"array"}';
  _resetCacheForTest();
  assert(getMcpConfigPath() === null, 'returns null when VESSEL_MCP_SERVERS not an array');

  process.env['VESSEL_MCP_SERVERS'] = '[]';
  _resetCacheForTest();
  assert(getMcpConfigPath() === null, 'returns null when array is empty');
}

// ── Test 2: valid env writes a real file ──────────────────────────────────
{
  process.env['VESSEL_MCP_SERVERS'] = JSON.stringify([
    { name: 'fs-test', command: 'node', args: ['./fake-mcp.js'] },
    { name: 'with-env', command: 'python', args: ['s.py'], env: { LOG_LEVEL: 'debug' } },
  ]);
  _resetCacheForTest();
  cleanupMcpConfig();

  const path = getMcpConfigPath();
  assert(path !== null, 'returns a path when env has valid specs');
  assert(typeof path === 'string' && path.includes(`vessel-mcp-${process.pid}`), 'path contains pid for isolation');
  assert(existsSync(path!), 'file exists on disk');

  const raw = readFileSync(path!, 'utf8');
  const parsed = JSON.parse(raw) as { mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> };
  assert(typeof parsed.mcpServers === 'object', 'JSON has mcpServers key');
  assert(parsed.mcpServers['fs-test']?.command === 'node', 'fs-test command preserved');
  assert(Array.isArray(parsed.mcpServers['fs-test']?.args), 'fs-test args is array');
  assert(parsed.mcpServers['with-env']?.env?.['LOG_LEVEL'] === 'debug', 'env field passed through');
  assert(!('env' in (parsed.mcpServers['fs-test'] ?? {})), 'env omitted when not provided in spec');

  // File mode must not be group/world readable (security: contains command paths).
  const mode = statSync(path!).mode & 0o777;
  assert(mode === 0o600, `file mode is 0o600 (got ${mode.toString(8)})`);
}

// ── Test 3: cached path stable across calls with same env ────────────────
{
  // env still set from Test 2
  const a = getMcpConfigPath();
  const b = getMcpConfigPath();
  assert(a !== null && a === b, 'getMcpConfigPath returns cached path on repeat');
}

// ── Test 4: env change regenerates file ──────────────────────────────────
{
  const before = getMcpConfigPath();

  // Mutate env (simulates rare in-process change).
  process.env['VESSEL_MCP_SERVERS'] = JSON.stringify([
    { name: 'changed', command: 'sh', args: ['-c', 'true'] },
  ]);
  // We don't reset cache — getMcpConfigPath should detect via envHash.
  const after = getMcpConfigPath();
  assert(after !== null, 'still returns a path after env change');

  const raw = readFileSync(after!, 'utf8');
  const parsed = JSON.parse(raw) as { mcpServers: Record<string, unknown> };
  assert('changed' in parsed.mcpServers, 'regenerated file reflects new env');
  assert(!('fs-test' in parsed.mcpServers), 'old entries gone from regenerated file');

  // before path may equal after path (same pid/tmpdir) — content matters, not identity.
  void before;
}

// ── Test 5: cleanupMcpConfig removes file ────────────────────────────────
{
  const path = getMcpConfigPath();
  assert(path !== null && existsSync(path!), 'file exists before cleanup');
  cleanupMcpConfig();
  assert(!existsSync(path!), 'file removed after cleanup');

  // Idempotent — second call shouldn't throw.
  let threw = false;
  try { cleanupMcpConfig(); } catch { threw = true; }
  assert(!threw, 'cleanupMcpConfig is idempotent');
}

// ── Test 6: buildCliMcpConfig pure function ──────────────────────────────
{
  const config = buildCliMcpConfig([
    { name: 'a', command: 'cmd-a', args: ['1', '2'] },
    { name: 'b', command: 'cmd-b', args: [], env: { K: 'V' } },
  ]);
  assert(Object.keys(config.mcpServers).length === 2, 'buildCliMcpConfig produces all entries');
  const a = config.mcpServers['a'] as Record<string, unknown>;
  const b = config.mcpServers['b'] as Record<string, unknown>;
  assert(a['command'] === 'cmd-a' && Array.isArray(a['args']), 'entry a shape correct');
  assert(!('env' in a), 'entry a omits env when not provided');
  assert(b['env'] !== undefined && (b['env'] as Record<string, string>)['K'] === 'V', 'entry b includes env');
}

// ── Test 7: cli-runner buildArgs includes --mcp-config when set ──────────
// Imports here to avoid circular issues at top of file
{
  process.env['VESSEL_MCP_SERVERS'] = JSON.stringify([
    { name: 'x', command: 'true', args: [] },
  ]);
  _resetCacheForTest();
  cleanupMcpConfig();

  // We can't easily test buildArgs in isolation (it's not exported), so instead
  // verify getMcpConfigPath returns a path that buildArgs would consume.
  const path = getMcpConfigPath();
  assert(path !== null, 'getMcpConfigPath ready for cli-runner consumption');

  // Cleanup after this test
  cleanupMcpConfig();
}

// ── Restore env ──────────────────────────────────────────────────────────
if (originalEnv === undefined) {
  delete process.env['VESSEL_MCP_SERVERS'];
} else {
  process.env['VESSEL_MCP_SERVERS'] = originalEnv;
}

process.stdout.write(`\nM1B+ MCP wire-up tests: ${passed} passed, ${failed} failed\n`);

// ── Manual smoke test note ────────────────────────────────────────────────
process.stdout.write(`
Manual smoke (requires real MCP server, e.g. @modelcontextprotocol/server-filesystem):

  export VESSEL_MCP_SERVERS='[{"name":"fs","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}]'
  pnpm vessel-core "list files in /tmp using the filesystem tool"

  Expect: Claude CLI invokes mcp__fs__* tools; child gets --mcp-config /tmp/vessel-mcp-<pid>.json.
  Verify: ps aux | grep server-filesystem (Claude CLI's spawned child)
`);

process.exit(failed > 0 ? 1 : 0);
