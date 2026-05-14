// Line-level unified diff view for Edit tool calls.
//
// Replaces the old "two stacked blocks" rendering (red old + green new) with a
// proper LCS-aligned diff where unchanged lines appear once (gray, prefix " ")
// and only changed lines are colored (red "−" / green "+"). This is the same
// model GitHub / git diff uses.
//
// Pure Swift, no dependency on Splash / Highlightr / WKWebView. Syntax
// highlighting is intentionally omitted in V1 — the value of a diff view is
// "see the change", not "see the colors".

import SwiftUI

struct UnifiedDiffView: View {
    let old: String
    let new: String

    var body: some View {
        let lines = computeDiff(old: old, new: new)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(lines) { line in
                row(for: line)
            }
        }
        .background(Color(.systemGray6), in: .rect(cornerRadius: 4))
    }

    private func row(for line: DiffLine) -> some View {
        HStack(alignment: .top, spacing: 4) {
            Text(prefixGlyph(for: line.op))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(prefixColor(for: line.op))
                .frame(width: 10, alignment: .center)
            Text(line.text.isEmpty ? " " : line.text)
                .font(.system(.caption2, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 1)
        .background(rowBackground(for: line.op))
    }

    private func prefixGlyph(for op: DiffOp) -> String {
        switch op {
        case .equal: return " "
        case .delete: return "−"
        case .insert: return "+"
        }
    }

    private func prefixColor(for op: DiffOp) -> Color {
        switch op {
        case .equal: return .secondary
        case .delete: return .red
        case .insert: return .green
        }
    }

    private func rowBackground(for op: DiffOp) -> Color {
        switch op {
        case .equal: return .clear
        case .delete: return .red.opacity(0.12)
        case .insert: return .green.opacity(0.12)
        }
    }
}

private enum DiffOp { case equal, delete, insert }

private struct DiffLine: Identifiable {
    let id = UUID()
    let op: DiffOp
    let text: String
}

// Standard LCS line diff. O(m*n) time + memory; fine for Edit tool calls
// where old/new strings are bounded by Claude's typical edit size (<a few
// hundred lines each). If you ever hit a huge edit, the cost is bounded by
// `m*n` 32-bit Ints, which stays in MBs not GBs.
private func computeDiff(old: String, new: String) -> [DiffLine] {
    let a = old.components(separatedBy: "\n")
    let b = new.components(separatedBy: "\n")
    let m = a.count, n = b.count

    if m == 0 || (m == 1 && a[0].isEmpty) {
        return b.map { DiffLine(op: .insert, text: $0) }
    }
    if n == 0 || (n == 1 && b[0].isEmpty) {
        return a.map { DiffLine(op: .delete, text: $0) }
    }

    var dp = Array(repeating: Array(repeating: 0, count: n + 1), count: m + 1)
    for i in 1...m {
        for j in 1...n {
            if a[i - 1] == b[j - 1] {
                dp[i][j] = dp[i - 1][j - 1] + 1
            } else {
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
            }
        }
    }

    var result: [DiffLine] = []
    var i = m, j = n
    while i > 0 && j > 0 {
        if a[i - 1] == b[j - 1] {
            result.append(DiffLine(op: .equal, text: a[i - 1]))
            i -= 1; j -= 1
        } else if dp[i - 1][j] > dp[i][j - 1] {
            result.append(DiffLine(op: .delete, text: a[i - 1]))
            i -= 1
        } else {
            // Tie goes to insert during backtrack, which (after reverse) puts
            // − lines before + lines within a hunk — the standard git/unified
            // diff convention.
            result.append(DiffLine(op: .insert, text: b[j - 1]))
            j -= 1
        }
    }
    while i > 0 { result.append(DiffLine(op: .delete, text: a[i - 1])); i -= 1 }
    while j > 0 { result.append(DiffLine(op: .insert, text: b[j - 1])); j -= 1 }

    return result.reversed()
}
