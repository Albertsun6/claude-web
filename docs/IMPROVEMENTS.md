# claude-web 改进建议

按优先级（P0 = 必须修，P1 = 强烈建议，P2 = 体验提升，P3 = 锦上添花）整理。
所有引用都带文件路径和行号，方便逐项对照。

---

## P0：安全（最重要）

### 1. 后端零认证 → Tailnet 之外任何地方泄漏都是裸奔

后端目前没有任何鉴权。当前依赖 Tailscale 私有网络做边界，但只要做了下面任何一件事就直接被打穿：

- 不小心把 `tailscale serve --bg` 改成了 `tailscale funnel`（funnel 是公网）
- 把 Cloudflare Tunnel 重新拉起来忘了加认证
- 在公共 wifi 下 Mac 没退 Tailscale，又开了 `--host` 监听 0.0.0.0
- 同 Tailnet 里再加入第二个人 / 别的设备被入侵

**最关键的提权点**：`packages/backend/src/routes/fs.ts:46` 的 `/api/fs/tree` 和 `:140` 的 `/api/fs/file` 接受**用户传入的 `root` 参数**，只校验"resolved 在 root 之下"——`root` 本身可以是 `/`。也就是说调用方可以列任何目录、读任何 ≤1MB 文件。`/api/git/*` 也是同理，`cwd` 是用户传的。

**建议**：

- 加最简单的共享密钥：环境变量 `CLAUDE_WEB_TOKEN`，HTTP 用 `Authorization: Bearer ...`，WS 用查询参数 `?token=...`，前端通过 `localStorage` 存。一次配置一辈子用。
- 加一个 `ALLOWED_ROOTS` 白名单（来自已保存的 projects 列表）：所有 `fs.ts`/`git.ts`/`sessions.ts` 入参都必须落在白名单内；非白名单一律 403。
- 后端默认只 bind 到 `127.0.0.1`，对外暴露走 Tailscale serve 反代，避免误绑 0.0.0.0。

涉及：
- `packages/backend/src/index.ts:30-38`（加 auth middleware）
- `packages/backend/src/routes/fs.ts:46,140`（root 白名单）
- `packages/backend/src/routes/git.ts:111,124,150,187`（cwd 白名单）
- `packages/backend/src/routes/sessions.ts:25,75`（cwd 白名单）

### 2. WebSocket 升级也没有 auth

`packages/backend/src/index.ts:133-139` 直接接受任何 `/ws` 连接，能随便发 `user_prompt` → 后端 spawn 你的 `claude` CLI 跑任意命令、用你的订阅。

修同上：升级时检查 `Authorization` 或 `?token=` 查询参数。

---

## P1：正确性 / 健壮性

### 3. 历史会话切换会触发 N 次 store 更新

`packages/frontend/src/components/SessionList.tsx:65-66`：

```ts
clearMessages(session.cwd);
for (const m of transcript) appendMessage(session.cwd, m);
```

每条历史消息一次 `set`，500 条消息就是 500 次 React 渲染。建议在 store 加一个 `replaceMessages(cwd, list)` 方法，一次替换。

涉及：
- `packages/frontend/src/store.ts:187-203`（加 `replaceMessages`）
- `packages/frontend/src/components/SessionList.tsx:65-66`

### 4. cli-runner 的 abort 没升级到 SIGKILL

`packages/backend/src/cli-runner.ts:69-72` 只发 SIGTERM。如果 CLI 卡在 hook fetch 上不响应，进程永远不退出。

建议：abort 后 5 秒还活着 → SIGKILL。

### 5. permission hook 单次请求没有超时

`packages/backend/src/routes/permission.ts:62-71`：hook script 发 POST 后 `await new Promise`，前端如果硬刷或断网，这个 Promise 永远不 resolve（只在 WS 关闭时 unregister 才一刀切 deny）。

建议：在 `entry.pending.set(requestId, { resolve })` 旁边加一个 `setTimeout(() => resolve("deny"), 600_000)`，跟 hook 的 timeout 对齐。否则 hook 进程会驻留十分钟。

### 6. 多次 resolvePermission 用线性扫描

`packages/backend/src/index.ts:164-170`：

