import { Hono } from "hono";
import { randomUUID } from "node:crypto";

export type PermissionDecision = "allow" | "deny";

interface PendingResolver {
  resolve: (decision: PermissionDecision) => void;
}

interface RegistryEntry {
  send: (msg: unknown) => void;
  pending: Map<string, PendingResolver>;
}

// keyed by per-WS-connection token. The hook script presents this token in its
// HTTP POST so the backend knows which browser session to ask.
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
      for (const r of entry.pending.values()) r.resolve("deny");
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
    entry.pending.set(requestId, { resolve });
    entry.send({
      type: "permission_request",
      requestId,
      toolName: payload?.tool_name ?? "unknown",
      input: payload?.tool_input ?? {},
    });
  });

  return c.json({ decision });
});
