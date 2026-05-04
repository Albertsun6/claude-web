// Notification settings loader.
// Reads from two sources, in priority order:
//   1. ~/.claude-web/notify.json   (file, hot-reloadable in future)
//   2. environment variables       (initial bootstrap)
// File takes precedence so users can update without restarting.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../data-dir.js";

export interface NotificationSettings {
  serverchan?: {
    sendKey: string;
    publicUrl?: string;
  };
  telegram?: {
    botToken: string;
    chatId: string | number;
    publicUrl?: string;
  };
  // Future: bark, apns ...
}

const SETTINGS_PATH = path.join(DATA_DIR, "notify.json");

export function loadNotificationSettings(): NotificationSettings {
  const fromFile = loadFromFile();
  const fromEnv = loadFromEnv();
  return mergeSettings(fromEnv, fromFile);
}

function loadFromFile(): NotificationSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as NotificationSettings;
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(`[notify] failed to read ${SETTINGS_PATH}:`, err?.message ?? err);
    }
  }
  return {};
}

function loadFromEnv(): NotificationSettings {
  const result: NotificationSettings = {};
  const sendKey = process.env.SERVERCHAN_SENDKEY?.trim();
  if (sendKey) {
    result.serverchan = {
      sendKey,
      publicUrl: process.env.CLAUDE_WEB_PUBLIC_URL?.trim() || undefined,
    };
  }
  const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tgChat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (tgToken && tgChat) {
    result.telegram = {
      botToken: tgToken,
      chatId: tgChat,
      publicUrl: process.env.CLAUDE_WEB_PUBLIC_URL?.trim() || undefined,
    };
  }
  return result;
}

function mergeSettings(base: NotificationSettings, override: NotificationSettings): NotificationSettings {
  return {
    ...base,
    ...override,
    serverchan: override.serverchan ?? base.serverchan,
    telegram: override.telegram ?? base.telegram,
  };
}
