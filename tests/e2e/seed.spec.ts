// risk: #2 (context/foundation/test-plan.md): a deploy breaks production, here as breakage that shows only on Workers.
// facet: on the workerd production preview, a signed-in shopper on a phone reaches their own list. The preview is bound to
// the local Supabase, the session cookie is read on workerd and the middleware attaches the user. `/` answers 200 even
// without Supabase, so only a signed-in state proves it.
// seed: the exemplar every spec in tests/e2e copies: role-based locators, waits for state, a name that names its risk.
import { expect, test } from "@playwright/test";
import { readRun } from "./support/run";

test("#2: a signed-in shopper reaches their own list on the production preview", async ({ page }) => {
  // Nothing to clean up: the run's user comes from the setup project, and this spec creates no data.
  const { email } = readRun();

  await page.goto("/watchlist");

  // The page a signed-in user gets, not the redirect to sign-in or the configuration banner.
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(page.getByRole("heading", { name: "Moja lista", level: 1 })).toBeVisible();
  // The account menu names this run's user, so the session the page read is the one the setup signed in.
  await expect(page.getByRole("group").getByText(`Konto: ${email}`)).toBeAttached();
});
