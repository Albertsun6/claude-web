// Thin client for /api/context/* — fetches injectable context blocks
// (git diff today; git log / URL fetch / etc later) for the H4 attachment
// sheet on the iOS InputBar.

import Foundation

struct GitDiffResponse: Decodable, Equatable {
    let diff: String
    let bytes: Int
    let truncated: Bool
    let maxBytes: Int
}

enum ContextAPIError: LocalizedError {
    case badURL
    case badResponse
    case backend(Int, String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "无法构造 context API URL"
        case .badResponse: return "响应格式错误"
        case .backend(let code, let msg): return "context \(code): \(msg)"
        }
    }
}

@MainActor
final class ContextAPI {
    private let backend: () -> URL
    private let token: () -> String

    init(backend: @escaping () -> URL, token: @escaping () -> String) {
        self.backend = backend
        self.token = token
    }

    /// GET /api/context/git-diff?cwd=...  Returns nil if cwd isn't a git repo.
    func getGitDiff(cwd: String) async throws -> GitDiffResponse? {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = "/api/context/git-diff"
        components.queryItems = [URLQueryItem(name: "cwd", value: cwd)]
        guard let url = components.url else { throw ContextAPIError.badURL }
        var req = URLRequest(url: url)
        let t = token()
        if !t.isEmpty {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        }
        req.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw ContextAPIError.badResponse }
        if http.statusCode == 400 {
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
            throw ContextAPIError.backend(http.statusCode, msg)
        }
        return try JSONDecoder().decode(GitDiffResponse.self, from: data)
    }
}
