// dependency-cruiser config — enforces vessel one-way dependency rules.
// Previously also enforced AISEP red lines (R1/R2/R6); those moved to
// vessel-aisep on 2026-05-15 (ADR-024). Only `no-circular` remains here.

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
