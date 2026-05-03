// Numeric version comparator (RFC §2.3 + ADR-0011 minimum 协议层行为契约).
//
// Phase 3 arch MAJOR-2b 修复：v2 dogfood arch M-D 同源——string lex 比较
// "1.10" < "1.9" 是错的。所有 protocolVersion / minClientVersion / clientVersion
// 比较必须用本工具，按数值字段比较。

/** Compare two semver-ish strings. Missing parts are treated as 0. */
export function compareVersion(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map((n) => {
    const x = parseInt(n, 10);
    return Number.isNaN(x) ? 0 : x;
  });
  const pb = b.split(".").map((n) => {
    const x = parseInt(n, 10);
    return Number.isNaN(x) ? 0 : x;
  });
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
