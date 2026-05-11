# M2-Soul — Closeout Review (vessel-pragmatist lens)
Date: 2026-05-10-2030

## Findings

### PASS: 没有引入新依赖
parser 用了 `yaml` package —— 已经在 backend/package.json 里（M0 期就加过）。
没有 `gray-matter` / `front-matter` 这种额外依赖。FRONTMATTER_RE 是 30 字符
正则，直接抓 `---\n...\n---\n<body>` —— 简单可读。

### PASS: 范围克制
- parser.ts ~165 行（多数是字段类型校验，无可绕过）
- injector.ts ~50 行
- cli-runner.ts +12 行（一个 try/catch + push 两个 args）
- vessel-core.ts +4 函数（cmdInit / cmdSoulShowPrompt / cmdSoulListTemplates / templatesSoulDir helper）
- 3 个模板 .md
- 1 个 e2e 测试文件

总计 < 500 行实现 + 测试。无 over-engineering。

### PASS: 强制 "≥ 1 字段已编辑" 用 byte-equality 实现
不需要 hash / 字段对比 / placeholder 标记。直接读两边文件做字符串相等比较，
穷举仓库里所有模板。简单到不会出错。**用户改一个字符就通过。**

### PASS: vessel init / soul show-prompt 是真的 CLI subcommand
不是新二进制，复用 vessel-core 入口。dispatch 多两条 if。consistent with
lesson / workflow 子命令格式。

### MINOR-1: cmdInit 有 5+ side effects 没有 `--dry-run`
现在 cmdInit 直接写盘 + 校验 + 报错。如果用户想"先看会做什么"没有办法。
对个人单机操作可接受（操作可逆 —— rm soul.md 重来）。
**Verdict**: MINOR — accepted-as-is.

### MINOR-2: 模板 fixtures 在测试里硬编码 'TEMPLATE_JARVIS' 字符串
test-soul.ts Test 6 里把 `TEMPLATE_JARVIS` 替换成 `EVA-Test`。这绑定到
jarvis-style.soul.md 的具体 name 字段值。如果未来改了 name，测试会失败。
不严重，重命名时一起改即可。
**Verdict**: MINOR — accepted-as-is.

### INFO: --append-system-prompt 是字符串而非文件路径
意味着每次 spawn Claude CLI 都会把整个 soul prompt 字符串作为命令行参数传
入。Linux/Mac ARG_MAX 通常 ~256KB —— soul.md 远小于这个。但极端情况
（用户把整本日记塞进 body）可能炸。可考虑改用 --append-system-prompt-file
（写临时文件）。
**Verdict**: INFO — 当前 soul.md 一般 < 4KB，先不优化。

## Verdict: PASS — 2 MINOR (accepted-as-is)
