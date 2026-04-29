// Build a short, human-readable conversation title from the first user
// prompt. Shared by:
//   - ConversationStore.startTurn  (live runs: rename auto-titled convs
//                                   after the first prompt is sent)
//   - ProjectRegistry.openHistoricalSession  (jsonl loads: title from
//                                            session.preview)
//   - TranscriptParser            (also strips the same system-injected
//                                   tags from rendered user bubbles)
//
// "Cleaning" means: drop the XML-style metadata blocks Claude Code / claude
// CLI hooks splice into the prompt before sending it to the model
// (<task-notification>, <system-reminder>, <command-name>, etc). Without
// stripping, titles end up showing opaque tag soup instead of the actual
// user question.

import Foundation

enum TitleHelper {
    /// Conversation titles cap at this many chars. Chip in the toolbar
    /// truncates further on small screens, but storing a tight string keeps
    /// the cache + drawer compact.
    static let maxTitleLength = 24

    /// Tag elements injected by hooks that should NEVER show up in titles
    /// or rendered user messages. Keep this list in sync with whatever
    /// hooks the user has wired into ~/.claude/settings.json.
    static let systemInjectedTags: [String] = [
        "task-notification",
        "system-reminder",
        "user-prompt-submit-hook",
        "command-name",
        "command-message",
        "command-args",
        "local-command-stdout",
        "local-command-stderr",
        "local-command-caveat",
        "ide_selection",
    ]

    /// Drop entire `<tag>…</tag>` blocks for any tag in `systemInjectedTags`.
    /// Returns the trimmed remainder.
    static func stripSystemInjectedTags(_ text: String) -> String {
        var result = text
        for tag in systemInjectedTags {
            let pattern = "<\(tag)\\b[^>]*>[\\s\\S]*?</\(tag)>"
            if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
                let range = NSRange(result.startIndex..., in: result)
                result = regex.stringByReplacingMatches(
                    in: result, options: [], range: range, withTemplate: ""
                )
            }
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Build a single-line, length-capped title from a free-form user
    /// prompt. Returns "" if nothing meaningful is left after stripping.
    static func makeTitle(from prompt: String) -> String {
        let stripped = stripSystemInjectedTags(prompt)
        guard !stripped.isEmpty else { return "" }
        // Take the first non-empty line — multi-line prompts shouldn't
        // bury the gist below blank lines.
        let firstLine: String = stripped
            .split(separator: "\n", omittingEmptySubsequences: true)
            .first
            .map { String($0).trimmingCharacters(in: .whitespaces) }
            ?? stripped
        if firstLine.count <= maxTitleLength { return firstLine }
        return String(firstLine.prefix(maxTitleLength)) + "…"
    }
}
