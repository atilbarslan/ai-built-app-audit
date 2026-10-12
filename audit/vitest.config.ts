import { defineConfig } from "vitest/config";

// Standalone config for the audit's DB-level security tests. Kept separate from
// the app's vitest.config.ts so it has no jsdom / React setup and only runs the
// audit suite. Run: npx vitest run --config audit/vitest.config.ts
export default defineConfig({
  test: {
    environment: "node",
    include: ["audit/tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false, // single shared DB connection
    reporters: ["default"],
  },
});
