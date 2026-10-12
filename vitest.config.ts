import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Backend tests share one real Postgres database and truncate tables
    // between files — running files in parallel would race on that
    // shared state, so they run sequentially. Fine at B1's test count.
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15000,
    // beforeEach/beforeAll run the same real TRUNCATE CASCADE + fixture
    // work as the tests. Vitest's hookTimeout default is 10000ms, below
    // testTimeout — a late-suite reset that is still well under 15s was
    // reported as "Hook timed out in 10000ms" (see b19-contact-change).
    hookTimeout: 15000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
