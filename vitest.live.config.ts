import { defineConfig } from "vitest/config";

// Contract tests against the live SIDOF API. Run with `npm run test:live`; CI runs them nightly.
export default defineConfig({
  test: {
    include: ["test/live/*.test.ts"],
    testTimeout: 60_000,
    // One file, run serially, to keep the load on SIDOF to a handful of requests.
    fileParallelism: false,
  },
});
