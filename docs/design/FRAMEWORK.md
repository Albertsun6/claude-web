# Vessel Framework（接口契约 + 数据模型 + Boot）

> **Status**: 0A 后期 · 2026-05-09 · 5 接口契约 + Trace + Soul + Manifest schema + 三层 boot 时序
>
> **Depends on**: [REQUIREMENTS.md](REQUIREMENTS.md)（NFR 场景反向驱动接口）+ ADR-000 / ADR-012 / ADR-014 / ADR-016
>
> **Companion**: [trace-redaction-spec.md](trace-redaction-spec.md)（Trace 脱敏规则）

---

## 1. 整体分层（接口存放约定，from ADR-000 §2）

```
packages/backend/src/
├── interfaces/                   # 5 接口主契约（Vessel 顶级抽象，跨端共享类型）
│   ├── agent.ts                  # Agent
│   ├── skill.ts                  # Skill
│   ├── tool.ts                   # Tool
│   ├── memory.ts                 # Memory
│   └── app.ts                    # App (Capability)
├── drivers/
│   └── types.ts                  # Driver 内部契约（不在 5 接口；CodingDriver 等）
├── ml-worker/
│   └── types.ts                  # Memory 接口的内部 helper（EmbeddingClient / AsrClient / TtsClient）
├── observability/
│   └── trace.ts                  # Trace 协议 + redaction
├── soul/
│   └── parser.ts + injector.ts   # Soul Spec
└── boot.ts                       # 三层 boot（process / instance / session）

packages/shared/src/
├── protocol.ts                   # Wire Protocol（含 Vessel 新加 Intent / TraceEvent kind）
├── harness-protocol.ts           # 现有 Eva DTO + Vessel 新加 SoulSpec / AppManifest / Capability schemas
└── ...
```

---

## 2. 5 接口主契约（TypeScript signatures）

### 2.1 `interfaces/agent.ts`

```typescript
import type { TraceContext } from '../observability/trace';
import type { Intent, Artifact, SessionId } from '@vessel/shared';

/**
 * Agent — 一次正在执行的任务实例。
 *
 * Agent 是 Vessel 内核 Intent 的主执行者。每个 Agent 实例：
 * - 接受一个 Intent 作为输入
 * - 通过调用 Skills + Tools + Drivers 完成任务
 * - 产出 Artifact 或 Workflow
 * - 完整 trace_id 贯穿
 *
 * Lifecycle:
 *   spawn() → run() → ([pause()] → resume())* → complete() | cancel() | fail()
 *
 * @see CONCEPTS §1.4 八件套辨析 / §2.1 Orchestrator
 */
export interface Agent {
  readonly id: string;                          // uuid v4
  readonly sessionId: SessionId;
  readonly traceCtx: TraceContext;

  /** 异步执行任务；调用 Skill/Driver/Tool 完成 Intent。**统一返回 AgentResult**（v0A 修订 cursor M5，避免 union 状态边界不清）；成功路径必须是 `{ status: 'success', artifact }` */
  run(intent: Intent): Promise<AgentResult>;

  /** 优雅取消（Workflow HITL 节点用）；保证不留孤儿子进程 */
  cancel(reason?: string): Promise<void>;

  /** Health check（NFR-F1 / NFR-F2 用） */
  health(): Promise<{ ok: boolean; reason?: string }>;
}

/** v0A.1 修订（cursor M3 2026-05-10）：discriminated union 强制不变量，避免 caller 漏分支 */
export type AgentResult =
  | { status: 'success'; artifact: Artifact }              // success 必带 artifact
  | { status: 'paused'; resumeToken: string }              // paused 必带 resumeToken
  | { status: 'cancelled'; reason: string }                // cancelled 必带 reason
  | { status: 'failed'; error: { type: string; message: string } };  // failed 必带 error
```

### 2.2 `interfaces/skill.ts`

```typescript
import type { TraceContext } from '../observability/trace';
import type { Intent, Artifact } from '@vessel/shared';
import type { Tool } from './tool';
import type { Memory } from './memory';

/**
 * Skill — 单步能力胶囊。
 *
 * Skill 是 Agent 调用的"动作"。例：
 * - EchoSkill（M0）
 * - CodingSkill（M0.5，wrap CodingDriver）
 * - VoiceSkill（M2-Voice，wrap ASR/TTS worker）
 *
 * Lifecycle:
 *   - 由 Capability App register 进 SkillRegistry（启动时）
 *   - 被 Agent.run() 调用 invoke()
 *   - 无状态（state 在 Memory）
 *
 * @see CONCEPTS §1.4 / ADR-016 (CodingSkill 通过 CodingDriver 实现)
 */
export interface Skill {
  readonly id: string;                          // 'echo' / 'coding' / 'voice'
  readonly capabilityId: string;                // 所属 Capability App id
  readonly description: string;

  /** 执行 Skill；可访问 Tool / Memory；trace_ctx 必须传播 */
  invoke(intent: Intent, ctx: SkillContext): Promise<Artifact>;
}

export interface SkillContext {
  traceCtx: TraceContext;
  tools: ToolRegistry;
  memory: Memory;
  workspaceDir: string;                         // instance/workspace/<run_id>/
}

export interface ToolRegistry {
  /** 按 tool id 取 Tool 实例（已经过 Permission 检查） */
  get(toolId: string): Tool | null;

  /** 列出当前 Capability scope 内可访问的 Tool */
  list(): Tool[];
}
```

### 2.3 `interfaces/tool.ts`

