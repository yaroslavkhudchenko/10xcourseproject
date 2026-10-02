// What the specs find on the list and a product's page, in the running app's own words (explored at 390 px with
// playwright-cli): a product's row, its shops' cards and their lines, the stopped notice, and the page's width. Each
// locator goes by role and text, as the seed does; none of the texts is read off the app's code.
import { expect, type Locator, type Page } from "@playwright/test";
import { waitForIsland } from "./islands";
import type { SeededProduct } from "./watchlist-data";

/** How long ago a check made during the test was, as a page says it: "przed chwilą" for a minute, then "N min temu". */
export const JUST_NOW = String.raw`(?:przed chwilą|\d+ min temu)`;

/** What a shop's card says once the island asked the shop again and it was refused: the setup stops every shop. */
export function stoppedNotice(shop: string): string {
  return `Odświeżanie cen w sklepie ${shop} jest wyłączone, bo sklep zablokował zapytania.`;
}

/** The product's row on the list: a link whose name is what a screen reader hears, its whole comparison. */
export function rowOf(page: Page, product: SeededProduct): Locator {
  return page.getByRole("list", { name: "Moja lista" }).getByRole("link", { name: product.name });
}

/** A shop's card among the product's prices. */
export function cardOf(page: Page, shop: "Rossmann" | "Natura"): Locator {
  return page
    .getByRole("region", { name: "Ceny" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: shop, level: 3 }) });
}

/** The cheapest marks among the product's prices. */
export function marksOf(page: Page): Locator {
  return page.getByRole("region", { name: "Ceny" }).getByText("Najtaniej", { exact: true });
}

/** A card's price, as a screen reader reads it ("19,99 zł"): the digits drawn beside it are hidden from it. */
export function priceOf(card: Locator, amount: string): Locator {
  return card.getByText(new RegExp(String.raw`^${amount}\szł$`));
}

/** A card's line with the price's source and age: the price is the shop's online one, checked that long ago. */
export function ageLine(card: Locator, age: string): Locator {
  return card.getByText(new RegExp(String.raw`^cena online · ${age}$`));
}

/** Taps the product's row on the list the page shows, and waits until the product's prices are live. */
export async function openFromList(page: Page, product: SeededProduct): Promise<void> {
  await rowOf(page, product).tap();
  await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  await waitForIsland(page, "PriceComparison");
}

/** How far the page scrolls sideways: none at all on a phone, where rows wrap and only the filter chips scroll. */
export function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** One of the island's price requests: the shop it asks again, and the item it names there. */
export interface PriceCall {
  shop: string;
  shopItemId: string;
}

/**
 * Records the island's price requests (POST /api/watchlist/prices) as the page sends them, from now on. Each would cost
 * its shop one request if the shops weren't stopped, so their count is what a page view or a tap costs the shops.
 */
export function recordPriceCalls(page: Page): PriceCall[] {
  const calls: PriceCall[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/watchlist/prices") return;
    const body: unknown = request.postDataJSON();
    const field = (name: string): string => {
      const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
      return typeof value === "string" ? value : "";
    };
    calls.push({ shop: field("shop"), shopItemId: field("shopItemId") });
  });
  return calls;
}
