import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  comparisonOf,
  done,
  initialState,
  priceComparisonReducer,
  start,
} from "@/components/watchlist/price-comparison-state";
import ShopCard from "@/components/watchlist/ShopCard";
import type { PriceComparisonShop, PricedShop } from "@/lib/services/price-comparison";
import { PRICE_UNSAVED_TEXT } from "@/lib/shop-messages";
import type { LatestPrice, PriceRefreshAnswer, ShopOffer } from "@/types";

// The repository's first test that renders a component. ShopCard keeps no state, so react-dom/server renders it in
// Node, with no DOM and no new dependency, and createElement stands in for JSX, which the suite's .test.ts files can't
// hold. It pins the line a shop's card adds while the price it shows is one the route couldn't store (`saved: false`),
// which e2e can't reach: every shop is stopped there, so a refetch only ever gets the stopped notice (the refresh flow
// analysis's TD-19). The line is the owner's of 2026-10-10 (context/changes/unstored-price-check/plan.md), and
// shop-messages.test.ts pins its words.

// Both prices were stored 20 minutes before the server rendered the page at RENDERED; Natura's refetch answered a few
// seconds after it.
const STORED_AT = "2026-09-28T11:40:00.000Z";
const RENDERED = "2026-09-28T12:00:00.000Z";
const CHECKED_AT = "2026-09-28T12:00:02.000Z";
const ANSWERED_AT = Date.parse("2026-09-28T12:00:03.000Z");

const offer = (price: number): ShopOffer => ({
  price,
  regularPrice: null,
  lowestPrice30d: null,
  promoEndsOn: null,
  available: true,
});

/** A stored price, checked at STORED_AT and read without its history. */
function stored(shop: PricedShop, shopItemId: string, price: number): LatestPrice {
  return {
    shop,
    shopItemId,
    lastCheckedAt: STORED_AT,
    lastStatus: "price",
    offer: { ...offer(price), pricedAt: STORED_AT },
    history: null,
  };
}

// Nivea Soft 300 ml as the page hands it to the island: Rossmann's stored 26,99 zł and Natura's 29,99 zł, each with its
// item's page, so each card ends with "Zobacz w sklepie".
const SHOPS: PriceComparisonShop[] = [
  {
    shop: "rossmann",
    shopItemId: "26900",
    productUrl: "https://www.rossmann.pl/Produkt/NIVEA-Soft,26900,13049",
    latest: stored("rossmann", "26900", 26.99),
  },
  {
    shop: "natura",
    shopItemId: "NV89063",
    productUrl: "https://www.drogerienatura.pl/nivea-soft",
    latest: stored("natura", "NV89063", 29.99),
  },
];

/**
 * Natura's card as the island renders it once Natura's refetch answered 16,99 zł, below Rossmann's 26,99 zł, which the
 * route stored unless `saved` is false. Its row comes through the island's reducer and the comparison's marks
 * (comparisonOf), as the view's comes.
 */
function naturaCardAfter(saved: boolean): string {
  const answer: PriceRefreshAnswer = { kind: "price", offer: offer(16.99), checkedAt: CHECKED_AT, saved };
  const before = initialState({ shops: SHOPS, now: RENDERED });
  const state = [start("natura"), done("natura", answer, ANSWERED_AT)].reduce(priceComparisonReducer, before);
  const row = comparisonOf(state).rows.find(({ shop }) => shop === "natura");
  if (row === undefined) {
    throw new Error("The comparison has no row for Natura.");
  }
  return renderToStaticMarkup(createElement(ShopCard, { row, now: state.now }));
}

/** How many times `text` stands in `markup`. */
const timesIn = (markup: string, text: string) => markup.split(text).length - 1;

describe("ShopCard", () => {
  it("says once that the list won't show a price the route couldn't store, and keeps the price's „Najtaniej”", () => {
    const card = naturaCardAfter(false);

    expect(timesIn(card, PRICE_UNSAVED_TEXT)).toBe(1);
    expect(card).toContain("Najtaniej");
  });

  it("says nothing of the kind under a price the route stored", () => {
    const card = naturaCardAfter(true);

    expect(card).not.toContain(PRICE_UNSAVED_TEXT);
    expect(card).toContain("Najtaniej");
  });
});
