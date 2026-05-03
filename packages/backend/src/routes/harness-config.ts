// /api/harness/config — M0 modelList Round 第一 endpoint
//
// RFC §2.1（phase 3 修订后）：
// - GET 200 + body + ETag header (HTTP-quoted "sha256:xxx")
// - If-None-Match (quoted or unquoted) match → 304
// - 不传 If-None-Match → 200 + body
// - Auth 继承现有 /api/* 中间件（authMiddleware 在 index.ts 已挂）

import { Hono } from "hono";
import { getHarnessConfig } from "../harness-config.js";

export const harnessConfigRouter = new Hono();

/** Strip surrounding quotes from `If-None-Match` value if present. */
function unquoteEtag(s: string | undefined | null): string | null {
  if (!s) return null;
  return s.replace(/^"(.*)"$/, "$1");
}

harnessConfigRouter.get("/", (c) => {
  const cfg = getHarnessConfig();
  const quotedEtag = `"${cfg.etag}"`;

  const ifNoneMatch = unquoteEtag(c.req.header("if-none-match"));
  if (ifNoneMatch && ifNoneMatch === cfg.etag) {
    return c.body(null, 304, {
      ETag: quotedEtag,
    });
  }

  return c.json(cfg, 200, {
    ETag: quotedEtag,
    "Cache-Control": "no-cache",  // require revalidation on every fetch
  });
});
