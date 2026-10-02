// risk: #7 (context/foundation/test-plan.md), with #2's share of it: a no-JavaScript form fails, here only on the
// production build.
// facet: before the island runs, or with JavaScript off, a product's "Odśwież ceny" is a plain form. On the production
// build it posts to the refresh route on workerd, which asks no stopped shop, and the page comes back saying the refresh
// failed, still showing every price with its age.
// seed: tests/e2e/seed.spec.ts
import { expect, test } from "@playwright/test";
import { ageLine, cardOf, JUST_NOW, priceOf } from "./support/pages";
import { addMatchedProduct, recordPrice, removeSeededProducts } from "./support/watchlist-data";

test.use({ javaScriptEnabled: false });

test.afterEach(async () => {
  await removeSeededProducts();
});

test("#7: without JavaScript, a product's refresh posts on the production build and keeps every price and age", async ({
  page,
}) => {
  // One product whose two prices were both checked just now.
  const product = await addMatchedProduct("Krem bez JavaScriptu");
  await recordPrice("rossmann", product.itemId, { price: 19.99, available: true });
  await recordPrice("natura", product.sku, { price: 14.49, available: true });
  const shops = [
    ["Rossmann", "19,99"],
    ["Natura", "14,49"],
  ] as const;

  // 1. Open the product page: its server-rendered cards show both prices with their age.
  await page.goto(`/watchlist/${product.productId}`);
  for (const [shop, price] of shops) {
    await expect(priceOf(cardOf(page, shop), price)).toBeAttached();
    await expect(ageLine(cardOf(page, shop), JUST_NOW)).toBeVisible();
  }

  // 2. Tap "Odśwież ceny": the form posts to the refresh route.
  await page.getByRole("button", { name: "Odśwież ceny tego produktu" }).tap();

  // 3. No shop answered, so the page comes back saying the refresh failed, and it still shows both prices and ages.
  await expect(page.getByRole("alert")).toHaveText("Nie udało się odświeżyć cen. Spróbuj ponownie za chwilę.");
  for (const [shop, price] of shops) {
    await expect(priceOf(cardOf(page, shop), price)).toBeAttached();
    await expect(ageLine(cardOf(page, shop), JUST_NOW)).toBeVisible();
  }
});
