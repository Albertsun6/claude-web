# L1-minimal lessons closeout — Phase 1 / vessel-risk-officer

- **Date**: 2026-05-10 05:00
- **Reviewer**: vessel-risk-officer (Phase 1)
- **Lens**: secrets / 攻击面 / 数据暴露 / DoS — 重点 free-form lesson body 持久化的 redact
- **Artifacts**:
  - `packages/backend/src/observability/redact-helpers.ts` (redactFreeformText)
  - `packages/backend/src/memory/lesson-store.ts` (生成层 redact ✓)
  - `packages/backend/src/routes/vessel-intent.ts:137-177` (HTTP `/api/vessel/lessons`)
  - `packages/backend/src/cli/vessel-core.ts:225-270` (closeout finalize)
  - `scripts/import-debate-log.ts` (一次性导入 137 verdict)

---

## TL;DR — Verdict 矩阵

| # | Severity | Title | 触发器 |
|---|---|---|---|
| **R-L1-1** | **BLOCKER** | `appendFileSync(reportPath, ...)` 无路径校验 + 跟随 symlink → CLI 被构造路径越界写文件 / 通过 symlink 改任意可写文件 | #5 secrets / #8 数据破坏 |
| **R-L1-2** | **MAJOR** | HTTP `tags`/`refs` 字段无长度/数量校验 → DB row 无界膨胀，可绕过 32K body cap，将 memory.db 写满磁盘 | DoS / 资源争用 |
| **R-L1-3** | **MAJOR** | 截断 secret 不被覆盖（< 20 字符 token / Slack `xoxb-` 前缀本身被剪掉时 / `sk-ant-` 前缀被剪到 `sk-`+短串）；用户贴 secret 截图旁边的"开头几位"会逃过 redact | #5 secrets |
| **R-L1-4** | **MAJOR** | `importance` 字段无应用层 validate；攻击者传 `999` / `-50` / `"high"` / `0.5` → SQL CHECK 抛 SQLITE_CONSTRAINT 转 500，**没有 try/catch** 直接传给 Hono → 错误信息含 SQL 语句片段；`0.5` 还可能因 SQLite numeric affinity 绕过 CHECK | API hygiene / 信息泄露 |
| **R-L1-5** | **MAJOR** | 一次性 import 137 verdict 进 lessons.body — verdict markdown 内含 Eva 期 sensitive 业务路径与代码片段；redact 只跑 PATTERN_RULES 不跑 path-blacklist，**Eva 业务私有路径（如 `/Users/yongqian/Desktop/claude-web/`）在 PATH_WHITELIST 里**，导致全文搬运后这些 Eva 路径明文进 memory.db 长期持久化 → 数据生命周期从 git history 短期延展到 SQLite 长期 | #5 secrets / 数据生命周期 |
| **R-L1-6** | MAJOR | `redactFreeformText` 不覆盖 `%HOME%` / `%USERPROFILE%` / `~bob`（user-named home shorthand） / 相对路径 `./.env` — 跨平台/Windows 风格泄露兜底缺位 | #5 secrets |
| **R-L1-7** | MINOR | 无 rate-limit / write-throttle on `/api/vessel/lessons` POST；持有 token 的客户端可循环 32K POST 写满 memory.db；M0 `/api/vessel/intent` 已有 fork-bomb 防御注释，但 lessons 写入路径无类似考虑 | DoS |
| **R-L1-8** | MINOR | `redactFreeformText` 通用 20+ char token 规则误命中合法 base64 内容（如 SSH key 整行）将整行替换为单 hash → 良性副作用，但读 lesson 时丢失大量上下文 | 可读性 |
| **R-L1-9** | MINOR | `MAX_BODY_BYTES`(64K bytes) vs `MAX_TEXT_CHARS`(32K chars) UTF-8 不对称：CJK 输入 32K 字符 ≈ 96K 字节，被 content-length 头先 413 拒掉；但攻击者可以**不送 content-length** 让 Hono 读完整 body — 取决于 Hono 内部是否有兜底 | DoS |
| **R-L1-10** | MINOR | import script 用 `searchLessons({ tag: fp })` LIKE 子串匹配做 dedup — 16 字符 fp 互不冲突概率极小，但前缀冲突在理论上存在；`import_fingerprint` UNIQUE INDEX 才是真兜底，但 dedup 路径走 tag column 而不是 import_fingerprint column | 数据完整性 |

