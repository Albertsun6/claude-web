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
    case assistantText(String)
    case toolUse(name: String)             // M1 just shows "[tool: Bash]" placeholder
    case toolResult                         // ditto
    case result(usd: Double?)               // turn finished, usage info
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
            // assistant.message.content[].type == "text" | "tool_use" → flatten to text
            if let message = dict["message"] as? [String: Any],
               let content = message["content"] as? [[String: Any]] {
                let texts = content.compactMap { block -> String? in
                    if (block["type"] as? String) == "text" {
                        return block["text"] as? String
                    }
                    return nil
                }.joined()
                if !texts.isEmpty { return .assistantText(texts) }
                if let firstTool = content.first(where: { ($0["type"] as? String) == "tool_use" }),
                   let name = firstTool["name"] as? String {
                    return .toolUse(name: name)
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
