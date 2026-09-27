import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Project code only: the default include would also pick up the 10x CLI's *.test.mjs files under .claude/.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
