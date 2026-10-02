// risk: #7 (context/foundation/test-plan.md): a browser-only regression breaks the phone flow at the shelf, here a
// removal that one tap fires without its confirm, or that doesn't last.
// facet: on the production build at 390 px, the first tap on "Usuń z listy" only opens the confirm and removes nothing.
// The confirm removes the product for good: the list says so, and the row is gone, after a reload too.
// seed: tests/e2e/seed.spec.ts
import { expect, test } from "@playwright/test";
import { openFromList, rowOf } from "./support/pages";
import { addMatchedProduct, recordPrice, removeSeededProducts } from "./support/watchlist-data";

// The cleanup deletes the product again, which must succeed although the test already removed it.
test.afterEach(async () => {
  await removeSeededProducts();
});

test("#7: on a phone, removing a product takes its confirm, and the removal lasts", async ({ page }) => {
  // One product whose two prices were both checked just now, so its page asks no shop.
  const product = await addMatchedProduct("Krem do usunięcia");
  await recordPrice("rossmann", product.itemId, { price: 19.99, available: true });
  await recordPrice("natura", product.sku, { price: 14.49, available: true });
  await page.goto("/watchlist");
  await openFromList(page, product);
  const productPage = page.url();
  const removal = page.getByRole("group").filter({ hasText: "Usuń z listy" });
  const confirm = removal.getByRole("button", { name: "Usuń z listy" });

  // 1. Tap "Usuń z listy": the confirm opens, and the product is still there. While the confirm is closed, its button
  // waits in the page undrawn, so the summary is the only "Usuń z listy" shown.
  await expect(confirm).toBeHidden();
  await removal.getByText("Usuń z listy", { exact: true }).filter({ visible: true }).tap();
  await expect(confirm).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  expect(page.url(), "the first tap removes nothing: the product's page stays").toBe(productPage);

  // 2. Tap the confirm's "Usuń z listy".
  await confirm.tap();

  // 3. The list says the product was removed, and its row is gone, after a reload too.
  await expect(page.getByRole("status").filter({ hasText: "Usunięto produkt z listy." })).toBeVisible();
  await expect(rowOf(page, product)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Moja lista" })).toBeVisible();
  await expect(rowOf(page, product)).toHaveCount(0);
});
