// HTTP client for /api/version/latest — mirrors the web UpdateBanner flow.
// Backend returns current backend version + latest GitHub release info +
// hasUpdate=true when latest pkg version > current. Cache lives on the
// backend (6h TTL); iOS just fetches once on app foreground.

import Foundation

struct VersionCurrentDTO: Decodable {
    let backend: String
    let source: String   // "VERSION" | "package.json" | "unknown"
}

struct VersionAssetDTO: Decodable {
    let name: String
    let downloadUrl: String
    let sizeBytes: Int

    enum CodingKeys: String, CodingKey {
        case name
        case downloadUrl
        case sizeBytes
    }
}

struct VersionLatestDTO: Decodable {
    let tag: String
    let name: String?
    let htmlUrl: String
    let publishedAt: String?
    let asset: VersionAssetDTO?
}

struct UpdateCheckDTO: Decodable {
    let current: VersionCurrentDTO
    let latest: VersionLatestDTO?
    let hasUpdate: Bool
    let checkedAt: String
    let error: String?
}

@MainActor
@Observable
final class VersionAPI {
    private let backend: () -> URL
    private let token: () -> String

    init(backend: @escaping () -> URL, token: @escaping () -> String = { "" }) {
        self.backend = backend
        self.token = token
    }

    func latest(force: Bool = false) async throws -> UpdateCheckDTO {
        var components = URLComponents(url: backend(), resolvingAgainstBaseURL: false)!
        components.path = "/api/version/latest"
        if force {
            components.queryItems = [URLQueryItem(name: "force", value: "1")]
        }
        var req = URLRequest(url: components.url!)
        req.httpMethod = "GET"
        let t = token()
        if !t.isEmpty {
            req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw VersionAPIError.badResponse
        }
        return try JSONDecoder().decode(UpdateCheckDTO.self, from: data)
    }
}

enum VersionAPIError: LocalizedError {
    case badResponse

    var errorDescription: String? {
        switch self {
        case .badResponse: return "Version API 响应错误"
        }
    }
}
