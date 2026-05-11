# iOS TestFlight Setup — Operator Playbook

> 这是 **M2-iOS-γ §2.2** 的人工部分。Claude 无法做的，因为需要 Apple ID + 2FA + 网页 UI + Apple 审核（1-7 天）。代码侧的 bundle id 改名 (`com.albertsun6.vessel`) 已经在 [PR #42](https://github.com/Albertsun6/claude-web/pull/42) 落地。

## 前置

- [ ] **Apple Developer Program 付费会员** ($99/年)。team `V84XLAQ28F` 已在 [project.yml](../packages/ios-native/project.yml) 配，确认仍有效（**Apple ID → 账户 → 我的账户** 看付费状态）
- [ ] PR #42 已 merge 到 main + tagged（包含 bundle id 改名）
- [ ] Xcode 16.x 已装 + 你 Apple ID 已登 (Xcode → Settings → Accounts)

## 1. App Store Connect 创建 app 记录

1. 打开 [https://appstoreconnect.apple.com](https://appstoreconnect.apple.com) → 登 Apple ID
2. **我的 App** → **+ → 新 App** (iOS)
3. 字段：
   - **平台**: iOS
   - **名称**: `Seaidea` (面向用户的市场名，跟 `CFBundleDisplayName` 一致)
   - **主要语言**: 简体中文
   - **Bundle ID**: 下拉里**选** `com.albertsun6.vessel` (如果没有 → 先去 [developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles → Identifiers → + → App IDs → 创建)
   - **SKU**: `vessel-ios-2026` (任意唯一字符串)
   - **用户访问权限**: 完全访问
4. 点 **创建**

## 2. Distribution provisioning profile

**最简路**: Xcode 自动管理。

1. Xcode 打开 `packages/ios-native/Vessel.xcodeproj`
2. 选 Vessel target → **Signing & Capabilities** tab
3. 勾 **Automatically manage signing**
4. **Team**: 选 `V84XLAQ28F`
5. Xcode 会自动找/生成 development + distribution profile

**手动路** (如果自动失败):

1. [developer.apple.com](https://developer.apple.com) → Profiles → + → App Store
2. 选 App ID `com.albertsun6.vessel`
3. 选 distribution certificate (或先生成一个：CSR → cert → download)
4. 命名 `Vessel App Store` → Generate → Download
5. 双击下载的 .mobileprovision 让 Xcode 接收

## 3. 本地 archive build

```bash
cd /Users/yongqian/Desktop/Vessel
xcodebuild archive \
  -project packages/ios-native/Vessel.xcodeproj \
  -scheme Vessel \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath /tmp/Vessel-$(date +%Y%m%d).xcarchive \
  -allowProvisioningUpdates
```

产物：`/tmp/Vessel-<date>.xcarchive` 目录。**Release** 配置很重要——Debug build 不能上 TestFlight。

## 4. Export .ipa

写 `/tmp/exportOptions.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>            <string>app-store</string>
  <key>teamID</key>            <string>V84XLAQ28F</string>
  <key>uploadSymbols</key>     <true/>
  <key>signingStyle</key>      <string>automatic</string>
</dict>
</plist>
```

然后：

```bash
xcodebuild -exportArchive \
  -archivePath /tmp/Vessel-$(date +%Y%m%d).xcarchive \
  -exportOptionsPlist /tmp/exportOptions.plist \
  -exportPath /tmp/Vessel-ipa
```

产物：`/tmp/Vessel-ipa/Vessel.ipa`

## 5. 上传到 App Store Connect

两种方法：

### 5a. xcrun altool (CLI)

```bash
xcrun altool --upload-app \
  -f /tmp/Vessel-ipa/Vessel.ipa \
  -t ios \
  --apiKey <YOUR_API_KEY_ID> \
  --apiIssuer <YOUR_ISSUER_ID>
```

需要先在 App Store Connect → 用户和访问 → 密钥 → + 创建一个 API 密钥并下载 .p8 文件，放 `~/.private_keys/AuthKey_<ID>.p8`。

### 5b. Transporter.app (GUI，最简)

1. Mac App Store 装 [Transporter](https://apps.apple.com/us/app/transporter/id1450874784)
2. 打开 → 登 Apple ID
3. 拖 `/tmp/Vessel-ipa/Vessel.ipa` 进去
4. 点 **交付**
5. 看进度 → "已成功交付"

## 6. App Store Connect 处理 + 提交 TestFlight

1. 等 **~5-15 分钟**，build 出现在 App Store Connect → 你的 App → **TestFlight** tab → iOS Builds
2. 第一次会有 **加密合规问题** 弹窗：点 build → 编辑加密信息 → 选「使用 Apple 提供的加密」或「未使用加密」(本 app 走 HTTPS / WSS 算豁免) → 保存
3. 状态变 **可邀请测试员**

## 7. 内测分发

### 7a. 内部测试 (即时，无 Apple 审核)

1. TestFlight tab → 内部测试 → + 添加群组（名字随意，如 "自己"）
2. + 测试员 → 输入你的 Apple ID
3. 选刚才的 build → 启用
4. 你的 iPhone 打开 [TestFlight app](https://apps.apple.com/us/app/testflight/id899247664)（首次需在 Mac App Store 装到 iPhone） → 接受邀请 → 装

### 7b. 外部测试 (需要 Apple 审核 ~1-3 天)

跳过——内部测试足够自己用。

## 8. 后续 build 更新

每次代码改后：

```bash
# 1. bump CURRENT_PROJECT_VERSION in packages/ios-native/project.yml (or via buildinfo.sh)
# 2. xcodegen + archive + export + upload
bash packages/ios-native/scripts/deploy.sh   # 本地装设备走这个；上 TestFlight 不走这个
```

TestFlight 推荐为新建一个 `scripts/testflight.sh` 包装上面的 archive + export + upload，但本 MVP 阶段先手动跑。

## 注意 / 已知坑

- **Build version 必须单调递增**: `CURRENT_PROJECT_VERSION` 每次 archive 必须 +1，否则 Transporter 拒收
- **加密合规第一次必填**: 漏了 build 上不去
- **App Store Connect 后台 vs Member Center**: 前者管 app records + TestFlight；后者管 certificates + provisioning profiles。两个网站，别混
- **Vessel 旧 build 51 的 claudeweb-native bundle id 在 TestFlight 上无效**: 那是 Personal Team 签的免费 dev build，跟 distribution 完全两条路径。卸了重装

## Claude 可以做的部分

代码 + xcodegen + archive + altool 命令都是 CLI。Claude 一旦你给 API key path 可以从「archive → export → 上传」端到端跑。但 **App Store Connect 网页 UI 操作 (创建 app record / 加密合规 / 邀请测试员)** 必须你来。

预估总时间：你侧 30-60 分钟（含等 Transporter 上传 + 等 5-15 分钟 build 出现）+ 苹果异步 0 分钟（内部测试无审核）。

---

文档维护：每次 Vessel iOS 走 TestFlight 流程发现坑就追加进「注意 / 已知坑」段。
