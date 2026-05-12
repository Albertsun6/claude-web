// Option E Stage E.2 — render AisepReport to single-file HTML via EJS.
//
// Pure-ish: reads template.ejs once from disk (relative to module), then
// pure string transform. R6 boundary: this module DOES read its own
// template file (one-time, deterministic, side-effect-free w.r.t.
// AisepStore / workspace); the report HTML output is returned as
// string for the CLI to fs.writeFile.

import ejs from "ejs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AisepReport } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, "template.ejs");

let cachedTemplate: ejs.TemplateFunction | undefined;

function loadTemplate(): ejs.TemplateFunction {
  if (cachedTemplate) return cachedTemplate;
  const src = readFileSync(TEMPLATE_PATH, "utf-8");
  cachedTemplate = ejs.compile(src, {
    filename: TEMPLATE_PATH, // for include() resolution if ever needed
    cache: false,
  });
  return cachedTemplate;
}

/**
 * Render an AisepReport to a single-file HTML document. The output is
 * self-contained (all CSS inlined, JSON data inlined via
 * `<script id="aisep-report-data" type="application/json">`), with one
 * external `<script src="cdn.jsdelivr.net/.../mermaid">` for diagram
 * rendering. Diagrams degrade gracefully to text source when offline.
 */
export function renderReport(report: AisepReport): string {
  const template = loadTemplate();
  return template({ report });
}
