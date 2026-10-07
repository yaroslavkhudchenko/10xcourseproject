// risk: #1 (context/foundation/test-plan.md): a price is presented as better than it is, or judged against nothing,
// and the shopper buys believing a deal that isn't one.
// facet: on the rendered product page, today's cheapest price below its shop's declared 30-day low is called good, and
// the page says it compared with the shop's low because the product's history is too short; a cheapest shop that
// declares no low gets no judgement, and the page says why. Every price here was checked today, so the product's own
// history, which counts only the days before today, is empty.
// expected values: the owner's decisions of 2026-10-06 (context/archive/2026-10-06-good-price-judgement/plan.md,
// "Desired End State": below the comparison is good; the shop's declared low until the history is enough; with nothing
// to compare with, no judgement and the reason) and the design's sentence for a good price
// (context/archive/2026-09-30-etykiety-redesign/handoff/Drogeria Radar Redesign.dc.html:816). None of it is read off the
// judgement's code. Hebe and Super-Pharm have no decision yet: each page's lookup there is refused by the stopped shop.
// seed: tests/e2e/seed.spec.ts
import { expect, test } from "@playwright/test";
import { requestLogMark } from "../../scripts/e2e-local-db.mjs";
import { openFromList, recordPriceCalls } from "./support/pages";
import { addMatchedProduct, recordPrice, removeSeededProducts } from "./support/watchlist-data";

test.afterEach(async () => {
  await removeSeededProducts();
});

// The design's sentence for a good price against the shop's declared low (handoff, Drogeria Radar Redesign.dc.html:816).
const BELOW_SHOP_LOW =
  "Poniżej najniższej ceny z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.";
// The owner's call for nothing to compare with: no judgement, and the reason (plan.md, Phase 3).
const NOTHING_TO_COMPARE =
  "Nie ma z czym porównać: Rossmann nie podaje najniższej ceny z 30 dni, a historia cen jest jeszcze za krótka.";

test("#1: on a phone, a price below its shop's 30-day low reads as good, and a price with nothing to compare says why", async ({
  page,
}) => {
  // The shop request log as the test starts: every shop is stopped, so nothing the test does may move it.
  const mark = requestLogMark();
  // P1: Natura is the cheapest, at 12,99 zł, below the 14,99 zł Natura declares as its lowest of 30 days.
  const good = await addMatchedProduct("Krem dobra cena");
  await recordPrice("rossmann", good.itemId, { price: 19.99, available: true });
  await recordPrice("natura", good.sku, { price: 12.99, available: true, lowestPrice30d: 14.99 });
  // P2: Rossmann is the cheapest, at 9,99 zł, and declares no 30-day low, as Rossmann does outside a sale.
  const bare = await addMatchedProduct("Szampon bez porównania");
  await recordPrice("rossmann", bare.itemId, { price: 9.99, available: true });
  await recordPrice("natura", bare.sku, { price: 11.99, available: true });
  // What the pages ask the shops for, through the island's price requests. Every price is fresh, so none.
  const priceCalls = recordPriceCalls(page);

  // P1's page: the price card judges the price against Natura's declared low, and says why it didn't use the history.
  await page.goto("/watchlist");
  await openFromList(page, good);
  await expect(page.getByRole("main").getByText(BELOW_SHOP_LOW, { exact: true })).toBeVisible();

  // P2's page: Rossmann declares no low and there's no history, so there's no judgement, and the card says why.
  await page.goto("/watchlist");
  await openFromList(page, bare);
  await expect(page.getByRole("main").getByText(NOTHING_TO_COMPARE, { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText(BELOW_SHOP_LOW, { exact: true })).toHaveCount(0);

  // No page asked a shop for a price, and no shop request was reserved.
  expect(priceCalls, "no product page asks a shop for a price").toEqual([]);
  expect(requestLogMark(), "the shop request log didn't move").toBe(mark);
});
