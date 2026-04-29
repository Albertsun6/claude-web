// Conversation domain types — pure data, no networking, no UI. Shared by
// BackendClient (writes), the Cache layer (Codable), TranscriptParser
// (writes), and SwiftUI views (read).

import Foundation

enum ConnState: Equatable {
    case disconnected
    case connecting
    case connected
    case error(String)
}

struct Conversation: Identifiable, Codable, Equatable {
    let id: String
    /// Working directory the CLI runs in. Stable for the conversation's
    /// lifetime — to point at a different cwd, create a new conversation.
    let cwd: String
    var sessionId: String?
    var title: String
    let createdAt: Date
    var lastUsed: Date
}

struct QueuedPrompt: Identifiable, Equatable {
    let id: String
    let text: String
    let model: String
    let permissionMode: String
    let attachments: [ImageAttachment]?

    init(text: String, model: String, permissionMode: String, attachments: [ImageAttachment]? = nil) {
        self.id = UUID().uuidString
        self.text = text
        self.model = model
        self.permissionMode = permissionMode
        self.attachments = attachments
    }

    static func == (lhs: QueuedPrompt, rhs: QueuedPrompt) -> Bool { lhs.id == rhs.id }
}

struct ConversationChatState: Equatable {
    var messages: [ChatLine] = []
    var pendingPermission: PermissionRequest? = nil
    var currentRunId: String? = nil
    var busy: Bool = false
    var pendingQueue: [QueuedPrompt] = []
}

struct ChatLine: Identifiable, Codable, Equatable {
    enum Role: String, Codable {
        case user, assistant, system, error
        /// A tool invocation by the assistant. `text` holds the tool name for
        /// fallback display; rich card rendering uses `toolName` + `toolInputJSON`.
        case toolUse
        /// A tool's result coming back from the CLI. v1 doesn't link it to its
        /// originating tool_use — independent card.
        case toolResult
    }
    let id: UUID
    let role: Role
    var text: String
    var runId: String?

    /// For `.toolUse` rows: tool name (Bash, Edit, Read, TodoWrite, ...).
    /// nil for non-tool rows.
    var toolName: String?
    /// For `.toolUse` rows: serialized JSON of the tool's input dict. Card
    /// views decode this into typed structs at render time. Optional because
    /// historical sessions loaded from jsonl may not have it preserved.
    var toolInputJSON: String?
    /// For `.toolUse` rows: the tool_use block id, used to match with a
    /// later tool_result if we ever want that. v1 doesn't use it.
    var toolUseId: String?
    /// For `.toolResult` rows: mirrors the CLI's is_error flag.
    var isError: Bool

    init(
        role: Role,
        text: String,
        runId: String? = nil,
        toolName: String? = nil,
        toolInputJSON: String? = nil,
        toolUseId: String? = nil,
        isError: Bool = false
    ) {
        self.id = UUID()
        self.role = role
        self.text = text
        self.runId = runId
        self.toolName = toolName
        self.toolInputJSON = toolInputJSON
        self.toolUseId = toolUseId
        self.isError = isError
    }

    /// What TTS should read aloud for this line. `nil` = skip (don't speak
    /// tool calls / system / error rows). Used by the TTS hook in App.
    var spokenText: String? {
        switch role {
        case .assistant: return text.isEmpty ? nil : text
        case .user, .system, .error, .toolUse, .toolResult: return nil
        }
    }
}

struct PermissionRequest: Identifiable, Equatable {
    var id: String { requestId }
    let runId: String
    let requestId: String
    let toolName: String
    let input: [String: Any]

    /// One-line preview rendered into the modal so the user can see what
    /// they're approving (file path for Edit, command for Bash, etc).
    var preview: String {
        switch toolName {
        case "Bash":
            return (input["command"] as? String) ?? ""
        case "Edit", "Write":
            return (input["file_path"] as? String) ?? (input["path"] as? String) ?? ""
        case "Read":
            return (input["file_path"] as? String) ?? ""
        default:
            // Fallback: pretty-print whole input
            if let data = try? JSONSerialization.data(withJSONObject: input, options: [.prettyPrinted]),
               let s = String(data: data, encoding: .utf8) {
                return s
            }
            return ""
        }
    }

    static func == (lhs: PermissionRequest, rhs: PermissionRequest) -> Bool {
        lhs.requestId == rhs.requestId
    }
}

enum PermissionDecision: String { case allow, deny }
