# M2-iOS-α — Closeout (vessel-risk-officer lens)
Date: 2026-05-10-2200

## Findings

### PASS: dataDir 泄漏修复
M1A-α 时 /api/vessel/health 返回 `dataDir: DATA_DIR` —— 这是绝对路径
`/Users/<owner>/.vessel`，泄漏 owner 用户名。M2-iOS-α 必须做 LAN 暴露，
当时的设计直接不安全。已删除。

回归测试 grep 验证响应不含 `/Users/`。✅

### PASS: /health 是无 auth 故意设计
NWBrowser 自动发现 + 手填 IP 探活 都需要无 auth probe（iOS app 启动还没
拿到 token 时也要能判断"是 Vessel"）。
公开数据集：service / version / hostname / uptimeSec / sessions/runs counts
/ bonjour spec / soul.name。其中 sessions/runs counts 算"内部状态泄漏"
但极轻微（数字，无可识别内容）。soul.name 与 mDNS instanceName 同级公开。

### MINOR-1: hostname 同样在 mDNS instanceName 与 /health 里出现
默认 instanceName = `Vessel-<hostname-prefix>`，/health.hostname = full hostname。
两者拼凑能拿到完整主机名。在 LAN 场景这本来就是公开信息（dns-sd / mDNS 协
议设计），不是新泄漏；但配合其他 fingerprint 可能加速识别。
**Mitigation**: 操作员关心匿名性可设 VESSEL_DISABLE_MDNS=1 + 自定义
instanceName 后续支持。
**Verdict**: MINOR — defer / 文档说明。

### PASS: 子进程权限隔离
spawn dns-sd 不传 detached=true → 子进程沿用父进程 user/group。无提权。
stdio 'ignore'/'pipe'/'pipe' → 不让 dns-sd 读父 stdin。

### PASS: 没有命令注入
`spawn('dns-sd', ['-R', instanceName, ...], ...)` — 数组形式，shell 不参
与。即使 instanceName 通过 hostname() 来自系统调用，shell metachar 也无法
利用。

### MINOR-2: instanceName 从 hostname 派生，无字符校验
defaultInstanceName 用 `replace(/[^A-Za-z0-9-]/g, '')` 已经做了 strip，但
没有长度上限。极端情况下 hostname 极长会被传给 dns-sd。dns-sd 会拒绝（有
自身限制），所以攻击面非常窄。
**Verdict**: MINOR — accepted-as-is.

### PASS: shutdown 路径包含 mDNS publisher
SIGTERM/SIGINT 处理 mcp + cleanup mcp config + stop mdns + http server。
crash exit (SIGKILL / panic) 不调用 — 但 dns-sd 子进程在父进程消失后
会被 launchd 收 reap，最终也没有持久副作用。

### INFO: VESSEL_DISABLE_MDNS=1 提供了"网络静默"opt-out
对在 hostile WiFi 上不想暴露存在的 operator 是必要的，符合"个人单机隐私
优先"硬约束。

## Verdict: PASS — 2 MINOR (deferred / accepted-as-is)
