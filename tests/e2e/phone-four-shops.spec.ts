// risk: #7 and #1 (context/foundation/test-plan.md): with a fourth shop, matched only on the user's own tap, a
// browser-only regression breaks the phone flow at the shelf, a plain view spends the cap the whole deployment shares, or
// the shop's price is shown without its source and age.
// facet: on the production build at 390 px, a product matched in Natura and Hebe and still to match in Super-Pharm shows
// Super-Pharm's card with its button, never a lookup the stopped shop refused, and its row on the list says Super-Pharm
// is still to match, which "Do sprawdzenia" holds. A tap on "Dopasuj w Super-Pharmie" opens ?retry=super-pharm, whose
// one search the stopped shop refuses before any request: the card says the search is stopped, and no shop request is
// reserved. A product whose Super-Pharm match, the user's pick, has the lowest fresh price shows it on Super-Pharm's
// card with its source, its age and "Zobacz w sklepie", marked cheapest on the page and on the list.
// expected values: the S-06 decisions (context/changes/super-pharm-in-comparison/plan.md: an undecided Super-Pharm is
// looked up only from its card's button, a plain view never searches it, and it counts in "Do sprawdzenia"), FR-011 and
// US-01 (context/foundation/prd.md: the cheapest shop today is marked, and every price shows its source and age), and the
// S-03 decision (context/archive/2026-09-28-cheapest-shop-today: only fresh prices the shop sells online can win):
// Super-Pharm's 18,49 zł is the lowest of four fresh, orderable prices. The texts are the running app's. None of it is
// read off the matching or comparison code.
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
  stoppedNotice,
} from "./support/pages";
import { addMatchedProduct, matchShop, recordPrice, removeSeededProducts } from "./support/watchlist-data";

test.afterEach(async () => {
  await removeSeededProducts();
});

// The matched item's page in Super-Pharm, on Super-Pharm's own site, as its adapter keeps links. The path is made up,
// and no step follows the link.
const SUPER_PHARM_PAGE = "https://www.superpharm.pl/e2e-balsam-w-czterech-sklepach";

test("#7: on a phone, Super-Pharm waits for its button, a tap asks only the stopped shop, and its picked price shows", async ({
  page,
}) => {
  // The shop request log as the test starts: every shop is stopped, so nothing the test does may move it.
  const mark = requestLogMark();
  // P1: matched automatically in Natura and in Hebe, with no decision in Super-Pharm, its three prices checked just now.
  // Its name, with the run's token, is text a shop's search may carry, so a tap on Super-Pharm's button reaches the gate.
  const waiting = await addMatchedProduct("Krem w czterech sklepach");
  const waitingHebe = await matchShop("hebe", waiting.productId, { name: "Hebe Krem w czterech sklepach" });
  await recordPrice("rossmann", waiting.itemId, { price: 19.99, available: true });
  await recordPrice("natura", waiting.sku, { price: 17.49, available: true });
  await recordPrice("hebe", waitingHebe, { price: 16.99, available: true });
  // P2: the same in Natura and Hebe, and matched in Super-Pharm by the user's pick, the only way Super-Pharm is matched.
  // Its four prices were checked just now, and Super-Pharm's is the lowest.
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

  // 2. Tap "Do sprawdzenia": it holds P1, still to match in Super-Pharm, and not P2, settled in every shop.
  await page
    .getByRole("navigation", { name: "Filtry listy" })
    .getByRole("link", { name: /^Do sprawdzenia/ })
    .tap();
  await expect(page).toHaveURL(/\/watchlist\?f=check$/);
  await expect(rowOf(page, waiting)).toBeVisible();
  await expect(rowOf(page, picked)).toHaveCount(0);

  // 3. Open P1: Super-Pharm's card offers its button, which names the shop, and no refused search, since the page asked
  // Super-Pharm nothing. The other shops' prices are fresh, so the page asked no shop at all.
  await openFromList(page, waiting);
  const superPharm = cardOf(page, "Super-Pharm");
  const button = superPharm.getByRole("link", { name: "Dopasuj w Super-Pharmie" });
  await expect(
    superPharm.getByText("Produkt nie jest jeszcze dopasowany w Super-Pharmie.", { exact: true }),
  ).toBeVisible();
  await expect(button).toHaveAttribute("href", `/watchlist/${waiting.productId}?f=check&retry=super-pharm`);
  await expect(superPharm.getByText(searchStoppedNotice("Super-Pharm"), { exact: true })).toHaveCount(0);
  await expect(superPharm.getByText(stoppedNotice("Super-Pharm"), { exact: true })).toHaveCount(0);
  expect(requestLogMark(), "no shop request was reserved: the run holds every shop stopped").toBe(mark);

  // 4. Tap "Dopasuj w Super-Pharmie": the page opens ?retry=super-pharm, whose one search the stopped shop refuses
  // before any request. Super-Pharm's card says its search is stopped, and no shop request was reserved.
  const beforeTap = requestLogMark();
  const [tapped] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().isNavigationRequest() && new URL(response.url()).searchParams.get("retry") === "super-pharm",
    ),
    button.tap(),
  ]);
  expect(tapped.status(), "the tap opens the product's page, which stores nothing to send it elsewhere").toBe(200);
  await waitForIsland(page, "PriceComparison");
  await expect(superPharm.getByText(searchStoppedNotice("Super-Pharm"), { exact: true })).toBeVisible();
  await expect(superPharm.getByRole("link", { name: "Dopasuj w Super-Pharmie" })).toHaveCount(0);
  expect(requestLogMark(), "the tap reserved no shop request: the stopped shop refused its one search").toBe(beforeTap);

  // 5. Open P2 from the list: Super-Pharm's card alone carries "Najtaniej", with its price, its source, superpharm.pl,
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

  // No page asked a shop for a price, and no shop request was reserved.
  expect(priceCalls, "no page of the flow asks a shop for a price").toEqual([]);
  expect(requestLogMark(), "the shop request log didn't move").toBe(mark);
});
