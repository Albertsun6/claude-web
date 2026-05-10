/**
 * ML Worker 内部契约（FRAMEWORK §4，不在 5 接口里）
 *
 * v0A.1 修订（A6 + cursor M1, 2026-05-10）：
 *  - HTTP loopback + OpenAI-compatible API（Ollama / Open WebUI Pipelines 模式）
 *  - 不是 stdin/stdout JSON-RPC
 *  - 详细签名以 FRAMEWORK §4.2 为权威
 *
 * 端口分配（按 FRAMEWORK §4.1）：
 *  - embedding-server (fastembed):  127.0.0.1:11435  (OpenAI Embeddings API 兼容)
 *  - whisper-server (whisper.cpp):  127.0.0.1:11436  (OpenAI Audio API 兼容)
 *  - piper-server (piper-tts):      127.0.0.1:11437  (OpenAI Audio Speech 兼容)
 *
 * @see ADR-012 / FRAMEWORK §4
 */

/** EmbeddingClient — Memory.longTerm 内部 helper（HTTP client over 127.0.0.1:11435）*/
export interface EmbeddingClient {
  embed(input: string | string[], opts?: { model?: string }): Promise<number[][]>;
  health(): Promise<{ ok: boolean; reason?: string; modelsLoaded?: string[] }>;
}

/** ASR Client — voice Capability 内部 helper（HTTP client over 127.0.0.1:11436）*/
export interface AsrClient {
  transcribe(wav: Buffer, opts?: { language?: string; model?: string }): Promise<string>;

  /** NDJSON 流式（streaming transcription，M2-Voice 之后）*/
  transcribeStream?(
    wav: ReadableStream<Uint8Array>,
    opts?: { language?: string; model?: string }
  ): AsyncIterable<{ delta: string; isFinal: boolean }>;

  health(): Promise<{ ok: boolean; reason?: string }>;
}

/** TTS Client — voice Capability 内部 helper（HTTP client over 127.0.0.1:11437）*/
export interface TtsClient {
  synthesize(
    text: string,
    opts?: { voice?: string; speed?: number; format?: 'wav' | 'mp3' }
  ): Promise<Buffer>;

  /** NDJSON 流式（low-latency TTS，M2-Voice 之后）*/
  synthesizeStream?(
    text: string,
    opts?: { voice?: string; speed?: number; format?: 'wav' | 'mp3' }
  ): AsyncIterable<Uint8Array>;

  health(): Promise<{ ok: boolean; reason?: string }>;
}
