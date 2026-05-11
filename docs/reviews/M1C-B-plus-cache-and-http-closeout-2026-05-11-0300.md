# M1C-B+ Cache + HTTP API — Closeout (4-way consolidated)
Date: 2026-05-11-0300
Type: cleanup + HTTP exposure (no schema change, no new ADR)

> 两个改动合一份 closeout：(C) HF cache 路径迁移 + (D) /api/vessel/memory
> HTTP API。都是 M1C-B 后续清理项，没有新决策。

## Scope

### C — HF cache 路径迁移
- embedder.ts: 设 transformersEnv.cacheDir = $VESSEL_DATA_DIR/models（默认）
  + VESSEL_HF_CACHE_DIR override + 尊重既有 HF_HOME
- docs/notes/model-sha-pinning.md: 路径 + 验证命令更新

### D — HTTP API
- packages/backend/src/routes/vessel-memory.ts (~165 行): 6 个 endpoint
  - POST   /memory          — addMemory + 验证
  - GET    /memory          — listMemory（kind / limit query）
  - POST   /memory/search   — KNN（query / top body）
  - GET    /memory/:id      — getMemoryById
  - DELETE /memory/:id      — idempotent
  - GET    /memory/status   — embedder + count snapshot
- index.ts: mount /api/vessel route
- test-vessel-memory-http.ts: 15 smoke + 14 e2e = 29/29 全过

## Findings

### PASS (architect): 路径迁移一行 env 控制
embedder.ts 加 ~8 行处理 3 层 priority（VESSEL_HF_CACHE_DIR > HF_HOME >
DATA_DIR/models）。代码改动最小，但提供了 tests / ops 双重灵活性（共享
prod cache vs 隔离 / 标准 HF env vs 自定义）。

### PASS (architect): HTTP routes 与既有 vesselRouter / vesselFsRouter 风格一致
- 同 prefix /api/vessel；多 router 串联（已经是 mount 模式）
- Hono 路由顺序：/memory/status 在 /memory/:id 之前避免被 :id 匹配
- 错误响应 {error, detail?} 与 vessel-workflow / vessel-fs 格式一致
- HTTP code: 400 invalid input / 413 too large / 404 not found / 201 created
  / 200 ok / 500 internal — RESTful 标准

### PASS (pragmatist): MAX_QUERY_CHARS=1000, MAX_CONTENT_CHARS=8000
content 上限与 workflow 一致（8000 chars），search query 更保守（1000
chars，KNN query 不需要长文本）。两个 cap 都防止恶意大 payload 撑爆 embedder。

### PASS (risk): 路径校验 + 类型校验全覆盖
- POST 缺 kind / 无效 kind / 缺 content / content 过长 → 400/413
- GET kind 参数无效 → 400
- POST search 缺 query / query 过长 / top 非正数 → 400/413
- :id 非正整数 → 400
- 不存在 :id GET → 404; DELETE → 200 (idempotent)

15 个 smoke 断言全部覆盖这些路径，e2e 路径无 BLOCKER 已验证。

### PASS (cursor cross): 模型缓存复用避免 90MB 重下载
HTTP test 通过 VESSEL_HF_CACHE_DIR=~/.vessel/models 复用已下载模型，e2e 测
试启动到第一个 POST 响应仅 ~3-5s（vs 30-60s 重下载）。CI 友好。

### PASS (cursor cross): 没破坏既有路径
8 套件回归全过。Eva web/iOS 无 ~/.vessel/memory.db → memory routes 列表为
空，搜索 fail-soft 返回空 hits。无 cors / auth header 改动。

### MINOR-1 (architect): vessel-memory 路由没接现有 auth middleware
HTTP 测试默认无 token 即可访问。而 vesselRouter 的 /intent 等敏感路由是
依赖外部 auth middleware（mounted at app level）。当前 vessel-memory 没
显式 require auth，与 /api/vessel/health 一致（health 是有意 no-auth）。
但 memory 含 user 内容，应该 token 保护。
**Verdict**: MINOR — 当前 Vessel 默认本地（127.0.0.1）+ Tailscale 暴露才
需要 token；本地 dogfood 阶段可接受。defer 到 Tailscale 暴露 / 多端真用之
前补 auth check（简单加 verifyToken middleware）。

