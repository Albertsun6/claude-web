// Thin HTTP client for /api/pim endpoints (M0-PIM Day 4).
//
// 同源：
// - Backend route: packages/backend/src/routes/pim.ts
// - Wire DTO: packages/shared/src/pim-protocol.ts PimItemDtoSchema
// - Swift DTO: HarnessProtocol.swift PimItemDto (复用)
//
// 鉴权: 同 InboxAPI — 接受 authToken closure, 非空时设 Authorization Bearer header.

import Foundation

/// Wire response wrapper: backend returns `{ item: PimItemDto }`.
private struct PimItemEnvelope: Codable {
    let item: PimItemDto
}

/// Wire response for list endpoint.
struct PimItemListResponse: Codable {
    let items: [PimItemDto]
    let total: Int
}

@Observable
final class PimAPI {
    private let baseURL: () -> URL
    private let authToken: () -> String

    /// `authToken` defaults to `{ "" }` to mirror InboxAPI's compat shim.
    init(baseURL: @escaping () -> URL, authToken: @escaping () -> String = { "" }) {
        self.baseURL = baseURL
        self.authToken = authToken
    }

    private func authorize(_ req: inout URLRequest) {
        let token = authToken()
        if !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    // MARK: - POST /api/pim

    /// Capture a new PimItem. Backend infers source from UA + provided override.
    /// Day 4 MVP: only `content` is mandatory; backend defaults commitmentState='inbox',
    /// modality='text', visibility='private'. Future iOS UI can pass commitmentState
    /// explicitly once picker UI lands (post Week 3 schema convergence).
    func capture(
        content: String,
        commitmentState: String? = nil,
        domainTags: [String]? = nil
    ) async throws -> PimItemDto {
        let url = baseURL().appendingPathComponent("api/pim")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authorize(&req)

        var payload: [String: Any] = ["content": content, "source": "ios"]
        if let commitmentState { payload["commitmentState"] = commitmentState }
        if let domainTags { payload["domainTags"] = domainTags }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        req.timeoutInterval = 6

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw NSError(domain: "PimAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "no response"])
        }
        if http.statusCode != 201 {
            throw NSError(
                domain: "PimAPI",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "POST /api/pim HTTP \(http.statusCode)"]
            )
        }
        return try JSONDecoder().decode(PimItemEnvelope.self, from: data).item
    }

    // MARK: - GET /api/pim/list

    /// Week 3 Day 15: `query` 字段触发 FTS5 检索（pim_item_fts MATCH）.
    /// CJK 单字需要 caller 自己 append `*` 做前缀匹配（unicode61 tokenizer 限制）.
    func list(
        commitmentState: String? = nil,
        limit: Int = 50,
        includeDeleted: Bool = false,
        query: String? = nil
    ) async throws -> PimItemListResponse {
        var comps = URLComponents(
            url: baseURL().appendingPathComponent("api/pim/list"),
            resolvingAgainstBaseURL: false
        )!
        var queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if let commitmentState { queryItems.append(URLQueryItem(name: "commitment", value: commitmentState)) }
        if includeDeleted { queryItems.append(URLQueryItem(name: "includeDeleted", value: "1")) }
        if let query, !query.isEmpty { queryItems.append(URLQueryItem(name: "q", value: query)) }
        comps.queryItems = queryItems
        var req = URLRequest(url: comps.url!)
        authorize(&req)
        req.timeoutInterval = 6
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, http.statusCode == 400 {
            // FTS syntax error — give caller a typed signal
            throw NSError(
                domain: "PimAPI",
                code: 400,
                userInfo: [NSLocalizedDescriptionKey: "搜索语法错误（FTS5 解析失败）"]
            )
        }
        return try JSONDecoder().decode(PimItemListResponse.self, from: data)
    }

    // MARK: - PATCH /api/pim/:id

    /// Partial update — pass only the fields to change. Empty patch → backend 400.
    func patch(
        id: String,
        commitmentState: String? = nil,
        content: String? = nil
    ) async throws -> PimItemDto {
        let url = baseURL().appendingPathComponent("api/pim/\(id)")
        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authorize(&req)

        var payload: [String: Any] = [:]
        if let commitmentState { payload["commitmentState"] = commitmentState }
        if let content { payload["content"] = content }
        guard !payload.isEmpty else {
            throw NSError(
                domain: "PimAPI",
                code: -2,
                userInfo: [NSLocalizedDescriptionKey: "PATCH body must contain at least one field"]
            )
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        req.timeoutInterval = 6

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(
                domain: "PimAPI",
                code: code,
                userInfo: [NSLocalizedDescriptionKey: "PATCH /api/pim/:id HTTP \(code)"]
            )
        }
        return try JSONDecoder().decode(PimItemEnvelope.self, from: data).item
    }

    // MARK: - DELETE /api/pim/:id (soft delete)

    func softDelete(id: String) async throws {
        let url = baseURL().appendingPathComponent("api/pim/\(id)")
        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        authorize(&req)
        req.timeoutInterval = 6
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(
                domain: "PimAPI",
                code: code,
                userInfo: [NSLocalizedDescriptionKey: "DELETE /api/pim/:id HTTP \(code)"]
            )
        }
    }
}
