// risk: #1 and #7 (context/foundation/test-plan.md): for a product added from another shop than Rossmann, its own
// shop's price is left out of the comparison or shown without its source, age and page, the wrong shop is marked
// cheapest, or a view asks a shop for what the page already has.
// facet: on the production build at 390 px, a product added from Natura, matched in Rossmann, Hebe and Super-Pharm, has
// four fresh, orderable prices, its own Natura price the lowest. Its row on the list names Natura as cheapest, with its
// price's age, and so does its tag. On its page, Natura's own card carries "Najtaniej", its price, its source, its age
// and "Zobacz w sklepie" to the product's own page in Natura, with no match to change and no lookup there, while
// Rossmann's card names the matched Rossmann item, with its price, its age and "Zmień". Every decision is stored and
// every price fresh, so neither page asks a shop.
// expected values: the change's Phase 2 (context/changes/add-from-other-shops/plan.md, "Desired End State": a product
// added from Natura shows its own shop's price with its age and its own link, and is matched in Rossmann and the other
// two shops), FR-011 and US-01 (context/foundation/prd.md: the cheapest shop today is marked, and every price shows its
// source and age), and the S-03 decision (context/archive/2026-09-28-cheapest-shop-today: only fresh prices the shop
// sells online can win): Natura's 15,49 zł is the lowest of four fresh, orderable prices, 1,50 zł under Rossmann's
// 16,99 zł. The texts are the running app's. None of it is read off the comparison code.
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
} from "./support/pages";
import { addProduct, matchShop, recordPrice, removeSeededProducts } from "./support/watchlist-data";

test.afterEach(async () => {
  await removeSeededProducts();
});

// The product's own page in Natura, on Natura's own site, which "Dodaj" keeps as a product's link. The path is made
// up, and no step follows the link.
const NATURA_PAGE = "https://www.drogerienatura.pl/e2e-krem-z-natury";

test("#1: on a phone, a product added from Natura is priced by its own item beside its Rossmann match, and the cheapest is marked", async ({
  page,
}) => {
  // The shop request log as the test starts: every shop is stopped, so nothing the test does may move it.
  const mark = requestLogMark();
  // A product added from Natura, with its page there, and matched automatically in Rossmann, Hebe and Super-Pharm. Its
  // four prices were checked just now, all orderable: Natura's own is the lowest, then Rossmann's.
  const product = await addProduct({ source: "natura", name: "Krem z Natury", productUrl: NATURA_PAGE });
  const rossmannId = await matchShop("rossmann", product.productId, { name: "Rossmann Krem z Natury" });
  const hebeId = await matchShop("hebe", product.productId, { name: "Hebe Krem z Natury" });
  const superPharmId = await matchShop("super-pharm", product.productId, { name: "Super-Pharm Krem z Natury" });
  await recordPrice("natura", product.itemId, { price: 15.49, available: true });
  await recordPrice("rossmann", rossmannId, { price: 16.99, available: true });
  await recordPrice("hebe", hebeId, { price: 17.49, available: true });
  await recordPrice("super-pharm", superPharmId, { price: 17.99, available: true });
  // What the pages ask the shops for, through the island's price requests (lessons: "Bound what each page view and
  // action costs every shop"). Every price is fresh, so no page asks any.
  const priceCalls = recordPriceCalls(page);

  // 1. On the list, the row names Natura, the shop the product was added from, as cheapest, 1,50 zł under Rossmann,
  // with its price's age, and its tag says where its price comes from.
  await page.goto("/watchlist");
  await expect(rowOf(page, product)).toHaveAccessibleName(
    new RegExp(String.raw`Najtaniej: Natura 15,49\szł, o 1,50\szł taniej niż Rossmann · ${JUST_NOW}\.`),
  );
  await expect(rowOf(page, product).getByText(new RegExp(String.raw`^Natura · ${JUST_NOW}$`))).toBeVisible();

  // 2. Open it from the list: Natura's own card alone carries "Najtaniej", with its price, its source,
  // drogerienatura.pl, its age and "Zobacz w sklepie", which leads to the product's own page in Natura. Natura is the
  // shop the product was added from, so its card has no match to change, and the page looked nothing up there. The
  // hero names Natura.
  await openFromList(page, product);
  const natura = cardOf(page, "Natura");
  await expect(marksOf(page)).toHaveCount(1);
  await expect(natura.getByText("Najtaniej", { exact: true })).toBeVisible();
  await expect(priceOf(natura, "15,49")).toBeAttached();
  await expect(natura.getByText("drogerienatura.pl", { exact: true })).toBeVisible();
  await expect(ageLine(natura, JUST_NOW)).toBeVisible();
  await expect(natura.getByRole("link", { name: /^Zobacz w sklepie/ })).toHaveAttribute("href", NATURA_PAGE);
  await expect(natura.getByRole("link", { name: "Zmień" })).toHaveCount(0);
  await expect(natura.getByText(searchStoppedNotice("Natura"), { exact: true })).toHaveCount(0);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(String.raw`
    - paragraph: Najtaniej dziś
    - text: /15,49\szł/
    - paragraph: w Naturze
  `);

  // 3. Rossmann's card names the matched Rossmann item, with its price, its age and "Zmień".
  const rossmann = cardOf(page, "Rossmann");
  await expect(rossmann.getByText(`Rossmann ${product.name}`, { exact: true })).toBeVisible();
  await expect(priceOf(rossmann, "16,99")).toBeAttached();
  await expect(ageLine(rossmann, JUST_NOW)).toBeVisible();
  await expect(rossmann.getByRole("link", { name: "Zmień" })).toBeVisible();

  // Neither page asked a shop for a price, and no shop request was reserved.
  expect(priceCalls, "no page of the flow asks a shop for a price").toEqual([]);
  expect(requestLogMark(), "the shop request log didn't move").toBe(mark);
});
