// Common helpers used across all aisep protocol schemas.
//
// Independent from @claude-web/shared by design (R1 red line, v0): even
// though semantically similar to harness-protocol's helpers, AISEP keeps
// its own to avoid coupling. Phase 2+ may evaluate sharing.

import { z } from "zod";

/** epoch ms non-negative integer (< 2^53 compatible with JS Number / Swift Int64) */
export const EpochMsSchema = z.number().int().nonnegative();

/** Artifact content hash in form "sha256:<64 hex>" */
export const ContentHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "must be 'sha256:<64 hex>'");

/** Opaque ID — recommended pattern `<type>-<ULID>` but not enforced */
export const OpaqueIdSchema = z.string().min(1);

/**
 * trace_id namespace (Round-2 added FIX + TEST per reviewer-cross M6):
 * - REQ: requirement (requirements.yaml)
 * - ADR: architecture decision record (decisions/NNNN-*.md)
 * - ZOD: zod schema name (contracts-seed.ts / contracts/*.ts)
 * - RISK: risk register entry (risks.yaml)
 * - FIX: AlphaEvolve memory record (governance-log/evolution_log.json)
 * - TEST: test case id (verify_report.json)
 * - G / D / C / P / S: ArchiMate Motivation Layer (goal / driver / constraint / principle / stakeholder)
 *
 * **Padding convention** (not regex-enforced in v0.1 to preserve existing
 * fixtures; v0.2 may tighten):
 * - REQ / ADR / ZOD / RISK / FIX / TEST: 4-digit zero-padded (`ADR-0001`)
 * - G / D / C / P / S: ≥ 1 digit OK (`G-1` acceptable)
 */
export const TraceIdSchema = z
  .string()
  .regex(
    /^(REQ|ADR|ZOD|RISK|FIX|TEST|G|D|C|P|S)-[A-Za-z0-9_-]+$/,
    "must be '<NS>-<id>' with NS ∈ {REQ,ADR,ZOD,RISK,FIX,TEST,G,D,C,P,S}",
  );
