# Third-Party Code Notices

> Code adapted from third-party open-source projects. Original copyright remains
> with the original authors; modifications fall under the same license unless
> noted otherwise.
>
> claude-web/Seaidea is a personal-use tool, not distributed (see [docs/HARNESS_ROADMAP.md §0 #13](../docs/HARNESS_ROADMAP.md)).
> Copyleft licenses (AGPL/GPL/LGPL) only require source disclosure on
> distribution; this project is currently exempt. This file documents
> attribution as required by basic copyright law and to preserve future
> flexibility.

---

## tiann/hapi (AGPL-3.0)

Source repo: <https://github.com/tiann/hapi>
Reference commit: `7d55bc145672b0b9ce8a688cde1bd5c48eb2c49b` (fetched 2026-05-01)
License: AGPL-3.0
License file: <https://github.com/tiann/hapi/blob/main/LICENSE>

### Borrowed components

| claude-web file | hapi source | Borrow type |
|---|---|---|
| `packages/backend/src/notifications/hub.ts` | `hub/src/notifications/notificationHub.ts` | Adapted: fan-out architecture, ready cooldown, per-channel error isolation. Removed SyncEngine dependency, simplified Session model. |
| `packages/backend/src/notifications/types.ts` | `hub/src/notifications/notificationTypes.ts` | Adapted: NotificationChannel interface trimmed for claude-web's per-conversation model. |
| `packages/backend/src/notifications/channels/serverchan.ts` | `hub/src/serverchan/channel.ts` | Adapted: ServerChan POST helper preserved as-is (~30 lines); event mapping rewritten for claude-web's conversation model. |

Each adapted file carries a header comment in the form:

```ts
// Adapted from tiann/hapi@7d55bc14 (AGPL-3.0)
// Original: hub/src/notifications/<file>.ts
// Modifications: <brief summary>
// See third_party/NOTICES.md for full attribution
```

---

## getpaseo/paseo (AGPL-3.0)

Source repo: <https://github.com/getpaseo/paseo>
Reference commit: TBD (when first borrowed)
License: AGPL-3.0

### Borrowed components

(none yet)

Future borrows (planned):
- `packages/app/src/hooks/use-push-token-registration.ts` — APNs token registration logic, will be translated to Swift for `packages/ios-native/Sources/ClaudeWeb/PushToken.swift` if/when APNs is added (M0.5 item #7).

---

## Maintenance rules

1. Every file that contains adapted code must carry the header comment shown above.
2. When borrowing new code, append an entry to the table for the source project.
3. If the original project changes license (e.g. AGPL → MIT), update the License row but keep the original commit reference.
4. If claude-web ever changes status from "personal-use, not distributed" to "distributed in any form" (open-source, give to a friend, deploy to public, sell), this file becomes the audit checklist for AGPL compliance — every entry needs review for either source disclosure or rewrite/replacement.
