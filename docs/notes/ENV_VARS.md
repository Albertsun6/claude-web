# Vessel Env Vars Reference

> 闭合 M1B+ MINOR-risk-1 (VESSEL_ALLOWED_ROOTS 与 MCP scope 关系)
> + M2-iOS-α MINOR-arch-3 (VESSEL_DISABLE_MDNS) + risk-1 (hostname 双重曝光)

## Production env vars (set in launchd plist)

| Env | Default | Effect | Notes |
|---|---|---|---|
| `PORT` | `3030` (Eva) / `3032` (Vessel) | HTTP / WS bind port | launchd plist sets |
| `BACKEND_HOST` | `127.0.0.1` | Bind interface | only set `0.0.0.0` behind reverse proxy |
| `VESSEL_DATA_DIR` | `~/.vessel` | All Vessel data: memory.db / soul.md / models / traces / workspace | per-Instance isolation (ADR-005) |
| `VESSEL_TOKEN` | unset (dev) | Bearer/query token required for all `/api/*` except `NO_AUTH_PATHS` | unset=dev mode 警告；Tailscale 暴露**必须**设 |
| `VESSEL_ALLOWED_ROOTS` | unset | Colon-separated absolute paths whitelist for cwd / `vessel-fs` (M1B) | **不**包括 MCP server filesystem scope (见下) |
| `VESSEL_MCP_SERVERS` | unset | JSON array of `{name, command, args, env?}` MCP server specs | M1B+ injects via `--mcp-config` to Claude CLI |
| `VESSEL_MEMORY_AUGMENT` | unset (=on) | Set `0` to disable cli-runner memory KNN augmentation | soul-memory integration |
| `VESSEL_MEMORY_TOPK` | `3` | Top-K memory records pulled into system prompt (1–20 enforced) | |
| `VESSEL_HF_CACHE_DIR` | `$VESSEL_DATA_DIR/models` | Override HF model cache (priority: this > `HF_HOME` > default) | M1C-B+ closeout |
| `VESSEL_DISABLE_MDNS` | unset (=enabled) | Set `1` to disable `_vessel._tcp` mDNS broadcasting | useful in CI / hostile WiFi / privacy mode |
| `CLAUDE_CLI` | `claude` | Claude CLI binary path | rare override |
| `WHISPER_BIN` / `WHISPER_MODEL` / `FFMPEG_BIN` / `EDGE_TTS_BIN` | system PATH | Voice helper bin overrides | Eva voice path |

## Permission scope boundaries — VERY important

**`VESSEL_ALLOWED_ROOTS` does NOT govern MCP server filesystem scope.**

```
┌─────────────────────────────────────────────────────────┐
│ Scope                                  │ Enforced by    │
├────────────────────────────────────────┼────────────────┤
│ cwd of spawned Claude CLI              │ verifyAllowedPath in auth.ts │
│ /api/vessel/fs/* read access           │ verifyAllowedPath in vessel-fs.ts │
│ MCP server filesystem operations       │ The MCP server itself (e.g. │
│                                         │ `@mcp/server-filesystem` takes │
│                                         │ a root arg in its own spec) │
│ Soul/memory file reads                 │ Hardcoded to $VESSEL_DATA_DIR │
└────────────────────────────────────────┴────────────────┘
```

When you configure `VESSEL_MCP_SERVERS` with e.g. `@modelcontextprotocol/server-filesystem`,
its `args: ["/some/path"]` defines the MCP server's own root. Vessel-core does
NOT verify these paths against `VESSEL_ALLOWED_ROOTS`. **You configure each MCP
server's scope at the MCP server level.**

Why: MCP is a protocol; each MCP server has its own permission semantics
(filesystem servers take a root, git servers take a repo, etc.). Vessel can't
know what every MCP server's "scope" means generically. The right mental model:
treat each MCP server as a sub-component you configure once per its docs.

## NO_AUTH_PATHS — what bypasses auth middleware

In `auth.ts`, `NO_AUTH_PATHS = Set<string>` lists routes that intentionally
skip token check even when `VESSEL_TOKEN` is set:

| Path | Why no-auth |
|---|---|
| `/api/vessel/health` | LAN service-discovery probe (M2-iOS-α NWBrowser flow). Response leaks no secrets — only public service identity (service/version/hostname/uptime/sessions count/runs count/bonjour metadata/soul.name). All these are visible via mDNS broadcast already. |

To add a new bypass: edit `NO_AUTH_PATHS` directly in `auth.ts` (not env-driven
— prevents accidental backdoor expansion via env injection). Document the
reason in the Set definition's comment.

## mDNS broadcast — what's exposed on LAN

`com.vessel.backend` launchd job by default broadcasts `_vessel._tcp` so
iOS NWBrowser can auto-discover (M2-iOS-α/β). The broadcast packet contains:
- Instance name: `Vessel-<hostname-prefix>` (e.g. `Vessel-Albert-Macbook`)
- Service type: `_vessel._tcp`
- Domain: `local.`
- Port (resolves on demand): the configured `PORT`

**Privacy implication**: anyone on the same LAN can see your hostname-derived
instance name and that you're running Vessel. They can `dig +short -t SRV
_vessel._tcp.local` and connect to your `/api/vessel/health`, getting your
full hostname + soul.name (if set) + `sessions` and `runs` counts.

**Mitigations**:
- Set `VESSEL_DISABLE_MDNS=1` to disable broadcasting (manual IP entry still
  works; iOS app's Settings → Backend has manual URL field as fallback).
- On hostile WiFi (cafés, hotels), use Tailscale + Vessel on `127.0.0.1` only,
  not LAN-broadcast.
- For multi-Instance Mac (rare), use distinct `instanceName` once that override
  ships (currently hostname-derived only).

## hostname double exposure — explicit acknowledgement

The same hostname appears in TWO LAN-public surfaces:
1. **mDNS broadcast** (`Vessel-<hostname-prefix>` instance name)
2. **`/api/vessel/health` response** (`hostname` field, full hostname)

This is **intentional** for service-discovery UX (iOS app shows "Connected to
\<hostname\>"), but means LAN scanners can fingerprint your Mac.

If you don't want this:
- Set `VESSEL_DISABLE_MDNS=1` (kills #1)
- Auth-protect `/api/vessel/health` by removing it from `NO_AUTH_PATHS` (kills
  #2 but breaks NWBrowser discovery flow — manual IP only)

For personal-single-machine + tailscale setup, this exposure is acceptable
(your Mac's hostname is also visible via Tailscale's MagicDNS).
