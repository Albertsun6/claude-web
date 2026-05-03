// HTTP client for /api/harness/config (M0 modelList Round).
//
// RFC §2.1（phase 3 修订后）：
// - GET 200 + body + ETag header (HTTP-quoted)
// - GET with If-None-Match (quoted) match → 304
// - 不传 If-None-Match → 200 + body
// - Auth 继承现有 /api/* 中间件（authMiddleware）

import Foundation

enum HarnessConfigFetchResult {
    case updated(HarnessConfig)        // 200 with new body
    case notModified                   // 304
}

@MainActor
final class HarnessConfigAPI {
    private let backend: () -> URL
    private let token: () -> String

    init(backend: @escaping () -> URL, token: @escaping () -> String = { "" }) {
        self.backend = backend
        self.token = token
    }

    /// Fetch /api/harness/config. If `ifNoneMatch` is non-nil and matches the
    /// server etag, returns `.notModified`. Otherwise returns `.updated(config)`.
    func fetch(ifNoneMatch: String?) async throws -> HarnessConfigFetchResult {
        let url = backend().appendingPathComponent("/api/harness/config")
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        let tok = token()
        if !tok.isEmpty {
            req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
        }
        if let etag = ifNoneMatch, !etag.isEmpty {
            // Use HTTP-standard quoted form on the wire
            req.setValue("\"\(etag)\"", forHTTPHeaderField: "If-None-Match")
        }

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "HarnessConfigAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "non-http response"])
        }
        if http.statusCode == 304 {
            return .notModified
        }
        guard http.statusCode == 200 else {
            throw NSError(
                domain: "HarnessConfigAPI",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "GET /api/harness/config: HTTP \(http.statusCode)"]
            )
        }
        let cfg = try JSONDecoder().decode(HarnessConfig.self, from: data)
        return .updated(cfg)
    }
}
