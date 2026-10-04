// risk: #7 (context/foundation/test-plan.md): a browser-only regression breaks the phone flow at the shelf: an island
// that doesn't hydrate, a live per-shop refresh that stops, a layout that overflows or focus that disappears.
// facet: on the production build at 390 px, a shopper opens a product priced in Rossmann, Natura and Hebe from the list
// and taps "Odśwież ceny" while every shop is stopped. Each card keeps its price and age and says why its shop wasn't
// asked, the cheapest mark stays, the page doesn't scroll sideways, and keyboard focus is drawn, in forced colours too.
// The refresh goes through the app's own JSON route on workerd; nothing in the browser answers it.
// seed: tests/e2e/seed.spec.ts
import { expect, test, type Page } from "@playwright/test";
import {
  ageLine,
  cardOf,
  JUST_NOW,
  marksOf,
  openFromList,
  priceOf,
  recordPriceCalls,
  rowOf,
  sidewaysScroll,
  stoppedNotice,
} from "./support/pages";
import { addMatchedProduct, matchShop, recordPrice, removeSeededProducts } from "./support/watchlist-data";

test.afterEach(async () => {
  await removeSeededProducts();
});

/**
 * Keyboard focus as drawn: whether it sits on a control the keyboard reached, and that control's outline, with the
 * opacity of its colour (0 to 255), read by painting the colour, since a canvas parses every syntax the page computes.
 * It's read once the control's transitions have run: Tailwind's `transition` fades `outline-color` too, so an outline
 * turning transparent still shows its old colour for a moment.
 */
function focusRing(page: Page) {
  return page.evaluate(async () => {
    const control = document.activeElement;
    if (control === null || control === document.body) return { onControl: false, style: "none", width: 0, alpha: 0 };
    await Promise.all(control.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(control);
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const paint = canvas.getContext("2d");
    let alpha = 0;
    if (paint) {
      // A colour the canvas can't parse leaves this transparent one in place, so it reads as no outline, not as one.
      paint.fillStyle = "rgba(0, 0, 0, 0)";
      paint.fillStyle = outlineColor;
      paint.fillRect(0, 0, 1, 1);
      alpha = paint.getImageData(0, 0, 1, 1).data[3];
    }
    return {
      onControl: control.matches(":focus-visible"),
      style: outlineStyle,
      width: Number.parseFloat(outlineWidth),
      alpha,
    };
  });
}

async function expectDrawnFocus(page: Page, when: string): Promise<void> {
  const ring = await focusRing(page);
  expect(ring.onControl, `${when}: keyboard focus is on a control`).toBe(true);
  expect(ring.style, `${when}: the focused control draws an outline`).not.toBe("none");
  expect(ring.width, `${when}: the outline is at least 2 px wide`).toBeGreaterThanOrEqual(2);
  // A transparent outline (Tailwind's outline-hidden) has a style and a width, and shows nothing.
  expect(ring.alpha, `${when}: the outline's colour isn't transparent`).toBeGreaterThan(0);
}

test("#7: on a phone, a refresh with every shop stopped keeps each price and age, says why, and shows focus", async ({
  page,
}) => {
  // One product whose three prices were all checked just now, so its page asks no shop on load. Hebe's is the dearest.
  const product = await addMatchedProduct("Krem do odświeżenia");
  const hebeId = await matchShop("hebe", product.productId, { name: "Hebe Krem do odświeżenia" });
  await recordPrice("rossmann", product.itemId, { price: 19.99, available: true });
  await recordPrice("natura", product.sku, { price: 14.49, available: true });
  await recordPrice("hebe", hebeId, { price: 21.99, available: true });
  const shops = [
    ["Rossmann", "19,99"],
    ["Natura", "14,49"],
    ["Hebe", "21,99"],
  ] as const;
  // What the page asks the shops for, through the island's price requests (lessons: "Bound what each page view and
  // action costs every shop").
  const priceCalls = recordPriceCalls(page);

  // 1. On the list, the row names Natura as cheapest with its price, how much cheaper it is than the next shop,
  // Rossmann, and its age, and the page doesn't scroll sideways.
  await page.goto("/watchlist");
  await expect(rowOf(page, product)).toHaveAccessibleName(
    new RegExp(String.raw`Najtaniej: Natura 14,49\szł, o 5,50\szł taniej niż Rossmann · ${JUST_NOW}\.`),
  );
  await expect.poll(() => sidewaysScroll(page)).toBe(0);

  // 2. Tap the row, then wait for the island.
  await openFromList(page, product);

  // 3. Each card shows its price and its age, and "Najtaniej" is on Natura.
  for (const [shop, price] of shops) {
    await expect(priceOf(cardOf(page, shop), price)).toBeAttached();
    await expect(ageLine(cardOf(page, shop), JUST_NOW)).toBeVisible();
  }
  await expect(cardOf(page, "Natura").getByText("Najtaniej", { exact: true })).toBeVisible();
  // Every price is fresh, so opening the product asks no shop.
  expect(priceCalls, "opening a product whose prices are fresh asks no shop").toEqual([]);

  // 4. Tap the bottom bar's "Odśwież ceny".
  await page.getByRole("button", { name: "Odśwież ceny tego produktu" }).tap();

  // 5. Each shop is asked again and refused: its card says why, and keeps its price and age. Natura stays cheapest.
  for (const [shop, price] of shops) {
    const card = cardOf(page, shop);
    await expect(card.getByText(stoppedNotice(shop), { exact: true })).toBeVisible();
    await expect(priceOf(card, price)).toBeAttached();
    await expect(ageLine(card, JUST_NOW)).toBeVisible();
  }
  await expect(marksOf(page)).toHaveCount(1);
  await expect(cardOf(page, "Natura").getByText("Najtaniej", { exact: true })).toBeVisible();
  // The refresh asked each shop once, for the item the page shows there, and opening the product asked none.
  expect(
    [...priceCalls].sort((a, b) => a.shop.localeCompare(b.shop)),
    "the refresh asks each shop once, for this product's item",
  ).toEqual([
    { shop: "hebe", shopItemId: hebeId },
    { shop: "natura", shopItemId: product.sku },
    { shop: "rossmann", shopItemId: product.itemId },
  ]);

  // 6. The page still doesn't scroll sideways.
  await expect.poll(() => sidewaysScroll(page)).toBe(0);

  // 7. Tab reaches a control with a drawn focus outline, and the outline stays drawn in forced colours.
  await page.keyboard.press("Tab");
  await expectDrawnFocus(page, "after Tab");
  await page.emulateMedia({ forcedColors: "active" });
  await expectDrawnFocus(page, "in forced colours");
});
