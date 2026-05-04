// Thin HTTP client for /api/inbox endpoints.
// Mirrors backend's InboxItem shape so encode/decode round-trips cleanly.

import Foundation

struct InboxTriage: Codable, Equatable {
    let destination: String  // "ideas" | "archive"
    let note: String?
    let triagedAt: Int64
}

struct InboxItem: Codable, Identifiable, Equatable {
    let id: String
    let body: String
    let source: String
    let capturedAt: Int64
    let cwd: String?
    let processedIntoConversationId: String?
    let status: String?  // "open" | "archived"; nil on legacy records → treat as "open"
    let triage: InboxTriage?

    enum CodingKeys: String, CodingKey {
        case id, body, source, capturedAt, cwd, processedIntoConversationId, status, triage
    }
}

struct InboxStats: Codable, Equatable {
    let total: Int
    let unprocessed: Int
}

struct InboxListResponse: Codable {
    let items: [InboxItem]
    let stats: InboxStats
}

@Observable
final class InboxAPI {
    private let baseURL: () -> URL

    init(baseURL: @escaping () -> URL) {
        self.baseURL = baseURL
    }

    /// Submit a new Idea. Returns immediately on success.
    func capture(body: String, source: String = "ios", cwd: String? = nil) async throws -> InboxItem {
        let url = baseURL().appendingPathComponent("api/inbox")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: String] = ["body": body, "source": source]
        if let cwd { payload["cwd"] = cwd }
        req.httpBody = try JSONEncoder().encode(payload)
        req.timeoutInterval = 6
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw NSError(domain: "InboxAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "no response"])
        }
        if http.statusCode != 201 {
            throw NSError(
                domain: "InboxAPI",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode)"],
            )
        }
        struct Wrap: Codable { let item: InboxItem }
        return try JSONDecoder().decode(Wrap.self, from: data).item
    }

    func list(
        unprocessedOnly: Bool = false,
        includeArchived: Bool = false,
        limit: Int = 50,
        cwd: String? = nil,
    ) async throws -> InboxListResponse {
        var comps = URLComponents(url: baseURL().appendingPathComponent("api/inbox/list"), resolvingAgainstBaseURL: false)!
        var queryItems = [
            URLQueryItem(name: "unprocessed", value: unprocessedOnly ? "1" : "0"),
            URLQueryItem(name: "includeArchived", value: includeArchived ? "1" : "0"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let cwd { queryItems.append(URLQueryItem(name: "cwd", value: cwd)) }
        comps.queryItems = queryItems
        var req = URLRequest(url: comps.url!)
        req.timeoutInterval = 6
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(InboxListResponse.self, from: data)
    }

    func markProcessed(id: String, conversationId: String) async throws -> InboxItem {
        let url = baseURL().appendingPathComponent("api/inbox/\(id)/processed")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["conversationId": conversationId])
        req.timeoutInterval = 6
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Wrap: Codable { let item: InboxItem }
        return try JSONDecoder().decode(Wrap.self, from: data).item
    }

    /// Triage an inbox item.
    /// destination=archive → backend flips status to "archived" (item hidden from default list)
    /// destination=ideas   → backend writes triage label only; caller copies body to clipboard
    ///                       so user can manually paste into docs/IDEAS.md or HARNESS_ROADMAP §17.
    ///                       Backend never writes those docs (§16.3 #1).
    func triage(id: String, destination: String, note: String? = nil) async throws -> InboxItem {
        let url = baseURL().appendingPathComponent("api/inbox/\(id)/triage")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: String] = ["destination": destination]
        if let note { payload["note"] = note }
        req.httpBody = try JSONEncoder().encode(payload)
        req.timeoutInterval = 6
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(
                domain: "InboxAPI",
                code: code,
                userInfo: [NSLocalizedDescriptionKey: "triage failed HTTP \(code)"],
            )
        }
        struct Wrap: Codable { let item: InboxItem }
        return try JSONDecoder().decode(Wrap.self, from: data).item
    }
}

/// Force-interrupt an active run via HTTP. Used by the emergency-intervention UI
/// (long-press on conversation chip → confirm).
func interruptRun(baseURL: URL, runId: String) async throws {
    let url = baseURL.appendingPathComponent("api/runs/\(runId)/interrupt")
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 6
    let (_, resp) = try await URLSession.shared.data(for: req)
    guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
        let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
        throw NSError(
            domain: "InterruptRun",
            code: code,
            userInfo: [NSLocalizedDescriptionKey: "interrupt failed HTTP \(code)"],
        )
    }
}
