// Thin client over the backend /api/fs/* endpoints. Used by the directory
// picker (F1c2) and later by the file browser (F2). Intentionally minimal:
// we only call /tree and /mkdir for now; file/blob endpoints come later.

import Foundation

struct FsEntry: Identifiable, Equatable, Decodable {
    let name: String
    let type: String           // "dir" | "file"
    let size: Int?
    var id: String { type + ":" + name }
    var isDir: Bool { type == "dir" }
}

struct FsTreeResponse: Decodable {
    let entries: [FsEntry]
}

struct FsHomeResponse: Decodable {
    let home: String
    let desktop: String?
    let cwd: String
}

@MainActor
final class FsAPI {
    private let backend: () -> URL
    private let token: () -> String

    init(backend: @escaping () -> URL, token: @escaping () -> String = { "" }) {
        self.backend = backend
        self.token = token
    }

    /// List entries directly under `path`. Hidden files / node_modules are
    /// hidden by default for the directory picker — picking a project doesn't
    /// need to navigate into junk.
    func listChildren(of absPath: String) async throws -> [FsEntry] {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = "/api/fs/tree"
        components.queryItems = [
            URLQueryItem(name: "root", value: absPath),
            URLQueryItem(name: "path", value: ""),
            URLQueryItem(name: "hidden", value: "0"),
            URLQueryItem(name: "showNodeModules", value: "0"),
        ]
        guard let url = components.url else { throw FsError.badURL }
        let (data, response) = try await URLSession.shared.data(for: authed(URLRequest(url: url)))
        try ensureOK(response, data)
        return try JSONDecoder().decode(FsTreeResponse.self, from: data).entries
    }

    /// Create a new directory at `parent/name`. Returns the new absolute path.
    @discardableResult
    func mkdir(parent: String, name: String) async throws -> String {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = "/api/fs/mkdir"
        guard let url = components.url else { throw FsError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "parent": parent,
            "name": name,
        ])
        let (data, response) = try await URLSession.shared.data(for: authed(req))
        try ensureOK(response, data)
        struct R: Decodable { let path: String? }
        let r = try JSONDecoder().decode(R.self, from: data)
        return r.path ?? (parent as NSString).appendingPathComponent(name)
    }

    func home() async throws -> FsHomeResponse {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = "/api/fs/home"
        guard let url = components.url else { throw FsError.badURL }
        let (data, response) = try await URLSession.shared.data(for: authed(URLRequest(url: url)))
        try ensureOK(response, data)
        return try JSONDecoder().decode(FsHomeResponse.self, from: data)
    }

    // MARK: - helpers

    private func authed(_ req: URLRequest) -> URLRequest {
        var r = req
        let t = token()
        if !t.isEmpty {
            r.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        }
        return r
    }

    private func ensureOK(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw FsError.badResponse
        }
        if !(200..<300).contains(http.statusCode) {
            // Try to surface the backend's error message
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = json["error"] as? String {
                throw FsError.backend(http.statusCode, msg)
            }
            throw FsError.backend(http.statusCode, "HTTP \(http.statusCode)")
        }
    }
}

enum FsError: LocalizedError {
    case badURL
    case badResponse
    case backend(Int, String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "URL 错误"
        case .badResponse: return "响应错误"
        case .backend(_, let msg): return msg
        }
    }
}
