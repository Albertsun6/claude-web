# M1B MCP + permission — 4-way closeout: vessel-risk-officer

**Date**: 2026-05-10 17:30  
**Verdict**: NOT-YET-PASS (1 BLOCKER: null byte)

## BLOCKER

**R-M1B-1: path query param 未过滤 null bytes → 奇异 trace log + 可能 ENXIO**

HTTP 请求 `GET /api/vessel/fs/file?path=foo%00bar` — `rawPath` 含 `\0`，
`path.resolve()` 保留 null byte，`statSync()` 可能 ENXIO 或行为未定义（OS dependent）。
虽然最终用户看到 500，但：
1. `emitDenied()` 收到含 null byte 的字符串写 trace → trace JSON 含 null byte → 后续 grep/jq 解析可能出错
2. 攻击者可以借此混淆日志

**Fix required**: 在 `path.resolve()` 前对 `rawPath` 验证 `\0` 不存在。2 行 fix，需 re-test。

## MAJOR

**R-M1B-2: `emitDenied` 中 `run_id` 为随机 UUID，导致 trace directory 每次 denied 产生新 trace_id**

这是设计内的（architect minor m-1 接受了合成 session_id 方案）。问题是：
- 每个 denied 请求 = 新 trace_id 目录 = 新目录创建
- 高频 denial（如扫描攻击）可能在 `$VESSEL_DATA_DIR/traces/` 产生大量目录
- vessel-core 没有 traces/ 目录的 rotation / cap

**Mitigation**: 接受现状，注释里说明。Trace rotation 是 M1C observability 话题，不阻塞 M1B。**defer to M1C**。

**R-M1B-3: MCP manager shutdown 的 SIGTERM / setImmediate exit race**

同 architect M-1 / pragmatist M-1。**defer to M1C** 统一信号处理。

## MINOR

**r-m1b-1: vessel-fs.ts `emitDenied` 中的 path 用 `redactFreeformText` 脱敏后写 trace payload**

当前实现 ✅ 已有此保护（`.slice(0, 200)` + redact）。cursor B-级 review m-1 已落地。

**r-m1b-2: MCP spawn 失败不 crash** ✅

`spawn()` 内部 try/catch + warn 而非 throw。降级：无 MCP server 时 core 正常工作。
