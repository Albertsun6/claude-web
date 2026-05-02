import SwiftUI
import MarkdownUI

struct HelpView: View {
  @Environment(AppSettings.self) private var settings
  @State private var markdown: String = ""
  @State private var isLoading = true
  @State private var error: String? = nil

  var body: some View {
    ZStack {
      if isLoading {
        ProgressView()
      } else if let error = error {
        VStack(spacing: 12) {
          Image(systemName: "exclamationmark.triangle")
            .font(.largeTitle)
            .foregroundColor(.orange)
          Text("加载失败")
            .font(.headline)
          Text(error)
            .font(.caption)
            .foregroundColor(.secondary)
          Button("重试") {
            loadHelp()
          }
          .buttonStyle(.borderedProminent)
        }
        .padding()
      } else {
        ScrollView {
          Markdown(markdown)
            .markdownTheme(.gitHub)
            .textSelection(.enabled)
            .padding(16)
        }
      }
    }
    .navigationTitle("使用手册")
    .navigationBarTitleDisplayMode(.inline)
    .onAppear {
      loadHelp()
    }
  }

  private func loadHelp() {
    Task {
      isLoading = true
      error = nil

      // 1. 尝试从缓存加载
      if let cached = HelpCache.load() {
        markdown = cached
        isLoading = false
        // 后台刷新
        await refreshFromBackend()
        return
      }

      // 2. 直接从后端加载
      await refreshFromBackend()
    }
  }

  private func refreshFromBackend() async {
    guard let url = URL(string: "\(settings.backendURL.absoluteString)/api/help") else {
      DispatchQueue.main.async {
        self.error = "Invalid backend URL"
        self.isLoading = false
      }
      return
    }

    do {
      var req = URLRequest(url: url)
      req.timeoutInterval = 30

      // 添加认证 header（如需要）
      if !settings.authToken.isEmpty {
        req.setValue("Bearer \(settings.authToken)", forHTTPHeaderField: "Authorization")
      }

      let (data, response) = try await URLSession.shared.data(for: req)

      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
        throw URLError(.badServerResponse)
      }

      let text = String(data: data, encoding: .utf8) ?? ""

      // 缓存 24h
      HelpCache.save(text)

      DispatchQueue.main.async {
        self.markdown = text
        self.isLoading = false
        self.error = nil
      }
    } catch {
      DispatchQueue.main.async {
        self.error = error.localizedDescription
        self.isLoading = false
      }
    }
  }
}

// MARK: - 离线缓存
private struct HelpCache {
  private static let cacheKey = "help_markdown"
  private static let cacheTimeKey = "help_markdown_time"
  private static let cacheDuration: TimeInterval = 24 * 3600 // 24h

  static func load() -> String? {
    guard let cached = UserDefaults.standard.string(forKey: cacheKey) else {
      return nil
    }

    if let cacheTime = UserDefaults.standard.value(forKey: cacheTimeKey) as? TimeInterval {
      if Date().timeIntervalSince1970 - cacheTime < cacheDuration {
        return cached
      }
    }

    return cached // 过期了但离线可用，返回旧版本
  }

  static func save(_ markdown: String) {
    UserDefaults.standard.set(markdown, forKey: cacheKey)
    UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: cacheTimeKey)
  }
}

#Preview {
  HelpView()
}
