// Placeholder router for OpenAI Realtime ephemeral session minting.
//
// In a future patch, this endpoint will use a server-held `OPENAI_API_KEY`
// to mint a short-lived ephemeral client token via the OpenAI Realtime
// "client_secrets" / sessions API, returning it to the browser so the
// frontend can negotiate a WebRTC connection directly with OpenAI for
// low-latency STT/TTS without ever exposing the long-lived key.
//
// For now this is a stub returning HTTP 501 so the frontend can detect
// "realtime not configured" and gracefully fall back to the Web Speech API.

import { Hono } from "hono";

export const realtimeRouter = new Hono();

realtimeRouter.get("/session", (c) =>
  c.json({ ok: false, error: "openai realtime not yet configured" }, 501),
);
