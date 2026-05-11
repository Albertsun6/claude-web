/**
 * Startup env var check — Vessel renamed from claude-web (per ADR-013 §2 Stage 2 修订).
 *
 * **代码不留 fallback**（按 pragmatist M-P1 + 0-pre E2 owner 决议）：
 *   迁移脚本 alert 用户改 env 后再跑；不在代码里 try VESSEL_X || CLAUDE_WEB_X。
 *
 * 此模块在 vessel-core 进程启动时（bootProcess() 早期）调用：
 *   - 检测旧 CLAUDE_WEB_* env vars
 *   - 如有 → 输出明确指引 + process.exit(1)
 *     （v0A.1 risk-officer M-R3：launchd 启动若 stderr 静默，用户看不到 alert
 *     → 可设 `VESSEL_ENV_CHECK_BYPASS=1` 跳过 exit；默认仍 fail-loud）
 *   - 如无 → 静默通过
 *
 * 检测的 env vars（与 ADR-013 §2 Stage 2 + EVA_TO_VESSEL_MAPPING §2 一致）：
 *   - CLAUDE_WEB_TOKEN          → VESSEL_TOKEN
 *   - CLAUDE_WEB_ALLOWED_ROOTS  → VESSEL_ALLOWED_ROOTS
 *   - CLAUDE_WEB_DATA_DIR       → VESSEL_DATA_DIR
 *   - CLAUDE_WEB_PUBLIC_URL     → VESSEL_PUBLIC_URL
 */

const RENAME_MAP: Record<string, string> = {
  CLAUDE_WEB_TOKEN: 'VESSEL_TOKEN',
  CLAUDE_WEB_ALLOWED_ROOTS: 'VESSEL_ALLOWED_ROOTS',
  CLAUDE_WEB_DATA_DIR: 'VESSEL_DATA_DIR',
  CLAUDE_WEB_PUBLIC_URL: 'VESSEL_PUBLIC_URL',
};

export function checkRenamedEnvVars(): void {
  const stale: string[] = [];

  for (const oldName of Object.keys(RENAME_MAP)) {
    if (process.env[oldName] !== undefined && process.env[oldName] !== '') {
      stale.push(oldName);
    }
  }

  if (stale.length === 0) return;

  // Found stale env vars — alert + exit
  process.stderr.write('\n');
  process.stderr.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.stderr.write('⚠️  Stale CLAUDE_WEB_* env vars detected\n');
  process.stderr.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.stderr.write('\n');
  process.stderr.write('Vessel renamed env vars (ADR-013). Code does NOT fall back to CLAUDE_WEB_* —\n');
  process.stderr.write('please rename them in your shell profile / .env / launchd plist:\n');
  process.stderr.write('\n');
  for (const oldName of stale) {
    const newName = RENAME_MAP[oldName];
    process.stderr.write(`  ${oldName}  →  ${newName}\n`);
  }
  process.stderr.write('\n');
  process.stderr.write('After renaming, re-start vessel-core.\n');
  process.stderr.write('\n');
  process.stderr.write('See: docs/adr/vessel/ADR-013-rename-strategy.md §2 Stage 2\n');
  process.stderr.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.stderr.write('\n');

  // v0A.1 risk-officer M-R3 escape hatch: launchd 用户若已确认 stale 但希望服务继续启动
  // （如临时迁移期），可设 VESSEL_ENV_CHECK_BYPASS=1 跳过 exit。默认 fail-loud。
  if (process.env.VESSEL_ENV_CHECK_BYPASS === '1') {
    process.stderr.write('VESSEL_ENV_CHECK_BYPASS=1 detected — continuing despite stale vars.\n');
    process.stderr.write('\n');
    return;
  }

  process.exit(1);
}
