// AISEP protocol version constants.
//
// Bump rules:
// - PATCH (0.1.0 → 0.1.1): bug fix in schemas, no wire shape change
// - MINOR (0.1.x → 0.2.0): backward-compatible wire shape additions
// - MAJOR (0.x.x → 1.0.0): backward-incompatible wire shape change
//
// v0.x stabilization supersede (ADR-022 Decision 5):
// During pre-1.0, AISEP may take MAJOR-class wire changes with a MINOR
// version label (e.g. 0.3 → 0.4) provided:
//   1. A `aisep migrate --to X.Y` utility ships in the same release;
//   2. A cross-version round-trip dogfood gate validates BOTH directions
//      (v0.X state.json → v0.(X+1) binary → clear migrate error;
//       v0.(X+1) state.json → v0.X binary → schema validation error,
//       not silent drop).
// Post-1.0 reverts to ADR-006 §5 "breaking change 仅跨 major (v1.x → v2.0)".
//
// v0.4.0 — ADR-022 fan-in:
//   AisepStageRun.affects: string[] required for fanOutRole='child' rows;
//   FAN_OUT_ALLOWED_STAGES widened to {implement, verify, review}.
//   Migrate utility: `aisep migrate --to 0.4` fills `affects: [".*"]` +
//   `migratedFromV03: true` on existing v0.3 child rows.
//
// v0.2 followups (per Round-2 cross-review, deferred):
// - Add `deprecated` / `deprecatedSince` fields on schemas for staged
//   wire-format evolution.
// - Reevaluate zod 4 migration: JSON Schema export, metadata/registry,
//   performance/error-format improvements.

export const AISEP_PROTOCOL_VERSION = "0.4.0";
export const MIN_CLIENT_VERSION = "0.1.0";
