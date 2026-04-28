# 手机语音交互方案探索

按 **场景 → 限制 → 选项 → 推荐路径** 整理。

---

## 当前能用的

| 场景 | 状态 | 体验 |
|---|---|---|
| 桌面 Chrome / Safari | ✅ Web Speech + 对话模式 | 完美 |
| 安卓 Chrome | ✅ 同上 | 完美 |
| **iPhone Safari 浏览器** | ✅ Web Speech + 对话模式 | 完美，但**没 PWA 壳** |
| **iPhone PWA standalone** | ⚠️ 只能 push-to-talk + 远端 whisper | 没对话模式，没实时转写 |

**核心痛点**：iPhone 上"加到主屏"的全屏 PWA 体验和"对话模式"二选一。

---

## iOS 的硬限制

逐项查清，方案就有边界：

| 能力 | iOS Safari | iOS PWA standalone | 说明 |
|---|---|---|---|
| `getUserMedia`（麦克风） | ✅ HTTPS 下可用 | ✅ | OK |
| `MediaRecorder` | ✅ | ✅ | iOS 14+，输出 audio/mp4 |
| **Web Speech API（实时转写）** | ✅ | ❌ | iOS 把它叫"语音控制"，沙箱化只给 Safari 浏览器使用 |
| WebSocket | ✅ | ✅ | OK |
| **后台 mic** | ❌ | ❌ | App 进后台 5-10s 内 mic 停 |
| **锁屏后 mic** | ❌ | ❌ | 锁屏立即停 |
| WakeLock（屏幕常亮） | ✅ HTTPS | ✅ HTTPS | 阻止息屏 |
| 振动 `navigator.vibrate` | ❌ Safari 全系不实现 | ❌ | iOS 不支持 |
| 蓝牙耳机播暂键 | ⚠️ 不可靠 | ⚠️ | AirPods 双击 = `keypress` 偶尔触发 |
| BT headset mic 切换 | ✅（系统层） | ✅ | 自动用耳机 mic 输入 |

**结论**：**只要屏幕不锁、App 不进后台，iOS PWA 完全能跑语音**。一锁屏就 GG。这意味着：
- 走路时手机得**亮屏拿着**（用 WakeLock 防自动息屏）
- 不能塞进口袋说话
- 真正的 always-on 必须上原生 app（Tier 4）

---

## 方案分层

### Tier 1：VAD 分块转写（让 PWA 也有对话模式）

**目标**：iPhone PWA standalone 也能进对话模式 + 说"发送"提交。

**做法**：
1. `getUserMedia` 拿 mic stream
2. Web Audio API 的 `AnalyserNode` 每 50ms 算一次 RMS（音量）
3. 简单 VAD：RMS > 阈值 = 说话；连续 1.2s 低于阈值 = 句子结束
4. 句子结束时，把 MediaRecorder 当前 chunk stop + 送 `/api/voice/transcribe`
5. 拿到文本拼到 `convoBuf`
6. 检查 `convoBuf` 末尾是否有 `发送` 触发词，命中则提交
7. 没命中：重新 start MediaRecorder，继续监听

**优点**：
- 全本地 + Mac whisper，零持续费用
- iOS PWA 能用
- 跟桌面 Web Speech 对话模式行为一致

**代价**：
- 每个句子额外 ~500-1500ms whisper 推理延迟（vs Web Speech 实时）
- VAD 阈值要调，太松误触发，太紧漏字
- 复杂度：~200 行新代码

**实施**：3-4 小时

---

### Tier 2：UX 加固（小改动，体验大跳）

不依赖新技术，纯前端补丁：

1. **WakeLock**：进入对话模式时申请 `screen.keepAwake()`，防自动息屏。出对话模式释放
2. **音频提示音**：启动 / 停止 / 提交各播一个 200ms 短 beep（Web Audio API 即时合成），不看屏幕也知道状态
3. **Call Mode 全屏 UI**：进对话模式后切到极简界面：只有大麦克风 + 实时转写 + 简单波形，其他都隐藏。退出按钮在角落。一手能用
4. **TTS 速率适配**：行进中（可选开关）把 TTS speak rate 调到 0.85x，戴耳机听得更清
5. **Submit 后 1s buffer**：避免 Claude 回复刚开始就被新句子打断（边收边说话）

