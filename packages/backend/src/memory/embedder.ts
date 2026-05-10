/**
 * embedder — TS-in-process ONNX embedding via @huggingface/transformers.
 *
 * Per ADR-012 amendment 2026-05-10: small ONNX models (< 200MB) run in the
 * vessel-core process directly, not as a Python worker subprocess. Default
 * model: bge-small-zh-v1.5 (Xenova ONNX mirror).
 *
 * Lifecycle:
 *   - Lazy: pipeline created on first embed() / ready() call
 *   - Singleton: one pipeline per process (model load is ~96MB cold start)
 *   - Background-friendly: ready() returns a Promise so callers can pre-warm
 *     during boot without blocking
 *   - Health: health() reports model_loaded vs not, with reason string
 *
 * M1C-B gate items addressed:
 *   - in-process embedding fallback (catches model load errors → mark capability
 *     unavailable, vessel-core still works for other commands)
 *   - HF CDN download mitigation (transformers.js caches under HF_HOME; first
 *     download blocks the ready() Promise so callers can show "loading...")
 *   - EmbeddingClient.health() in-process semantics (model loaded check)
 */

import { pipeline, env as transformersEnv, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { join } from 'node:path';
import { DATA_DIR } from '../data-dir.js';

/** Default embedding model — see ADR-012 amendment + spike report. */
export const DEFAULT_EMBED_MODEL = 'Xenova/bge-small-zh-v1.5';
export const DEFAULT_EMBED_DIM = 512;

// M1C-B+: anchor model cache to $VESSEL_DATA_DIR/models so a `pnpm install` (which
// blows away node_modules including transformers.js's default `.cache`) doesn't
// trigger another 90MB redownload.
//
// Override priority (highest first):
//   1. VESSEL_HF_CACHE_DIR — explicit cache path (handy for tests that want
//      memory.db in a tmp dir but reuse the production model cache)
//   2. HF_HOME — standard Hugging Face env var (transformers.js respects on
//      its own; we honor it by skipping our cacheDir override)
//   3. $VESSEL_DATA_DIR/models (default)
//
// transformersEnv.cacheDir applies on first model load; subsequent loads
// reuse cached files. mkdir is implicit on first download.
const explicitCache = process.env.VESSEL_HF_CACHE_DIR;
if (explicitCache && explicitCache.trim() !== '') {
  transformersEnv.cacheDir = explicitCache;
} else if (!process.env.HF_HOME) {
  transformersEnv.cacheDir = join(DATA_DIR, 'models');
}

interface EmbedderState {
  model: string;
  pipelinePromise: Promise<FeatureExtractionPipeline> | null;
  loadedModel: string | null;
  loadError: string | null;
}

const state: EmbedderState = {
  model: DEFAULT_EMBED_MODEL,
  pipelinePromise: null,
  loadedModel: null,
  loadError: null,
};

/** Override the default model. Must be called before first embed() / ready(). */
export function setEmbedModel(model: string): void {
  if (state.pipelinePromise) {
    throw new Error('cannot change embed model after first use; restart vessel-core');
  }
  state.model = model;
}

/** Get the current model id (whatever was set or default). */
export function getEmbedModel(): string {
  return state.model;
}

/**
 * Resolve the pipeline, kicking off model download on first call. Subsequent
 * callers await the same promise.
 */
async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (state.pipelinePromise) return state.pipelinePromise;

  state.loadError = null;
  state.pipelinePromise = (async () => {
    try {
      const pipe = (await pipeline('feature-extraction', state.model)) as FeatureExtractionPipeline;
      state.loadedModel = state.model;
      return pipe;
    } catch (err) {
      state.loadError = err instanceof Error ? err.message : String(err);
      // Reset so a retry can re-download (e.g. after fixing network).
      state.pipelinePromise = null;
      throw err;
    }
  })();

  return state.pipelinePromise;
}

/**
 * Pre-warm the model. Returns when the pipeline is ready or rejects on
 * load failure. Safe to call multiple times — second call awaits the same
 * promise.
 */
export async function ready(): Promise<void> {
  await getPipeline();
}

/**
 * Embed a batch of texts. Returns one Float32Array per input — each of length
 * DEFAULT_EMBED_DIM (512 for bge-small-zh-v1.5). Vectors are L2-normalized
 * (transformers.js `pooling: 'mean', normalize: true`) so cosine == dot product.
 *
 * Empty input returns empty array. Throws on model load failure.
 */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const pipe = await getPipeline();
  const out: Float32Array[] = [];
  // transformers.js batches internally per call; we forward one string at a
  // time to keep memory bounded for arbitrary input length. Could batch
  // adaptively later (M1C-B closeout MINOR follow-up).
  for (const text of texts) {
    const result = await pipe(text, { pooling: 'mean', normalize: true });
    // result.data is Float32Array of length 512 for bge-small.
    out.push(new Float32Array(result.data as ArrayLike<number>));
  }
  return out;
}

/** Single-text convenience — same shape as embed([text])[0]. */
export async function embedOne(text: string): Promise<Float32Array> {
  const [vec] = await embed([text]);
  return vec!;
}

/**
 * Health snapshot for `vessel-core memory status` and /api/health/full.
 * No I/O; reports state from the singleton.
 */
export function health(): { ok: boolean; model: string; loaded: boolean; reason?: string } {
  const result: { ok: boolean; model: string; loaded: boolean; reason?: string } = {
    ok: state.loadedModel === state.model && state.loadError === null,
    model: state.model,
    loaded: state.loadedModel === state.model,
  };
  if (state.loadError) result.reason = state.loadError;
  else if (!state.loadedModel) result.reason = 'not loaded yet';
  return result;
}

/** Test-only — reset singleton between integration test cases. */
export function _resetForTest(): void {
  state.pipelinePromise = null;
  state.loadedModel = null;
  state.loadError = null;
}
