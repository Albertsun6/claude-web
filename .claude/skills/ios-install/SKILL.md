# iOS App Install Skill

快速构建并安装 Seaidea app 到 iOS 设备（真机或模拟器）。

## Usage

```
/ios-install [device-name]
```

**参数：**
- `device-name` (可选) — 目标设备名，如 "iPhone 17 Pro Max" 或 "Albert's iPhone"
- 不指定时自动检测并列出可用设备供选择

## Features

✅ 自动检测可用的模拟器和已连接的真机
✅ 快速构建最新版本（Debug 配置）
✅ 支持真机和模拟器安装
✅ 自动启动 app
✅ 清晰的设备列表和进度提示

## 工作流

### 模拟器安装

```bash
/ios-install "iPhone 17 Pro Max"
```

### 真机安装

```bash
/ios-install "Albert's iPhone"
```

### 交互式选择

```bash
/ios-install
```

## 实现细节

1. **检测设备** — 列出所有模拟器和已连接真机
2. **构建应用** — xcodebuild Debug 配置
3. **安装应用** — 自动选择合适的安装方式（模拟器或真机）
4. **启动应用** — 自动启动并显示进度

## Bundle ID & Display Name

- **Bundle ID**: `com.albertsun6.claudeweb-native`
- **Display Name**: **Seaidea**

## Notes

- 真机首次安装需要在 Xcode 中信任开发者证书
- 推荐用 Worktree 隔离并行开发
