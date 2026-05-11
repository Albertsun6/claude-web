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

/** trace_id namespace: REQ / ADR / ZOD / RISK / G(oal) / D(river) / C(onstraint) / P(rinciple) / S(takeholder) */
export const TraceIdSchema = z
  .string()
  .regex(
    /^(REQ|ADR|ZOD|RISK|G|D|C|P|S)-[A-Za-z0-9_-]+$/,
    "must be '<NS>-<id>' with NS ∈ {REQ,ADR,ZOD,RISK,G,D,C,P,S}",
  );
