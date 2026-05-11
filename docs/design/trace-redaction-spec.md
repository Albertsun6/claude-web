# Trace Redaction Spec（0A FRAMEWORK 前置笔记）

> **状态**：0A FRAMEWORK.md 写作时**直接搬入 Trace 协议章节**；不单独 ADR（owner 决定：先放 FRAMEWORK，复杂时再补 ADR-017）。
>
> **Resolves**: [v5.4 dogfood escalation E3 / B-R3](../../instance/inbox/2026-05-09-2140-dogfood-escalations.md)
>
> **触发器**：4 类硬触发 #5 secrets / 数据隐私

---

## 背景

CC CLI 子进程输出常含：
- 用户 prompt 全文（个人想法 / 私人信息）
- 文件绝对路径（`~/private/...`）
- API key（如果用户在 prompt 里贴了）
- API responses（含敏感内容）

Trace 归档到 `instance/traces/<trace_id>/` 长期保存——若用户分享某次 trace 给开发者排查 bug，secrets 会跟着流出。**0A FRAMEWORK 必须强制脱敏**。

---

## 1. Trace `payload` 字段约束（FRAMEWORK 必落）

OpenTelemetry-lite 12 字段中的 `payload` 字段必须满足：

| 约束 | 规则 |
|---|---|
| 类型 | JSON-only（不是任意 string） |
| 大小 | ≤ 4 KiB；超出切到 `artifact_refs`（指向 `instance/traces/<trace_id>/<span_id>.stdout`） |
| 编码 | UTF-8 |
| 强类型 | 推荐 Zod schema 校验（`packages/shared/src/protocol.ts` 加 `TracePayload` 类型）|

---

## 2. 白名单字段（永远明文）

无论何时，下列字段**不脱敏**：

```
trace_id / span_id / parent_span_id
event_type / component / status
timestamp / duration_ms
session_id / run_id
```

这些字段无敏感信息（都是 UUID / 枚举 / 时间戳），日志、trace replay、debug 都需要明文。

---

## 3. 黑名单匹配（必脱敏，遮蔽为 `***`）

### 3a. 字段路径黑名单（按路径精确匹配）

```yaml
- payload.user_prompt          # 用户原始 prompt 文本
- payload.cli_args.path        # CLI 路径参数（除非在 4. 路径白名单）
- payload.api_response.body    # 外部 API 响应正文
- payload.env.*                # 环境变量（除非显式 allowlist）
- payload.headers.authorization
- payload.headers.cookie
- payload.headers["x-api-key"]
```

### 3b. 内容模式匹配（任何字段值匹配则脱敏）

正则匹配以下模式，匹配段替换为 `***-redacted-<hash6>***`：

```regex
# Token-like 字符串（20+ 字符的 base64-ish）
[A-Za-z0-9_-]{20,}

# OpenAI / Anthropic API key 形态
sk-[A-Za-z0-9]{20,}
sk-ant-[A-Za-z0-9_-]{40,}

# AWS access key
AKIA[0-9A-Z]{16}

# 用户绝对路径（除非在路径白名单）
/Users/[^/\s]+/(?!Desktop/Vessel/|Desktop/claude-web/)

# Email
[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}
```

> `<hash6>` = 原文 sha256 前 6 字符，用来在 trace replay 时识别同一 token 多次出现时是同一个（不暴露明文）。

---

## 4. 路径白名单（可明文，例外于 3b）

下列路径下的绝对路径**不脱敏**（用于 trace 调试 / artifact 链接）：

```
/Users/yongqian/Desktop/Vessel/
/Users/yongqian/Desktop/claude-web/   # Eva 旧仓库
/tmp/
/var/folders/                          # macOS tmp
```

> 注意：`instance/workspace/<run_id>/` 是动态路径，匹配前缀 `Vessel/instance/workspace/` 算白名单内。

---

## 5. 大输出 → `artifact_refs` 协议

当 `payload` 包含的 stdout / stderr / api response > 4 KiB：

