// Mirrors packages/shared/src/protocol.ts. Keep in sync when adding fields.
//
// Decoding strategy: every server message has a `type` discriminator. We decode
// to a tagged enum so call sites pattern-match on cases. For sdk_message we
// keep the `message` payload as raw JSON (Data) and only parse the shapes we
// actually render (assistant text, system:init, result with usage, error).

import Foundation

// MARK: - Client → Server

enum ClientMessage: Encodable {
    case userPrompt(runId: String, prompt: String, cwd: String, model: String, permissionMode: String, resumeSessionId: String?)
    case interrupt(runId: String?)
    case permissionReply(requestId: String, decision: String, runId: String?)

    enum CodingKeys: String, CodingKey {
        case type, runId, prompt, cwd, model, permissionMode, resumeSessionId, requestId, decision
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .userPrompt(let runId, let prompt, let cwd, let model, let permissionMode, let resumeSessionId):
            try c.encode("user_prompt", forKey: .type)
            try c.encode(runId, forKey: .runId)
            try c.encode(prompt, forKey: .prompt)
            try c.encode(cwd, forKey: .cwd)
            try c.encode(model, forKey: .model)
            try c.encode(permissionMode, forKey: .permissionMode)
            try c.encodeIfPresent(resumeSessionId, forKey: .resumeSessionId)
        case .interrupt(let runId):
            try c.encode("interrupt", forKey: .type)
            try c.encodeIfPresent(runId, forKey: .runId)
        case .permissionReply(let requestId, let decision, let runId):
            try c.encode("permission_reply", forKey: .type)
            try c.encode(requestId, forKey: .requestId)
            try c.encode(decision, forKey: .decision)
            try c.encodeIfPresent(runId, forKey: .runId)
        }
    }
}

// MARK: - Server → Client

enum ServerMessage {
    case sdkMessage(runId: String, raw: SDKMessage)
    case sessionEnded(runId: String, reason: String)
    case error(runId: String?, message: String)
    case clearRunMessages(runId: String)
    case permissionRequest(runId: String, requestId: String, toolName: String, input: [String: Any])
    case unknown(type: String)

    /// Used by BackendClient to route a message to the conversation that
    /// originated the run. `unknown` and global `error` (without runId) → nil
    /// → the message gets dropped (no conversation to attribute it to).
    var runId: String? {
        switch self {
        case .sdkMessage(let r, _),
             .sessionEnded(let r, _),
             .clearRunMessages(let r):
            return r
        case .permissionRequest(let r, _, _, _):
            return r
        case .error(let r, _):
            return r
        case .unknown:
            return nil
        }
    }

    /// Stable string name for telemetry / debug logs.
    var typeName: String {
        switch self {
        case .sdkMessage: return "sdk_message"
        case .sessionEnded: return "session_ended"
        case .error: return "error"
        case .clearRunMessages: return "clear_run_messages"
        case .permissionRequest: return "permission_request"
        case .unknown(let t): return "unknown:\(t)"
        }
    }

    static func decode(_ data: Data) throws -> ServerMessage {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "missing type"))
        }
        switch type {
        case "sdk_message":
            let runId = (json["runId"] as? String) ?? ""
            let messageDict = json["message"] as? [String: Any] ?? [:]
            return .sdkMessage(runId: runId, raw: SDKMessage.parse(messageDict))
        case "session_ended":
            let runId = (json["runId"] as? String) ?? ""
            let reason = (json["reason"] as? String) ?? "completed"
            return .sessionEnded(runId: runId, reason: reason)
        case "error":
            return .error(runId: json["runId"] as? String, message: (json["error"] as? String) ?? "unknown")
        case "clear_run_messages":
            return .clearRunMessages(runId: (json["runId"] as? String) ?? "")
        case "permission_request":
            return .permissionRequest(
                runId: (json["runId"] as? String) ?? "",
                requestId: (json["requestId"] as? String) ?? "",
                toolName: (json["toolName"] as? String) ?? "?",
                input: (json["input"] as? [String: Any]) ?? [:]
            )
        default:
            return .unknown(type: type)
        }
    }
}

/// Subset of stream-json SDK messages we actually render.
enum SDKMessage {
    case systemInit(sessionId: String?, model: String?)
    /// One assistant message with any combination of text + tool_use blocks.
    /// `text` is the joined text content (nil if none); `toolUses` is each
    /// individual tool_use block in the order they appeared. Thinking blocks
    /// are filtered at parse time. BackendClient emits one ChatLine per
    /// piece (assistant text, then a tool_use row per tool call).
    case assistantContent(text: String?, toolUses: [ToolUseInfo])
    /// A user-wrapped tool_result block. v1 doesn't link it back to its
    /// tool_use; the row just shows "✓ tool result" placeholder.
    case toolResult
    /// Turn finished, with optional cost telemetry.
    case result(usd: Double?)
    case other

    static func parse(_ dict: [String: Any]) -> SDKMessage {
        let type = dict["type"] as? String ?? ""
        let subtype = dict["subtype"] as? String ?? ""
        switch (type, subtype) {
        case ("system", "init"):
            return .systemInit(
                sessionId: dict["session_id"] as? String,
                model: dict["model"] as? String
            )
        case ("assistant", _):
            // Walk content blocks. Join text blocks; capture each tool_use
            // independently. Thinking blocks are silently ignored.
            if let message = dict["message"] as? [String: Any],
               let content = message["content"] as? [[String: Any]] {
                var texts: [String] = []
                var tools: [ToolUseInfo] = []
                for block in content {
                    let blockType = block["type"] as? String ?? ""
                    switch blockType {
                    case "text":
                        if let s = block["text"] as? String { texts.append(s) }
                    case "tool_use":
                        let name = block["name"] as? String ?? "?"
                        let id = block["id"] as? String
                        let input = block["input"] as? [String: Any] ?? [:]
                        let inputJSON: String
                        if let data = try? JSONSerialization.data(withJSONObject: input, options: [.sortedKeys, .prettyPrinted]),
                           let s = String(data: data, encoding: .utf8) {
                            inputJSON = s
                        } else {
                            inputJSON = "{}"
                        }
                        tools.append(ToolUseInfo(id: id, name: name, inputJSON: inputJSON))
                    default:
                        // thinking, redacted_thinking, etc — drop silently
                        break
                    }
                }
                let joined = texts.joined()
                if !joined.isEmpty || !tools.isEmpty {
                    return .assistantContent(
                        text: joined.isEmpty ? nil : joined,
                        toolUses: tools
                    )
                }
            }
            return .other
        case ("user", _):
            // tool_result blocks come back wrapped as user messages — we just acknowledge
            return .toolResult
        case ("result", _):
            return .result(usd: dict["total_cost_usd"] as? Double)
        default:
            return .other
        }
    }
}

/// One tool_use block extracted from an assistant message. Carries the data
/// each tool card view needs to decode — name picks the card type, inputJSON
/// is the raw blob the card decodes to typed fields.
struct ToolUseInfo: Equatable {
    let id: String?
    let name: String
    let inputJSON: String
}
