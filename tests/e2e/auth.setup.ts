// The run's setup (test-plan Phase 1, context/changes/testing-critical-browser-flows/plan.md): it stops every shop for
// the whole run, signs a fresh local user up, and signs that user in once through the real form, so every spec starts
// with that user's session (storageState) and none can reach a shop. It only obtains the session: the seed
// (seed.spec.ts), not the setup, proves that the list honours it on workerd. Its teardown is shops.teardown.ts.
import { randomBytes } from "node:crypto";
import { expect, test as setup } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { requestLogMark, stopShops } from "../../scripts/e2e-local-db.mjs";
import { waitForIsland } from "./support/islands";
import { clearRun, SESSION_FILE, writeRun } from "./support/run";

setup("stop every shop, then sign the run's user up and in", async ({ page }) => {
  // A run file an earlier run left would hand this run's teardown a stale mark.
  clearRun();

  // Every shop stops before anything is asked. The mark comes after, once nothing can reserve a request any more.
  stopShops();
  const mark = requestLogMark();

  // Local sign-up is on with email confirmation off, so signing up returns a session (supabase/config.toml).
  const { SUPABASE_URL, SUPABASE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("SUPABASE_URL and SUPABASE_KEY must be set (.env)");
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const email = `e2e-${String(Date.now())}-${randomBytes(3).toString("hex")}@example.com`;
  const password = `E2e-${randomBytes(12).toString("base64url")}`;
  const { data, error } = await client.auth.signUp({ email, password });
  expect(error).toBeNull();
  expect(data.session, "local sign-up returns a session").not.toBeNull();

  // The gate's own view: the shops the app calls answer "stopped" before any request is counted or sent.
  for (const shop of ["rossmann", "natura"]) {
    const reservation = await client.rpc("reserve_shop_request", { p_shop_id: shop });
    expect(reservation.error).toBeNull();
    expect(reservation.data, `${shop} is stopped for the run`).toEqual({ outcome: "stopped" });
  }

  // Sign in once through the real form. It's a React island, which drops input typed before it hydrates, so the setup
  // waits for it to hydrate instead of retrying: every retry would be one more sign-in against the local limit of 30
  // sign-ins and sign-ups per 5 minutes (supabase/config.toml).
  // The route's own answer proves the sign-in: a 302 to /watchlist, which carries the session's cookies, read from the
  // redirect itself; a refused sign-in goes back to /auth/signin?error=…. Where the browser lands after it isn't the
  // setup's to judge: a middleware that doesn't attach the signed-in user must turn the seed red on its signed-in
  // assertion, not stop the run here.
  await page.goto("/auth/signin");
  await waitForIsland(page, "SignInForm");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const [answer] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/auth/signin",
    ),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  expect(answer.status(), "the sign-in route answers with a redirect").toBe(302);
  expect(answer.headers().location, "the sign-in route sends a signed-in user to the list").toBe("/watchlist");

  await page.context().storageState({ path: SESSION_FILE });
  writeRun({ email, password, mark });
});
