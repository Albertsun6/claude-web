import { Hono } from "hono";
import { randomUUID } from "node:crypto";

export type PermissionDecision = "allow" | "deny";

interface PendingResolver {
  resolve: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
}

interface RegistryEntry {
  send: (msg: unknown) => void;
  pending: Map<string, PendingResolver>;
}

// Hook-script timeout is 600s (configured in cli-runner). Match that here so
// the HTTP request from the hook resolves before the hook itself times out
// (which would yield an unbounded zombie hook process otherwise).
const PENDING_TIMEOUT_MS = 590_000;

const registry = new Map<string, RegistryEntry>();

export function registerPermissionChannel(
  token: string,
  send: (msg: unknown) => void,
): () => void {
  registry.set(token, { send, pending: new Map() });
  return () => {
    const entry = registry.get(token);
    if (entry) {
      // resolve any in-flight requests as deny so hooks don't hang
      for (const r of entry.pending.values()) {
        clearTimeout(r.timer);
        r.resolve("deny");
      }
    }
    registry.delete(token);
  };
}

export function resolvePermission(
  token: string,
  requestId: string,
  decision: PermissionDecision,
): void {
  const entry = registry.get(token);
  if (!entry) return;
  const resolver = entry.pending.get(requestId);
  if (!resolver) return;
  entry.pending.delete(requestId);
  clearTimeout(resolver.timer);
  resolver.resolve(decision);
}

export const permissionRouter = new Hono();

permissionRouter.post("/ask", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ decision: "allow", reason: "missing token" });
  const entry = registry.get(token);
  if (!entry) return c.json({ decision: "allow", reason: "session not found" });

  let payload: any;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ decision: "allow", reason: "bad payload" });
  }

  const requestId = randomUUID();
  const decision = await new Promise<PermissionDecision>((resolve) => {
    const timer = setTimeout(() => {
      const e = registry.get(token);
      if (e) e.pending.delete(requestId);
      // Fail-open on timeout so the hook doesn't sit forever; the user can
      // always interrupt the run if they didn't intend the tool to fire.
      resolve("allow");
    }, PENDING_TIMEOUT_MS);
    entry.pending.set(requestId, { resolve, timer });
    entry.send({
      type: "permission_request",
      requestId,
      toolName: payload?.tool_name ?? "unknown",
      input: payload?.tool_input ?? {},
    });
  });

  return c.json({ decision });
});
