# launchd plists — stable + dev backend

Two-instance dogfooding setup:

| Plist | Port | Data dir | Mode | Use |
|---|---|---|---|---|
| `com.claude-web.backend.plist` | 3030 | `~/.claude-web` | `pnpm start:backend` (no watch) | iOS / Tailscale prod traffic |
| `com.claude-web.backend.dev.plist` | 3031 | `~/.claude-web-dev` | `pnpm dev:backend` (tsx watch) | active development |

Edits to `packages/backend/src/**` only auto-reload **dev**. Stable keeps running its in-memory copy of the source until explicitly promoted.

## Install (first time)

```bash
# stable — replaces the existing plist (brief :3030 downtime)
cp scripts/launchd/com.claude-web.backend.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.claude-web.backend.plist
launchctl load -w ~/Library/LaunchAgents/com.claude-web.backend.plist

# dev
cp scripts/launchd/com.claude-web.backend.dev.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.claude-web.backend.dev.plist
```

## Promote dev → stable

After dev validates a change, promote it to the stable instance:

```bash
launchctl kickstart -k gui/$(id -u)/com.claude-web.backend
```

`-k` means kill+restart. Stable picks up whatever is currently in `packages/backend/src/`.

## Tailscale exposure (optional)

Stable is already exposed via the existing `tailscale serve` config. To also reach **dev** from a real iPhone:

```bash
tailscale serve --bg --https=8443 http://localhost:3031
```

Then in iOS Settings → Backend, tap "Dev — Tailscale (:8443)".

## Snapshot prod data → dev (read-only)

When you want dev to have realistic data without risking prod:

```bash
# safe to copy: the read-mostly registry + sessions cache
cp ~/.claude-web/projects.json ~/.claude-web-dev/

# do NOT copy: harness.db (schema may drift), telemetry.jsonl (bloats),
# inbox.jsonl (you'll get duplicate triage), notify.json (push tokens)
```

## Stop / start

```bash
launchctl unload ~/Library/LaunchAgents/com.claude-web.backend.dev.plist  # stop dev
launchctl load   -w ~/Library/LaunchAgents/com.claude-web.backend.dev.plist  # start dev

launchctl list | grep claude-web   # status
tail -f ~/Library/Logs/claude-web-backend.dev.stderr.log
```
