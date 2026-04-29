import Foundation

struct UsageDTO: Decodable {
    let fiveHourPct: Double?
    let fiveHourResetsAt: Int?
    let sevenDayPct: Double?
    let sevenDayResetsAt: Int?
    let subscriptionType: String?
    let tier: String?
    let error: String?
}

@Observable final class UsageAPI {
    private let backend: () -> URL
    private let token: () -> String

    init(backend: @escaping () -> URL, token: @escaping () -> String) {
        self.backend = backend
        self.token = token
    }

    func fetchUsage() async throws -> UsageDTO {
        let url = backend().appendingPathComponent("api/usage")
        var req = URLRequest(url: url)
        let authToken = token()
        if !authToken.isEmpty {
            req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await URLSession.shared.data(for: req)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }

        guard httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        let decoder = JSONDecoder()
        return try decoder.decode(UsageDTO.self, from: data)
    }
}
