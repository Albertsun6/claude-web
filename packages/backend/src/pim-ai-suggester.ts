// pim-ai-suggester — AI Level 1 建议态外脑 (ADR-020 §D9, M0-PIM Week 2 Day 9-10)
//
// 设计原则（ADR-020 §D9）：
// - **建议态外脑**: AI 永不擅自移动 — 写到 pim_intent_snapshot 表作为"建议"，
//   用户 1-tap accept 才应用到 pim_item.commitment_state
// - **独立 spawn** (NOT 复用 cli-runner.ts — 后者为长 task 设计):
//   spawn claude --model haiku --output-format json -p "<short prompt>"
// - **30s AbortController timeout**: 超时 kill -9 child
// - **状态机** pim_item.ai_status: pending → running → done/failed/timeout/disabled
// - **Orphan cleanup**: backend 启动时扫 ai_status='running' > 5min → 标 failed
// - **24h 退避**: 失败 24h 内不重试
// - **env var PIM_AI_ENABLED=true|false** 全局开关；空/false → 跳过整个 suggester
//
// Mem.ai 教训: 早期失败核心是缺 audit trail + override → 我们用 audit log 记录
// 每次建议，用户可见、可拒绝、可回滚。

import { spawn } from "node:child_process";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { appendPimAudit } from "./pim-audit.js";

// ============================================================================
// Config
// ============================================================================

const PIM_AI_ENABLED = (process.env.PIM_AI_ENABLED ?? "false").toLowerCase() === "true";
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const TIMEOUT_MS = 30_000;
const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
const RETRY_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isPimAiEnabled(): boolean {
  return PIM_AI_ENABLED;
}

// ============================================================================
// State machine: pim_item.ai_status transitions
// ============================================================================
//
// pending  → running  (suggester picks up)
// running  → done     (suggestion successfully written)
// running  → failed   (claude CLI exit non-zero / parse error)
// running  → timeout  (30s AbortController fired)
// any      → disabled (PIM_AI_ENABLED=false; orphan cleanup; manual override)
// ============================================================================

function setAiStatus(
  db: Database.Database,
  pimItemId: string,
  newStatus: "pending" | "running" | "done" | "failed" | "timeout" | "disabled",
  suggestedAt?: number,
): boolean {
  const result = db
    .prepare(
      `UPDATE pim_item
         SET ai_status = ?, ai_suggested_at = COALESCE(?, ai_suggested_at), updated_at = ?
       WHERE id = ?`,
    )
    .run(newStatus, suggestedAt ?? null, Date.now(), pimItemId);
  return result.changes > 0;
}

// ============================================================================
// Cleanup orphan running items (called by backend boot)
// ============================================================================

/**
 * Backend boot 时调用：扫 ai_status='running' 但 ai_suggested_at 超过 5 min →
 * 标 failed (crashed mid-spawn). 与 scheduler cleanupOrphanStages 模式一致.
 */
export function cleanupOrphanAiSuggestions(db: Database.Database): number {
  const threshold = Date.now() - ORPHAN_THRESHOLD_MS;
  const orphans = db
    .prepare(
      `SELECT id FROM pim_item
         WHERE ai_status = 'running'
           AND (ai_suggested_at IS NULL OR ai_suggested_at < ?)
           AND deleted_at IS NULL`,
    )
    .all(threshold) as Array<{ id: string }>;

  if (orphans.length === 0) return 0;

  const tx = db.transaction(() => {
    for (const row of orphans) {
      setAiStatus(db, row.id, "failed");
      appendPimAudit({
        op: "ai_suggest",
        pim_item_id: row.id,
        actor: "system",
        reason: "orphan_after_restart",
        after: { ai_status: "failed" },
      });
    }
  });
  tx();
  console.log(`[pim-ai-suggester] marked ${orphans.length} orphan AI runs as failed`);
  return orphans.length;
}

// ============================================================================
// Backoff check: skip retry if recent failure
// ============================================================================

function recentlyFailedWithin(db: Database.Database, pimItemId: string, windowMs: number): boolean {
  const row = db
    .prepare(
      `SELECT ai_status, ai_suggested_at FROM pim_item WHERE id = ?`,
    )
    .get(pimItemId) as { ai_status: string; ai_suggested_at: number | null } | undefined;
  if (!row) return false;
  if (row.ai_status !== "failed" && row.ai_status !== "timeout") return false;
  if (row.ai_suggested_at == null) return false;
  return Date.now() - row.ai_suggested_at < windowMs;
}

// ============================================================================
// Prompt template (short — claude --model haiku must respond in JSON ≤ 200 tokens)
// ============================================================================

const PROMPT_TEMPLATE = (content: string) =>
  `You are a PIM (Personal Information Manager) classifier. Given a short captured note, output ONLY a JSON object (no markdown, no commentary) with these fields:

- "commitmentState": one of ["inbox", "action", "calendar", "waiting", "reference"] (default "inbox" if unclear)
- "modality": one of ["text", "link", "image", "audio", "file"] (default "text")
- "domainTags": array of zero or more from ["工作","家庭","健康","财务","学习","兴趣","关系"]

Rules:
- Only suggest "action" if the note clearly contains a TODO ("I need to…", "buy", "fix", "send", "finish").
- Only suggest "calendar" if there's a date/time reference.
- Only suggest "waiting" if it's blocked on someone else / external.
- Otherwise default to "inbox".

Captured note:
"""
${content}
"""

JSON:`;

