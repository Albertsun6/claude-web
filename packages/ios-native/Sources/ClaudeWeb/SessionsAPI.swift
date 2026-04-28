// HTTP client for /api/sessions/* — wraps the existing backend endpoints
// reading historical jsonl from ~/.claude/projects/<encoded-cwd>/. Used by
// the conversation switcher to show "load past session" entries per project.

import Foundation

struct SessionMeta: Identifiable, Decodable, Equatable {
    let sessionId: String
    let preview: String
    let mtime: Double
    let size: Int
    var id: String { sessionId }
    var modifiedAt: Date { Date(timeIntervalSince1970: mtime / 1000) }
}

struct SessionsListResponse: Decodable {
    let sessions: [SessionMeta]
}

/// One raw entry from the jsonl transcript. The fields we actually parse are
/// the type and message.content blocks; the rest are kept loosely (extra
/// metadata like parentUuid we don't need yet).
struct TranscriptEntry: Decodable {
    let type: String?
    let message: TranscriptMessage?
    let isSidechain: Bool?
    let isMeta: Bool?
}

struct TranscriptMessage: Decodable {
    let role: String?
    let content: TranscriptContent?
}

/// content can be either a string OR an array of blocks. The backend's
/// normalizeJsonlEntry coerces strings into [{type:text}] blocks, so iOS
/// only ever sees array form, but we tolerate both for safety.
enum TranscriptContent: Decodable {
    case string(String)
    case blocks([TranscriptBlock])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            self = .string(s); return
        }
        if let blocks = try? c.decode([TranscriptBlock].self) {
            self = .blocks(blocks); return
        }
        self = .blocks([])
    }
}

struct TranscriptBlock: Decodable {
    let type: String
    let text: String?
    let name: String?      // for tool_use
    let id: String?        // for tool_use
    /// For tool_use: the input dict serialized as a JSON string. We pass it
    /// through verbatim because re-decoding a heterogeneous dict in Swift
    /// requires AnyCodable shenanigans; card views parse it themselves.
    let inputJSON: String?

    enum CodingKeys: String, CodingKey {
        case type, text, name, id, input
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.type = try c.decode(String.self, forKey: .type)
        self.text = try c.decodeIfPresent(String.self, forKey: .text)
        self.name = try c.decodeIfPresent(String.self, forKey: .name)
        self.id = try c.decodeIfPresent(String.self, forKey: .id)
        // Re-encode whatever shape `input` has into a JSON string. tool_use
        // input is always an object in practice; if the field is missing or
        // null we leave inputJSON nil.
        if c.contains(.input) {
            let any = try? c.decode(JSONValue.self, forKey: .input)
            if let val = any,
               let data = try? JSONEncoder().encode(val),
               let s = String(data: data, encoding: .utf8) {
                self.inputJSON = s
            } else {
                self.inputJSON = nil
            }
        } else {
            self.inputJSON = nil
        }
    }
}

/// Tiny tagged-union to losslessly round-trip arbitrary JSON values through
/// Swift's Codable. Used to capture `tool_use.input` blobs from jsonl
/// without forcing a typed schema per tool.
enum JSONValue: Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? c.decode(Double.self) {
            self = .number(n)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else if let a = try? c.decode([JSONValue].self) {
            self = .array(a)
        } else if let o = try? c.decode([String: JSONValue].self) {
            self = .object(o)
        } else {
            throw DecodingError.dataCorrupted(.init(codingPath: c.codingPath, debugDescription: "unknown JSON value"))
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

struct SessionTranscriptResponse: Decodable {
    let sessionId: String
    let messages: [TranscriptEntry]
}

@MainActor
final class SessionsAPI {
    private let backend: () -> URL
    private let token: () -> String

    init(backend: @escaping () -> URL, token: @escaping () -> String = { "" }) {
        self.backend = backend
        self.token = token
    }

    func list(cwd: String) async throws -> [SessionMeta] {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = "/api/sessions/list"
        components.queryItems = [URLQueryItem(name: "cwd", value: cwd)]
        let req = authed(URLRequest(url: components.url!))
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(SessionsListResponse.self, from: data).sessions
    }

    func transcript(cwd: String, sessionId: String) async throws -> SessionTranscriptResponse {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = "/api/sessions/transcript"
        components.queryItems = [
            URLQueryItem(name: "cwd", value: cwd),
            URLQueryItem(name: "sessionId", value: sessionId),
        ]
        let req = authed(URLRequest(url: components.url!))
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(SessionTranscriptResponse.self, from: data)
    }

    private func authed(_ req: URLRequest) -> URLRequest {
        var r = req
        let t = token()
        if !t.isEmpty {
            r.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        }
        return r
    }

    private func ensureOK(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw SessionsError.badResponse }
        if !(200..<300).contains(http.statusCode) {
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = json["error"] as? String {
                throw SessionsError.backend(http.statusCode, msg)
            }
            throw SessionsError.backend(http.statusCode, "HTTP \(http.statusCode)")
        }
    }
}

enum SessionsError: LocalizedError {
    case badResponse
    case backend(Int, String)
    var errorDescription: String? {
        switch self {
        case .badResponse: return "响应错误"
        case .backend(_, let msg): return msg
        }
    }
}
