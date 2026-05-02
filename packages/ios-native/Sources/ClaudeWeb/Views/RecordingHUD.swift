import SwiftUI

/// Floating overlay shown while user is holding the PTT button. Mirrors
/// WeChat / Telegram style: default white card with mic icon, switches to
/// red "release to cancel" card when finger has slid up past the cancel
/// threshold.
struct RecordingHUD: View {
    let cancelArmed: Bool

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(cancelArmed ? Color.red : Color(.systemBackground))
                    .shadow(color: .black.opacity(0.15), radius: 12, y: 4)

                VStack(spacing: 10) {
                    Image(systemName: cancelArmed ? "xmark" : "mic.fill")
                        .font(.system(size: 36, weight: .bold))
                        .foregroundStyle(cancelArmed ? Color.white : Color.accentColor)

                    Text(cancelArmed ? "松开取消" : "↑ 上滑取消")
                        .font(.callout.weight(.medium))
                        .foregroundStyle(cancelArmed ? Color.white : .secondary)
                }
                .padding(20)
            }
            .frame(width: 160, height: 140)
            .animation(.easeInOut(duration: 0.15), value: cancelArmed)
        }
        // Sit above input bar with breathing room. iOS keyboard does not
        // come up during PTT so we don't need keyboard-avoidance.
        .padding(.bottom, 140)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .allowsHitTesting(false) // overlay must not steal the gesture
        .transition(.opacity.combined(with: .scale(scale: 0.9)))
    }
}

#Preview("Default") {
    ZStack {
        Color.gray.opacity(0.2).ignoresSafeArea()
        RecordingHUD(cancelArmed: false)
    }
}

#Preview("Cancel armed") {
    ZStack {
        Color.gray.opacity(0.2).ignoresSafeArea()
        RecordingHUD(cancelArmed: true)
    }
}
