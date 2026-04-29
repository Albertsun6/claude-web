// GET /api/usage — fetch Claude Max subscription usage from Anthropic API
// Reads OAuth token from macOS Keychain, makes minimal API call to get rate_limits,
// caches result for 60 seconds to avoid excessive API calls.

import { Hono } from "hono";
import { execSync } from "child_process";

let cachedUsage: any = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

export const usageRouter = new Hono();

usageRouter.get("/", async (c) => {
  try {
    const now = Date.now();
    // Return cached result if still fresh
    if (cachedUsage && now - cacheTime < CACHE_TTL) {
      return c.json(cachedUsage);
    }

    // Read OAuth token from macOS Keychain
    const keychain = execSync(
      `security find-generic-password -s "Claude Code-credentials" -w`,
      { encoding: "utf-8", timeout: 5000 }
    );
    const credJson = JSON.parse(keychain);
    const accessToken = credJson?.claudeAiOauth?.accessToken;
    const subscriptionType = credJson?.claudeAiOauth?.subscriptionType || "unknown";
    const rateLimitTier = credJson?.claudeAiOauth?.rateLimitTier || "unknown";

    if (!accessToken) {
      return c.json({ error: "No OAuth token found" }, 400);
    }

    // Make minimal API call to get rate_limits
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    if (!response.ok) {
      return c.json({ error: `API error: ${response.status}` }, response.status);
    }

    const data = (await response.json()) as any;
    const rateLimits = data.rate_limits || {};
    const fiveHour = rateLimits.five_hour || {};
    const sevenDay = rateLimits.seven_day || {};

    const result = {
      fiveHourPct: fiveHour.used_percentage ?? null,
      fiveHourResetsAt: fiveHour.resets_at ?? null,
      sevenDayPct: sevenDay.used_percentage ?? null,
      sevenDayResetsAt: sevenDay.resets_at ?? null,
      subscriptionType,
      tier: rateLimitTier,
    };

    // Cache the result
    cachedUsage = result;
    cacheTime = now;

    return c.json(result);
  } catch (err: any) {
    console.error("usage endpoint error:", err.message);
    return c.json({ error: err.message }, 500);
  }
});
