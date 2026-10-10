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
import { ANSWERED_AT, CHECKED_AT, natura, offer, RENDERED, rossmann } from "@/lib/services/testing/island-shops";
import { PRICE_UNSAVED_TEXT } from "@/lib/shop-messages";
import type { PriceRefreshAnswer } from "@/types";

// The repository's first test that renders a component. ShopCard keeps no state, so react-dom/server renders it in
// Node, with no DOM and no new dependency, and createElement stands in for JSX, which the suite's .test.ts files can't
// hold. It pins the line a shop's card adds while the price it shows is one the route couldn't store (`saved: false`),
// which e2e can't reach: every shop is stopped there, so a refetch only ever gets the stopped notice, the refresh flow
// analysis's TD-19 (context/changes/price-refresh-flow-analysis/research.md). The line is the owner's of 2026-10-10
// (context/archive/2026-10-10-unstored-price-check/plan.md), and shop-messages.test.ts pins its words.

/**
 * Natura's card as the island renders it for Nivea Soft 300 ml, with Rossmann's 26,99 zł and Natura's 29,99 zł stored
 * before the page was rendered (island-shops.ts), once Natura's refetch answered 16,99 zł, which the route stored
 * unless `saved` is false. Its row comes through the island's reducer and the comparison's marks (comparisonOf), as the
 * view's comes.
 */
function naturaCardAfter(saved: boolean): string {
  const answer: PriceRefreshAnswer = { kind: "price", offer: offer(16.99), checkedAt: CHECKED_AT, saved };
  const before = initialState({ shops: [rossmann(), natura()], now: RENDERED });
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
