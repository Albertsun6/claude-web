# M2-Soul — Closeout Review (vessel-risk-officer lens)
Date: 2026-05-10-2030

## Findings

### PASS: soul.md 文件权限 0o600
cmdInit 在 writeFileSync 时显式 `mode: 0o600`。soul.md 含个人 persona /
偏好 / 自由文本 body —— 可能含 PII。owner-only 是正确选择。

### PASS: Soul 内容不进 trace / 不进 logs
parser 解析后的 SoulSpec 仅在内存中传递给 injector，结果作为 CLI 命令行
参数（`--append-system-prompt`）传给 Claude CLI。不写 stdout / stderr /
trace event / SQLite。Soul 内容不会泄漏到观测层。

trace.ts 里 payload 字段已强制 4KB 上限 + 脱敏，跟 Soul 注入路径无交集。

### PASS: SoulParseError 不暴露文件内容
parser 抛出错误时只说"missing frontmatter" / "invalid YAML: <yaml-lib msg>"
等结构性诊断，不泄漏实际字段内容到 stderr。stack trace 也不带源文件内容。

### MINOR-1: --append-system-prompt 把 Soul 字符串写到进程命令行
传到 Claude CLI 的方式是命令行参数 —— 在 `ps aux` 输出可见。同 user 的
其他进程能 `ps -ef` 读到。在个人单机场景影响有限（通常只有 owner 自己的
进程）；但 Soul 含敏感心理学描写时会被 ps 看到。
**Risk**: Low for 个人单机。
**Mitigation**: 未来可改 --append-system-prompt-file（写 mode 0o600 临时文件）。
**Verdict**: MINOR — defer.

### PASS: cmdInit 没有路径遍历漏洞
templateName 用作文件名 join: `join(templatesSoulDir(), \`${templateName}.soul.md\`)`。
如果用户传 `--template=../../etc/passwd`，join 解析后会得到一个非
templates/soul/ 内的路径，但 existsSync 会检查 `.soul.md` 后缀的文件是否
存在 —— `.soul.md` 后缀防止 nominal 利用（除非用户精心构造 `.soul.md`
软链）。

更稳的做法是把 templateName 限定为 [a-z0-9_-]+ 字符集。但目前不存在公网
攻击面，operator 自己输入 —— 接受。
**Verdict**: 不是当前威胁模型下的漏洞，记一笔留意。

### PASS: 解析失败 fail-loud
parser 抛 SoulParseError 而不是 silent 返回 partial spec —— 用户能立刻看到
soul.md 写错了在哪行，而不是 Claude CLI 莫名其妙不带 persona。

cli-runner 的 catch 是 fail-soft（warn + 跳过注入），是正确的"工程能力
不能因为人格失败而全挂"的取舍。

### INFO: 模板 vs 实际 soul.md 内容是否泄漏
templates/soul/*.soul.md 是公共仓库内容（jarvis/friday 模板都会进 git
仓库）。如果用户基于 blank.soul.md 编辑了真实 persona 然后忘了把
soul.md 加进 .gitignore，可能 leak。

instance/ 目录在 plan 里要求顶层 .gitignore，但目前 vessel 仓库没有
instance/ —— soul.md 写到 ~/.vessel/soul.md（DATA_DIR），根本不在仓库里。
所以这个 leak 路径不成立。

## Verdict: PASS — 1 MINOR (deferred)
