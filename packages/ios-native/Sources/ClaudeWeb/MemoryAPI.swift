// HTTP client for /api/vessel/memory/* (M1C-B+ HTTP API).
//
// Endpoints (mirrors packages/backend/src/routes/vessel-memory.ts):
//   POST   /api/vessel/memory          → addMemory
//   GET    /api/vessel/memory          → listMemory
//   POST   /api/vessel/memory/search   → KNN search
//   GET    /api/vessel/memory/:id      → getMemoryById
//   DELETE /api/vessel/memory/:id      → idempotent delete
//   GET    /api/vessel/memory/status   → embedder + count snapshot
//
// Requires backend ≥ Vessel M1C-B+ (transformers.js + sqlite-vec). When
// pointed at a stock claude-web (Eva) backend without these routes, calls
// 404. Caller can detect via probe → MemoryAPI.status().

import Foundation

struct MemoryRecord: Identifiable, Codable, Equatable {
    let id: Int
    let kind: String          // "note" | "fact" | "episode" | "preference"
    let content: String
    let source: String?
    let embedding_model: String
    let created_at: String
    let updated_at: String
}

struct MemorySearchHit: Identifiable, Codable, Equatable {
    let id: Int
    let kind: String
    let content: String
    let source: String?
    let embedding_model: String
    let created_at: String
    let updated_at: String
    let distance: Double
}

struct MemoryStatus: Codable, Equatable {
    let embedder: EmbedderInfo
    let records: Int

    struct EmbedderInfo: Codable, Equatable {
        let ok: Bool
        let model: String
        let loaded: Bool
        let reason: String?
        let currentModelId: String?
    }
}

private struct MemoryAddResponse: Decodable {
    let memory: MemoryRecord
}

private struct MemoryListResponse: Decodable {
    let memories: [MemoryRecord]
    let count: Int
}

private struct MemorySearchResponse: Decodable {
    let hits: [MemorySearchHit]
    let count: Int
}

private struct MemoryGetResponse: Decodable {
    let memory: MemoryRecord
}

@MainActor
final class MemoryAPI {
    private let backend: () -> URL
    private let token: () -> String

    init(backend: @escaping () -> URL, token: @escaping () -> String = { "" }) {
        self.backend = backend
        self.token = token
    }

    func add(kind: String, content: String, source: String? = nil) async throws -> MemoryRecord {
        var req = makeRequest(path: "/api/vessel/memory", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        var body: [String: Any] = ["kind": kind, "content": content]
        if let s = source, !s.isEmpty { body["source"] = s }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(MemoryAddResponse.self, from: data).memory
    }

    func list(kind: String? = nil, limit: Int = 50) async throws -> [MemoryRecord] {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = "/api/vessel/memory"
        var queryItems: [URLQueryItem] = [URLQueryItem(name: "limit", value: String(limit))]
        if let k = kind { queryItems.append(URLQueryItem(name: "kind", value: k)) }
        components.queryItems = queryItems

        var req = URLRequest(url: components.url!)
        req.httpMethod = "GET"
        applyAuth(&req)

        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(MemoryListResponse.self, from: data).memories
    }

    func search(query: String, top: Int = 5) async throws -> [MemorySearchHit] {
        var req = makeRequest(path: "/api/vessel/memory/search", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "query": query,
            "top": top,
        ])
        // KNN may take longer if embedder is cold-loading the model.
        req.timeoutInterval = 60
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(MemorySearchResponse.self, from: data).hits
    }

    func get(id: Int) async throws -> MemoryRecord {
        let req = makeRequest(path: "/api/vessel/memory/\(id)", method: "GET")
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(MemoryGetResponse.self, from: data).memory
    }

    /// Idempotent — server returns 200 even when id doesn't exist.
    func delete(id: Int) async throws {
        let req = makeRequest(path: "/api/vessel/memory/\(id)", method: "DELETE")
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
    }

    func status() async throws -> MemoryStatus {
        let req = makeRequest(path: "/api/vessel/memory/status", method: "GET")
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(MemoryStatus.self, from: data)
    }

    // MARK: - helpers

    private func makeRequest(path: String, method: String) -> URLRequest {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = path
        var req = URLRequest(url: components.url!)
        req.httpMethod = method
        applyAuth(&req)
        return req
    }

    private func applyAuth(_ req: inout URLRequest) {
        let t = token()
        if !t.isEmpty {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        }
    }

    private func ensureOK(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw MemoryAPIError.badResponse }
        if !(200..<300).contains(http.statusCode) {
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = json["error"] as? String {
                throw MemoryAPIError.backend(http.statusCode, msg)
            }
            throw MemoryAPIError.backend(http.statusCode, "HTTP \(http.statusCode)")
        }
    }
}

enum MemoryAPIError: LocalizedError {
    case badResponse
    case backend(Int, String)

    var errorDescription: String? {
        switch self {
        case .badResponse: return "服务器返回非 HTTP 响应"
        case .backend(let code, let msg): return "HTTP \(code)：\(msg)"
        }
    }
}
