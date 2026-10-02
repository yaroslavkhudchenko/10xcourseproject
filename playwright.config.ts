import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { assertLocalSupabase } from "./scripts/e2e-local-db.mjs";
import { SESSION_FILE } from "./tests/e2e/support/run";

// The tests' Supabase (SUPABASE_URL, SUPABASE_KEY) comes from the gitignored .env; in CI the job writes it from the local
// stack. Nothing here reads a key.
if (existsSync(".env")) process.loadEnvFile(".env");

// The setup project stops every shop of the deployment it talks to, so refuse anything but the local stack, before
// anything is built or asked: the tests' SUPABASE_URL and the preview's .dev.vars, which the build copies into dist/server.
assertLocalSupabase();

// 4321 is Astro's preview default: astro.config.mjs sets no port and the preview script passes none.
// E2E_PORT overrides it when that port is taken on this machine.
const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // In CI the list reporter writes one line per test, and every failure, into the job's log, beside the HTML report.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Stops every shop and signs the run's user up and in; its teardown switches the shops back on and checks that the
    // run reserved no shop request.
    { name: "setup", testMatch: /.*\.setup\.ts/, teardown: "teardown" },
    { name: "teardown", testMatch: /.*\.teardown\.ts/ },
    {
      // A shopper at the shelf: Chromium at the 390 px the phone checks used, with touch, signed in as the run's user.
      name: "phone",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, storageState: SESSION_FILE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // The production build on workerd, as CI's smoke job and Workers Builds build it, on the port above. Its readiness
    // check only says the server answers (`/` answers 200 even without Supabase); the setup's sign-in proves the binding.
    command: `npm run build && npm run preview -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // In CI the build and the preview's start go into the job's log, so a failed build there can be read; locally they
    // stay out of the test output.
    stdout: process.env.CI ? "pipe" : "ignore",
    // Astro 7 moves `astro preview` into a background daemon when it detects an AI agent; this keeps it in the
    // foreground, so Playwright owns the server and stops it after the run.
    env: { ASTRO_PREVIEW_BACKGROUND: "1" },
  },
});
