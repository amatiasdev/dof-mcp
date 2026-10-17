import { defineConfig } from "vitest/config";

// The default run uses recorded fixtures only; live-API tests live in test/live and run with
// `npm run test:live` (see vitest.live.config.ts).
export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
  },
});
