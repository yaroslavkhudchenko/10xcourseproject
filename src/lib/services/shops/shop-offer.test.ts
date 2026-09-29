import { describe, expect, it } from "vitest";
import { PRICE_LIMITS } from "@/lib/services/product-limits";
import { storableOffer } from "@/lib/services/shops/shop-offer";
import type { ShopOffer } from "@/types";

// Felix at Rossmann during a promotion, as rossmann-detail-reduced.json recorded it.
const felix: ShopOffer = {
  price: 5.99,
  regularPrice: 9.99,
  lowestPrice30d: 6.39,
  promoEndsOn: "2026-09-30",
  available: true,
};

describe("storableOffer", () => {
  it("keeps an offer that fits the table as it is", () => {
    expect(storableOffer(felix)).toEqual(felix);
    expect(storableOffer({ ...felix, regularPrice: null, lowestPrice30d: null, promoEndsOn: null })).toEqual({
      ...felix,
      regularPrice: null,
      lowestPrice30d: null,
      promoEndsOn: null,
    });
  });

  it("rounds every amount to grosze, as the table's numeric(10, 2) columns store them", () => {
    expect(storableOffer({ ...felix, price: 5.994, regularPrice: 9.989, lowestPrice30d: 6.3949 })).toEqual(felix);
  });

  it("keeps the highest price the table holds, and a 30-day low above today's price", () => {
    expect(storableOffer({ ...felix, price: PRICE_LIMITS.max, regularPrice: null, lowestPrice30d: 7.99 })).toEqual({
      ...felix,
      price: 99999.99,
      regularPrice: null,
      lowestPrice30d: 7.99,
    });
  });

  it.each([
    { why: "zero", price: 0 },
    { why: "less than a grosz", price: 0.004 },
    { why: "negative", price: -5.99 },
    { why: "above what the table holds", price: PRICE_LIMITS.max + 0.01 },
    { why: "above it once rounded", price: 99999.996 },
    { why: "not a number", price: Number.NaN },
    { why: "infinite", price: Number.POSITIVE_INFINITY },
  ])("gives no offer for a price that's $why", ({ price }) => {
    expect(storableOffer({ ...felix, price })).toBeNull();
  });

  it.each([
    { why: "equal to the price", regularPrice: 5.99 },
    { why: "equal to the price once rounded", regularPrice: 5.991 },
    { why: "below the price", regularPrice: 4.99 },
    { why: "zero", regularPrice: 0 },
    { why: "above what the table holds", regularPrice: 100000 },
  ])("drops a regular price that's $why, and keeps the rest of the offer", ({ regularPrice }) => {
    expect(storableOffer({ ...felix, regularPrice })).toEqual({ ...felix, regularPrice: null });
  });

  it.each([
    { why: "zero", lowestPrice30d: 0 },
    { why: "negative", lowestPrice30d: -6.39 },
    { why: "above what the table holds", lowestPrice30d: 100000 },
    { why: "not a number", lowestPrice30d: Number.NaN },
  ])("drops a 30-day low that's $why, and keeps the rest of the offer", ({ lowestPrice30d }) => {
    expect(storableOffer({ ...felix, lowestPrice30d })).toEqual({ ...felix, lowestPrice30d: null });
  });
});
