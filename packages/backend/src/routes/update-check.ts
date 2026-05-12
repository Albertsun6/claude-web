// GET /api/version/latest — current backend version + latest GitHub release.
// Used by frontend UpdateBanner to surface available updates.

import { Hono } from "hono";
import { checkForUpdate } from "../lib/update-check.js";

export const updateCheckRouter = new Hono();

updateCheckRouter.get("/latest", async (c) => {
  const force = c.req.query("force") === "1";
  const result = await checkForUpdate({ force });
  return c.json(result);
});
