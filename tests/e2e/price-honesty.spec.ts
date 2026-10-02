// risk: #1 (context/foundation/test-plan.md): a stale, ended-promotion or gone price is shown as current, or the wrong
// shop is marked cheapest, and the shopper buys at the wrong shop.
// facet: on the rendered list and product pages, only a fresh price the shop sells online is marked cheapest, and every
// price shows its shop and age. In every product the cheaper price is the one that may not win, so a rule that ignores
// freshness or orderability marks the wrong shop.
// expected values: the PRD guardrail and US-01 (context/foundation/prd.md: a stale or failed price is never presented as
// current; a shop without a current price shows the gap and its last price with its age), and the S-03 decisions
// (context/archive/2026-09-28-cheapest-shop-today: only fresh, at most 24 hours old, orderable prices can win; an ended
// promotion is out of date, its last day still fresh). The texts are the running app's. None of it is read off the
// comparison code.
// seed: tests/e2e/seed.spec.ts
import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForIsland } from "./support/islands";
import {
  addRossmannProduct,
  backdateChecks,
  matchNatura,
  recordMissing,
  recordPrice,
  removeProducts,
  warsawDate,
  type SeededProduct,
} from "./support/watchlist-data";

// A check made during the test reads "przed chwilą" for a minute and "N min temu" after that; a slow run crosses it.
const JUST_NOW = String.raw`(?:przed chwilą|\d+ min temu)`;

// What a shop's card says once the island asked it again and the stopped shop refused (the setup stops every shop).
const stopped = (shop: string) => `Odświeżanie cen w sklepie ${shop} jest wyłączone, bo sklep zablokował zapytania.`;

const seeded: string[] = [];

test.afterEach(async () => {
  await removeProducts(seeded.splice(0));
});

/** Adds a product from Rossmann, matched in Natura, as the run's user. */
async function addMatchedProduct(name: string): Promise<SeededProduct & { sku: string }> {
  const product = await addRossmannProduct({ name });
  seeded.push(product.productId);
  return { ...product, sku: await matchNatura(product.productId, { name: `Natura ${name}` }) };
}

/** The product's row on the list: a link whose name is what a screen reader hears, its whole comparison. */
function rowOf(page: Page, product: SeededProduct): Locator {
  return page.getByRole("list", { name: "Moja lista" }).getByRole("link", { name: product.name });
}

/** A shop's card among the product's prices. */
function cardOf(page: Page, shop: "Rossmann" | "Natura"): Locator {
  return page
    .getByRole("region", { name: "Ceny" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: shop, level: 3 }) });
}

/** The cheapest marks among the product's prices. */
function marksOf(page: Page): Locator {
  return page.getByRole("region", { name: "Ceny" }).getByText("Najtaniej", { exact: true });
}

/** A card's line with the price's source and age: the price is the shop's online one, checked that long ago. */
function ageLine(card: Locator, age: string): Locator {
  return card.getByText(new RegExp(String.raw`^cena online · ${age}$`));
}

/** Opens the product from its row on the list, and waits for its prices to be live. */
async function openFromList(page: Page, product: SeededProduct): Promise<void> {
  await page.goto("/watchlist");
  await rowOf(page, product).click();
  await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  await waitForIsland(page, "PriceComparison");
}