---

## BLOCKER

### R-L1-1：closeout finalize 用户控制路径无验证 → 写文件越界 + symlink follow

**位置**：[`vessel-core.ts:259-265`](../../packages/backend/src/cli/vessel-core.ts#L259)

```ts
if (reportPath && existsSync(reportPath)) {
  try {
    appendFileSync(reportPath, `\n\nlesson_id: ${row.id}\n`);
  } catch { ... }
}
```

**实证**（在 `/tmp/vessel-traversal-test` 做的 PoC 已 reproduce）：
- `--report=docs/../../etc/passwd-mock` 被 `existsSync` 接受 + `appendFileSync` 跟着写
- `--report=docs/symlink.md`（symlink 指向 repo 外）→ append 写到 symlink target，根本没回到 docs/

**为什么是 BLOCKER 而非 MAJOR**：
- closeout finalize 是"原子生成层"的核心入口（cursor B1 + architect M-2 三审一致），却把"path 用户随便给"作默认行为
- 与 `auth.ts:120` `verifyAllowedPath` 形成本地 inconsistency — Eva fs/git/sessions 严格走 allowlist，本 CLI 不走
- 即使是 single-user，下一阶段评审导向（M3+ 多 agent / cursor-agent runner）不再保证调用方被信任；现在不收紧，未来要做 RCE-style 加固

**Fix**：
1. 禁 path traversal: `path.resolve(reportPath)` 后必须 `startsWith(REPO_ROOT)` 或在 `VESSEL_ALLOWED_ROOTS` 之内
2. 拒绝 symlink: `lstatSync(reportPath).isSymbolicLink() → throw`
3. 限 extension: only `.md` allowed
4. 与 HTTP `/api/vessel/lessons` 不一样的是 CLI **没有 token 门**，本机任何 process 都能跑 → fix 不能省

---

## MAJOR

### R-L1-2：tags/refs 字段无界 → memory.db 膨胀绕过 body cap

**位置**：[`vessel-intent.ts:150-177`](../../packages/backend/src/routes/vessel-intent.ts#L150)

body cap 32K chars + title 1K chars 已 enforce，但：
- `tags?: string[]` — 数组长度 + 元素长度都没 cap
- `refs?: string[]` — 同上
- `addLesson` 把 `tags.join(',')` 直接 INSERT 进 TEXT 列，10000 个 100-char tag = ~1MB 一行

**实证**：probe 数组 join 长度 = 1009999 chars，无任何拒绝。

**触发器**：DoS / 资源争用。一个持 token 的客户端循环 POST，每次 ~1MB tags，单次会话即可写入 GB 级 memory.db；FTS5 索引相应膨胀。M0 review 给 `/api/vessel/intent` 加了 fork-bomb 防御，本路由没复用同一思路。

**Fix**：
- `tags.length ≤ 32`，每个元素 `≤ 64` chars
- `refs.length ≤ 32`，每个元素 `≤ 256` chars
- 总 `JSON.stringify(body).length ≤ MAX_BODY_BYTES` 在 parse 后再检一次（content-length 头不可信，可被 chunked 编码绕过）

---

### R-L1-3：截断 / 大写 / 短 token secret 不被覆盖

PoC 输入 → 输出（已实跑）：

| 输入 | 输出 | 状态 |
|---|---|---|
| `sk-ant-shortdead12` (18 字符 body) | unchanged | **未 redact** |
| `password=short123token456` (17 字符) | unchanged | **未 redact** |
| `short19charactertok` (19 字符) | unchanged | **未 redact** |
| `~bob/.ssh/id_rsa` (named user home) | unchanged | **未 redact** |
| `./env file` 相对路径 | unchanged | **未 redact** |
| `192.168.1.1` IPv4 | unchanged | 视情况；可接受但应记录 |
| `Authorization: Bearer eyJxxx....SignatureBlobHere` (JWT 中段) | 仅 header 段 redact，**signature 残留 16 字符明文** | **部分 redact 不够** |

**核心问题**：cursor B2 catch 的"home shorthand 不全"在第 11 次评审已修，但 PATTERN_RULES 的"≥20 字符"门槛是写规格时为减少误报选的。**用户在 retrospective 中复述 secret 时下意识只写"开头几位"** —"我的 sk-ant 开头是 sk-ant-shortdead..."—这种语义恰好落在 ≥20 cap 之下。

**Fix**：
- 加专项 rule：`sk-ant-[A-Za-z0-9_-]+` (无下限) — 这个前缀一旦出现就高度怀疑
- 加专项 rule：`xoxb-` / `xoxp-` (Slack) / `ghp_` / `github_pat_` / `gho_` (GitHub) — known prefix 直接 mask 后续 ≥10 chars
- 加专项 rule：`(postgres|mysql|mongodb)://[^@\s]+:[^@\s]+@` 整段 mask（已部分覆盖 password 但 user 也常含 PII）
- JWT 三段：从 `eyJ` 开始的 base64 分段全 mask，不只 header

测试矩阵补充覆盖以上 case（test-lessons.ts 现 6 case 太少）。

---

### R-L1-4：importance 无 validate + addLesson 抛错无 try/catch

**位置**：[`vessel-intent.ts:167-176`](../../packages/backend/src/routes/vessel-intent.ts#L167)

```ts
const row = addLesson({
  ...
  importance: body.importance,    // user 控制，无 validate
});
return c.json({ lesson: row }, 201);
```

`importance: 999` → `INSERT ... CHECK (importance BETWEEN 1 AND 5)` fail → `better-sqlite3` 抛 `Error: CHECK constraint failed` 一路冒到 Hono → 返回 500 + 错误信息可能含 SQL 片段。

测试矩阵也未 cover invalid importance。

**Fix**：
```ts
if (body.importance != null) {
  if (typeof body.importance !== 'number' || !Number.isInteger(body.importance) ||
      body.importance < 1 || body.importance > 5) {
    return c.json({ error: 'importance must be integer 1..5' }, 400);
  }
}
```

同时 `addLesson` 包 `try/catch`，DB error 转 statusCode 500 但 body 只回 `{ error: 'db error' }` 不泄 SQL。

---

### R-L1-5：import 137 verdict 把 Eva 期业务路径搬进 memory.db 长期持久化

**位置**：[`scripts/import-debate-log.ts:142-173`](../../scripts/import-debate-log.ts#L142) + [`redact-helpers.ts:22-27`](../../packages/backend/src/observability/redact-helpers.ts#L22)

PATH_WHITELIST 包含 `/Users/yongqian/Desktop/claude-web/` — 即 Eva 期项目根。这是**有意保留**（防 Vessel 文档里的合法 Eva 路径被 mask），但副作用是：

- 137 verdict markdown 中含 Eva 业务文件路径（如 `packages/backend/src/routes/voice.ts`、`/Users/yongqian/Desktop/claude-web/packages/...`）
- 这些路径**不被 redact**（whitelist 命中），全文搬到 lessons.body
- memory.db 的数据生命周期 = 用户磁盘 — 比 git history 长得多；用户日后想 forget Eva 不能再"重命名 repo + git filter-repo"
- 真实代码片段 / 业务逻辑描述（含未来商业化时不希望泄露的部分）也全文进 DB

**Fix**：
- import script 加 `--exclude-eva-paths` 默认行为：跑前 `text.replace(/\/Users\/yongqian\/Desktop\/claude-web\/[^\s]*/g, '$EVA_PATH/...')`
- 或者 `firstParagraph.slice(0, 800)` 缩到 200，仅留摘要不留代码
- 提供 `vessel-core lesson rebuild-from-refs` 后续命令，DB 只存 hash + ref，body 重新从 git 读 — 这与 cursor M3 提的"refs-driven minimal body"一致，目前 metadata-only verdict 用 `(metadata-only; see refs_json)` placeholder，但完整 verdict 没走这条路

**为什么是 MAJOR 而非 MINOR**：cursor 历次评审反复强调"redact 必须放生成层"，import script 是 **生成层入口之一**（不是消费层），但它的 redact 等于"借用" lesson-store 的 PATTERN_RULES 不补 path-redact，等于在生成层留了配置层 bypass。

---

## MINOR — 不展开，速记 fix 方向

- **R-L1-6**：`redactFreeformText` 加 `%HOME%/...`、`%USERPROFILE%\\...`、`~[a-zA-Z0-9_-]+/.*`（named home）、相对 dotfile 路径 `\.\.?/(\.\w+/)*` rules
- **R-L1-7**：在 `vesselRouter` 加 sliding-window rate-limit middleware（`/api/vessel/lessons` POST 单 token 60/min）
- **R-L1-8**：generic-token rule 命中 base64 大块时仅 mask 前 20 chars + `...` 而非整段 hash —保留可读上下文
- **R-L1-9**：parsed JSON 后再做一次 `JSON.stringify(body).length` cap 检查
- **R-L1-10**：dedup 走 `db.prepare('SELECT id FROM lessons WHERE import_fingerprint = ?')` 直查，不走 tag LIKE

---

## 基于 cursor 11 次 BLOCKER catch 的"本次最可能漏看"

cursor 11 轮的命中模式（速归纳）：
- M0.5 找 `.input` subtree force-mask bypass
- M1A-α 找 `claude-code stream-json` schema 漏字段
- M1A-β 找"消费层 fix vs 生成层 fix" 反模式
- L1-retro 找 closeout writer 入口缺失 + redactRetroBody 规格不全 + table name 与 harness.db 冲突

**共性**：cursor 极擅长**"声称的不变量在调用链某节点没真正 enforce"** 类型的疏漏（spec drift / 入口空缺 / 名字空间冲突 / consumer-vs-generator confusion）。

**本次最可能 cursor 也会抓但 architect / pragmatist 已收敛之外的死角**：

> 🎯 **import script + closeout finalize 之间的"生成层入口数量"不一致**：M1A-β 教训说"redact 必须 single source of truth in generation layer"，但 L1 实际有 **三个生成层入口**（HTTP POST、CLI lesson add、CLI closeout finalize、import script），它们都依赖 `addLesson` 来调 `redactFreeformText`，**但** import script 把 `firstParagraph` 截断后才进 addLesson — 截断本身不算 redact，截断后的"前 800 字符"如果横跨一个 sk-ant 中段，会进 DB 的是**截到一半的 secret 字符串**（`sk-ant-shortdead...` 这种），而 redactFreeformText 看到 < 20 字符 body 不 mask（见 R-L1-3），导致截断 + redact 两步联动后**仍然漏**。

简言之：**截断与 redact 顺序在 import script 里反了**。正确顺序：先 `redactFreeformText(content)` → 再 `slice(0, 800)`，不能先 slice 再 redact。

📍 [`scripts/import-debate-log.ts:144-147`](../../scripts/import-debate-log.ts#L144) — `firstParagraph` 是 raw content slice，**没经过 `redactFreeformText`**，再被传 `addLesson({ body })`。`addLesson` 内调 `redactFreeformText(safeBody)` 看到的就是已截断的字符串。这是**第 11 次 cursor catch 的同型 bug — 入口存在、规则存在、但调用顺序导致语义不达**。

---

## Verdict

- **BLOCKER**: 1（path traversal / symlink follow）
- **MAJOR**: 5（tags/refs 无界 / 截断 secret 不覆盖 / importance 无 validate / Eva 路径长期持久化 / 跨平台 home shorthand）
- **MINOR**: 5

**结论**: ❌ **NOT-YET-PASS** — R-L1-1 (path 写入越界) 与 R-L1-3 (截断 secret 不覆盖) 都是 single-user 也立即可踩的；R-L1-5 (Eva 路径搬入 long-term store) 是不可逆数据决策。Phase 2 react 建议聚焦 R-L1-3 与"截断+redact 顺序" — 这是本轮**最可能 cursor 一抓就中、其他 reviewer 没看到**的 generation-layer ordering bug。