```typescript
import type { TraceContext } from '../observability/trace';
import type { ZodSchema } from 'zod';

/**
 * Tool — 系统调用 / 外部能力的统一接口。
 *
 * Tool 在 Vessel 中通常是 MCP server 暴露的能力（filesystem / git / playwright / etc.）。
 * 也可以是内部 tool（如 memory.search 暴露成 tool）。
 *
 * Lifecycle:
 *   - 由 MCP client 或 internal Capability register 进 ToolRegistry
 *   - 调用前必须经 Permission 检查（按 NFR-P1 / NFR-P2 / NFR-P3）
 *
 * @see CONCEPTS §3.2 Tool Registry / ADR-009 MCP server lifecycle
 */
export interface Tool {
  readonly id: string;                          // 'filesystem.read' / 'git.commit' / etc.
  readonly description: string;
  readonly inputSchema: ZodSchema<unknown>;     // Zod schema，运行时校验
  readonly outputSchema: ZodSchema<unknown>;
  readonly permissionScope: PermissionScope;    // 路径白名单 / 操作白名单 / etc.

  /** 调用 Tool；ctx 含 trace_ctx 和 cancel signal */
  invoke(input: unknown, ctx: ToolContext): Promise<unknown>;
}

export interface PermissionScope {
  /** 路径白名单模式（glob 或绝对前缀） */
  pathAllowlist?: string[];
  /** 操作白名单（read / write / exec / etc.） */
  ops?: ('read' | 'write' | 'exec' | 'network')[];
}

// v0A.1 修订（cursor M4，2026-05-10）：路径白名单必须 canonicalize + 防 symlink escape
//
// **HARD RULES**（M1B Permission middleware 实施时必落）：
// 1. 所有 input path 必须 `realpath` canonicalize（resolve symlinks + `../` + relative）
// 2. allowlist 也 canonicalize（vessel-core 启动时一次性 resolve；config reload 时重 resolve）
// 3. canonicalized input path 必须严格 startsWith canonicalized allowlist entry
// 4. **禁止 symlink 逃出 instance root**：如 `instance/workspace/<run_id>/foo` 是 symlink → `~/.ssh/...`，
//    realpath 后命中 `~/.ssh/`（不在 allowlist），permission middleware 拒绝
// 5. `~` 只允许 vessel-core 启动时 expand（不允许运行时 user input 含 `~`）
// 6. 大小写：macOS 默认 case-insensitive FS；canonicalize 后比较前必须按 fs.realpathSync.native 拿真实大小写
// 7. 测试覆盖：`../`、symlink、bind mount、UNC paths（Windows，v1+）
//
// 参考实现：每次 Tool.invoke() 前调 `verifyAllowedPath(input.path, scope.pathAllowlist)`

export interface ToolContext {
  traceCtx: TraceContext;
  abortSignal: AbortSignal;
}
```

### 2.4 `interfaces/memory.ts`

```typescript
import type { TraceContext } from '../observability/trace';

/**
 * Memory — 分层记忆接口。
 *
 * 三层：
 * - **Short term**（对话上下文，进程内 in-memory）
 * - **Session KV**（跨重启，SQLite session_kv 表）
 * - **Long term**（向量检索，sqlite-vec + ML worker embedding）
 *
 * Lifecycle:
 *   - 由 vessel-core 启动时创建（按三层 boot §3.5）
 *   - Session 级初始化拉相关 long-term memory（NFR-O3 trace replay 场景）
 *
 * @see CONCEPTS §3.1 Memory / ADR-002 embedding-fastembed
 */
export interface Memory {
  /** Short-term：对话上下文（M0 起） */
  short: ShortTermMemory;

  /** Session KV：跨重启（M0 起） */
  sessionKv: SessionKvMemory;

  /** Long-term：向量检索（M1C-B 起，通过 EmbeddingClient ML worker） */
  longTerm: LongTermMemory;
}

export interface ShortTermMemory {
  /** 当前 session 的最近 N 条消息 */
  recent(sessionId: string, n?: number): Promise<MemoryRecord[]>;
  append(sessionId: string, record: MemoryRecord): Promise<void>;
}

export interface SessionKvMemory {
  get<T>(sessionId: string, key: string): Promise<T | null>;
  set<T>(sessionId: string, key: string, value: T): Promise<void>;
  delete(sessionId: string, key: string): Promise<void>;
}

export interface LongTermMemory {
  /** 写入；自动调 EmbeddingClient.embed() */
  write(record: MemoryRecord): Promise<{ id: string }>;

  /** 向量检索（按余弦相似度） */
  search(query: string, opts?: { topK?: number; sessionId?: string }): Promise<MemoryRecord[]>;
}

export interface MemoryRecord {
  id?: string;
  sessionId: string;
  text: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;                           // ISO 8601
}
```

### 2.5 `interfaces/app.ts`（Capability App）

