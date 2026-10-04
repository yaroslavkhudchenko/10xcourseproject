// risk: #7 and #1 (context/foundation/test-plan.md): with a third shop, a browser-only regression breaks the phone flow
// at the shelf, or the wrong shop is marked cheapest and the shopper buys at the wrong one.
// facet: on the production build at 390 px, a product priced in Rossmann, Natura and Hebe names Hebe, the cheapest, on
// its page, its price with its source and age, and on the list. Once the shopper declines Hebe's wrong match through
// its "Zmień" while Hebe's search is stopped, Natura is the cheapest on both, and Natura's match is untouched. Opening
// the product asks no shop for a price, and no shop request is reserved.
// expected values: FR-011 and US-01 (context/foundation/prd.md: the cheapest shop today is marked, and every price
// shows its source and age) and the S-03 decision (context/archive/2026-09-28-cheapest-shop-today: only fresh prices
// the shop sells online can win): Hebe's 16,99 zł is the lowest of three fresh, orderable prices, and without Hebe,
// Natura's 17,49 zł is. FR-007 (S-08: "Żaden z nich" removes a wrong match by declining the shop). The texts are the
// running app's. None of it is read off the comparison code.
// seed: tests/e2e/seed.spec.ts
import { expect, test } from "@playwright/test";
import { requestLogMark } from "../../scripts/e2e-local-db.mjs";
import { waitForIsland } from "./support/islands";
import {
  ageLine,
  cardOf,
  JUST_NOW,
  marksOf,
  openFromList,
  priceOf,
  recordPriceCalls,
  rowOf,
  searchStoppedNotice,
} from "./support/pages";
import { addMatchedProduct, matchShop, recordPrice, removeSeededProducts } from "./support/watchlist-data";

test.afterEach(async () => {
  await removeSeededProducts();
});

test("#7: on a phone, the cheapest of three shops is marked, and declining Hebe's match hands it to Natura", async ({
  page,
}) => {
  // The shop request log as the test starts: every shop is stopped, so nothing the test does may move it.
  const mark = requestLogMark();
  // One product matched automatically in Natura and in Hebe, its three prices all checked just now, all orderable.
  const product = await addMatchedProduct("Krem w trzech sklepach");
  const hebeId = await matchShop("hebe", product.productId, { name: "Hebe Krem w trzech sklepach" });
  await recordPrice("rossmann", product.itemId, { price: 19.99, available: true });
  await recordPrice("natura", product.sku, { price: 17.49, available: true });
  await recordPrice("hebe", hebeId, { price: 16.99, available: true });
  // What the pages ask the shops for, through the island's price requests (lessons: "Bound what each page view and
  // action costs every shop"). The list asks none.
  const priceCalls = recordPriceCalls(page);

  // 1. On the list, the row names Hebe as cheapest, 50 groszy under Natura, with its price's age.
  await page.goto("/watchlist");
  await expect(rowOf(page, product)).toHaveAccessibleName(
    new RegExp(String.raw`Najtaniej: Hebe 16,99\szł, o 0,50\szł taniej niż Natura · ${JUST_NOW}\.`),
  );
  await expect(rowOf(page, product).getByText(new RegExp(String.raw`^Hebe · ${JUST_NOW}$`))).toBeVisible();

  // 2. On the product's page, Hebe's card alone carries "Najtaniej"; its price shows its source, hebe.pl, and its age,
  // and the hero names Hebe. Every price is fresh, so opening the product asks no shop.
  await openFromList(page, product);
  const hebe = cardOf(page, "Hebe");
  const natura = cardOf(page, "Natura");
  await expect(marksOf(page)).toHaveCount(1);
  await expect(hebe.getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(priceOf(hebe, "16,99")).toBeAttached();
  await expect(hebe.getByText("hebe.pl", { exact: true })).toBeVisible();
  await expect(ageLine(hebe, JUST_NOW)).toBeVisible();
  for (const [shop, price] of [
    ["Rossmann", "19,99"],
    ["Natura", "17,49"],
  ] as const) {
    await expect(priceOf(cardOf(page, shop), price)).toBeAttached();
    await expect(ageLine(cardOf(page, shop), JUST_NOW)).toBeVisible();
  }
  await expect(page.getByRole("main")).toMatchAriaSnapshot(String.raw`
    - paragraph: Najtaniej dziś
    - text: /16,99\szł/
    - paragraph: w Hebe
  `);
  expect(priceCalls, "opening a product whose prices are fresh asks no shop").toEqual([]);

  // 3. Tap "Zmień" on Hebe's card: Hebe's choice says its search is stopped, with no candidate to pick, and offers
  // "Żaden z nich". Natura's card still shows its match.
  await hebe.getByRole("link", { name: "Zmień" }).tap();
  const choice = page.getByRole("region", { name: "Hebe", exact: true });
  await expect(choice.getByText(searchStoppedNotice("Hebe"), { exact: true })).toBeVisible();
  await expect(choice.getByRole("button", { name: "To ten produkt" })).toHaveCount(0);
  await expect(natura.getByRole("link", { name: "Zmień" })).toBeVisible();

  // 4. Tap "Żaden z nich": the page says the decline is saved, and Hebe's card says it's the user's choice.
  await choice.getByRole("button", { name: "Żaden z nich" }).tap();
  await expect(hebe.getByRole("status")).toHaveText("Zapisano: brak w Hebe.");
  await expect(hebe.getByText("Brak w Hebe — Twój wybór.", { exact: true })).toBeVisible();
  await expect(hebe.getByRole("link", { name: "Dopasuj ponownie" })).toBeVisible();

  // 5. Once the prices are live, Natura is the cheapest, and its match is untouched: its card names the same item, with
  // its price and "Zmień". Hebe's price no longer counts, and the hero names Natura.
  await waitForIsland(page, "PriceComparison");
  await expect(marksOf(page)).toHaveCount(1);
  await expect(natura.getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(natura.getByText(`Natura ${product.name}`, { exact: true })).toBeVisible();
  await expect(natura.getByRole("link", { name: "Zmień" })).toBeVisible();
  await expect(priceOf(natura, "17,49")).toBeAttached();
  await expect(priceOf(hebe, "16,99")).toHaveCount(0);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(String.raw`
    - paragraph: Najtaniej dziś
    - text: /17,49\szł/
    - paragraph: w Naturze
  `);

  // 6. On the list, the row follows: Natura is the cheapest, 2,50 zł under Rossmann, and Hebe is the user's decline.
  await page.goto("/watchlist");
  await expect(rowOf(page, product)).toHaveAccessibleName(
    new RegExp(
      String.raw`Najtaniej: Natura 17,49\szł, o 2,50\szł taniej niż Rossmann · ${JUST_NOW}\. Hebe: brak \(Twój wybór\)\.`,
    ),
  );
  await expect(rowOf(page, product).getByText(new RegExp(String.raw`^Natura · ${JUST_NOW}$`))).toBeVisible();

  // The island asked no shop for a price, on opening or after the decline, and no shop request was reserved: the
  // lookups the pages tried met the stopped shops before any request.
  expect(priceCalls, "no page of the flow asks a shop for a price").toEqual([]);
  expect(requestLogMark(), "the shop request log didn't move").toBe(mark);
});
