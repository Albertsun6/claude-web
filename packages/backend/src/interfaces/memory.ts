/**
 * Memory — 分层记忆接口（FRAMEWORK §2.4）
 *
 * 三层（v0A.1 路线，A2 推到 M1C-A/B 实施）：
 *  - **Short term**（对话上下文，进程内 in-memory）
 *  - **Session KV**（跨重启，SQLite session_kv 表）
 *  - **Long term**（向量检索，sqlite-vec + ML worker embedding）
 *
 * Lifecycle:
 *  - 由 vessel-core 启动时创建（按三层 boot §3.5）
 *  - Session 级初始化拉相关 long-term memory
 *
 * @see CONCEPTS §3.1 Memory / ADR-002 embedding-fastembed
 * @see FRAMEWORK §2.4
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
