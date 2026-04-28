# ⚠️ Capacitor iOS 路径已 DEPRECATED

这个目录下的 Capacitor 包壳是 **iOS 原生路径之前的过渡方案**，从 v1 起不再
维护。新的代码改动 / bug 修复都不会回流到这里。

## 为什么放弃

Capacitor 把 React + WebView 包成 iOS app，但底层仍是 WKWebView，碰到 iOS
平台限制：

- Web Speech API 不可用 → 只能走 remote whisper
- HTMLAudio 在 PWA standalone 下需要复杂的 unlock 技巧
- 物理静音键 + autoplay 限制 → TTS 不稳定
- 后台行为受 WKWebView 限制
- 锁屏 Now Playing 几乎不可能稳定

经过多轮调试发现这些不是代码问题，是 WebView 在 iOS 上的根本约束。

## 替代方案

**新路径 = SwiftUI 原生 app**：[`packages/ios-native/`](../../ios-native/)

跑通了：
- AVAudioSession.playback 让 TTS 不被静音键卡
- 原生 AVAudioRecorder 录音稳定
- AVAudioPlayer 直接播 mp3，无 unlock
- Now Playing / Lock screen Remote Command 正确路由（在 TTS 真播放期间）
- 后台保活（实验）让 WS 不被挂起

参考 [docs/USER_MANUAL.md](../../../../docs/USER_MANUAL.md) "iOS 原生 app（Claude Voice）" 章节。

## 这个目录会怎么样

- **不删**：仍可用、可 build，作为如果原生 app 出问题的紧急 fallback
- **不维护**：新 feature / fix 走 ios-native
- **不上 PR**：如果你改这里的代码，请确认理由（例如紧急 hotfix）

桌面 web（`packages/frontend/` 的非 ios 部分）**仍是主要桌面入口**，继续维护。
