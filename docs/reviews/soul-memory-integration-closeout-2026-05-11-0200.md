# Soul + Memory + cli-runner 集成 — Closeout (4-way review consolidated)
Date: 2026-05-11-0200
Type: integration milestone (not new feature ADR-level)

> 因为这是把 M2-Soul + M1C-B 接通的 thin 集成层（无新 ADR / 无 schema 改动），
> 4 reviewer lens 合并写一份 — 避免 closeout 文件爆炸。如未来类似集成改动
> 增多，单独拆 4 文件。

## Scope
让 `vessel-core "..."` 一次 intent 自动：
1. embed 用户 prompt → memory KNN top-K（默认 K=3，distance ≤ 1.5）
2. 把命中记录格式化为 markdown system-prompt 段
3. 与 soul prompt 拼接后通过 `--append-system-prompt` 注入 Claude CLI

文件改动：
- packages/backend/src/cli-runner.ts: +`getMemoryContextOrEmpty()` (export)
  + buildArgs 接受 memoryContext + 拼接 promptParts
- packages/backend/src/test-soul-memory-integration.ts: 新 11 e2e + 2 smoke 断言

## Findings

### PASS (architect): 接入点选择正确
candidates: orchestrator / skill / driver / cli-runner — 选 cli-runner 因为
- cli-runner 已经在做 soul 注入（M2-Soul），加 memory 注入是同类操作
- 不动 5 接口契约（Skill/Driver/Memory/...）
- echo skill 不走 cli-runner，自然不被 augmentation 影响（合理隔离）
- failed-soft 已有先例（soul parse error 跳过注入）

### PASS (architect): 单一职责仍清晰
- memory-store: 数据层，不知道 prompt 上下文
- embedder: 推理层，无 cli 概念
- cli-runner: 集成层，已有 soul 注入责任，加 memory 注入是同类
- 没有跨层耦合

### PASS (pragmatist): 范围克制
+ ~50 行代码（getMemoryContextOrEmpty + buildArgs 改 4 行）+ 100 行测试。
0 新依赖。0 schema 改动。0 接口扩展。

### PASS (pragmatist): env 控制 + 默认开
- VESSEL_MEMORY_AUGMENT=0 关闭（用户 dogfood 不爽时立刻 escape hatch）
- VESSEL_MEMORY_TOPK 调 K（默认 3，cap 20）
- 距离阈值硬编码 1.5（distMax）— 可未来 env 化但 YAGNI

### PASS (risk): 失败传播链合理
- VESSEL_MEMORY_AUGMENT=0 / 短 prompt / embedder cold / DB lock / 0 命中 →
  全部 return ''
- buildArgs 收到 '' 不 push memory 段，soul 段独立工作
- soul 段失败也 fail-soft，promptParts 可能两段都空 → 不 push --append-system-prompt
- 任何一层失败都不阻塞 spawn

### PASS (risk): retrieval 不进 trace
embedder 调用是 in-process，没有 trace event 写入。memory 命中内容也只在
spawn args 里（命令行参数 — `ps` 可见，与 M2-Soul 评审已识别风险一致）。
memory 内容不入 vessel-core 的 trace.ts / SQLite trace 表。

### PASS (cursor cross): 协议一致 + 回归 0 影响
- 8 个既有测试套件全过（soul/memory/workflow/m1bplus/m1b/lessons/m2-ios-alpha/coding-driver）
- 无 schema 变化（memory.db 仍 v4）
- shared/protocol.ts 无改动
- Eva web/iOS 路径完全不受影响（VESSEL_MEMORY_AUGMENT 默认开但 Eva 没 ~/.vessel/memory.db
  的话 searchMemory 直接 fail-soft 返回 ''）

### MINOR-1 (pragmatist): retry 路径重复 retrieve
runOnce 在 stale-session retry 时再调 await getMemoryContextOrEmpty，多 30-100ms
KNN。可在 sendMessage 起点 retrieve 一次后透传给 retry runOnce，避免重做。
**Verdict**: MINOR — defer / retry 是错误恢复路径，性能不关键。

### MINOR-2 (architect): 默认开 → 首次 cli-runner 触发被 transformers.js 模型 download 阻塞
第一次 user 跑 `vessel-core "..."` (coding) 会等模型下载 30s-2min。这个延迟出
现在 spawn Claude CLI 之前，user 不知道发生了什么。M1C-B 实施时已记 MINOR-2
"HF CDN 国内 mitigation"，本 integration 复用同样问题但放大场景（不仅 memory
search 卡，coding 也卡）。
**Mitigation 选项**：
- (a) `vessel-core memory status` 跑一次预热（已有命令）
- (b) vessel-core 启动时 background warmup（不阻塞 startup）
- (c) 默认 VESSEL_MEMORY_AUGMENT=0，opt-in
**Verdict**: MINOR — 当前选 (a)（操作员手动预热）。M1C-B+ 可考虑 (b)。

### MINOR-3 (cursor): distMax=1.5 硬编码
代码里 const distMax = 1.5 是常量。bge-small-zh-v1.5 L2-normalized 向量的
"L2 distance"理论范围 [0, 2]，1.5 算"很宽松"。但没有数据支撑这个值。需要
dogfood 一段时间观察 false positive / negative，再调或 env 化。
**Verdict**: MINOR — accepted-as-is. 1.5 是初始保守值。

### Finding 矩阵汇总

| ID | 严重度 | 来源 | Finding | 决策 |
|---|---|---|---|---|
| MINOR-1 | MINOR | pragmatist | retry 路径重复 retrieve | defer |
| MINOR-2 | MINOR | architect | 首次 coding 被模型 download 阻塞 | accepted-as-is（手动预热）|
| MINOR-3 | MINOR | cursor | distMax=1.5 硬编码 | accepted-as-is |

3 MINOR, 0 MAJOR, 0 BLOCKER. 无 fix-now.

## 验收（Soul + Memory 接通的契约）

- ✅ getMemoryContextOrEmpty short-circuits（VESSEL_MEMORY_AUGMENT=0 / 短 prompt / 空 store）
- ✅ e2e: seed 3 records + KNN 命中 + 段头 / marker / 格式化 kind
- ✅ VESSEL_MEMORY_TOPK 控制 K 生效
- ✅ Soul prompt + memory section 拼接后通过 --append-system-prompt 注入（间接验证）
- ✅ 11/11 e2e + 2/2 smoke + 全套回归 (8 suites) ✅

## Verdict: PASS

Soul + Memory + cli-runner 接通完成。Vessel 现在能"基于历史记忆 + 人格风格"
响应 user 请求 —— 这是 14 个里程碑后产品形态的第一次"质变"（从孤立能力到
连贯助理）。

接下来推荐：
- C: HF_HOME 移到 $VESSEL_DATA_DIR/models（之前盘点提到的）
- D: /api/vessel/memory HTTP API（让 Eva web/iOS 也能访问 memory）


lesson_id: 811c8a1a-086a-4f2c-a582-60ca99b4f29c
