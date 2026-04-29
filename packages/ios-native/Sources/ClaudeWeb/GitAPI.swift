// Thin HTTP client over /api/git/* endpoints. Pattern mirrors FsAPI.swift —
// dependency-injected backend URL + token closures, async/throws calls.

import Foundation

enum GitAPIError: LocalizedError {
    case badURL
    case badResponse
    case backend(Int, String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "无法构造 git API URL"
        case .badResponse: return "响应格式错误"
        case .backend(let code, let msg): return "git \(code): \(msg)"
        }
    }
}

@MainActor
final class GitAPI {
    private let backend: () -> URL
    private let token: () -> String

    init(backend: @escaping () -> URL, token: @escaping () -> String) {
        self.backend = backend
        self.token = token
    }

    /// GET /api/git/status?cwd=<absolute-path>. Returns nil if the cwd isn't
    /// a git repo (400 from backend) — caller treats that as "no gate needed".
    func getStatus(cwd: String) async throws -> GitStatusReport? {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = "/api/git/status"
        components.queryItems = [URLQueryItem(name: "cwd", value: cwd)]
        guard let url = components.url else { throw GitAPIError.badURL }
        var req = URLRequest(url: url)
        let t = token()
        if !t.isEmpty {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        }
        req.timeoutInterval = 10
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw GitAPIError.badResponse }
        if http.statusCode == 400 {
            // Most likely "not a git repo" — silent skip is correct here.
            return nil
        }
        if !(200..<300).contains(http.statusCode) {
            let msg: String
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let m = json["error"] as? String {
                msg = m
            } else {
                msg = "HTTP \(http.statusCode)"
            }
            throw GitAPIError.backend(http.statusCode, msg)
        }
        return try JSONDecoder().decode(GitStatusReport.self, from: data)
    }
}
