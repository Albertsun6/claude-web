// Mirrors packages/shared/src/protocol.ts. Keep in sync when adding fields.
//
// Decoding strategy: every server message has a `type` discriminator. We decode
// to a tagged enum so call sites pattern-match on cases. For sdk_message we
// keep the `message` payload as raw JSON (Data) and only parse the shapes we
// actually render (assistant text, system:init, result with usage, error).

import Foundation

// MARK: - Shared types

/// Mirrors ImageAttachment in packages/shared/src/protocol.ts.
struct ImageAttachment: Encodable {
    /// MIME type, e.g. "image/png", "image/jpeg"
    let mediaType: String
    /// Raw base64 data — no "data:" prefix
    let dataBase64: String
}

// MARK: - Client → Server

enum ClientMessage: Encodable {
    case userPrompt(runId: String, prompt: String, cwd: String, model: String, permissionMode: String, resumeSessionId: String?, attachments: [ImageAttachment]?)
    case interrupt(runId: String?)
    case permissionReply(requestId: String, decision: String, runId: String?, toolName: String?)
    case sessionSubscribe(cwd: String, sessionId: String, fromByteOffset: Int?)
    case sessionUnsubscribe(cwd: String, sessionId: String)

    enum CodingKeys: String, CodingKey {
        case type, runId, prompt, cwd, model, permissionMode, resumeSessionId, attachments,
             requestId, decision, toolName, sessionId, fromByteOffset
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .userPrompt(let runId, let prompt, let cwd, let model, let permissionMode, let resumeSessionId, let attachments):
            try c.encode("user_prompt", forKey: .type)
            try c.encode(runId, forKey: .runId)
            try c.encode(prompt, forKey: .prompt)
            try c.encode(cwd, forKey: .cwd)
            try c.encode(model, forKey: .model)
            try c.encode(permissionMode, forKey: .permissionMode)
            try c.encodeIfPresent(resumeSessionId, forKey: .resumeSessionId)
            try c.encodeIfPresent(attachments, forKey: .attachments)
        case .interrupt(let runId):
            try c.encode("interrupt", forKey: .type)
            try c.encodeIfPresent(runId, forKey: .runId)
        case .permissionReply(let requestId, let decision, let runId, let toolName):
            try c.encode("permission_reply", forKey: .type)
            try c.encode(requestId, forKey: .requestId)
            try c.encode(decision, forKey: .decision)
            try c.encodeIfPresent(runId, forKey: .runId)
            try c.encodeIfPresent(toolName, forKey: .toolName)
        case .sessionSubscribe(let cwd, let sessionId, let fromByteOffset):
            try c.encode("session_subscribe", forKey: .type)
            try c.encode(cwd, forKey: .cwd)
            try c.encode(sessionId, forKey: .sessionId)
            try c.encodeIfPresent(fromByteOffset, forKey: .fromByteOffset)
        case .sessionUnsubscribe(let cwd, let sessionId):
            try c.encode("session_unsubscribe", forKey: .type)
            try c.encode(cwd, forKey: .cwd)
            try c.encode(sessionId, forKey: .sessionId)
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
    /// One incremental jsonl entry from a `session_subscribe`d session.
    /// `entryJSON` is the raw JSON of one normalized entry; consumer
    /// decodes it as `TranscriptEntry` and reuses TranscriptParser.
    case sessionEvent(cwd: String, sessionId: String, byteOffset: Int, entryJSON: Data)
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
        case .sessionEvent, .unknown:
            // session_event isn't tied to a runId — routed via (cwd, sessionId).
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
        case .sessionEvent: return "session_event"
        case .unknown(let t): return "unknown:\(t)"
        }
    }

    static func decode(_ data: Data) throws -> [ServerMessage] {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "missing type"))
        }
        switch type {
        case "sdk_message":
            let runId = (json["runId"] as? String) ?? ""
            let messageDict = json["message"] as? [String: Any] ?? [:]
            // parse returns array of messages (may include thinking + assistantContent)
            let messages = SDKMessage.parse(messageDict)
            return messages.map { .sdkMessage(runId: runId, raw: $0) }
        case "session_ended":
            let runId = (json["runId"] as? String) ?? ""
            let reason = (json["reason"] as? String) ?? "completed"
            return [.sessionEnded(runId: runId, reason: reason)]
        case "error":
            return [.error(runId: json["runId"] as? String, message: (json["error"] as? String) ?? "unknown")]
        case "clear_run_messages":
            return [.clearRunMessages(runId: (json["runId"] as? String) ?? "")]
        case "permission_request":
            return [.permissionRequest(
                runId: (json["runId"] as? String) ?? "",
                requestId: (json["requestId"] as? String) ?? "",
                toolName: (json["toolName"] as? String) ?? "?",
                input: (json["input"] as? [String: Any]) ?? [:]
            )]
        case "session_event":
            // Re-serialize the entry dict back to JSON Data so the consumer
            // can hand it straight to JSONDecoder<TranscriptEntry>.
            let entry = json["entry"] ?? [:]
            let entryJSON = (try? JSONSerialization.data(withJSONObject: entry, options: []))
                ?? Data("{}".utf8)
            return [.sessionEvent(
                cwd: (json["cwd"] as? String) ?? "",
                sessionId: (json["sessionId"] as? String) ?? "",
                byteOffset: (json["byteOffset"] as? Int) ?? 0,
                entryJSON: entryJSON
            )]
        default:
            return [.unknown(type: type)]
        }
    }
}

