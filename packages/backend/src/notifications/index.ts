// Top-level notifications module.
// Builds a NotificationHub from current settings; returns NoOpHub if no
// channels are configured. Caller (index.ts) calls publish* methods at
// session lifecycle events.

import { NotificationHub, NoOpHub } from "./hub.js";
import { ServerChanChannel } from "./channels/serverchan.js";
import { TelegramChannel } from "./channels/telegram.js";
import { loadNotificationSettings } from "./settings.js";
import type { NotificationChannel } from "./types.js";

export type { NotificationContext, SessionEndReason, TaskNotification } from "./types.js";
export { NotificationHub, NoOpHub } from "./hub.js";

export function buildNotificationHub(): NotificationHub | typeof NoOpHub {
  const settings = loadNotificationSettings();
  const channels: NotificationChannel[] = [];

  if (settings.serverchan) {
    try {
      channels.push(
        new ServerChanChannel({
          sendKey: settings.serverchan.sendKey,
          publicUrl: settings.serverchan.publicUrl,
        }),
      );
      console.log("[notify] Server酱 channel enabled");
    } catch (err) {
      console.error("[notify] failed to init Server酱 channel:", err);
    }
  }

  if (settings.telegram) {
    try {
      channels.push(
        new TelegramChannel({
          botToken: settings.telegram.botToken,
          chatId: settings.telegram.chatId,
          publicUrl: settings.telegram.publicUrl,
        }),
      );
      console.log("[notify] Telegram channel enabled");
    } catch (err) {
      console.error("[notify] failed to init Telegram channel:", err);
    }
  }

  if (channels.length === 0) {
    console.log(
      "[notify] no channels configured. Set SERVERCHAN_SENDKEY env or write ~/.claude-web/notify.json to enable push.",
    );
    return NoOpHub;
  }

  return new NotificationHub(channels);
}
