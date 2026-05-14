// v0.4 fan-in declared-overlap conflict detector (ADR-022 Q4).
//
// Pre-dispatch check: given N fan-out children with declared
// `affects: string[]` regex patterns, refuse fan-in dispatch if any
// child-pair shares a literal anchor (≥3-char substring between regex
// metachars where one anchor is a substring of the other). False
// positives are acceptable (forces user to disambiguate); false negatives
// are tolerated where the heuristic can't statically detect intersection
// (Q4 documents this as "regex-intersect heuristic" with known limits).
//
// R6 boundary: pure function. No fs / spawn / net.
//
// NOT based on actual modified files post-implement — `AisepPatchSetManifest`
// is unchanged in v2 (Q4: declared-only, on-disk scan explicitly NOT done).

/** Regex metachars used to split a pattern into literal anchor segments. */
const REGEX_METACHARS = /[.*+?(){}[\]\\|]/g;

/** Trim leading ^ and trailing $ from a regex string. */
function stripAnchors(regex: string): string {
  let r = regex;
  if (r.startsWith("^")) r = r.slice(1);
  if (r.endsWith("$") && !r.endsWith("\\$")) r = r.slice(0, -1);
  return r;
}

/**
 * Extract literal anchor segments from a regex string. An anchor is a
 * substring of length ≥ 3 between regex metachars (or at the start/end).
 * Forward-slashes are NOT metachars and stay inside anchors.
 *
 * Examples:
 *   "packages/backend/.*"           → ["packages/backend/"]
 *   ".*backend.*"                   → ["backend"]
 *   "src/(foo|bar)/baz\\.ts"        → ["src/", "/baz", "ts"]  (".\\t" is literal "t")
 *   ".*"                            → []  (no anchor of length ≥ 3)
 */
export function literalAnchors(regex: string): string[] {
  const r = stripAnchors(regex);
  return r
    .split(REGEX_METACHARS)
    .filter((segment) => segment.length >= 3);
}

export interface AffectsOverlap {
  /** Index into the input array. */
  i: number;
  /** Index into the input array (j > i). */
  j: number;
  /** The shared anchor that triggered the heuristic. */
  sharedAnchor: string;
}

/**
 * Check N declared `affects` regex arrays (one per fan-out child) for
 * pairwise overlap. Returns the first overlap detected (deterministic:
 * scan in input order (i, j) with i < j, and within each pair scan
 * anchors in order).
 *
 * The check is per-PATTERN, not per-CHILD-ARRAY: if any pattern in
 * child[i].affects shares an anchor with any pattern in child[j].affects,
 * the pair is flagged.
 *
 * Catch-all (`.*`, `(?:.*)`, etc.) inputs are explicitly rejected as
 * unsafe — plan validator (Slice 4) rejects these at parse time, but
 * this function also flags them here defensively. An empty literal-anchor
 * list (no ≥3-char anchor) on a non-anchor-empty pattern signals
 * "matches everything", which overlaps with everything.
 */
export function detectAffectsOverlap(
  childAffects: readonly (readonly string[])[],
): AffectsOverlap | null {
  for (let i = 0; i < childAffects.length; i += 1) {
    for (let j = i + 1; j < childAffects.length; j += 1) {
      const overlap = pairOverlap(childAffects[i] ?? [], childAffects[j] ?? []);
      if (overlap) {
        return { i, j, sharedAnchor: overlap };
      }
    }
  }
  return null;
}

function pairOverlap(
  affectsA: readonly string[],
  affectsB: readonly string[],
): string | null {
  for (const a of affectsA) {
    const anchorsA = literalAnchors(a);
    const catchAllA = anchorsA.length === 0;
    for (const b of affectsB) {
      const anchorsB = literalAnchors(b);
      const catchAllB = anchorsB.length === 0;
      // Catch-all on either side overlaps with anything.
      if (catchAllA || catchAllB) {
        return catchAllA ? a : b;
      }
      for (const x of anchorsA) {
        for (const y of anchorsB) {
          if (x.includes(y)) return y;
          if (y.includes(x)) return x;
        }
      }
    }
  }
  return null;
}

/**
 * Throwing wrapper: `assertNoAffectsOverlap` is what `runner.runFanOutParent`
 * calls just before dispatching children. Throws with an actionable
 * message naming the offending child indices + the shared anchor.
 */
export function assertNoAffectsOverlap(
  childAffects: readonly (readonly string[])[],
): void {
  const overlap = detectAffectsOverlap(childAffects);
  if (overlap) {
    throw new AffectsOverlapError(overlap);
  }
}

export class AffectsOverlapError extends Error {
  constructor(public readonly overlap: AffectsOverlap) {
    super(
      `declared affects overlap between fan-out children ${overlap.i} and ${overlap.j} (shared anchor: "${overlap.sharedAnchor}"); refine the patterns or reduce parallelism`,
    );
    this.name = "AffectsOverlapError";
  }
}
