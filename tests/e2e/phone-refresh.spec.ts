// risk: #7 (context/foundation/test-plan.md): a browser-only regression breaks the phone flow at the shelf: an island
// that doesn't hydrate, a live per-shop refresh that stops, a layout that overflows or focus that disappears.
// facet: on the production build at 390 px, a shopper opens a product from the list and taps "Odśwież ceny" while every
// shop is stopped. Each card keeps its price and age and says why its shop wasn't asked, the cheapest mark stays, the
// page doesn't scroll sideways, and keyboard focus is drawn, in forced colours too. The refresh goes through the app's
// own JSON route on workerd; nothing in the browser answers it.
// seed: tests/e2e/seed.spec.ts
import { expect, test, type Page } from "@playwright/test";
import {
  ageLine,
  cardOf,
  JUST_NOW,
  marksOf,
  openFromList,
  priceOf,
  rowOf,
  sidewaysScroll,
  stoppedNotice,
} from "./support/pages";
import { addMatchedProduct, recordPrice, removeSeededProducts } from "./support/watchlist-data";

test.afterEach(async () => {
  await removeSeededProducts();
});

/** Keyboard focus as drawn: whether it sits on a control the keyboard reached, and that control's outline. */
function focusRing(page: Page) {
  return page.evaluate(() => {
    const control = document.activeElement;
    if (control === null || control === document.body) return { onControl: false, style: "none", width: 0 };
    const { outlineStyle, outlineWidth } = getComputedStyle(control);
    return {
      onControl: control.matches(":focus-visible"),
      style: outlineStyle,
      width: Number.parseFloat(outlineWidth),
    };
  });
}

async function expectDrawnFocus(page: Page, when: string): Promise<void> {
  const ring = await focusRing(page);
  expect(ring.onControl, `${when}: keyboard focus is on a control`).toBe(true);
  expect(ring.style, `${when}: the focused control draws an outline`).not.toBe("none");
  expect(ring.width, `${when}: the outline is at least 2 px wide`).toBeGreaterThanOrEqual(2);
}

test("#7: on a phone, a refresh with every shop stopped keeps each price and age, says why, and shows focus", async ({
  page,
}) => {
  // One product whose two prices were both checked just now, so its page asks no shop on load.
  const product = await addMatchedProduct("Krem do odświeżenia");
  await recordPrice("rossmann", product.itemId, { price: 19.99, available: true });
  await recordPrice("natura", product.sku, { price: 14.49, available: true });
  const shops = [
    ["Rossmann", "19,99"],
    ["Natura", "14,49"],
  ] as const;

  // 1. On the list, the row names Natura as cheapest with its price, how much cheaper it is and its age, and the page
  // doesn't scroll sideways.
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

  // 6. The page still doesn't scroll sideways.
  await expect.poll(() => sidewaysScroll(page)).toBe(0);

  // 7. Tab reaches a control with a drawn focus outline, and the outline stays drawn in forced colours.
  await page.keyboard.press("Tab");
  await expectDrawnFocus(page, "after Tab");
  await page.emulateMedia({ forcedColors: "active" });
  await expectDrawnFocus(page, "in forced colours");
});