1. 把内容写到文件：`instance/traces/<trace_id>/<span_id>.stdout`（或 `.stderr` / `.json`）
2. 文件 mode = **0600**（owner read/write only，**禁** group / other 访问）
3. 文件路径加入 trace event 的 `artifact_refs` 字段（数组）
4. `payload` 字段保留**摘要**（前 200 字符 + 截断标记），同样按 3b 脱敏

```typescript
// pseudo
if (output.length > 4 * 1024) {
  const path = `instance/traces/${trace_id}/${span_id}.stdout`;
  await fs.writeFile(path, output, { mode: 0o600 });
  return {
    payload: { summary: redact(output.slice(0, 200)) + '...[truncated]' },
    artifact_refs: [path],
  };
}
```

---

## 6. trace 文件目录权限

整个目录 `instance/traces/<trace_id>/` mode = **0700**（owner only），子文件 mode = **0600**。

```bash
# 创建时：
mkdir -m 0700 instance/traces/${trace_id}
# 写文件时：
fs.writeFile(path, data, { mode: 0o600 })
```

---

## 7. M0 Acceptance（plan v5.4 M0 段加这两条）

`pnpm vessel-core "echo hi"` 运行后：

```bash
# Acceptance C-1：trace 目录权限
test "$(stat -f '%Lp' instance/traces/<trace_id>)" = "700" || exit 1
# Acceptance C-2：trace 文件权限
test "$(stat -f '%Lp' instance/traces/<trace_id>/<span_id>.stdout)" = "600" || exit 1
# Acceptance C-3：payload 不出现 user_prompt 全文
grep -q "user_prompt" instance/traces/<trace_id>/*.json && exit 1 || exit 0
```

> **macOS 用 `stat -f`；Linux 用 `stat -c`**——0A FRAMEWORK 写跨平台版。

---

## 8. 可选 / 后期增强（暂缓到 v1+）

- `gitleaks` pre-commit hook 扫 `instance/traces/` 目录（防意外 commit）—— 但 `instance/` 顶层 `.gitignore`，理论上不会进 git
- 用户配置的自定义脱敏规则（`~/.vessel/redact-rules.yaml`）
- Trace 加密存储（age / sops）

---

## 9. 实现库推荐（pragmatist react 提的）

- **`fast-redact`**（npm，MIT，适合 Pino 风格日志）
- **`pino-redact`**（同上，集成 Pino）
- 黑名单字段路径用 dot-notation 直接传给 `fast-redact`

不必自研——直接装包。

---

## 10. Phase 0 豁免说明

本规则部分参考业界做法（GDPR/CCPA 数据脱敏 / fast-redact / pino-redact 库）+ Vessel 特有的"用户 prompt 是核心隐私"判断。**重大外部选型部分**（fast-redact 库）需要在 0A 写 ADR-XXX-redaction-library 时引用 Prior Art；本规范本身（白名单字段 / 路径列表 / Vessel 特有约束）属 Vessel 特有设计，按 ADR-015 引用规则。

```
## Prior Art
No direct prior art found for the full spec.
Search keywords: ["pino redact javascript", "log redaction patterns",
                  "openTelemetry sensitive data redaction"]
Rationale for self-design:
  - 业界库（fast-redact / pino-redact）只解决脱敏机制，不能直接给 Vessel 的 4 KiB 切割 + artifact_refs 协议
  - Vessel "用户 prompt 是核心隐私"判断与一般日志库（多关注 password / API key）不同
  - 路径白名单是 Vessel 特有
```

---

## 11. 0A 实施 checklist

0A 写 FRAMEWORK.md 时按下列顺序：

- [ ] 把本文件 §2 / §3 / §4 / §5 / §6 写入 FRAMEWORK.md "Trace 协议 / Redaction" 小节
- [ ] 把 §7 写入 plan v5.4 M0 acceptance（增订条 C-1/C-2/C-3）
- [ ] 决定是否新增 ADR-XXX-redaction-library（如选 fast-redact，写一份）
- [ ] 把本文件标 status: superseded-by-FRAMEWORK，移到 docs/design/_archived/

完成后此前置笔记可归档（移到 `docs/design/_archived/`）。