/// Subset of stream-json SDK messages we actually render.
enum SDKMessage {
    case systemInit(sessionId: String?, model: String?)
    /// One assistant message with any combination of text + tool_use blocks.
    /// `text` is the joined text content (nil if none); `toolUses` is each
    /// individual tool_use block in the order they appeared.
    /// BackendClient emits one ChatLine per piece (assistant text, tool_use row per tool call).
    case assistantContent(text: String?, toolUses: [ToolUseInfo])
    /// Extended thinking block from the assistant.
    case thinking(text: String)
    /// A user-wrapped tool_result block. `content` is the text output;
    /// `isError` mirrors the CLI's is_error flag.
    case toolResult(content: String, isError: Bool)
    /// Turn finished, with optional cost telemetry.
    case result(usd: Double?)
    case other

    static func parse(_ dict: [String: Any]) -> [SDKMessage] {
        let type = dict["type"] as? String ?? ""
        let subtype = dict["subtype"] as? String ?? ""
        var messages: [SDKMessage] = []

        switch (type, subtype) {
        case ("system", "init"):
            messages.append(.systemInit(
                sessionId: dict["session_id"] as? String,
                model: dict["model"] as? String
            ))
        case ("assistant", _):
            // Walk content blocks. Extract thinking blocks separately,
            // join text blocks, and capture each tool_use independently.
            if let message = dict["message"] as? [String: Any],
               let content = message["content"] as? [[String: Any]] {
                var texts: [String] = []
                var tools: [ToolUseInfo] = []
                var thinking: String?

                for block in content {
                    let blockType = block["type"] as? String ?? ""
                    switch blockType {
                    case "text":
                        if let s = block["text"] as? String { texts.append(s) }
                    case "thinking":
                        if let s = block["thinking"] as? String {
                            thinking = s
                        }
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
                        // redacted_thinking, other unknown blocks — drop silently
                        break
                    }
                }

                // Add thinking block if present
                if let thinkingText = thinking {
                    messages.append(.thinking(text: thinkingText))
                }

                // Add assistant content (text + tools) if present
                let joined = texts.joined()
                if !joined.isEmpty || !tools.isEmpty {
                    messages.append(.assistantContent(
                        text: joined.isEmpty ? nil : joined,
                        toolUses: tools
                    ))
                }
            }

            // If no messages were added, return other
            if messages.isEmpty {
                messages.append(.other)
            }
        case ("user", _):
            // tool_result blocks come back wrapped as user messages.
            // Extract the first tool_result block's content and error flag.
            if let message = dict["message"] as? [String: Any],
               let contentArr = message["content"] as? [[String: Any]] {
                for block in contentArr where block["type"] as? String == "tool_result" {
                    let isError = block["is_error"] as? Bool ?? false
                    var text = ""
                    if let s = block["content"] as? String {
                        text = s
                    } else if let arr = block["content"] as? [[String: Any]] {
                        text = arr.compactMap { $0["text"] as? String }.joined(separator: "\n")
                    }
                    messages.append(.toolResult(content: text, isError: isError))
                }
            }
            if messages.isEmpty {
                messages.append(.toolResult(content: "", isError: false))
            }
        case ("result", _):
            messages.append(.result(usd: dict["total_cost_usd"] as? Double))
        default:
            messages.append(.other)
        }

        return messages
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