```typescript
import type { Skill } from './skill';
import type { Tool, PermissionScope } from './tool';     // v0A 修订 cursor m1：补 PermissionScope import

/**
 * Capability App — 装卸式插件。
 *
 * Capability 通过 manifest.yaml 声明依赖 + 提供的 Skill/Tool。
 * vessel-core 启动时按 manifest 加载（NFR-C1 / NFR-C2 / NFR-C3）。
 *
 * Lifecycle:
 *   install() → boot() → enable() → ([disable() → enable()])* → uninstall()
 *
 * @see ADR-007 / ADR-009 / NFR-C1~C3
 */
export interface CapabilityApp {
  readonly manifest: AppManifest;

  /** 启动时调用；注册 Skill/Tool；spawn helper subprocess（如 ML worker） */
  boot(ctx: AppBootContext): Promise<void>;

  /** 优雅卸载（按 NFR-C1 30 秒内）；清理子进程；注销 Tool/Skill */
  uninstall(): Promise<void>;

  /** Health check */
  health(): Promise<{ ok: boolean; reason?: string }>;

  /** 列出此 App 提供的 Skill */
  skills(): Skill[];

  /** 列出此 App 暴露的 Tool（可能 0 个） */
  tools(): Tool[];
}

export interface AppBootContext {
  /** App 工作目录（`packages/capability-<id>/`） */
  appDir: string;
  /** 可读取 instance 数据目录 */
  instanceDataDir: string;
  /** 注册 ML worker 用 */
  spawnHelper(spec: HelperSpawnSpec): Promise<HelperHandle>;
}

export interface AppManifest {
  /** id 必须匹配 directory name（`packages/capability-<id>/`） */
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  schemaVersion: number;                        // App Manifest schema 版本（v1 起）

  /** 此 App 提供的 Skill ids */
  skills: string[];

  /** 此 App 暴露的 Tool ids（通过 MCP 或 internal） */
  tools?: string[];

  /** 依赖的 ML worker（如 voice 依赖 whisper / piper） */
  mlWorkers?: ('embedding' | 'asr' | 'tts')[];

  /** Permission scope（路径白名单 / 操作） */
  permissionScope?: PermissionScope;

  /** Soul Spec 是否注入到此 App 的 Skill prompt（v0.1 仅 cli-runner-based skills） */
  soulInjection?: 'cli-runner-only' | 'all-skills';
}

export interface HelperSpawnSpec {
  type: 'ml-worker' | 'mcp-server';
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HelperHandle {
  pid: number;
  pgid: number;                                 // process group id（NFR-C2 SIGTERM 用）
  shutdown(): Promise<void>;                    // SIGTERM + 5s SIGKILL
}
```

---

## 3. Driver 内部契约（不在 5 接口；ADR-016 C 路径）

`packages/backend/src/drivers/types.ts`：

```typescript
import type { TraceContext } from '../observability/trace';

/** 通用 Driver 父契约（CodingDriver / 未来的其他 Driver 继承） */
export interface DriverBase {
  /** Health check */
  health(): Promise<{ ok: boolean; reason?: string }>;
}

/** Coding Driver — wrap CC CLI / Cursor / Codex */
export interface CodingDriver extends DriverBase {
  /** 提交 coding 任务，返回 artifact */
  submit(spec: CodingDriverSpec, ctx: { traceCtx: TraceContext; abortSignal: AbortSignal }): Promise<CodingDriverArtifact>;

  /** 优雅取消（SIGTERM process group + 5s SIGKILL，NFR-F1） */
  cancel(runId: string): Promise<void>;
}

export interface CodingDriverSpec {
  runId: string;
  prompt: string;
  workspace: string;                            // instance/workspace/<runId>/
  systemPromptPrefix?: string;                  // M2-Soul 注入 soul.md 渲染内容（ADR-004）
  model?: 'opus' | 'sonnet' | 'haiku';          // 沿用 Eva model-registry
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
}

export interface CodingDriverArtifact {
  files: string[];                              // 产生的文件路径（绝对，在 workspace 下）
  exitCode: number;
  stdoutPath?: string;                          // > 4KB stdout 切到 instance/traces/<trace_id>/<span_id>.stdout
  stderrPath?: string;
  metadata?: Record<string, unknown>;
}
```

---

## 4. ML Worker 内部契约（**v0A.1 修订：HTTP loopback + NDJSON**，不在 5 接口；ADR-012 §6）

