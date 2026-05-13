// AISEP protocol version constants.
//
// Bump rules:
// - PATCH (0.1.0 → 0.1.1): bug fix in schemas, no wire shape change
// - MINOR (0.1.x → 0.2.0): backward-compatible wire shape additions
// - MAJOR (0.x.x → 1.0.0): backward-incompatible wire shape change
//
// v0.2 followups (per Round-2 cross-review):
// - Add `deprecated` / `deprecatedSince` fields on schemas for staged
//   wire-format evolution.
// - Reevaluate zod 4 migration: JSON Schema export, metadata/registry,
//   performance/error-format improvements.

export const AISEP_PROTOCOL_VERSION = "0.3.0";
export const MIN_CLIENT_VERSION = "0.1.0";
