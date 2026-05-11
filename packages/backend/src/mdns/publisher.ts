/**
 * mDNS Bonjour publisher — broadcast `_vessel._tcp` so iOS / other LAN clients
 * can discover vessel-core via NWBrowser without manual IP entry.
 *
 * M2-iOS-α scope: zero new dependency — wraps macOS-builtin `dns-sd -R`
 * subprocess. Linux/Windows would need avahi or a node-mdns library; we cross
 * that bridge if/when Vessel ever runs off-Mac (个人单机定位 → Mac is the
 * primary target).
 *
 * Lifecycle:
 *   spawn dns-sd -R "<instanceName>" _vessel._tcp local <port>
 *   on shutdown → SIGTERM the child, wait briefly, SIGKILL if alive.
 *
 * Per ADR-009 lifecycle conventions; symmetric with McpServerManager.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { hostname } from 'node:os';

const SERVICE_TYPE = '_vessel._tcp';
const SHUTDOWN_GRACE_MS = 1500;

let child: ChildProcess | null = null;
let publishedSpec: { instanceName: string; port: number } | null = null;

export interface PublishOptions {
  port: number;
  /** Defaults to "Vessel-<hostname-prefix>" so multiple Macs on a LAN don't collide. */
  instanceName?: string;
}

function defaultInstanceName(): string {
  // Take first label of hostname; trim trailing .local. Avoid odd chars.
  const raw = hostname().split('.')[0]!.replace(/[^A-Za-z0-9-]/g, '');
  const safe = raw.length > 0 ? raw : 'mac';
  return `Vessel-${safe}`;
}

/**
 * Start broadcasting `_vessel._tcp`. Idempotent — second call with same port
 * is a no-op; second call with different port is a re-register.
 *
 * Non-throwing: if dns-sd is unavailable (non-Mac, or stripped image) we warn
 * and skip — the manual-IP fallback path still works for clients.
 */
export function startMdnsPublisher(opts: PublishOptions): void {
  const instanceName = opts.instanceName ?? defaultInstanceName();

  if (child && publishedSpec && publishedSpec.port === opts.port && publishedSpec.instanceName === instanceName) {
    return; // already publishing same spec
  }

  if (child) {
    stopMdnsPublisher();
  }

  try {
    const proc = spawn('dns-sd', ['-R', instanceName, SERVICE_TYPE, 'local', String(opts.port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    if (!proc.pid) {
      console.warn(`[mdns] dns-sd spawn returned no pid; service discovery unavailable`);
      return;
    }

    proc.stdout?.on('data', () => { /* swallow normal "STARTING / Name now registered" chatter */ });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const txt = chunk.toString().trim();
      if (txt) console.warn(`[mdns/dns-sd] ${txt}`);
    });

    proc.on('exit', (code, signal) => {
      child = null;
      publishedSpec = null;
      if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
        console.warn(`[mdns] dns-sd exited unexpectedly: code=${code} signal=${signal}`);
      }
    });

    proc.on('error', (err) => {
      // 'error' fires if dns-sd binary is missing — fail-soft.
      console.warn(`[mdns] dns-sd unavailable: ${err.message} (manual-IP fallback still works)`);
      child = null;
      publishedSpec = null;
    });

    child = proc;
    publishedSpec = { instanceName, port: opts.port };
    console.log(`[mdns] broadcasting ${instanceName}.${SERVICE_TYPE} on port ${opts.port}`);
  } catch (err) {
    console.warn(`[mdns] failed to start: ${(err as Error).message}`);
  }
}

/** Stop the dns-sd subprocess. Idempotent. */
export function stopMdnsPublisher(): void {
  if (!child) return;
  try { child.kill('SIGTERM'); } catch { /* already gone */ }

  // Best-effort SIGKILL after grace window. Don't await — this runs synchronously
  // from signal handlers where blocking would delay process exit.
  const c = child;
  setTimeout(() => {
    if (c.exitCode === null && !c.killed) {
      try { c.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }, SHUTDOWN_GRACE_MS).unref();

  child = null;
  publishedSpec = null;
}

/** Test/inspection — currently published spec, or null. */
export function getPublishedSpec(): Readonly<{ instanceName: string; port: number }> | null {
  return publishedSpec;
}
