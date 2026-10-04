// risk: #1 (context/foundation/test-plan.md): a stale, ended-promotion or gone price is shown as current, or the wrong
// shop is marked cheapest, and the shopper buys at the wrong shop.
// facet: on the rendered list and product pages, only a fresh price the shop sells online is marked cheapest, and every
// price shows its shop and age. In every product the cheaper price is the one that may not win, so a rule that ignores
// freshness or orderability marks the wrong shop.
// expected values: the PRD guardrail and US-01 (context/foundation/prd.md: a stale or failed price is never presented as
// current; a shop without a current price shows the gap and its last price with its age), and the S-03 decisions
// (context/archive/2026-09-28-cheapest-shop-today: only fresh, at most 24 hours old, orderable prices can win; an ended
// promotion is out of date, its last day still fresh). The texts are the running app's. None of it is read off the
// comparison code. No product has a decision in Hebe, the third shop, yet: its row says so, and its page's lookup
// there is refused by the stopped shop, which its card says in place of a price.
// seed: tests/e2e/seed.spec.ts
import { expect, test } from "@playwright/test";
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
  stoppedNotice,
} from "./support/pages";
import {
  addMatchedProduct,
  backdateChecks,
  recordMissing,
  recordPrice,
  removeSeededProducts,
  warsawDate,
} from "./support/watchlist-data";

test.afterEach(async () => {
  await removeSeededProducts();
});

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
  // What the pages ask the shops for, through the island's price requests (lessons: "Bound what each page view and
  // action costs every shop"). The list asks none.
  const priceCalls = recordPriceCalls(page);

  // The list: each row names the cheapest shop with its price and age, and the other shop's state, then Hebe's, still
  // to match; its tag shows the price's shop and age.
  await page.goto("/watchlist");
  await expect(rowOf(page, p1)).toHaveAccessibleName(
    new RegExp(
      String.raw`Najtaniej: Rossmann 19,99\szł · ${JUST_NOW} · Natura: niedostępny online\. Hebe: do dopasowania\.`,
    ),
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

  // P1's page: Rossmann's card is the cheapest; Natura's lower price says it can't be ordered online. Hebe's card has
  // no price, and says why: the page's lookup there was refused.
  await openFromList(page, p1);
  await expect(marksOf(page)).toHaveCount(1);
  await expect(cardOf(page, "Rossmann").getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(cardOf(page, "Natura").getByText("niedostępny online", { exact: true })).toBeVisible();
  await expect(ageLine(cardOf(page, "Rossmann"), JUST_NOW)).toBeVisible();
  await expect(ageLine(cardOf(page, "Natura"), JUST_NOW)).toBeVisible();
  await expect(cardOf(page, "Hebe").getByText(searchStoppedNotice("Hebe"), { exact: true })).toBeVisible();
  await expect(cardOf(page, "Hebe").getByText(/zł/)).toHaveCount(0);

  // P2's page: Natura's card is the cheapest. The island asks Rossmann again on load, since its check is old, and the
  // stopped shop refuses; Rossmann's card keeps its old price, marked out of date, with its age.
  await page.goto("/watchlist");
  await openFromList(page, p2);
  const p2Rossmann = cardOf(page, "Rossmann");
  await expect(p2Rossmann.getByText(stoppedNotice("Rossmann"), { exact: true })).toBeVisible();
  await expect(priceOf(p2Rossmann, "8,99")).toBeAttached();
  await expect(p2Rossmann.getByText("Nieaktualna", { exact: true })).toBeVisible();
  await expect(ageLine(p2Rossmann, "wczoraj")).toBeVisible();
  await expect(marksOf(page)).toHaveCount(1);
  await expect(cardOf(page, "Natura").getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(ageLine(cardOf(page, "Natura"), JUST_NOW)).toBeVisible();

  // P3's page: Natura's card is the cheapest; Rossmann's ended promotion is out of date.
  await page.goto("/watchlist");
  await openFromList(page, p3);
  await expect(marksOf(page)).toHaveCount(1);
  await expect(cardOf(page, "Natura").getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(cardOf(page, "Rossmann").getByText("Nieaktualna", { exact: true })).toBeVisible();
  await expect(ageLine(cardOf(page, "Rossmann"), JUST_NOW)).toBeVisible();
  await expect(ageLine(cardOf(page, "Natura"), JUST_NOW)).toBeVisible();

  // P4's page: no shop is marked, and the page names Rossmann's price as its last known one. Rossmann's card says the
  // shop no longer returns the item. Natura's has no price yet: the island asks Natura on load, and is refused.
  await page.goto("/watchlist");
  await openFromList(page, p4);
  const p4Natura = cardOf(page, "Natura");
  await expect(p4Natura.getByText(stoppedNotice("Natura"), { exact: true })).toBeVisible();
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

  // Only the checks that needed it were asked again on load: P2's day-old Rossmann price and P4's never-checked Natura,
  // each for the item its page shows. P1's and P3's fresh checks asked nothing, P3's ended promotion included, since it
  // was checked after the end.
  expect(priceCalls, "each product page asks only the shops whose check is old or missing").toEqual([
    { shop: "rossmann", shopItemId: p2.itemId },
    { shop: "natura", shopItemId: p4.sku },
  ]);
});
