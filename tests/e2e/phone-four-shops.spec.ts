// risk: #7 and #1 (context/foundation/test-plan.md): with a fourth shop, looked up by name when the user opens a
// product, a browser-only regression breaks the phone flow at the shelf, a view reaches a shop the gate has stopped, or
// the shop's price is shown without its source and age.
// facet: on the production build at 390 px, a product matched in Natura and Hebe and still to match in Super-Pharm has
// its row on the list say Super-Pharm is still to match, which "Do sprawdzenia" holds. Opening it looks Super-Pharm up,
// and the stopped shop refuses the one search before any request: Super-Pharm's card says the search is stopped, with
// no button to tap, and no shop request is reserved. A product whose Super-Pharm match, the user's pick, has the lowest
// fresh price shows it on Super-Pharm's card with its source, its age and "Zobacz w sklepie", marked cheapest on the
// page and on the list. A product whose Super-Pharm match the rule accepted on its own, sharing no EAN with the
// product, is out of "Do sprawdzenia", and its Super-Pharm card says it was matched by name, with "Zmień"; opening it
// asks no shop.
// expected values: the S-06 decision that an undecided Super-Pharm counts in "Do sprawdzenia"
// (context/archive/2026-10-04-super-pharm-in-comparison/plan.md), the match-by-name decisions that the user's own
// navigation to a product with no Super-Pharm decision looks it up there by name, as it does Natura and Hebe, and that
// a match accepted by name says "Dopasowano automatycznie po nazwie." with "Zmień" and takes the product out of
// "Do sprawdzenia" (context/changes/match-by-name/change.md and plan.md), FR-011 and US-01
// (context/foundation/prd.md: the cheapest shop today is marked, and every price shows its source and age), and the
// S-03 decision (context/archive/2026-09-28-cheapest-shop-today: only fresh prices the shop sells online can win):
// Super-Pharm's 18,49 zł is the lowest of four fresh, orderable prices. The texts are the running app's. None of it is
// read off the matching or comparison code.
// seed: tests/e2e/seed.spec.ts
import { expect, test } from "@playwright/test";
import { requestLogMark } from "../../scripts/e2e-local-db.mjs";
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
import { addMatchedProduct, matchShop, recordPrice, removeSeededProducts } from "./support/watchlist-data";

test.afterEach(async () => {
  await removeSeededProducts();
});

// The matched item's page in Super-Pharm, on Super-Pharm's own site, as its adapter keeps links. The path is made up,
// and no step follows the link.
const SUPER_PHARM_PAGE = "https://www.superpharm.pl/e2e-balsam-w-czterech-sklepach";