// ============================================================================
// Suggestion result schema
// ============================================================================

export interface PimAiSuggestion {
  commitmentState?: string;
  modality?: string;
  domainTags?: string[];
}

interface SpawnResult {
  ok: boolean;
  /** suggestion JSON if ok */
  data?: PimAiSuggestion;
  /** 'timeout' | 'spawn_failed' | 'non_json' | 'non_zero_exit' */
  failureReason?: string;
  /** stderr / parse error truncated to 500 chars */
  errorSnippet?: string;
}

// ============================================================================
// Spawn helper: claude --model haiku --output-format json -p "<prompt>"
// ============================================================================

async function spawnClaudeShort(prompt: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const args = ["--model", "haiku", "--output-format", "json", "-p", prompt];
    const child = spawn(CLAUDE_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal: controller.signal,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        failureReason:
          (err as NodeJS.ErrnoException).code === "ENOENT" ? "spawn_failed" : "spawn_failed",
        errorSnippet: err.message.slice(0, 500),
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGABRT" || signal === "SIGTERM" || signal === "SIGKILL" || controller.signal.aborted) {
        return resolve({ ok: false, failureReason: "timeout" });
      }
      if (code !== 0) {
        return resolve({
          ok: false,
          failureReason: "non_zero_exit",
          errorSnippet: stderr.slice(0, 500),
        });
      }
      // claude --output-format json emits an envelope; the user prompt's response is in .result
      // Defensively try both: parse stdout directly as JSON (haiku said something), OR look for .result.
      let parsed: any;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        return resolve({ ok: false, failureReason: "non_json", errorSnippet: stdout.slice(0, 500) });
      }
      // If envelope shape, dig out the result text → JSON parse
      const inner = typeof parsed?.result === "string" ? parsed.result : null;
      let suggestion: PimAiSuggestion | undefined;
      if (inner) {
        try {
          suggestion = JSON.parse(inner.trim());
        } catch {
          return resolve({ ok: false, failureReason: "non_json", errorSnippet: inner.slice(0, 500) });
        }
      } else {
        suggestion = parsed as PimAiSuggestion;
      }
      resolve({ ok: true, data: suggestion });
    });
  });
}

// ============================================================================
// Main API: suggestForPimItem
// ============================================================================

/**
 * Generate an AI Level 1 suggestion for a PimItem and persist it as a
 * pim_intent_snapshot row (NOT applied to pim_item.commitment_state — user
 * must 1-tap accept). Updates pim_item.ai_status state machine throughout.
 *
 * Fire-and-forget from caller (POST /api/pim handler): never throws,
 * swallows all errors into ai_status='failed'.
 *
 * Skips when PIM_AI_ENABLED=false or item already 'disabled' or recently
 * failed within 24h.
 */
export async function suggestForPimItem(
  db: Database.Database,
  pimItemId: string,
): Promise<void> {
  if (!PIM_AI_ENABLED) {
    setAiStatus(db, pimItemId, "disabled", Date.now());
    return;
  }

  // 24h backoff after recent failure
  if (recentlyFailedWithin(db, pimItemId, RETRY_BACKOFF_MS)) {
    console.log(`[pim-ai-suggester] skip ${pimItemId}: recently failed within 24h backoff`);
    return;
  }

  const row = db
    .prepare(
      `SELECT content, ai_status FROM pim_item WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(pimItemId) as { content: string; ai_status: string } | undefined;
  if (!row) return;
  if (row.ai_status === "running" || row.ai_status === "done" || row.ai_status === "disabled") {
    return;
  }

  const startedAt = Date.now();
  setAiStatus(db, pimItemId, "running", startedAt);

  const result = await spawnClaudeShort(PROMPT_TEMPLATE(row.content));
  const finishedAt = Date.now();

  if (!result.ok) {
    const failStatus = result.failureReason === "timeout" ? "timeout" : "failed";
    setAiStatus(db, pimItemId, failStatus as "failed" | "timeout", finishedAt);
    appendPimAudit({
      op: "ai_suggest",
      pim_item_id: pimItemId,
      actor: "ai",
      reason: result.failureReason,
      after: { ai_status: failStatus, error_snippet: result.errorSnippet },
    });
    return;
  }

  // Persist suggestion as pim_intent_snapshot (建议态 — not applied to pim_item)
  const sug = result.data!;
  const vectorJson = JSON.stringify({
    suggested_commitment_state: sug.commitmentState ?? null,
    suggested_modality: sug.modality ?? null,
    suggested_domain_tags: sug.domainTags ?? [],
    latency_ms: finishedAt - startedAt,
  });
  db.prepare(
    `INSERT INTO pim_intent_snapshot (id, pim_item_id, vector_json, snapshot_at, source)
     VALUES (?, ?, ?, ?, 'ai_suggest')`,
  ).run(`pis-${randomUUID()}`, pimItemId, vectorJson, finishedAt);

  setAiStatus(db, pimItemId, "done", finishedAt);
  appendPimAudit({
    op: "ai_suggest",
    pim_item_id: pimItemId,
    actor: "ai",
    after: {
      ai_status: "done",
      suggestion: sug,
      latency_ms: finishedAt - startedAt,
    },
  });
}