```ts
if (msg.type === "permission_reply") {
  for (const handle of runs.values()) {
    resolvePermission(handle.permissionToken, msg.requestId, msg.decision);
  }
}
```

把所有 run 都扫一遍。requestId 是 UUID 不会冲突所以**功能正确**，但 `permission_reply` 应该带上 `runId`，O(1) 找到对应 token。

涉及：
- `packages/shared/src/protocol.ts`（给 `permission_reply` 加 runId 字段）
- `packages/backend/src/index.ts:164`
- `packages/frontend/src/ws-client.ts:159`

### 7. stale-session 重试时已经发出的 assistant 文本没有清理

`packages/backend/src/cli-runner.ts:127-147`：第一次 `runOnce` 失败前可能已经流过 system:init，前端已经 append 了；第二次重试又会发新的 system:init。前端会看到两条 init 紧挨着。

建议：runOnce 第一次失败时通知前端 `clear_run_messages` 类的事件，前端把这一 runId 的消息抹掉再开始。或者：第一次跑只在能拿到 system:init 之后才把消息推给前端。

### 8. 语音 TTS 错误被吞

`packages/backend/src/routes/voice.ts:191-193`：

```ts
}).catch((err) => {
  return null as Buffer | null;
});
```

err 直接丢了，前端只能拿到 500 + `tts failed`。把 err.message 写进响应或至少 `console.warn`。

### 9. 大量历史会话 list 性能

`packages/backend/src/routes/sessions.ts:38-66`：每次 list 把目录里**所有** jsonl 都读 60KB 拿 preview。50+ 会话就慢了。
建议：缓存 (mtime, sessionId, preview) → `Map<cwd, {mtime, list}>`，重新读盘前先 `readdir + stat`，只对 mtime 变了的文件重读 preview。

### 10. 没有自动化测试

`packages/backend/src/test-*.ts` 是手工跑的脚本。critical path（cli-runner、permission、sessions 解析）至少应该有 vitest 单测：

- cli-runner 用 `child_process.spawn` 替换为 mock，验证 stale-session 重试
- sessions/transcript 喂一行 JSONL 验证归一化
- permission 协议 fence post（hook 在 abort/disconnect 下不 hang）

---

## P2：体验

### 11. 没有删除已保存项目的 UI

`packages/frontend/src/store.ts:145-152` 有 `removeProject`，但 ProjectPicker 里没暴露。手机 PWA 里改 localStorage 麻烦，建议在 ProjectPicker 项目项右侧加垃圾桶按钮（参考 ProjectTabs 的 `proj-tab-close` 样式）。

### 12. PermissionModal 没有"本轮总是允许"选项

每次 Edit/Bash 都要手点。建议加 "always allow {toolName} for this run" 复选框，把允许的 tool 在前端 Map<runId, Set<toolName>> 里记录，下次同 runId + 同 tool 自动 reply。这是体验最大头。

涉及：`packages/frontend/src/components/PermissionModal.tsx` + `packages/frontend/src/ws-client.ts`

### 13. 代码块没有"复制"按钮

`MessageItem.tsx:42` 用 ReactMarkdown + rehypeHighlight，`<pre>` 没有 copy button。手机上长按选中很难。
建议：写一个 `<CodeBlock>` 组件传给 ReactMarkdown 的 `components.code`，hover/tap 显示复制图标。

### 14. 长消息没有截断 / 折叠

`tool_payload` 整段 JSON.stringify 全量展示，文件读取动辄上万行。建议长内容默认折叠（前 20 行 + 展开按钮）。

涉及：`packages/frontend/src/components/MessageItem.tsx:55,90`

### 15. 输入框没有快捷指令 / 历史回溯

InputBox 完全是个 textarea。建议：

- ↑ 调出最近 5 条 `_user_input`
- `/` 触发常用命令补全（`/compact`, `/clear`, `/files`...）
- ⌘+Enter 发送（已有？检查一下）

### 16. 历史会话面板默认折叠

`packages/frontend/src/components/SessionList.tsx:78-83` 默认 `open=false`。手机上多一次点击。建议：`useState(true)` + 持久化到 localStorage（`claude-web:session-list-open`）。

