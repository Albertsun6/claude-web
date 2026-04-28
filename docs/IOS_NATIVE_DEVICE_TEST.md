# iOS Native — 真机验收清单

> 目标：在真 iPhone 上把 M1-M4 + M4.5 修复全部跑一遍，找出模拟器测不到的真实
> 问题。跑完且全绿 → v1 可日常用。
>
> 跑法：从上到下逐条做，每条标 ✅ / ❌ / 💬（注释）。失败的发我修。
>
> **v1 验收范围 = Section 1, 2, 3, 5**。Section 4（锁屏长时间空闲后远程命令）
> 是 iOS 平台层面的硬约束（参见 [WWDC22 PushToTalk](https://developer.apple.com/videos/play/wwdc2022/10117/)），
> 已挂起，作为实验性 opt-in 功能（Settings 里的"锁屏保活"开关）。Section 4
> 跑下来 fail 不算 v1 不通过。

## 准备

### A. 设备 + Mac 状态

- [ ] iPhone 插 USB，解锁，**保持 trust 这台 Mac**（Xcode → Devices and Simulators 看到 Paired）
- [ ] iPhone 装着 Tailscale，登录同一账号，状态 connected
- [ ] Mac backend 在跑（`launchctl list | grep claude-web` 应该有 PID）
- [ ] backend 健康检查：`curl https://mymac.tailcf3ccf.ts.net/api/auth/info` 返回 JSON

### B. 部署 + 首次启动

```bash
cd /Users/yongqian/Desktop/claude-web/packages/ios-native
./scripts/deploy.sh   # 不带 --sim
```

- [ ] 看到 `✓ deployed + launched on <DEVICE_ID>`
- [ ] iPhone 主屏出现 **Claude Voice** 图标（不是 Claude）
- [ ] 第一次打开提示**信任开发者**：设置 → 通用 → VPN与设备管理 → 你的 Apple ID → 信任
- [ ] 重新打开 app，看到 SwiftUI UI（标题"Claude"，左上耳机图标，右上设置）

### C. 配置

- [ ] 右上 ⚙️ → 设置：
  - Backend = `https://mymac.tailcf3ccf.ts.net`
  - 工作目录 = 一个真实存在的 cwd（如 `/Users/yongqian/Desktop/claude-web`）
  - 模型 = Haiku 4.5（默认，省 token；测试 Sonnet/Opus 时切换）
  - 权限模式 = `Plan`（先安全跑）
  - CLAUDE_WEB_TOKEN = （如果 backend 设了 token 才填，没设就空）
  - 自动播报 = ON，风格 = 概要
  - 锁屏保活（实验）= 默认关，Section 4 才需要开
- [ ] 保存退出 → 顶部小圆点变 🟢 (已连接)

### D. 麦克风权限

- [ ] 第一次按 PTT 按钮 → iOS 弹"允许 Claude Voice 访问麦克风" → **允许**
- [ ] 第一次进入语音模式 → 可能弹本地网络权限（如果 backend 用 LAN IP 而不是 Tailscale）

---

## 1. 前台基础（M1 + M2 + M3）

| # | 操作 | 预期 | 结果 |
|---|---|---|---|
| 1.1 | 输入"你好"按发送 | 看到流式回复，连接圆点保持 🟢 | ☐ |
| 1.2 | 按住麦克风 ≥1s 说"列出当前目录"，松手 | 输入框出现转写文字（不自动发） | ☐ |
| 1.3 | 在转写基础上手改→点发送 | Claude 收到改后的版本 | ☐ |
| 1.4 | 设置切到 Default 模式，输入"运行 ls" | 弹出权限 sheet 显示 `Bash`，命令预览 → 允许 | ☐ |
| 1.5 | 同样问，按拒绝 | Claude 知道被拒，给说明 | ☐ |
| 1.6 | 收到回复后听到晓晓念概要 | TTS 自动播报，顶部出现 ⏸ ⏹ | ☐ |
| 1.7 | 念到一半按 ⏸ → 按 ▶ | 暂停 → 继续，无杂音 | ☐ |
| 1.8 | 念完后按 ↻ | 重听同一段（不重新调 Haiku，要快） | ☐ |
| 1.9 | 设置切"逐句"→ 重新问 | 念出来明显比概要长 | ☐ |
| 1.10 | 设置勾"慢速朗读"→ 重新问 | 速度明显慢 | ☐ |
| 1.11 | 设置模型切到 Sonnet 4.6 → 问"用三句话介绍 React" | 走的是 Sonnet；Mac backend 日志能确认 model 字段 | ☐ |
| 1.12 | 切回 Haiku 4.5 → 重新问 | 切换生效，无报错 | ☐ |

---

## 2. 进入语音模式 + Now Playing 卡片（**已挂起 / 平台约束**）

> ⚠️ **不强求 v1 通过**。实测在真机上即使 silent keepalive 在跑、audio
> session 已激活、MPNowPlayingInfoCenter metadata 正确写入，iOS 仍可能
> 不显示锁屏 / 控制中心的 Now Playing 卡片。这跟 Section 4 是同一类
> 平台限制，跟 Apple Voice Memos 锁屏即停同理。
>
> **可用的部分仍在保留**：
> - 后台保活（silent keepalive）让 WebSocket 不被挂起 ✅
> - TTS 真在播放时锁屏 / 控制中心确实能看到卡片 ✅
> - 前台语音模式 + 自动发送 ✅
>
> **不再投入**：
> - 让 idle 语音模式 / 保活模式的 Now Playing 卡片稳定显示

跳过到 Section 3（语音模式 + 前台行为）。

---

## 3. 语音模式 + 前台（M4 关键路径）

进入语音模式（保持绿色耳机）。

- [ ] **3.1** 按住 mic 按钮说"用三句话介绍 Hono"，松手 → 直接发出去（不进输入框，因为是语音模式）
- [ ] **3.2** Claude 回完听到 TTS 自动念
- [ ] **3.3** 念到一半再按 mic 抢话 → TTS 立刻停 → 进录音状态
- [ ] **3.4** 抢话说一句 → 松手 → 自动发 → 收到回复 → TTS 念新的

---

## 4. 锁屏 + Now Playing 远程命令（**实验性 / 已挂起**）

> ⚠️ 这一节**不是 v1 必须通过的**。iOS 平台限制下"长时间空闲后锁屏远程命令"
> 不能稳定做（参考 Apple Voice Memos 也是锁屏即停）。本节作为可选：你想试
> "锁屏保活"实验开关，到设置里打开后跑这一节。失败不影响 v1 通过。


进入语音模式。锁屏。

### 短时间窗口（刚锁屏内 1 分钟）

- [ ] **4.1** 锁屏唤醒一下看 Now Playing → 卡片在
- [ ] **4.2** 点 Now Playing 大播放键 → 状态变"录音中…再按一次结束"
- [ ] **4.3** 对着 iPhone 说一句话 → 再点播放键 → 状态变"识别中" → 然后"Claude 在想…"
- [ ] **4.4** Claude 回完 → Now Playing 标题换成"正在播报"，听到晓晓念
- [ ] **4.5** 念到一半点暂停 → TTS 暂停，状态"已暂停"
- [ ] **4.6** 点继续 → 接着念
- [ ] **4.7** 点 stop → 念停 → 状态回"待命"

### 中等窗口（idle 5 分钟）

- [ ] **4.8** 进入语音模式后**5 分钟啥也不做**，然后锁屏 → 锁屏 Now Playing 还在？标题"待命"？
- [ ] **4.9** 点播放键 → **能否启动录音**？

### 长窗口（idle 10 分钟）

- [ ] **4.10** 同上但等 10 分钟 → 锁屏 + 远程命令是否还工作？

### 极限（idle 30 分钟）

- [ ] **4.11** 同上但等 30 分钟 → 是否仍可以？
- [ ] **4.12** 如果 30 分钟挂了，记录在哪个时间点开始失败（5 / 10 / 15 / …）

---

## 5. AirPods / 耳机

- [ ] **5.1** AirPods 连上，进入语音模式 → 锁屏 Now Playing 出现
- [ ] **5.2** 锁屏，按 AirPods 单击柄（系统标准 play/pause 手势） → 是否触发录音/停止？
- [ ] **5.3** 录音时麦克风走 AirPods（音质判断）
- [ ] **5.4** TTS 播放走 AirPods（不应该走 iPhone 喇叭）
- [ ] **5.5** 取下 AirPods → TTS 应自动暂停（iOS 标准行为）
- [ ] **5.6** 戴回 AirPods → TTS 不应自动恢复（标准行为，需要手动）

---

## 6. 网络抖动

- [ ] **6.1** TTS 播放中关 WiFi → TTS 应播完缓存，下一轮发送可能失败 → 错误提示
- [ ] **6.2** 切到 4G → 等几秒 → 顶部小圆点应变 🟢 重新连
- [ ] **6.3** 4G 下发 prompt → 收到回复
- [ ] **6.4** 飞行模式 5 秒 → 关闭 → WS 自动重连？
- [ ] **6.5** 重连后 sessionId 是不是 Claude 还知道刚才聊过啥？

---

## 7. 系统打断

- [ ] **7.1** TTS 播放中来电话 → TTS 暂停（系统强制 ducking）
- [ ] **7.2** 接电话 → 挂电话 → 回 app → TTS 应能恢复或允许重听
- [ ] **7.3** 录音中按 Siri → 录音中断 → Siri 用完回 app → 状态是否清晰
- [ ] **7.4** 收到通知带声音（如 iMessage） → TTS ducking 一下还是被打断？
- [ ] **7.5** 切到其他 app（YouTube）放视频 → 回 Claude Voice → audio session 是否能重新接管

---

## 8. 错误恢复

- [ ] **8.1** 在 Mac 上 `launchctl unload ~/Library/LaunchAgents/com.claude-web.backend.plist` 杀掉后端
- [ ] **8.2** iPhone 上发 prompt → 看到红字"未连接后端，发送失败" → busy 不卡（mic 可再按）
- [ ] **8.3** 重启后端 → 顶部圆点几秒后变绿 → 重发 prompt 成功
- [ ] **8.4** 录音中拔 USB（模拟硬件问题）→ 看 app 表现是否清晰
- [ ] **8.5** 设置故意填错 Backend URL → 保存 → 错误提示 → 改回 → 应自动重连
- [ ] **8.6** 真出现错误（mic 失败 / TTS 失败）→ 顶部出现橙色 ⚠️ → 点击 → 状态回 idle

---

## 9. 后端鉴权 token

> 只在你打算给 backend 设 CLAUDE_WEB_TOKEN 时才测

- [ ] **9.1** Mac 上设 `CLAUDE_WEB_TOKEN=test123` 重启 backend
- [ ] **9.2** iPhone Settings 不填 token → 发 prompt → 应该失败（401 / WS 拒）
- [ ] **9.3** 填 token=test123 → 保存 → 自动重连 → 发 prompt → 成功
- [ ] **9.4** 录音 / TTS 同样应该工作（HTTP 带 Bearer 头）

---

## 10. 多轮 + 长时间

- [ ] **10.1** 连续 5 轮"问→听→问→听" → 不卡，sessionId 保持
- [ ] **10.2** 锁屏状态下完成连续 3 轮（全用 Now Playing 控件）
- [ ] **10.3** 用 30 分钟，记录电池消耗 %
- [ ] **10.4** 任意时间点退出语音模式 → 一切干净

---

## 报告模板

```
设备: iPhone 15 Pro Max, iOS 18.x
日期: 2026-04-XX

✅ 通过: [章节列表]
❌ 失败: [章节.项 + 描述]
💬 笔记:
  - 4.10 在 7 分钟时锁屏命令开始无响应
  - 5.2 AirPods 单击没触发，按了两下才行
  - 6.4 飞行模式恢复后 12 秒才重连，体感慢
```

把这个发我就行。

---

## 失败模式速查

| 现象 | 可能原因 | 排查 |
|---|---|---|
| 装上去打不开 / 闪退 | 免费 cert 没信任 | 设置 → VPN与设备管理 → 信任 |
| 圆点一直黄/红 | iPhone 不在 Tailscale 或 Mac backend 死 | `tailscale status` / `launchctl list \| grep claude` |
| Now Playing 卡片不出现 | 没进语音模式 | 点左上耳机图标 |
| 锁屏命令完全没响应 | iOS 已挂起 app（idle 太久）或 audio session 失活 | 体感时间点写下来发我 |
| 录音转写空 | 麦权限被拒 / 录音 < 250ms | 设置→Claude Voice→麦克风开 |
| TTS 不响 | 物理静音键？AirPods 路由错了？ | 试 iPhone 内放 / 再试 AirPods |
| 重启 backend 后不重连 | WS 重连只在 onClose 触发，可能没 detect | 切飞行模式再开 |
