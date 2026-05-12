// Unit tests for version-info + update-check pure functions.
// tsx script style (no vitest setup) — matches other test:* scripts in package.json.
//
// Runs `pnpm --filter @vessel/backend test:update-check`.

import assert from "node:assert/strict";
import { getCurrentVersion } from "./lib/version-info.js";
import { compareVersions, parsePkgVersion } from "./lib/update-check.js";

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`✓ ${name}`); }
  catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ ${name}\n    ${msg}`);
  }
}

check("getCurrentVersion returns a string backend version", () => {
  const v = getCurrentVersion();
  assert.equal(typeof v.backend, "string");
  assert.ok(v.backend.length > 0, `empty backend: ${JSON.stringify(v)}`);
  assert.ok(["VERSION", "package.json", "unknown"].includes(v.source), `bad source: ${v.source}`);
});

check("getCurrentVersion is memoized (same instance on repeat)", () => {
  const a = getCurrentVersion();
  const b = getCurrentVersion();
  assert.equal(a, b, "expected memoized singleton");
});

check("parsePkgVersion extracts version from canonical filename", () => {
  assert.equal(parsePkgVersion("Vessel-Backend-v0.1.1-arm64.pkg"), "0.1.1");
  assert.equal(parsePkgVersion("Vessel-Backend-v1.2.3-arm64.pkg"), "1.2.3");
  assert.equal(parsePkgVersion("Vessel-Backend-v10.20.30-arm64.pkg"), "10.20.30");
});

check("parsePkgVersion returns null for non-matching", () => {
  assert.equal(parsePkgVersion("random-file.txt"), null);
  assert.equal(parsePkgVersion("Vessel-Backend-v0.1.1-x64.pkg"), null); // not arm64
  assert.equal(parsePkgVersion(""), null);
});

check("compareVersions: equal", () => {
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
});

check("compareVersions: positive (a > b)", () => {
  assert.ok(compareVersions("0.1.1", "0.1.0") > 0);
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
});

check("compareVersions: negative (a < b)", () => {
  assert.ok(compareVersions("0.1.0", "0.1.1") < 0);
  assert.ok(compareVersions("0.0.99", "0.1.0") < 0);
});

check("compareVersions: different segment counts", () => {
  // 0.1 = 0.1.0
  assert.equal(compareVersions("0.1", "0.1.0"), 0);
  assert.ok(compareVersions("0.1.1", "0.1") > 0);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll tests passed");
