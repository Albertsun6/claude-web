// AISEP protocol version constants.
//
// Bump rules:
// - PATCH (0.1.0 → 0.1.1): bug fix in schemas, no wire shape change
// - MINOR (0.1.x → 0.2.0): backward-compatible wire shape additions
// - MAJOR (0.x.x → 1.0.0): backward-incompatible wire shape change

export const AISEP_PROTOCOL_VERSION = "0.1.0";
export const MIN_CLIENT_VERSION = "0.1.0";