### 17. Git Panel 没用 CodeMirror merge view

Phase 5 计划写了 merge view，目前看 `GitDiff.tsx` 应该还是 plain text。@codemirror/merge 包没装。如果想做：`pnpm add @codemirror/merge` + 简单封装。

### 18. iOS PWA 启动慢（用户提过 ≈1 分钟）

主要原因猜测：

1. 服务端首次响应慢（tsx watch 冷启动）
2. dist 单一连接拉所有 chunks
3. iOS PWA standalone 模式下没有 SW 缓存壳子（你 selfDestroying 了）

建议：
- 后端预编译（`tsx --no-warnings` 替换为 `pnpm build && node dist/index.js`），冷启动从秒级到亚秒
- index.html 里手动 `<link rel="modulepreload">` 关键 chunks（react-vendor、index-*.js）
- 重新评估"selfDestroying"：现在 SW 主动注销是为了解决黑屏 bug，但代价是 PWA 没有任何离线壳。可以考虑只缓存 `index.html` + 关键 css/js 的极简 SW（不缓存 API），保留 self-update 能力。

### 19. VoiceBar interim transcript 没有真正固定布局

之前修过按钮位置，但 interim 文字溢出窄屏侧边栏的反馈仍可能存在。看 `voice.css` 是否给 `.voice-interim` 限制了 `max-width: 100%; overflow: hidden; text-overflow: ellipsis`。

---

## P3：架构 / 可维护性

### 20. 没有 CLAUDE.md / AGENTS.md

未来在这个仓库里再开 Claude 会话，每次都要重新摸清架构。写一份精炼的：

- 目录映射（packages/backend、packages/frontend、packages/shared）
- 后端一切都是 spawn `claude` 子进程，**不要用 SDK**（这是最容易被新会话搞错的）
- 权限走 PreToolUse hook + per-run token，hook 脚本路径
- 启动方式（launchd plist 路径，端口 3030）
- HTTPS 走 `tailscale serve`，PWA 不缓存（selfDestroying）

### 21. realtime 路由是 stub

`packages/backend/src/routes/realtime.ts` 永远返回 501。如果不打算做 OpenAI Realtime，删掉路由和前端的 fallback 检测；要做就加 `OPENAI_API_KEY` 环境变量 + `client_secrets` 端点。空 stub 让代码看起来比实际功能多。

### 22. 前端 raw 消息全是 `any`

`MessageItem.tsx`、`store.ts`、`ws-client.ts` 都把 SDK 消息当 `any`。`@claude-web/shared` 已经有 `ClientMessage`/`ServerMessage`，但 SDK 内层（`type:"assistant"` 那个 envelope）没建模。
建议：在 shared 里加 `SdkMessage` discriminated union（system / assistant / user / result + 各自 content block 类型），渲染层就能拿到编译期保证。

### 23. launchd 日志没有轮转

`StandardOutPath`/`StandardErrorPath` 一直 append。半年后几个 GB。建议改成 `newsyslog.d` 配置或者用 `--rotating-file` 之类。

### 24. 没有 `/api/health` 的真实健康检查

`packages/backend/src/index.ts:32` 现在是 `c.json({ ok: true })` 永远 true。建议返回：

- claude CLI 是否可执行（`which claude`）
- 上次成功 spawn 的时间戳
- `tasks: runs.size` 当前活跃任务数

监控/客户端能据此显示真正的健康状态。

---

## 推荐优先级排序（如果只做 5 件事）

1. **#1 加共享 token + ALLOWED_ROOTS 白名单**（一次性投入 30 分钟，永久不踩坑）
2. **#3 SessionList 批量替换消息**（用户已经踩过坑了）
3. **#12 Permission 模态加"本轮自动允许"**（每次会话省几十次点击）
4. **#5 Permission hook 单请求超时**（避免僵尸 hook 进程）
5. **#20 写 CLAUDE.md**（让未来的会话不踩同样的坑）

剩下的可以按需推进。

---

最后一条建议：把这份文档同步到 `docs/IMPROVEMENTS.md`，下次开新会话时让 Claude `Read` 这个文件，可以直接照着这个清单做事，不用每次都重新评估。
