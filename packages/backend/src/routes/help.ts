import { Hono } from "hono";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

export const helpRouter = new Hono();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP_FILE = path.resolve(__dirname, "../../../../docs/USER_MANUAL.md");

helpRouter.get("/", async (c) => {
  try {
    const markdown = await readFile(HELP_FILE, "utf-8");
    return c.text(markdown, 200, {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});
