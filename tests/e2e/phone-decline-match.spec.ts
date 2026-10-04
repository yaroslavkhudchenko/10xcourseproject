// risk: #7 (context/foundation/test-plan.md), with #6's facet: a wrong automatic match can't be removed on a phone, or
// the declined shop's old price is still compared.
// facet: on the production build at 390 px, while Natura refuses every lookup, a matched Natura item is removed through
// its "Zmień": "Anuluj" changes nothing, and "Żaden z nich" stores the decline, after which Natura's old price drops
// out of the comparison on the product's page and on the list. Hebe, the third shop, has no decision: while Natura's
// choice is open its card offers only its button, since that page asks no other shop, and the list says Hebe is still
// to match.
// seed: tests/e2e/seed.spec.ts
import { expect, test } from "@playwright/test";
import { waitForIsland } from "./support/islands";
import { cardOf, JUST_NOW, openFromList, priceOf, rowOf, searchStoppedNotice } from "./support/pages";
import { addMatchedProduct, recordPrice, removeSeededProducts } from "./support/watchlist-data";

test.afterEach(async () => {
  await removeSeededProducts();
});

test("#7: on a phone, a wrong Natura match is removed through its re-pin choice, and its price stops counting", async ({
  page,
}) => {
  // One product matched in Natura automatically, its two prices both checked just now. Natura is the cheaper.
  const product = await addMatchedProduct("Krem z błędnym dopasowaniem");
  await recordPrice("rossmann", product.itemId, { price: 19.99, available: true });
  await recordPrice("natura", product.sku, { price: 14.49, available: true });
  await page.goto("/watchlist");
  await openFromList(page, product);
  const natura = cardOf(page, "Natura");
  const hebe = cardOf(page, "Hebe");
  const choice = page.getByRole("region", { name: "Drogerie Natura" });

  // 1. Natura's card names the matched item and offers "Zmień". Hebe's card says its lookup, which the page asked on
  // its own, was refused. Tap "Zmień".
  await expect(natura.getByText(`Natura ${product.name}`, { exact: true })).toBeVisible();
  await expect(hebe.getByText(searchStoppedNotice("Hebe"), { exact: true })).toBeVisible();
  await natura.getByRole("link", { name: "Zmień" }).tap();

  // 2. The choice says Natura's search is stopped and offers "Żaden z nich" and "Anuluj", with no candidate to pick.
  // Hebe, still undecided, gets only its button: the page opened to change Natura's match asks no other shop.
  await expect(choice.getByText(searchStoppedNotice("Natura"), { exact: true })).toBeVisible();
  await expect(choice.getByRole("button", { name: "Żaden z nich" })).toBeVisible();
  await expect(choice.getByRole("button", { name: "To ten produkt" })).toHaveCount(0);
  await expect(hebe.getByText("Produkt nie jest jeszcze dopasowany w Hebe.", { exact: true })).toBeVisible();
  await expect(hebe.getByRole("link", { name: "Dopasuj w Hebe" })).toBeVisible();
  await expect(hebe.getByText(searchStoppedNotice("Hebe"), { exact: true })).toHaveCount(0);

  // 3. Tap "Anuluj": the page is back without the choice, and Natura is still matched, cheapest at its price.
  await choice.getByRole("link", { name: "Anuluj" }).tap();
  // The choice is gone only from the new page, so the island waited for is that page's.
  await expect(choice).toBeHidden();
  await waitForIsland(page, "PriceComparison");
  await expect(natura.getByRole("link", { name: "Zmień" })).toBeVisible();
  await expect(priceOf(natura, "14,49")).toBeAttached();
  await expect(natura.getByText("Najtaniej", { exact: true })).toBeVisible();

  // 4. Tap "Zmień" again, then "Żaden z nich".
  await natura.getByRole("link", { name: "Zmień" }).tap();
  await choice.getByRole("button", { name: "Żaden z nich" }).tap();

  // 5. The page says the decline is saved, and Natura's card says it's the user's choice, with "Dopasuj ponownie".
  await expect(natura.getByRole("status")).toHaveText("Zapisano: brak w Naturze.");
  await expect(natura.getByText("Brak w Naturze — Twój wybór.", { exact: true })).toBeVisible();
  await expect(natura.getByRole("link", { name: "Dopasuj ponownie" })).toBeVisible();

  // 6. Once the prices are live, no shop is marked: Rossmann's price is the only one known, which the verdict says.
  await waitForIsland(page, "PriceComparison");
  await expect(page.getByRole("main").getByText(/Najtaniej/)).toHaveCount(0);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(String.raw`
    - paragraph: Jedyna znana cena
    - text: /19,99\szł/
    - paragraph: w Rossmannie
  `);

  // 7. On the list, the row names Rossmann's price as the only one, Natura as declined by the user, and Hebe as still
  // to match.
  await page.goto("/watchlist");
  await expect(rowOf(page, product)).toHaveAccessibleName(
    new RegExp(
      String.raw`Tylko w Rossmannie: 19,99\szł · ${JUST_NOW}\. Natura: brak \(Twój wybór\)\. Hebe: do dopasowania\.`,
    ),
  );
});
