// Thin HTTP client for /api/inbox endpoints.
// Mirrors backend's InboxItem shape so encode/decode round-trips cleanly.

import Foundation

struct InboxItem: Codable, Identifiable, Equatable {
    let id: String
    let body: String
    let source: String
    let capturedAt: Int64
    let processedIntoConversationId: String?

    enum CodingKeys: String, CodingKey {
        case id, body, source, capturedAt, processedIntoConversationId
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

    /// Submit a new 碎想. Returns immediately on success.
    func capture(body: String, source: String = "ios") async throws -> InboxItem {
        let url = baseURL().appendingPathComponent("api/inbox")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload = ["body": body, "source": source]
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

    func list(unprocessedOnly: Bool = false, limit: Int = 50) async throws -> InboxListResponse {
        var comps = URLComponents(url: baseURL().appendingPathComponent("api/inbox/list"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "unprocessed", value: unprocessedOnly ? "1" : "0"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
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