> **v0A.1 修订（A6，2026-05-09）**：原 stdio JSON-RPC 改为 **HTTP loopback + NDJSON**（Ollama 模式）。Prior Art：[Ollama](https://docs.ollama.com/api/introduction)（11434 端口 + OpenAI/Anthropic API 兼容）+ [Open WebUI Pipelines](https://markaicode.com/ollama-with-open-webui/)（9099 端口 + Pipeline 容器）+ [LM Studio plugins](https://lmstudio.ai/docs/typescript/plugins)。理由：调试友好（curl 可直接调）/ 生态兼容（直接复用 OpenAI/Anthropic SDK 当 client）/ 跨进程协议透明。

### 4.1 HTTP loopback 端口分配

每个 ML worker 监听**本机 127.0.0.1** 的固定端口（**不**对外暴露）：

| Worker | 端口 | 接口风格 |
|---|---|---|
| **embedding-server**（fastembed Python） | `127.0.0.1:11435` | **OpenAI Embeddings API 兼容**（`POST /v1/embeddings { model, input }`） |
| **whisper-server**（whisper.cpp Python） | `127.0.0.1:11436` | **OpenAI Audio API 兼容**（`POST /v1/audio/transcriptions { file, model }`） |
| **piper-server**（piper-tts Python） | `127.0.0.1:11437` | **OpenAI Audio Speech 兼容**（`POST /v1/audio/speech { input, voice, speed }`） |

> 端口仅 loopback 监听（`uvicorn --host 127.0.0.1`）；vessel-core 主进程通过 `fetch('http://127.0.0.1:11435/...')` 调用。**不**通过 LAN 暴露（按 NFR-S1 + ADR-012 个人单机硬约束）。

### 4.2 TS 客户端接口（仍保持类型化抽象）

`packages/backend/src/ml-worker/types.ts`：

```typescript
/** EmbeddingClient — Memory.longTerm 内部 helper（HTTP client over 127.0.0.1:11435） */
export interface EmbeddingClient {
  embed(input: string | string[], opts?: { model?: string }): Promise<number[][]>;
  health(): Promise<{ ok: boolean; reason?: string; modelsLoaded?: string[] }>;
}

/** ASR Client — voice Capability 内部 helper（HTTP client over 127.0.0.1:11436） */
export interface AsrClient {
  transcribe(wav: Buffer, opts?: { language?: string; model?: string }): Promise<string>;
  /** NDJSON 流式（streaming transcription） */
  transcribeStream(wav: ReadableStream<Uint8Array>, opts?: {...}): AsyncIterable<{ delta: string; isFinal: boolean }>;
  health(): Promise<{ ok: boolean; reason?: string }>;
}

/** TTS Client — voice Capability 内部 helper（HTTP client over 127.0.0.1:11437） */
export interface TtsClient {
  synthesize(text: string, opts?: { voice?: string; speed?: number; format?: 'wav' | 'mp3' }): Promise<Buffer>;
  /** NDJSON 流式（streaming TTS for low latency） */
  synthesizeStream(text: string, opts?: {...}): AsyncIterable<Uint8Array>;
  health(): Promise<{ ok: boolean; reason?: string }>;
}
```

### 4.3 Python worker 实现框架（FastAPI）

`ml-workers/src/embedding_server.py`：

```python
from fastapi import FastAPI
from fastembed import TextEmbedding

app = FastAPI()
model = TextEmbedding("BAAI/bge-small-en-v1.5")  # ADR-002 待 spike

@app.post("/v1/embeddings")
async def embed(req: EmbeddingRequest):
    """OpenAI Embeddings API 兼容；可被任何 OpenAI client 调"""
    embeddings = list(model.embed(req.input if isinstance(req.input, list) else [req.input]))
    return {
        "object": "list",
        "data": [{"object": "embedding", "embedding": e.tolist(), "index": i}
                 for i, e in enumerate(embeddings)],
        "model": req.model,
    }

@app.get("/health")
async def health():
    return {"ok": True, "modelsLoaded": ["BAAI/bge-small-en-v1.5"]}

# uvicorn 启动: uvicorn embedding_server:app --host 127.0.0.1 --port 11435
```

### 4.4 lifecycle 不变（ADR-012 §3）

- 不池化；按需起 + TTL 闲置回收（10 min 默认）
- spawn 时 vessel-core 主进程拿到 `pid + pgid + port`，存入 `HelperHandle`
- shutdown：HTTP `POST /shutdown` 优雅 → SIGTERM process group → 5s SIGKILL 兜底
- 端口冲突：vessel-core 启动时检测 11435/11436/11437 占用，占用则 escalation owner（不自动让端口）

### 4.5 双模生态兼容（V0A.1 加值）

因为 OpenAI API 兼容，**owner 可以**：
- 用 `curl` 直接调试：`curl http://127.0.0.1:11435/v1/embeddings -d '{"model":"local","input":"hello"}'`
- 用 OpenAI SDK 当 client（不走 OpenAI 服务器，loopback 到本机 worker）：`new OpenAI({ baseURL: 'http://127.0.0.1:11435/v1', apiKey: 'local' })`
- 未来 v1+ 切到 Ollama / LM Studio 等本地 LLM runtime 几乎零改动（同 API 形态）

---

## 5. Trace 协议（**v0A.1 修订（cursor B1 BLOCKER 修）：M0 直接采用 OTEL GenAI 命名；不引 SDK**）

> **v0A.1 修订（A7 + cursor B1，2026-05-10）**：cursor cross-reviewer 找出原"双 schema 兼容映射"是 BLOCKER（§5 主 schema 用 UUID + §5.5/5.6 又说 OTEL hex / W3C TRACEPARENT，0B-8 实施按哪份写不清）。**修订为单一契约**：M0 实施直接走 OTEL GenAI 命名 + W3C Trace Context；不引 OTEL SDK（按 cursor M5 路径 1，避免 recency bias）；自实现轻量 trace.ts。
>
> **承诺**：v1+ 加 OTEL exporter（接 Datadog / Tempo / 等）时引 SDK；当前 schema 已对齐 spec，零 refactor。

### 5.1 TraceSpan Schema（M0 直接实现，OTEL 风格 + Vessel 特有命名空间）

12 字段：

```typescript
// packages/backend/src/observability/trace.ts (导出到 packages/shared/src/trace.ts)
import { z } from 'zod';

export const TraceEventSchema = z.object({
  // OTEL 标准字段（M0 直接采用 hex 格式，不是 UUID v4）
  trace_id: z.string().regex(/^[0-9a-f]{32}$/, 'OTEL trace_id: 16-byte hex / 32 chars'),
  span_id: z.string().regex(/^[0-9a-f]{16}$/, 'OTEL span_id: 8-byte hex / 16 chars'),
  parent_span_id: z.string().regex(/^[0-9a-f]{16}$/).nullable(),
  // OTEL 推荐 span name（不直接对应 event_type，但 Vessel 沿用 event_type 作 vessel.event 命名空间）
  event_type: z.enum([
    'intent.received',
    'skill.invoked',
    'skill.completed',
    'permission.granted',
    'permission.denied',
    'driver.spawned',
    'driver.exited',
    'mcp.invoked',
    'mcp.completed',
    'workflow.paused',
    'workflow.resumed',
    'soul.loaded',
    'capability.installed',
    'capability.uninstalled',
  ]),
  timestamp: z.string().datetime(),             // ISO 8601 ms
  component: z.string(),                        // 'gateway' | 'orchestrator' | 'skill:<id>' | 'driver:cc-cli' | 'mcp:filesystem' | 'ml-worker:embedding' | ...
  session_id: z.string(),
  run_id: z.string(),
  status: z.enum(['success', 'error', 'paused', 'cancelled']),
  duration_ms: z.number().int().nullable().optional(),
  payload: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
           .optional()
           .refine((v) => !v || JSON.stringify(v).length <= 4096, { message: 'payload > 4KB; use artifact_refs' })
           .refine((v) => !v || isJsonSerializable(v), { message: 'payload must be JSON-serializable' }),
  // v0A 修订 Claude M-R1：JSON object/array 类型 + 4KB 限制 + JSON-serializable 验证；按 trace-redaction-spec 强制脱敏
  artifact_refs: z.array(z.string()).optional(), // 大输出文件路径
  error: z.object({ type: z.string(), message: z.string(), stack: z.string().optional() }).nullable().optional(),
});

export type TraceEvent = z.infer<typeof TraceEventSchema>;

/** Trace context 跨子进程传播 */
export interface TraceContext {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  session_id: string;
  run_id: string;
}

/** 子进程环境变量传播协议（**v0A.1 修订：W3C Trace Context 标准**，cursor B1） */
export const ENV_KEYS = {
  /** W3C Trace Context standard env var: 'TRACEPARENT=00-<32-hex-trace-id>-<16-hex-span-id>-<flags>' */
  TRACEPARENT: 'TRACEPARENT',
  /** Vessel 特有命名空间（OTEL spec 没有这俩概念）*/
  VESSEL_CONVERSATION_ID: 'VESSEL_CONVERSATION_ID',  // = session_id
  VESSEL_RUN_ID: 'VESSEL_RUN_ID',
} as const;

/** 写 trace event；自动按 trace-redaction-spec 脱敏 payload */
export interface TraceWriter {
  write(event: TraceEvent): Promise<void>;
  /** 创建子 span（child_span_id 自动生成；parent_span_id = current span） */
  childSpan(component: string): TraceContext;
}
```

**脱敏规则**：详见 [trace-redaction-spec.md](trace-redaction-spec.md)（M0 必落 acceptance C-1 / C-2 / C-3）。

### 5.5 OTEL GenAI 兼容映射（v0A.1 加，承诺 v1+ pivot）

按 [OTEL GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/) 的 4 类 span（CLIENT / INTERNAL）+ `gen_ai.*` 命名空间。Vessel 12 字段映射如下，M0 实施时**字段同时支持两套命名**（owner 切换 OTEL exporter 时无需重写）：

| Vessel 字段 | OTEL GenAI 对应 | 备注 |
|---|---|---|
| `trace_id`（uuid v4） | OTEL `trace_id`（16-byte hex / 32 字符） | M0 起改格式：32 字符 hex（zero-padding from uuid v4 也可）|
| `span_id`（uuid v4） | OTEL `span_id`（8-byte hex / 16 字符） | M0 起改格式 |
| `parent_span_id` | OTEL `parent_span_id` | 同上 |
| `event_type` enum 14 值 | OTEL span `name`（字符串） + `gen_ai.operation.name` | event_type → 转 OTEL span name（如 `skill.invoked` → `invoke_agent_internal` + `gen_ai.operation.name='skill.invoked'`）|
| `timestamp`（ISO 8601 ms） | OTEL `start_time_unix_nano`（nano） | nano 精度 |
| `component` | `gen_ai.provider.name` + `gen_ai.agent.name` | 'gateway' / 'driver:cc-cli' 拆为 provider + agent 二段 |
| `session_id` | `gen_ai.conversation.id` | 直接对应 |
| `run_id` | `vessel.run_id`（custom namespace） | OTEL spec 无此概念，用 vessel.* 命名空间 |
| `status` | OTEL `status.code`（OK/ERROR/UNSET） + `gen_ai.response.finish_reasons` | 'success' → OK / 'error' → ERROR / 'paused' → vessel.status='paused' |
| `duration_ms` | `end_time_unix_nano - start_time_unix_nano` | 计算字段，不直接存 |
| `payload` | `gen_ai.tool.input` / `gen_ai.tool.output` / `gen_ai.prompt` 等 | 按 trace-redaction-spec 脱敏；> 4KB 切 artifact_refs |
| `artifact_refs` | `vessel.artifact_refs`（custom namespace） | 同上 |
| `error` | `exception.type` / `exception.message` / `exception.stacktrace`（OTEL exception event） | OTEL Event 模式 |

### 5.6 W3C Trace Context（子进程传播标准）

替代当前 `VESSEL_TRACE_ID` / `VESSEL_PARENT_SPAN_ID` 自定义 env vars，**M0 实施时改用 W3C Trace Context** 标准：

```bash
# 标准 W3C env var (子进程从父进程继承)
TRACEPARENT='00-<32-hex-trace-id>-<16-hex-span-id>-<flags>'
# Vessel 特有
VESSEL_CONVERSATION_ID='<session_id>'
VESSEL_RUN_ID='<run_id>'
```

理由：MCP server / OTEL collector / 第三方 agent 都吃 W3C 标准；自定义 env vars 跟生态不兼容。

### 5.7 OTEL JS SDK 推荐 dependency

[`@opentelemetry/api`](https://www.npmjs.com/package/@opentelemetry/api) + [`@opentelemetry/sdk-node`](https://www.npmjs.com/package/@opentelemetry/sdk-node)（Apache-2.0）。M0 实施 trace.ts 薄壳 wrap OTEL SDK + 脱敏 hook + Vessel 12 字段双 schema export。

---

## 6. Soul Spec Schema（**M2-Soul 实施回归单文件 `soul.md`**；plan §6 4-sibling 设计 defer）

> **2026-05-11 update**（闭合 M2-Soul closeout MINOR-arch-1）：实际 M2-Soul
> 实施**回归到单文件 `~/.vessel/soul.md`**（YAML frontmatter + Markdown body），
> 不是 v0A.1 计划的 4 sibling 文件结构。理由：YAGNI — 单 instance / 单 owner
> 场景下 4 sibling 字段独立演进的价值未显现，先用着；如果 dogfood 后真发现拆
> 分必要（git diff 噪音 / 字段竞争编辑）再补 schema migration。
>
> 实际生效的 schema 见 [packages/backend/src/soul/parser.ts](../../packages/backend/src/soul/parser.ts) (`SoulSpec`)。
>
> **当前 schema** (`schema_version: 1`):
> ```yaml
> schema_version: 1
> name: <Instance 名>                    # 必填
> personality:                            # 必填（mapping）
>   tone: <free text>                     # 可选
>   values: [<string>, ...]               # 可选
>   pronouns: <free text>                 # 可选
>   signature_phrases: [<string>, ...]    # 可选
> preferences:                            # 可选
>   language: <BCP-47 tag>                # 可选
>   verbosity: terse|balanced|verbose     # 可选
> ---
> <free-form markdown body>
> ```
> 渲染规则见 [soul/injector.ts](../../packages/backend/src/soul/injector.ts) `renderSoulPrompt()`：
> 注入到 Claude CLI 通过 `--append-system-prompt-file` (M2-Soul 闭合 ps-aux 暴露
> 风险后改用 file 形式)。空字段不渲染（不产生 "Tone: undefined" 噪音）。
>
> 下面 §6.1–§6.4 是 v0A.1 plan 的 4-sibling 设计，**保留作为未来演进参考**，
> 当前**未实施**。如要真实落地需要 `soul.md` schema migration + parser 改造
> + injector 重写 + 模板批量更新。

> **v0A.1 plan 原文（保留为历史参考，未实施）**：原单文件 `soul.md` 改为 **4 sibling 文件**结构。Prior Art：[OpenClaw](https://github.com/openclaw/openclaw)（2026 GitHub #1 by stars，~250-355K）+ [aaronjmars/soul.md](https://github.com/aaronjmars/soul.md)（460+ stars，MIT）。理由：git diff 友好 / 字段独立演进 / 跟业界 prior art 对齐。

### 6.1 文件结构（M2-Soul 起，按 ADR-005 INSTANCE 隔离）

```
instance/
├── SOUL.md                # 身份 / 价值观 / guardrails
├── STYLE.md               # 沟通风格（语言 / tone / pace）
├── SKILL.md               # 操作模式（chat / essay / coding / review / 等）
└── MEMORY.md              # 持久知识 / 用户事实（不是长期向量记忆，仅静态偏好）
```

### 6.2 加载顺序（`bootInstance()` 时按此拼 system prompt）

```
SOUL.md → STYLE.md → SKILL.md → MEMORY.md
```

每个文件独立 YAML frontmatter + 可选 markdown body。

### 6.3 Schema（每文件单独 Zod schema）

```typescript
// packages/shared/src/soul-spec.ts (M2-Soul 时新建)
import { z } from 'zod';

// SOUL.md ── 身份核心
export const SoulFileSchema = z.object({
  schemaVersion: z.number().int().min(1),
  instanceName: z.string().min(1).max(50),     // 强制 owner 改 != Soul Template 默认值
  inspiredBy: z.string().optional(),

  identity: z.object({
    name: z.string(),
    gender: z.string().optional(),
    pronouns: z.string().optional(),
  }),

  values: z.array(z.string()).min(1),          // 价值观（v0A.1: 独立字段，不再嵌套在 personality 下）
  guardrails: z.array(z.string()).optional(),  // 红线（v0A.1: 新加，OpenClaw 模式）

  body: z.string().optional(),                  // 自由形式补充
});
export type SoulFile = z.infer<typeof SoulFileSchema>;

// STYLE.md ── 沟通风格
export const StyleFileSchema = z.object({
  schemaVersion: z.number().int().min(1),
  tone: z.string(),
  vocabulary: z.string().optional(),
  pace: z.string().optional(),
  language_mix: z.string().optional(),         // 中英混杂等
  examples: z.array(z.object({
    bad: z.string(),
    good: z.string(),
    why: z.string(),
  })).optional(),                              // good/bad calibration（v0A.1: aaronjmars/soul.md 模式）
  body: z.string().optional(),
});
export type StyleFile = z.infer<typeof StyleFileSchema>;

// SKILL.md ── 操作模式（不是 Vessel 5 接口的 Skill；这是人格化的"模式"）
export const SkillFileSchema = z.object({
  schemaVersion: z.number().int().min(1),
  modes: z.array(z.object({
    name: z.string(),                          // 'chat' | 'essay' | 'coding' | 'review' | 'plan' | ...
    when: z.string(),                          // 触发场景描述
    behavior: z.string(),                      // 该模式下的行为约束
  })).min(1),
  body: z.string().optional(),
});
export type SkillFile = z.infer<typeof SkillFileSchema>;

// MEMORY.md ── 持久用户事实 / 偏好（静态；不是长期向量记忆）
export const MemoryFileSchema = z.object({
  schemaVersion: z.number().int().min(1),
  user: z.object({
    address: z.string(),                       // 怎么称呼用户
    honesty: z.string().optional(),            // 是否可以反驳 / 怼
  }),
  facts: z.array(z.string()).optional(),       // 关于用户的稳定事实（家人 / 偏好 / 工作 / etc.）
  preferences: z.record(z.string(), z.unknown()).optional(), // 任意 KV
  body: z.string().optional(),
});
export type MemoryFile = z.infer<typeof MemoryFileSchema>;

// 组合 SoulSpec（运行时由 parser 拼装）
export interface SoulSpec {
  soul: SoulFile;
  style: StyleFile;
  skill: SkillFile;
  memory: MemoryFile;
}
```

### 6.4 兼容性

- **向后兼容**：v0A.1 之前如有单文件 soul.md（M2-Soul 还没实施，所以**实际无生产数据**），M2-Soul 实施时直接走 4 sibling
- **Soul Templates Library**（M2-Soul `templates/soul/`）按 4 sibling 提供：每个 template 是一个目录（含 SOUL/STYLE/SKILL/MEMORY 4 文件）

```
templates/soul/
├── jarvis-style/
│   ├── SOUL.md
│   ├── STYLE.md
│   ├── SKILL.md
│   └── MEMORY.md
├── friday-style/
│   └── ...
└── blank/
    └── ...
```

### 6.5 注入目标（ADR-004 不变）

仍然渲染成 system prompt prefix → 注入到 `cli-runner.ts` spawn CC CLI 的 prompt（v0.1 仅 cli-runner-based Skills；非 cli-runner Skills 不带，按 R-12）。但**渲染顺序明确**：SOUL → STYLE → SKILL → MEMORY 拼接（`\n\n---\n\n` 分隔）。

### 6.6 SillyTavern V3 import（B1，v1+）

按 [B1 ROADMAP](#)（v1+ 议题）：未来支持从 SillyTavern V3 character card（PNG + tEXt `ccv3` chunk + base64 JSON）反向映射到 4 sibling 结构。详见 IDEAS.md。

---

## 7. App Manifest YAML schema（M0.5 起）

文件：`packages/capability-<id>/manifest.yaml`

```yaml
schemaVersion: 1                              # ADR-006 schema 演进
id: coding                                    # 必须匹配 directory name
name: Coding Capability
version: 0.1.0
description: Spawn CC CLI to write code; provides CodingSkill
author: yongqian

skills:
  - coding                                    # 提供的 Skill ids

tools: []                                     # 不暴露 Tool（仅 internal Skill 用）

mlWorkers: []                                 # 不依赖 ML worker

permissionScope:
  pathAllowlist:
    - "~/Desktop/Vessel/instance/workspace/"
  ops: [read, write, exec]

soulInjection: cli-runner-only                # ADR-004
```

Zod schema：

```typescript
// packages/shared/src/app-manifest.ts
import { z } from 'zod';

export const AppManifestSchema = z.object({
  schemaVersion: z.number().int().min(1),       // v0A 修订 Claude M-A1：同 SoulSpec
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),    // 小写字母 + 数字 + 连字符
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), // semver
  description: z.string(),
  author: z.string().optional(),

  skills: z.array(z.string()),
  tools: z.array(z.string()).optional(),
  mlWorkers: z.array(z.enum(['embedding', 'asr', 'tts'])).optional(),

  permissionScope: z.object({
    pathAllowlist: z.array(z.string()).optional(),
    ops: z.array(z.enum(['read', 'write', 'exec', 'network'])).optional(),
  }).optional(),

  soulInjection: z.enum(['cli-runner-only', 'all-skills']).optional(),
});

export type AppManifest = z.infer<typeof AppManifestSchema>;
```

---

## 8. Intent / Artifact / Session 字段表（跨端共享）

新加到 `packages/shared/src/protocol.ts`（沿用 Eva ClientMessage / ServerMessage 模式）：

```typescript
// Intent kind (ClientMessage 新加)
export const IntentSchema = z.object({
  id: z.string().uuid(),                        // intent_id
  sessionId: z.string(),                        // 跨入口的对话 ID
  text: z.string(),                             // 用户原始输入（可能未脱敏，进 vessel-core 后脱敏）
  type: z.enum(['user_text', 'voice_transcript', 'agent_internal', 'subscription_trigger']),
  source: z.enum(['cli', 'http', 'ws', 'voice', 'ios']),
  attachments: z.array(z.object({
    type: z.enum(['image', 'file']),
    mediaType: z.string(),
    dataBase64: z.string(),
  })).optional(),
  receivedAt: z.string().datetime(),
});

export type Intent = z.infer<typeof IntentSchema>;

// Artifact (Skill / Driver 输出) — v0A.1 修订（cursor M3）：discriminatedUnion 强制 type ↔ payload 一致
export const ArtifactSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().uuid(),
    type: z.literal('file'),
    filePath: z.string(),                       // 必须；绝对路径，instance/workspace/ 下
    mimeType: z.string().optional(),
    size: z.number().int(),                     // 必须；NFR-F2 文件大小记录
    createdAt: z.string().datetime(),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('text'),
    content: z.string(),                        // 必须
    mimeType: z.string().optional(),
    size: z.number().int().optional(),
    createdAt: z.string().datetime(),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('binary'),
    filePath: z.string(),                       // binary 必须落盘
    mimeType: z.string(),                       // binary 必须有 mimeType
    size: z.number().int(),
    createdAt: z.string().datetime(),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal('reference'),
    content: z.string(),                        // reference 用 content 存指针（如 trace_id / artifact id 等）
    createdAt: z.string().datetime(),
    metadata: z.record(z.unknown()).optional(),
  }),
]);

export type Artifact = z.infer<typeof ArtifactSchema>;

// Session（v0A 修订 cursor M3：单 source enum 无法表达跨入口共享）
export const SourceSchema = z.enum(['cli', 'http', 'ws', 'voice', 'ios']);
export type Source = z.infer<typeof SourceSchema>;

export const SessionSchema = z.object({
  id: z.string(),                               // sess_<YYYY-MM-DD>_<random>
  instanceId: z.string(),                       // M2-Soul 起绑定 Instance（默认 'vessel-core'）
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  createdFrom: SourceSchema,                    // 创建 session 的入口
  activeSources: z.array(SourceSchema).optional(), // 后续跨入口加入的 source（CLI 起 sess → Web 接入时 push）
});

// Intent.source 仍是单 enum（每条 Intent 来自一个明确入口；按 cursor M3 解释）

export type SessionId = string;
export type Session = z.infer<typeof SessionSchema>;
```

iOS Swift Codable 同步：`packages/ios-native/Sources/ClaudeWeb/HarnessProtocol.swift` 加镜像（按 NFR-X1 fixture round-trip 测）。

---

## 9. 三层 Boot 时序（CONCEPTS §3.5 → TS 序列）

`packages/backend/src/boot.ts`：

```typescript
import type { TraceWriter } from './observability/trace';
import type { Memory } from './interfaces/memory';
import type { CapabilityApp } from './interfaces/app';
// ... 其他 imports

/** ① 进程级（一次性，进程启动时）*/
export async function bootProcess(): Promise<ProcessHandle> {
  // 1. 加载 ENV / config（按 ADR-008）
  // 2. 加载内核服务：
  //    - Memory（开 SQLite + sqlite-vec）
  //    - Tool Registry
  //    - Permission middleware
  //    - Event Bus（asyncio.Queue / Node EventEmitter）
  //    - Logger / Trace writer
  // 3. 注册 Drivers：
  //    - 检测 CC CLI 在 PATH（ADR-016 ClaudeCodeDriver）
  //    - 准备 ML worker manager（不立即 spawn，按需）
  // 4. 加载已安装的 Capability Apps（按 manifest.yaml）：
  //    - 每个 App.boot() spawn helper subprocess（按需）
  //    - 注册 Skill / Tool 到 registry
  // 5. 启动 Gateway：
  //    - HTTP server（M1A 起）
  //    - WebSocket upgrade handler
  //    - CLI server（M0 起，监听 stdin / `vessel-core <intent>` 命令）
  return processHandle;
}

/** ② Instance 级（vessel-core 起来后第一次绑定 Instance；M0 最小骨架，M2-Soul 扩展）*/
export async function bootInstance(processHandle: ProcessHandle): Promise<InstanceHandle> {
  // M0 最小骨架：
  //   1. 加载 Instance 名（M0 默认 'vessel-core'）
  //   2. 初始化 Memory（恢复历史对话索引；向量库就绪）
  //   3. 报 ready 给 Gateway

  // M2-Soul 扩展：
  //   4. 读 instance/soul.md → 解析 SoulSpec → 注入到 cli-runner prompt wrapper
  //   5. 加载 Instance 名（用户取的，如 'EVA'）

  return instanceHandle;
}

/** ③ Session 级（每次新会话第一个 Intent 时触发）*/
export async function bootSession(intent: Intent, instanceHandle: InstanceHandle): Promise<SessionHandle> {
  // 1. 创建 session_id（如 sess_2026-05-09_abc123）
  // 2. 拉相关长期记忆（向量检索 top-K，M1C-B 起）
  // 3. 创建 trace span（trace_id 此时分配）
  // 4. 检查是否有上次没结束的 Workflow（HITL 待恢复点，M1C-A 起）

  return sessionHandle;
}
```

**关键**：三层独立可重入（CONCEPTS §3.5）—— 改 soul.md 只触发 ②，不重启整个进程；新会话只触发 ③，不重启 Instance。

---

## 10. NFR Scenarios → 接口字段映射（反向驱动验证）

每个 NFR scenario（REQUIREMENTS §C）必须能在接口签名找到落地：

| NFR | 接口落地点 |
|---|---|
| NFR-O1 trace 全链路 | `TraceContext` + `ENV_KEYS` + 每层 boot 创建 child span |
| NFR-O2 trace 脱敏 | `TraceWriter.write()` 内部按 trace-redaction-spec 处理 payload + artifact_refs |
| NFR-O3 trace 重放 | `vessel-core trace replay <id>` CLI 命令 + `TraceEvent` schema 完整 |
| NFR-C1 Capability 卸载彻底 | `CapabilityApp.uninstall()` + `HelperHandle.shutdown()` |
| NFR-C2 专属 worker uninstall 立即 shutdown | `HelperHandle.shutdown()` SIGTERM + 5s SIGKILL |
| NFR-C3 共享 worker TTL 回收 | ML worker manager 内部 lifecycle（按 ADR-012）|
| NFR-P1 路径白名单 | `Tool.permissionScope.pathAllowlist` + middleware check |
| NFR-P2 白名单正常 | 同 NFR-P1（成功路径）|
| NFR-P3 Capability 越权 | `AppManifest.permissionScope` enforce |
| NFR-F1 CC 子进程崩溃恢复 | `CodingDriver.health()` + Agent fail / 主进程不挂 |
| NFR-F2 ML worker 启动失败 graceful | `EmbeddingClient.health()` + 主进程标 capability unavailable |
| NFR-F3 Workflow HITL 恢复 | workflow_state 表（migration 0004 v103）+ `Workflow.resume()` API |
| NFR-X1 Wire Protocol round-trip | Zod fixture + Swift Codable 镜像 |
| NFR-X2 iOS 服务发现兼容 | iOS NWBrowser + 手填 IP fallback（M2-iOS 落地） |
| NFR-S1 主进程唯一常驻 | `bootProcess` 单例 + helper subprocess lifecycle |

**0A FRAMEWORK Acceptance**：14 个 NFR scenarios 全部能在接口签名找到对应字段 / 方法。

---

## 11. 暂缓（v1+ 再加）

按 v0.1 范围，**不在本 FRAMEWORK 锁的 schema**：

- LLM Driver interface（v0.1 不上 LLM Driver）
- 多 Instance 切换协议（v1+ multi-instance）
- Capability 第三方发布协议（v1+ 社区分享 Soul Templates）
- Cross-machine ML worker（违反"个人单机"硬约束）
- Telemetry 跨设备汇总（v1+）

这些在未来 ADR 单独锁定。
