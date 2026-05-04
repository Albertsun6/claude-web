// HTTP client for /api/projects/* — wraps the F1c1 backend endpoints. The
// "registry" of projects lives on the server (~/.claude-web/projects.json);
// this is a thin client. Caching of the response is the Cache layer's job,
// not ours.

import Foundation

struct ProjectDTO: Identifiable, Codable, Equatable {
    let id: String
    var name: String
    let cwd: String
    let createdAt: String   // ISO8601 strings — Date conversion done on use
    var updatedAt: String
    /// Server-pinned project (e.g. the always-on "💬 随手问" scratch entry).
    /// Sorted to the top of the project list regardless of activity date.
    var sticky: Bool? = nil
}

struct ProjectsListResponse: Decodable {
    let projects: [ProjectDTO]
}

struct ProjectResponse: Decodable {
    let project: ProjectDTO
}

struct CleanupResponse: Decodable {
    let missing: [ProjectDTO]
}

@MainActor
final class ProjectsAPI {
    private let backend: () -> URL
    private let token: () -> String

    init(backend: @escaping () -> URL, token: @escaping () -> String = { "" }) {
        self.backend = backend
        self.token = token
    }

    func list() async throws -> [ProjectDTO] {
        let req = makeRequest(path: "/api/projects", method: "GET")
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(ProjectsListResponse.self, from: data).projects
    }

    /// Idempotent — POSTing the same cwd twice returns the same project.
    /// Empty `name` lets the backend derive one from the cwd basename.
    func create(name: String, cwd: String) async throws -> ProjectDTO {
        var req = makeRequest(path: "/api/projects", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "name": name,
            "cwd": cwd,
        ])
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(ProjectResponse.self, from: data).project
    }

    func rename(id: String, to name: String) async throws -> ProjectDTO {
        var req = makeRequest(path: "/api/projects/\(id)", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["name": name])
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(ProjectResponse.self, from: data).project
    }

    /// Returns full Project objects whose cwd no longer exists. Server does
    /// NOT auto-forget — caller decides per the user's confirmation alert.
    func cleanup() async throws -> [ProjectDTO] {
        let req = makeRequest(path: "/api/projects/cleanup", method: "POST")
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
        return try JSONDecoder().decode(CleanupResponse.self, from: data).missing
    }

    /// Removes the project from the registry. Does NOT delete the underlying
    /// jsonl history files — those persist so re-registering the same cwd
    /// later restores access to the conversation list.
    func forget(id: String) async throws {
        let req = makeRequest(path: "/api/projects/\(id)/forget", method: "POST")
        let (data, response) = try await URLSession.shared.data(for: req)
        try ensureOK(response, data)
    }

    // MARK: - helpers

    private func makeRequest(path: String, method: String) -> URLRequest {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = path
        var req = URLRequest(url: components.url!)
        req.httpMethod = method
        let t = token()
        if !t.isEmpty {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        }
        return req
    }

    private func ensureOK(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw ProjectsError.badResponse }
        if !(200..<300).contains(http.statusCode) {
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = json["error"] as? String {
                throw ProjectsError.backend(http.statusCode, msg)
            }
            throw ProjectsError.backend(http.statusCode, "HTTP \(http.statusCode)")
        }
    }
}

enum ProjectsError: LocalizedError {
    case badResponse
    case backend(Int, String)

    var errorDescription: String? {
        switch self {
        case .badResponse: return "响应错误"
        case .backend(_, let msg): return msg
        }
    }
}
