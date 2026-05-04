// Centralized auth + path-allowlist enforcement for the backend.
//
// Two independent gates:
//   1. CLAUDE_WEB_TOKEN — shared bearer/query token. Required on every
//      /api/* request (except /health) and on the /ws upgrade. If empty,
//      we log a one-time warning and allow no-auth (single-user dev mode).
//   2. CLAUDE_WEB_ALLOWED_ROOTS — colon-separated absolute paths. Every
//      cwd / root passed to fs / git / sessions / cli-runner must equal one
//      of these or live below one of them. If empty, log a warning and
//      allow any path.
//
// Both are *optional* so existing dev setups keep working, but the warning
// nudges the user to set them. Production-ish setups (Tailscale serve,
// launchd, etc.) should always set both.

import path from "node:path";
import type { Context, Next } from "hono";
import { SCRATCH_CWD } from "./projects-store.js";

const TOKEN = (process.env.CLAUDE_WEB_TOKEN ?? "").trim();
const RAW_ROOTS = (process.env.CLAUDE_WEB_ALLOWED_ROOTS ?? "").trim();

const ALLOWED_ROOTS: string[] = RAW_ROOTS
  ? Array.from(new Set([
      ...RAW_ROOTS.split(":")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => path.resolve(p)),
      // Always permit the scratch project's cwd so the always-on "💬 随手问"
      // entry works even with a strict allowlist.
      SCRATCH_CWD,
    ]))
  : [];

let warnedToken = false;
let warnedRoots = false;

export function isAuthEnabled(): boolean {
  return TOKEN.length > 0;
}

export function isPathAllowlistEnabled(): boolean {
  return ALLOWED_ROOTS.length > 0;
}

export function getAllowedRoots(): readonly string[] {
  return ALLOWED_ROOTS;
}

/** Check a single token (constant-time-ish). */
function tokenMatches(supplied: string | null | undefined): boolean {
  if (!supplied) return false;
  if (supplied.length !== TOKEN.length) return false;
  let mismatch = 0;
  for (let i = 0; i < TOKEN.length; i++) {
    mismatch |= TOKEN.charCodeAt(i) ^ supplied.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Extract a token from an HTTP request. Accepts either:
 *   - Authorization: Bearer <token>
 *   - ?token=<token> query param  (handy for SSE / `<img>` / WS)
 */
export function extractTokenFromRequest(
  authHeader: string | null | undefined,
  url: string,
): string | null {
  if (authHeader) {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (m && m[1]) return m[1].trim();
  }
  try {
    const u = new URL(url, "http://localhost");
    const q = u.searchParams.get("token");
    if (q) return q;
  } catch { /* ignore */ }
  return null;
}

/** Check Hono context against the configured token. */
export function checkAuth(c: Context): boolean {
  if (!isAuthEnabled()) {
    if (!warnedToken) {
      console.warn(
        "[auth] CLAUDE_WEB_TOKEN is empty — running without authentication. " +
        "Set it in env (and on launchd plist) for any non-localhost exposure.",
      );
      warnedToken = true;
    }
    return true;
  }
  const supplied = extractTokenFromRequest(
    c.req.header("authorization") ?? null,
    c.req.url,
  );
  return tokenMatches(supplied);
}

/** Hono middleware: 401s requests without a valid token. */
export const authMiddleware = async (c: Context, next: Next) => {
  if (!checkAuth(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

/** Validate a token from a raw HTTP upgrade request URL/headers (for WS). */
export function checkWsAuth(rawUrl: string | undefined, authHeader: string | undefined): boolean {
  if (!isAuthEnabled()) return true;
  const supplied = extractTokenFromRequest(authHeader ?? null, rawUrl ?? "");
  return tokenMatches(supplied);
}

/**
 * Verify that an absolute path is allowed (== an allowed root or under one).
 * Returns null on success, error string on failure.
 */
export function verifyAllowedPath(absPath: string): string | null {
  if (!path.isAbsolute(absPath)) return "path must be absolute";
  const resolved = path.resolve(absPath);
  if (!isPathAllowlistEnabled()) {
    if (!warnedRoots) {
      console.warn(
        "[auth] CLAUDE_WEB_ALLOWED_ROOTS is empty — fs/git/sessions accept any absolute path. " +
        "Set it (e.g. /Users/you/code:/Users/you/Desktop) to lock this down.",
      );
      warnedRoots = true;
    }
    return null;
  }
  for (const root of ALLOWED_ROOTS) {
    if (resolved === root) return null;
    const rel = path.relative(root, resolved);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return null;
  }
  return `path not under any allowed root (${ALLOWED_ROOTS.join(", ")})`;
}