**优点**：体验本质提升，零外部依赖

**实施**：每项 30min，全做 ~3 小时

---

### Tier 3：OpenAI Realtime（花钱换体验）

完整 WebRTC 双向音频流到 OpenAI gpt-4o-realtime：
- STT 延迟 < 200ms（vs whisper chunk 1-2s）
- TTS 延迟 < 200ms（vs edge-tts 1-2s）
- 真正"对话感"，可以打断，可以插话
- iOS PWA 完全工作（getUserMedia + WebRTC，跟 Web Speech 不冲突）

**代价**：
- ~$0.06/分钟 ＝ ¥30/小时
- 每天用 1 小时 ≈ ¥900/月
- 需 OpenAI API key
- ~4 小时实施

**适合**：通勤路上、开车场景这种真"对话"用法。日常坐着办公没必要。

---

### Tier 4：Capacitor 原生 app（彻底解决后台/锁屏）

把现有 React 套 native iOS shell：
- 后台 mic 持续工作（需要 background audio mode 申请）
- 锁屏后继续录音
- 蓝牙耳机按键直连（AVAudioSession）
- 推送通知（Claude 完成时震一下）
- iOS 系统快捷指令唤起对话

**代价**：
- Apple Developer ¥688/年
- 自签 7 天证书或上架审核
- ~6-8 小时实施 + 持续维护

**适合**：真的要做"边走边用 Claude"的产品级体验。

---

## 推荐路径（我的判断）

按你目前真实使用场景（在家 / 办公室、Mac 开着、手机平时不锁屏地拿着），**Tier 1 + Tier 2 同步做最划算**：

```
工作量： ~6-7 小时
费用：    0
覆盖：    iPhone PWA 也能对话模式 + 走路 / 开车 / 手不方便时也好用
```

如果之后真有"通勤路上口播 30 分钟"的高频场景再上 Tier 3。

Tier 4 短期不建议——维护成本高，跟个人工具定位不匹配。

---

## 决策点

```
A. 全做 Tier 1 + Tier 2  → 最划算，~6 小时
B. 只做 Tier 1（PWA 对话模式）  → 关键功能，~4 小时
C. 只做 Tier 2（UX 加固）        → 现有 Web Speech 模式更好用，~3 小时
D. 直接 Tier 3（OpenAI Realtime） → 体验巅峰，但要花钱 + 配 key
E. Tier 4（Native app）           → 长期产品，~1 周
F. 暂时不做，记 IDEAS              → 现有方案够用了
```

---

## 实现细节（如果选 Tier 1，参考）

VAD 核心代码骨架：
```ts
const audioCtx = new AudioContext();
const source = audioCtx.createMediaStreamSource(stream);
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 1024;
source.connect(analyser);

const buf = new Uint8Array(analyser.frequencyBinCount);
let lastVoiceTs = 0;
let inSpeech = false;
const SILENCE_MS = 1200;
const RMS_THRESHOLD = 30; // 0-128, calibrate

function tick() {
  analyser.getByteTimeDomainData(buf);
  const rms = Math.sqrt(buf.reduce((s, v) => s + (v - 128) ** 2, 0) / buf.length);
  if (rms > RMS_THRESHOLD) {
    lastVoiceTs = Date.now();
    if (!inSpeech) { onSpeechStart(); inSpeech = true; }
  } else if (inSpeech && Date.now() - lastVoiceTs > SILENCE_MS) {
    inSpeech = false;
    onSpeechEnd(); // stop recorder, send to whisper, restart recorder
  }
  requestAnimationFrame(tick);
}
```

边界：calibrate RMS_THRESHOLD 在不同环境（安静办公 vs 户外）。考虑 noise floor 自适应：取前 500ms 的 RMS 平均作为底噪，阈值 = 底噪 × 3。
