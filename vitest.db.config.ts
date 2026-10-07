import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The tests that need the local Supabase stack, `src/**/*.db.test.ts`: `npm run test:db`, which CI's smoke job runs
// against its own stack. The default run (vitest.config.ts), which the end-of-turn hook and CI's ci job use, leaves them
// out, since neither has a database.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.db.test.ts"],
    environment: "node",
    // Every test makes several requests to the stack, one after another.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