test("#1: only a fresh price the shop sells online is marked cheapest, and every price shows its shop and age", async ({
  page,
}) => {
  // P1: Natura is cheaper, but its item can't be ordered online. Both checks are fresh.
  const p1 = await addMatchedProduct("Krem P1");
  await recordPrice("rossmann", p1.itemId, { price: 19.99, available: true });
  await recordPrice("natura", p1.sku, { price: 12.99, available: false });
  // P2: Rossmann is cheaper, but its check is an hour past the 24-hour line.
  const p2 = await addMatchedProduct("Szampon P2");
  await recordPrice("rossmann", p2.itemId, { price: 8.99, available: true });
  backdateChecks("rossmann", p2.itemId, 25);
  await recordPrice("natura", p2.sku, { price: 13.99, available: true });
  // P3: Rossmann is cheaper, but its promotion ended yesterday in Warsaw; it was checked just now, after the end.
  const p3 = await addMatchedProduct("Żel P3");
  await recordPrice("rossmann", p3.itemId, {
    price: 9.99,
    regularPrice: 14.99,
    promoEndsOn: warsawDate(-1),
    available: true,
  });
  await recordPrice("natura", p3.sku, { price: 14.49, available: true });
  // P4: Rossmann's last check no longer found the item, after a price; Natura was never checked.
  const p4 = await addMatchedProduct("Pasta P4");
  await recordPrice("rossmann", p4.itemId, { price: 11.99, available: true });
  await recordMissing("rossmann", p4.itemId);

  // The list: each row names the cheapest shop with its price and age, and the other shop's state; its tag shows
  // the price's shop and age.
  await page.goto("/watchlist");
  await expect(rowOf(page, p1)).toHaveAccessibleName(
    new RegExp(String.raw`Najtaniej: Rossmann 19,99\szł · ${JUST_NOW} · Natura: niedostępny online\.`),
  );
  await expect(rowOf(page, p1).getByText(new RegExp(String.raw`^Rossmann · ${JUST_NOW}$`))).toBeVisible();
  for (const [product, price] of [
    [p2, "13,99"],
    [p3, "14,49"],
  ] as const) {
    await expect(rowOf(page, product)).toHaveAccessibleName(
      new RegExp(String.raw`Najtaniej: Natura ${price}\szł · ${JUST_NOW} · Rossmann: cena nieaktualna\.`),
    );
    await expect(rowOf(page, product).getByText(new RegExp(String.raw`^Natura · ${JUST_NOW}$`))).toBeVisible();
  }
  // P4 has no price that may win: its tag keeps Rossmann's last one, marked out of date, and no shop is named cheapest.
  await expect(rowOf(page, p4).getByText("Nieaktualna", { exact: true })).toBeVisible();
  await expect(rowOf(page, p4).getByText(/^11,99\szł$/)).toBeAttached();
  await expect(rowOf(page, p4).getByText(new RegExp(String.raw`^Rossmann · ${JUST_NOW}$`))).toBeVisible();
  await expect(rowOf(page, p4)).not.toHaveAccessibleName(/Najtaniej/);

  // P1's page: Rossmann's card is the cheapest; Natura's lower price says it can't be ordered online.
  await openFromList(page, p1);
  await expect(marksOf(page)).toHaveCount(1);
  await expect(cardOf(page, "Rossmann").getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(cardOf(page, "Natura").getByText("niedostępny online", { exact: true })).toBeVisible();
  await expect(ageLine(cardOf(page, "Rossmann"), JUST_NOW)).toBeVisible();
  await expect(ageLine(cardOf(page, "Natura"), JUST_NOW)).toBeVisible();

  // P2's page: Natura's card is the cheapest. The island asks Rossmann again on load, since its check is old, and the
  // stopped shop refuses; Rossmann's card keeps its old price, marked out of date, with its age.
  await openFromList(page, p2);
  const p2Rossmann = cardOf(page, "Rossmann");
  await expect(p2Rossmann.getByText(stopped("Rossmann"), { exact: true })).toBeVisible();
  await expect(p2Rossmann.getByText(/^8,99\szł$/)).toBeAttached();
  await expect(p2Rossmann.getByText("Nieaktualna", { exact: true })).toBeVisible();
  await expect(ageLine(p2Rossmann, "wczoraj")).toBeVisible();
  await expect(marksOf(page)).toHaveCount(1);
  await expect(cardOf(page, "Natura").getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(ageLine(cardOf(page, "Natura"), JUST_NOW)).toBeVisible();

  // P3's page: Natura's card is the cheapest; Rossmann's ended promotion is out of date.
  await openFromList(page, p3);
  await expect(marksOf(page)).toHaveCount(1);
  await expect(cardOf(page, "Natura").getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(cardOf(page, "Rossmann").getByText("Nieaktualna", { exact: true })).toBeVisible();
  await expect(ageLine(cardOf(page, "Rossmann"), JUST_NOW)).toBeVisible();
  await expect(ageLine(cardOf(page, "Natura"), JUST_NOW)).toBeVisible();

  // P4's page: no shop is marked, and the page names Rossmann's price as its last known one. Rossmann's card says the
  // shop no longer returns the item. Natura's has no price yet: the island asks Natura on load, and is refused.
  await openFromList(page, p4);
  const p4Natura = cardOf(page, "Natura");
  await expect(p4Natura.getByText(stopped("Natura"), { exact: true })).toBeVisible();
  await expect(p4Natura.getByText("Jeszcze bez ceny", { exact: true })).toBeVisible();
  await expect(
    cardOf(page, "Rossmann").getByText("Sklep nie zwraca już tego produktu. Cena może być nieaktualna.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(ageLine(cardOf(page, "Rossmann"), JUST_NOW)).toBeVisible();
  // The product's pane, the whole page on a phone; the list beside it waits hidden in the page for wider screens.
  await expect(page.getByRole("main").getByText(/Najtaniej/)).toHaveCount(0);
  // The verdict above the cards, in the order a screen reader reads it: the last price it knows, not today's cheapest.
  await expect(page.getByRole("main")).toMatchAriaSnapshot(String.raw`
    - paragraph: Ostatnia znana cena
    - text: /11,99\szł/
    - paragraph: w Rossmannie
  `);
});
