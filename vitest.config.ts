import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Project code only: the default include would also pick up the 10x CLI's *.test.mjs files under .claude/. The
    // scripts' own tests are .mjs, like the dependency-free scripts they test.
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    // The tests that need the local Supabase stack run only through `npm run test:db` (vitest.db.config.ts): this run,
    // the end-of-turn hook's and CI's ci job's, has no database.
    exclude: [...configDefaults.exclude, "src/**/*.db.test.ts"],
    environment: "node",
  },
});