test("#7: on a phone, opening a product looks Super-Pharm up, the stopped shop refuses it, a picked price shows, and a match by name says so", async ({
  page,
}) => {
  // The shop request log as the test starts: every shop is stopped, so nothing the test does may move it.
  const mark = requestLogMark();
  // P1: matched automatically in Natura and in Hebe, with no decision in Super-Pharm, its three prices checked just now.
  // Its name, with the run's token, is text a shop's search may carry, so opening it takes Super-Pharm's search to
  // the gate, rather than storing "not found" with nothing to search for.
  const waiting = await addMatchedProduct("Krem w czterech sklepach");
  const waitingHebe = await matchShop("hebe", waiting.productId, { name: "Hebe Krem w czterech sklepach" });
  await recordPrice("rossmann", waiting.itemId, { price: 19.99, available: true });
  await recordPrice("natura", waiting.sku, { price: 17.49, available: true });
  await recordPrice("hebe", waitingHebe, { price: 16.99, available: true });
  // P2: the same in Natura and Hebe, and matched in Super-Pharm by the user's pick. Its four prices were checked just
  // now, and Super-Pharm's is the lowest.
  const picked = await addMatchedProduct("Balsam w czterech sklepach");
  const pickedHebe = await matchShop("hebe", picked.productId, { name: "Hebe Balsam w czterech sklepach" });
  const pickedSuperPharm = await matchShop("super-pharm", picked.productId, {
    name: "Super-Pharm Balsam w czterech sklepach",
    decidedBy: "user",
    productUrl: SUPER_PHARM_PAGE,
  });
  await recordPrice("rossmann", picked.itemId, { price: 21.99, available: true });
  await recordPrice("natura", picked.sku, { price: 20.49, available: true });
  await recordPrice("hebe", pickedHebe, { price: 19.99, available: true });
  await recordPrice("super-pharm", pickedSuperPharm, { price: 18.49, available: true });
  // P3: the same in Natura and Hebe, and matched in Super-Pharm by the rule on its own. Neither the product nor the
  // matched item carries an EAN, so they share none, as a match accepted by name doesn't. Its four prices were checked
  // just now, so its page asks no shop for one.
  const byName = await addMatchedProduct("Żel w czterech sklepach");
  const byNameHebe = await matchShop("hebe", byName.productId, { name: "Hebe Żel w czterech sklepach" });
  const byNameSuperPharm = await matchShop("super-pharm", byName.productId, {
    name: "Super-Pharm Żel w czterech sklepach",
    decidedBy: "auto",
  });
  await recordPrice("rossmann", byName.itemId, { price: 14.99, available: true });
  await recordPrice("natura", byName.sku, { price: 13.99, available: true });
  await recordPrice("hebe", byNameHebe, { price: 13.49, available: true });
  await recordPrice("super-pharm", byNameSuperPharm, { price: 12.99, available: true });
  // What the pages ask the shops for, through the island's price requests (lessons: "Bound what each page view and
  // action costs every shop"). Every price is fresh, so no page asks any.
  const priceCalls = recordPriceCalls(page);

  // 1. On the list, P1's row names Hebe as cheapest and says Super-Pharm is still to match. P2's names Super-Pharm as
  // cheapest, 1,50 zł under Hebe, with its price's age.
  await page.goto("/watchlist");
  await expect(rowOf(page, waiting)).toHaveAccessibleName(
    new RegExp(
      String.raw`Najtaniej: Hebe 16,99\szł, o 0,50\szł taniej niż Natura · ${JUST_NOW}\. Super-Pharm: do dopasowania\.`,
    ),
  );
  await expect(rowOf(page, picked)).toHaveAccessibleName(
    new RegExp(String.raw`Najtaniej: Super-Pharm 18,49\szł, o 1,50\szł taniej niż Hebe · ${JUST_NOW}\.`),
  );
  await expect(rowOf(page, picked).getByText(new RegExp(String.raw`^Super-Pharm · ${JUST_NOW}$`))).toBeVisible();

  // 2. Tap "Do sprawdzenia": it holds P1, still to match in Super-Pharm, and neither P2 nor P3, each settled in every
  // shop, P3's Super-Pharm by the rule on its own.
  await page
    .getByRole("navigation", { name: "Filtry listy" })
    .getByRole("link", { name: /^Do sprawdzenia/ })
    .tap();
  await expect(page).toHaveURL(/\/watchlist\?f=check$/);
  await expect(rowOf(page, waiting)).toBeVisible();
  await expect(rowOf(page, picked)).toHaveCount(0);
  await expect(rowOf(page, byName)).toHaveCount(0);

  // 3. Open P1: the page looks Super-Pharm up, by name, and the stopped shop refuses its one search before any request,
  // so Super-Pharm's card says its search is stopped, with no button to tap. The other shops' prices are fresh, so the
  // island asks no shop for a price, and no refresh is refused.
  await openFromList(page, waiting);
  const superPharm = cardOf(page, "Super-Pharm");
  await expect(superPharm.getByText(searchStoppedNotice("Super-Pharm"), { exact: true })).toBeVisible();
  await expect(superPharm.getByRole("link", { name: "Dopasuj w Super-Pharmie" })).toHaveCount(0);
  await expect(superPharm.getByText(stoppedNotice("Super-Pharm"), { exact: true })).toHaveCount(0);
  expect(requestLogMark(), "no shop request was reserved: the stopped shop refused Super-Pharm's search").toBe(mark);

  // 4. Open P2 from the list: Super-Pharm's card alone carries "Najtaniej", with its price, its source, superpharm.pl,
  // its age and "Zobacz w sklepie", which leads to the matched item's page; the hero names Super-Pharm.
  await page.goto("/watchlist");
  await openFromList(page, picked);
  const pickedCard = cardOf(page, "Super-Pharm");
  await expect(marksOf(page)).toHaveCount(1);
  await expect(pickedCard.getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(priceOf(pickedCard, "18,49")).toBeAttached();
  await expect(pickedCard.getByText("superpharm.pl", { exact: true })).toBeVisible();
  await expect(ageLine(pickedCard, JUST_NOW)).toBeVisible();
  await expect(pickedCard.getByRole("link", { name: /^Zobacz w sklepie/ })).toHaveAttribute("href", SUPER_PHARM_PAGE);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(String.raw`
    - paragraph: Najtaniej dziś
    - text: /18,49\szł/
    - paragraph: w Super-Pharmie
  `);

  // 5. Open P3 from the list: Super-Pharm's card says the rule matched its item on its own, by name, and offers
  // "Zmień". Every decision is stored, so the page looks no shop up, and every price is fresh, so the island asks none.
  await page.goto("/watchlist");
  await openFromList(page, byName);
  const byNameCard = cardOf(page, "Super-Pharm");
  await expect(byNameCard.getByText("Dopasowano automatycznie po nazwie.", { exact: true })).toBeVisible();
  await expect(byNameCard.getByRole("link", { name: "Zmień" })).toBeVisible();

  // No page asked a shop for a price, and no shop request was reserved.
  expect(priceCalls, "no page of the flow asks a shop for a price").toEqual([]);
  expect(requestLogMark(), "the shop request log didn't move").toBe(mark);
});