### MINOR-2 (pragmatist): 没有 batch POST
一次 POST 一条记录。如果未来需要从 markdown / 历史聊天日志批量导入，需要
batch 接口。当前 YAGNI。
**Verdict**: MINOR — defer.

### MINOR-3 (risk): HTTP 路径下首次 POST 仍需 embedder cold start
默认行为：第一个 POST /memory 触发 embedder.ready() → 模型加载 30s-60s。
HTTP 客户端可能 timeout。已通过 GET /memory/status 让客户端先预热，但没
有显式 mitigation。
**Verdict**: MINOR — defer / iOS / web client 可以在启动时调一次
/memory/status 预热（pattern 与 transformers.js 一致）。

### Finding 矩阵汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-arch-1 | MINOR | architect | vessel-memory routes 没显式 auth check | defer / Tailscale 暴露前补 |
| MINOR-prag-1 | MINOR | pragmatist | 无 batch POST | defer |
| MINOR-risk-1 | MINOR | risk | 首次 POST cold-start 30-60s | defer / 客户端预热 pattern |

3 MINOR, 0 MAJOR, 0 BLOCKER. 全部 defer.

## 验收

### C 验收
- ✅ tsc clean
- ✅ embedder cache 落到 ~/.vessel/models/Xenova/bge-small-zh-v1.5/onnx/model.onnx
- ✅ SHA 与 docs/notes/model-sha-pinning.md 一致：`69a0b846f4f116b5e6aabf9546ea6754d02264f3211a13a1bd69b31b8040749a`
- ✅ pnpm test:memory:e2e 29/29 通过 (cli 路径)
- ✅ pnpm vessel-core memory add 后模型从新位置加载

### D 验收
- ✅ POST /memory + GET /memory + POST /memory/search + DELETE 全 CRUD
- ✅ 15 smoke (validation 路径) + 14 e2e (含真实 KNN) = 29/29
- ✅ Eva path 0 影响（既有 /api/vessel/intent / fs / health / workflow 不变）
- ✅ HTTP 测试用 VESSEL_HF_CACHE_DIR 复用模型缓存，无重下载

## Verdict: PASS
- 0 BLOCKER, 0 MAJOR
- 3 MINOR (全部 defer)
- 全套回归 (10 套件) ✅

C + D 完成。Vessel memory 现在多端可用：CLI（vessel-core memory ...）+ HTTP
（/api/vessel/memory）+ 自动注入（cli-runner system prompt）。模型缓存独立
于 node_modules，pnpm reinstall 不再触发 90MB 重下载。

---

## 集成观察（"产品形态盘点"补遗）

到此 Vessel 已经具备：
- ✅ 内核 + Coding Driver
- ✅ 多入口（CLI + HTTP + WS + iOS）
- ✅ MCP 工具 wire-up
- ✅ Soul 注入
- ✅ Workflow Engine + HITL + timeout/cancel
- ✅ 长期记忆（CLI + HTTP + 自动注入）
- ✅ 服务发现（mDNS）
- ✅ iOS UI 接入（NWBrowser sheet）

**剩余的"自我完整"线索**：
- 仍未做：M2-Voice (Eva voice 重构为 Capability) — 非阻塞，dogfood 时再决定
- 仍未做：M2-iOS-γ (operator 真机 + TestFlight) — 操作员主导
- 仍未做：HTTP /api/vessel/memory 与 iOS 集成 — 简单 fetch wrapper，dogfood 后
  补
- 一直没做：HTTP / WS auth middleware 全面覆盖 vessel routes — 见 MINOR-arch-1


lesson_id: e21784d2-19a8-4a9f-aad4-353c35d94035
