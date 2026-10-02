# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.63.0
- config: playwright.config.ts (projects: setup → phone, Chromium at 390 × 844 with touch → teardown; globalTeardown tests/e2e/support/global-teardown.ts; refuses to load unless SUPABASE_URL in the environment and every SUPABASE_URL line of .env and .dev.vars is exactly the local stack, with CLOUDFLARE_ENV unset)
- single-spec command: npx playwright test tests/e2e/<name>.spec.ts
- full-suite command: npx playwright test
- base URL: http://localhost:4321
- port: 4321 (detected from Astro's preview default: astro.config.mjs and the preview script set none; detected default 4321, override with E2E_PORT)
- web server command: npm run build && npm run preview -- --port ${PORT} (PORT is E2E_PORT or 4321), with ASTRO_PREVIEW_BACKGROUND=1; never reuses a server already on the port (reuseExistingServer: false), so an occupied port fails the run
- auth setup project: setup (tests/e2e/auth.setup.ts): refuses while another run or a manual stop holds the shops, then holds every enabled shop under the run's name (E2E_RUN, set by the config) through scripts/e2e-local-db.mjs, signs up a fresh local user with supabase-js each run and signs it in once through the form; no stored credentials (no E2E_USERNAME / E2E_PASSWORD); teardown tests/e2e/shops.teardown.ts switches back on exactly the shops the run stopped and fails if a shop request was reserved; the globalTeardown switches them back on after an interrupted run
- storageState: playwright/.auth/user.json (gitignored), with the run's name, user, sign-up session (which the seeding helpers take over), request-log mark and stopped shops in playwright/.auth/run.json
- seed: tests/e2e/seed.spec.ts — protects #2: a signed-in shopper reaches their own list on the workerd production preview
- browser CLI: playwright-cli, command skill at .claude/skills/playwright-cli/SKILL.md; the shops are live between runs, so run `node scripts/e2e-local-db.mjs stop` before exploring a product page and `restore` afterwards
- updated: 2026-10-02
