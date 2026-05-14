// dependency-cruiser config — enforces AISEP one-way dependency rules.
// Spec: ~/.claude/plans/ai-vessel-vessel-bubbly-noodle.md "关键不变量（红线）"

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies signal a design problem.",
      from: {},
      to: { circular: true },
    },
    {
      name: "aisep-no-import-vessel-mainline",
      severity: "error",
      comment:
        "R1 red line: aisep-* packages must NOT import from backend / frontend / ios-native / capability-* (any vessel mainline package).",
      from: { path: "^packages/aisep-[^/]+/(src|fixtures)" },
      to: { path: "^packages/(backend|frontend|ios-native|capability-)" },
    },
    {
      name: "vessel-mainline-no-import-aisep",
      severity: "error",
      comment:
        "R2 red line: backend / frontend / ios-native must NOT import aisep-* in v0. When AISEP is wired back as a Capability App, a thin route is acceptable (raise a new ADR).",
      from: { path: "^packages/(backend|frontend|ios-native|capability-)[^/]*/src" },
      to: { path: "^packages/aisep-" },
    },
    {
      name: "aisep-protocol-is-the-root",
      severity: "error",
      comment:
        "aisep-protocol is the dependency root of the aisep-* cluster. It must NOT import from any other aisep-* package.",
      from: { path: "^packages/aisep-protocol/src" },
      to: { path: "^packages/aisep-(?!protocol/)" },
    },
    {
      name: "aisep-core-no-import-workspace",
      severity: "error",
      comment:
        "R6 red line: aisep-core has zero fs / net / spawn side effects. All side effects flow through the AisepWorkspace interface, implemented by aisep-workspace. aisep-core must NOT import aisep-workspace directly.",
      from: { path: "^packages/aisep-core/src" },
      to: { path: "^packages/aisep-workspace/" },
    },
    {
      name: "aisep-pure-fns-no-side-effects",
      severity: "error",
      comment:
        "R6 reinforcement: pure-function modules (m5-cap, scheduler) MUST NOT import node:fs / node:child_process / node:net / node:process. Side effects flow through injected workspace / store APIs only. Adding new pure modules: append the basename here.",
      from: { path: "^packages/aisep-core/src/(m5-cap|scheduler)\\.ts$" },
      to: {
        path: "^node:(fs|child_process|net|process|os|http|https|crypto|cluster|dgram|dns|readline|repl|tls|tty|v8|vm|worker_threads|inspector)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    // Skip generated build artifacts that ship inside source-tree paths
    // (Vite output + Capacitor copies). These contain content-hashed
    // bundles that legitimately re-import each other; dep-cruiser flags
    // them as `no-circular` violations because the bundler is allowed
    // to produce cyclic-looking module graphs that the browser still
    // executes correctly.
    exclude: {
      path: [
        "^packages/frontend/dist/",
        "^packages/frontend/ios/App/App/public/",
      ],
    },
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node"],
    },
    includeOnly: "^packages/",
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
