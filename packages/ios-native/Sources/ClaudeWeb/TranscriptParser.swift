// Convert jsonl-backed historical transcript entries into ChatLine[] for
// rendering. Independent of SDKMessage.parse because the historical format
// has a true user role with text content (the prompt) — SDKMessage.parse
// always maps user → toolResult, which would lose the prompt entirely.
//
// Render rules:
//   user + content[text]          → user ChatLine
//   user + content[tool_result]   → skipped (v1 doesn't render tool results)
//   assistant + content[text...]  → assistant ChatLine (text blocks joined)
//   assistant + content[tool_use] → system "🔧 <ToolName>" ChatLine
//   assistant + content[thinking] → skipped (internal reasoning, not user-facing)
//   result / system / unknown      → skipped

import Foundation

enum TranscriptParser {
    static func parse(_ entries: [TranscriptEntry]) -> [ChatLine] {
        var lines: [ChatLine] = []
        for entry in entries {
            // Skip subagent traces and CLI internal metadata.
            if entry.isSidechain == true || entry.isMeta == true { continue }
            lines.append(contentsOf: render(entry))
        }
        return lines
    }

    private static func render(_ entry: TranscriptEntry) -> [ChatLine] {
        guard let type = entry.type, let msg = entry.message else { return [] }
        switch type {
        case "user":
            return renderUser(msg)
        case "assistant":
            return renderAssistant(msg)
        default:
            return []
        }
    }

    private static func renderUser(_ msg: TranscriptMessage) -> [ChatLine] {
        guard let content = msg.content else { return [] }
        let raw: String
        switch content {
        case .string(let s):
            raw = s
        case .blocks(let blocks):
            // tool_result wrapped as user → don't render. Only render if the
            // user actually typed (text) blocks.
            let texts = blocks.compactMap { $0.type == "text" ? $0.text : nil }
            raw = texts.joined(separator: "\n")
        }
        let cleaned = TitleHelper.stripSystemInjectedTags(raw)
        return cleaned.isEmpty ? [] : [ChatLine(role: .user, text: cleaned)]
    }

    private static func renderAssistant(_ msg: TranscriptMessage) -> [ChatLine] {
        guard let content = msg.content else { return [] }
        switch content {
        case .string(let s):
            return s.isEmpty ? [] : [ChatLine(role: .assistant, text: s)]
        case .blocks(let blocks):
            var lines: [ChatLine] = []
            // Text first (if any).
            let texts = blocks.compactMap { $0.type == "text" ? $0.text : nil }
            let joined = texts.joined(separator: "")
            if !joined.isEmpty {
                lines.append(ChatLine(role: .assistant, text: joined))
            }
            // Each tool_use block as its own row. Card views decode
            // toolInputJSON; we capture id so the future "link to result"
            // feature has the data.
            for block in blocks where block.type == "tool_use" {
                let name = block.name ?? "?"
                lines.append(ChatLine(
                    role: .toolUse,
                    text: name,
                    toolName: name,
                    toolInputJSON: block.inputJSON,
                    toolUseId: block.id
                ))
            }
            return lines
        }
    }
}
