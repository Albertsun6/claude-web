// Append-only JSONL telemetry log at ~/.claude-web/telemetry.jsonl. Used by
// the iOS app (and potentially future clients) to ship structured event logs
// for bug diagnosis. Personal-sideload semantics — no PII filter, no SaaS,
// just a local file the user greps.
//
// Rotation: when the file exceeds ~10MB, we rename to `telemetry.jsonl.1`
// (single rolling backup) and start fresh. Two files = enough history for
// a few weeks of normal use.

import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./data-dir.js";

const STORE_DIR = DATA_DIR;
const STORE_PATH = path.join(STORE_DIR, "telemetry.jsonl");
const ROLLED_PATH = STORE_PATH + ".1";
const MAX_SIZE = 10 * 1024 * 1024;   // 10 MB

export interface TelemetryEvent {
  timestamp: string;        // ISO8601
  level: "info" | "warn" | "error" | "crash";
  event: string;            // dotted event name like "ws.connect.failed"
  conversationId?: string;
  runId?: string;
  props?: Record<string, unknown>;
  appVersion?: string;
  buildVersion?: string;
  deviceModel?: string;
  source?: string;          // "ios" | "web" | etc — server stamps this if missing
}

// Serialize writes through a promise queue so concurrent batch POSTs don't
// interleave each other's lines.
let writeQueue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => undefined);
  return next;
}

async function ensureDir() {
  await mkdir(STORE_DIR, { recursive: true });
}

async function maybeRotate() {
  try {
    const st = await stat(STORE_PATH);
    if (st.size > MAX_SIZE) {
      await rename(STORE_PATH, ROLLED_PATH);
    }
  } catch {
    // missing file = nothing to rotate, that's fine
  }
}

export async function appendEvents(events: TelemetryEvent[], source?: string): Promise<number> {
  if (events.length === 0) return 0;
  return withLock(async () => {
    await ensureDir();
    await maybeRotate();
    // Stamp `source` and a server-side received timestamp so we can tell
    // when the event was logged vs when it actually happened on the device.
    const receivedAt = new Date().toISOString();
    const lines = events
      .map((e) => {
        const stamped = {
          ...e,
          source: e.source ?? source ?? "unknown",
          receivedAt,
        };
        return JSON.stringify(stamped);
      })
      .join("\n") + "\n";
    await appendFile(STORE_PATH, lines, "utf-8");
    return events.length;
  });
}

export function telemetryStorePath(): string {
  return STORE_PATH;
}
