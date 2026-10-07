import { describe, expect, it } from "vitest";
import {
  ageText,
  compareShops,
  formatDay,
  formatDayOf,
  formatPrice,
  HISTORY_DAYS_NEEDED,
  HISTORY_WINDOW_DAYS,
  judgementOf,
  listJoin,
  listPricedItems,
  listSummaryText,
  namesOf,
  needsRefetch,
  PRICE_UNREAD_TEXT,
  priceParts,
  priceState,
  productPriceKeys,
  REFETCH_AFTER_MS,
  sinceText,
  STALE_AFTER_MS,
  staleTargets,
  verdictOf,
  type LatestCheck,
  type PriceDecision,
  type PricedItem,
  type PricedShop,
  type PriceJudgement,
  type PriceVerdict,
  type ShopPrice,
} from "@/lib/services/price-comparison";
import type { LatestPrice, PriceHistory, ShopId, ShopMatchState } from "@/types";

// Every time here is measured back from one fixed moment.
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Intl writes Polish prices with a no-break space before "zł".
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** The ISO timestamp `ms` before NOW. */
const ago = (ms: number) => new Date(NOW - ms).toISOString();

interface CheckOptions {
  price?: number;
  available?: boolean;
  status?: "price" | "missing";
  checkedAgo?: number;
  pricedAgo?: number;
  promoEndsOn?: string | null;
  lowestPrice30d?: number | null;
  history?: PriceHistory | null;
}

/**
 * An item last checked `checkedAgo` before NOW, with a price fetched `pricedAgo` before NOW (by default, then), on a
 * promotion ending on `promoEndsOn` when one is given, with the shop's 30-day low when it's given, and with the item's
 * price history as the page read it: none, unless one is given, or null for a history that wasn't read.
 */
function check({
  price = 16.99,
  available = true,
  status = "price",
  checkedAgo = 5 * MINUTE,
  pricedAgo = checkedAgo,
  promoEndsOn = null,
  lowestPrice30d = null,
  history = { low: null, days: [] },
}: CheckOptions = {}): LatestCheck {
  return {
    lastCheckedAt: ago(checkedAgo),
    lastStatus: status,
    offer: { price, regularPrice: null, lowestPrice30d, promoEndsOn, available, pricedAt: ago(pricedAgo) },
    history,
  };
}

// NOW is 14:00 on 28 September in Poland. A promotion that ended the day before:
const ENDED_YESTERDAY = "2026-09-27";

/** A promotion's price checked at `at`, an ISO timestamp, whose promotion ends on `promoEndsOn`. */
function promoCheck(at: string, promoEndsOn: string): LatestCheck {
  return {
    lastCheckedAt: at,
    lastStatus: "price",
    offer: { price: 5.99, regularPrice: 9.99, lowestPrice30d: null, promoEndsOn, available: true, pricedAt: at },
    history: null,
  };
}

/** An item checked once, when the shop answered without it: no price at all. */
const neverPriced: LatestCheck = { lastCheckedAt: ago(MINUTE), lastStatus: "missing", offer: null, history: null };

const row = (shop: PricedShop, latest: LatestCheck | null) => ({ shop, latest });

/** Each row's shop and mark, in the comparison's order. */
function marks(rows: { shop: PricedShop; cheapest: boolean }[]) {
  return rows.map(({ shop, cheapest }) => [shop, cheapest]);
}

describe("needsRefetch", () => {
  it("fetches an item that has never been checked", () => {
    expect(needsRefetch(null, NOW)).toBe(true);
  });

  it("keeps a check exactly 15 minutes old, and fetches again 1 ms later", () => {
    expect(needsRefetch(check({ checkedAgo: REFETCH_AFTER_MS }), NOW)).toBe(false);
    expect(needsRefetch(check({ checkedAgo: REFETCH_AFTER_MS + 1 }), NOW)).toBe(true);
  });

  it("goes by the last check, whatever it found", () => {
    expect(needsRefetch({ ...neverPriced, lastCheckedAt: ago(MINUTE) }, NOW)).toBe(false);
    expect(needsRefetch(check({ status: "missing", checkedAgo: MINUTE, pricedAgo: 3 * DAY }), NOW)).toBe(false);
  });

  it("fetches a price again at once when its promotion ended after the check, however recent the check", () => {
    // 23:55 in Poland on the promotion's last day, then 00:05 the next day: the check is ten minutes old.
    const pastMidnight = Date.parse("2026-09-28T22:05:00.000Z");

    expect(needsRefetch(promoCheck("2026-09-28T21:55:00.000Z", "2026-09-28"), pastMidnight)).toBe(true);
    // On the promotion's last day the price still holds.
    expect(needsRefetch(check({ checkedAgo: MINUTE, promoEndsOn: "2026-09-28" }), NOW)).toBe(false);
  });

  it("waits the 15 minutes after a check made once the promotion had ended: the shop already answered", () => {
    // The shop still sends an end date that has passed. Asking again at once would only repeat the same answer.
    expect(needsRefetch(check({ checkedAgo: MINUTE, promoEndsOn: ENDED_YESTERDAY }), NOW)).toBe(false);
    expect(needsRefetch(check({ checkedAgo: REFETCH_AFTER_MS + 1, promoEndsOn: ENDED_YESTERDAY }), NOW)).toBe(true);
  });

  it("waits the 15 minutes after a check that found the item missing, whatever the last price's promotion", () => {
    const missing = check({ status: "missing", checkedAgo: MINUTE, pricedAgo: 3 * DAY, promoEndsOn: "2026-09-20" });

    expect(needsRefetch(missing, NOW)).toBe(false);
  });
});

describe("priceState", () => {
  it("is none without a price", () => {
    expect(priceState(null, NOW)).toBe("none");
    expect(priceState(neverPriced, NOW)).toBe("none");
  });

  it("is fresh at exactly 24 hours, and stale 1 ms later", () => {
    expect(priceState(check({ checkedAgo: STALE_AFTER_MS }), NOW)).toBe("fresh");
    expect(priceState(check({ checkedAgo: STALE_AFTER_MS + 1 }), NOW)).toBe("stale");
  });

  it("is missing when the last check found no item, however fresh the price", () => {
    expect(priceState(check({ status: "missing", checkedAgo: MINUTE, pricedAgo: 2 * MINUTE }), NOW)).toBe("missing");
    expect(priceState(check({ status: "missing", pricedAgo: 3 * DAY }), NOW)).toBe("missing");
    expect(priceState(check({ status: "missing", promoEndsOn: ENDED_YESTERDAY }), NOW)).toBe("missing");
  });

  it("is fresh on a promotion's last day, and stale once that day is over", () => {
    expect(priceState(check({ promoEndsOn: "2026-09-29" }), NOW)).toBe("fresh");
    expect(priceState(check({ promoEndsOn: "2026-09-28" }), NOW)).toBe("fresh");
    expect(priceState(check({ promoEndsOn: ENDED_YESTERDAY }), NOW)).toBe("stale");
  });

  it("ends a promotion's last day at midnight in Poland, not in UTC", () => {
    // Summer time: 21:59 UTC is 23:59 in Poland, and 22:30 UTC is already 00:30 on 29 September. The price itself is
    // under 24 hours old at both times.
    const lastMinute = Date.parse("2026-09-28T21:59:00.000Z");
    const pastMidnight = Date.parse("2026-09-28T22:30:00.000Z");

    expect(priceState(check({ promoEndsOn: "2026-09-28" }), lastMinute)).toBe("fresh");
    expect(priceState(check({ promoEndsOn: "2026-09-28" }), pastMidnight)).toBe("stale");
    expect(priceState(check({ promoEndsOn: "2026-09-29" }), pastMidnight)).toBe("fresh");
  });
});

describe("compareShops", () => {
  it("puts the cheapest first and marks it, with the savings worked out in grosze", () => {
    const { rows, summary } = compareShops(
      [row("rossmann", check({ price: 26.99 })), row("natura", check({ price: 16.99, checkedAgo: 2 * HOUR }))],
      NOW,
    );

    expect(marks(rows)).toEqual([
      ["natura", true],
      ["rossmann", false],
    ]);
    // The plan's example: exactly 10,00 zł.
    expect(summary).toEqual({
      kind: "cheapest",
      shops: ["natura"],
      price: 16.99,
      ageFrom: ago(2 * HOUR),
      savings: { amount: 10, than: "rossmann" },
    });
    if (summary.kind !== "cheapest" || summary.savings === null) {
      throw new Error(`expected savings, got ${summary.kind}`);
    }
    expect(formatPrice(summary.savings.amount)).toBe(`10,00${NO_BREAK_SPACE}zł`);
  });

  it("works the savings out in grosze where floating point would be off", () => {
    // 5.99 - 3.19 in floating point is 2.8000000000000003; in grosze it's exactly 2,80 zł.
    const { summary } = compareShops(
      [row("rossmann", check({ price: 5.99 })), row("natura", check({ price: 3.19 }))],
      NOW,
    );

    expect(summary).toMatchObject({ kind: "cheapest", shops: ["natura"], savings: { amount: 2.8, than: "rossmann" } });
  });

  it("keeps a fresh price whose last check found the item missing from winning", () => {
    const { rows, summary } = compareShops(
      [
        row("rossmann", check({ price: 26.99 })),
        row("natura", check({ price: 16.99, status: "missing", checkedAgo: MINUTE, pricedAgo: 10 * MINUTE })),
      ],
      NOW,
    );

    expect(marks(rows)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);
    expect(rows.map(({ state, eligible }) => [state, eligible])).toEqual([
      ["fresh", true],
      ["missing", false],
    ]);
    expect(summary).toMatchObject({ kind: "cheapest", shops: ["rossmann"], savings: null });
  });

  it("never names a price that can't be ordered online cheapest", () => {
    const { rows, summary } = compareShops(
      [row("rossmann", check({ price: 26.99 })), row("natura", check({ price: 16.99, available: false }))],
      NOW,
    );

    expect(marks(rows)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);
    expect(summary).toMatchObject({ kind: "cheapest", shops: ["rossmann"], price: 26.99, savings: null });
  });

  it("never names a stale price cheapest, even when it's lower", () => {
    const { rows, summary } = compareShops(
      [row("rossmann", check({ price: 9.99, checkedAgo: STALE_AFTER_MS + 1 })), row("natura", check({ price: 16.99 }))],
      NOW,
    );

    expect(marks(rows)).toEqual([
      ["natura", true],
      ["rossmann", false],
    ]);
    expect(summary).toMatchObject({ kind: "cheapest", shops: ["natura"], savings: null });
  });

  it("never names a price whose promotion has ended cheapest, even when it's lower", () => {
    const { rows, summary } = compareShops(
      [row("rossmann", check({ price: 5.99, promoEndsOn: ENDED_YESTERDAY })), row("natura", check({ price: 16.99 }))],
      NOW,
    );

    expect(marks(rows)).toEqual([
      ["natura", true],
      ["rossmann", false],
    ]);
    expect(rows.map(({ shop, state }) => [shop, state])).toEqual([
      ["natura", "fresh"],
      ["rossmann", "stale"],
    ]);
    expect(summary).toMatchObject({ kind: "cheapest", shops: ["natura"], price: 16.99, savings: null });
  });

  it("marks both shops of a tie, with the older price's age", () => {
    const { rows, summary } = compareShops(
      [
        row("rossmann", check({ price: 16.99, checkedAgo: 5 * MINUTE })),
        row("natura", check({ price: 16.99, checkedAgo: HOUR })),
      ],
      NOW,
    );

    expect(marks(rows)).toEqual([
      ["rossmann", true],
      ["natura", true],
    ]);
    expect(summary).toEqual({
      kind: "cheapest",
      shops: ["rossmann", "natura"],
      price: 16.99,
      ageFrom: ago(HOUR),
      savings: null,
    });
  });

  it("gives only for a lone shop, which it doesn't mark: nothing was compared", () => {
    const { rows, summary } = compareShops([row("rossmann", check({ price: 26.99 }))], NOW);

    expect(summary).toEqual({ kind: "only", shop: "rossmann" });
    expect(rows).toEqual([
      expect.objectContaining({ shop: "rossmann", state: "fresh", eligible: true, cheapest: false }),
    ]);
  });

  it("gives none when no shop has a fresh price, and marks nothing", () => {
    const { rows, summary } = compareShops(
      [
        row("rossmann", check({ price: 26.99, checkedAgo: 2 * DAY })),
        row("natura", check({ price: 16.99, checkedAgo: STALE_AFTER_MS + 1 })),
      ],
      NOW,
    );

    expect(summary).toEqual({ kind: "none" });
    // Still in price order, so the stale prices read from the lowest.
    expect(marks(rows)).toEqual([
      ["natura", false],
      ["rossmann", false],
    ]);
    expect(compareShops([], NOW).summary).toEqual({ kind: "none" });
    expect(compareShops([row("rossmann", null), row("natura", neverPriced)], NOW).summary).toEqual({ kind: "none" });
  });

  // Hebe, matched beside Natura, is compared like any priced shop. The verdicts come from FR-011 and the S-03 rule
  // that only a fresh price the shop sells online can win, never from the comparison's code.
  it("marks Hebe cheapest when its fresh price is the lowest of three, with the savings against the next shop", () => {
    const { rows, summary } = compareShops(
      [
        row("rossmann", check({ price: 19.99 })),
        row("natura", check({ price: 17.49 })),
        row("hebe", check({ price: 16.99, checkedAgo: HOUR })),
      ],
      NOW,
    );

    expect(marks(rows)).toEqual([
      ["hebe", true],
      ["natura", false],
      ["rossmann", false],
    ]);
    expect(summary).toEqual({
      kind: "cheapest",
      shops: ["hebe"],
      price: 16.99,
      ageFrom: ago(HOUR),
      savings: { amount: 0.5, than: "natura" },
    });
  });

  it.each<{ why: string; hebe: LatestCheck }>([
    { why: "1 ms past 24 hours old", hebe: check({ price: 9.99, checkedAgo: STALE_AFTER_MS + 1 }) },
    { why: "from a promotion that ended yesterday", hebe: check({ price: 9.99, promoEndsOn: ENDED_YESTERDAY }) },
    { why: "for an item Hebe no longer returns", hebe: check({ price: 9.99, status: "missing", pricedAgo: HOUR }) },
    { why: "for an item Hebe doesn't sell online", hebe: check({ price: 9.99, available: false }) },
  ])("never names Hebe's lowest price of three cheapest when it's $why", ({ hebe }) => {
    const { rows, summary } = compareShops(
      [row("rossmann", check({ price: 19.99 })), row("natura", check({ price: 17.49 })), row("hebe", hebe)],
      NOW,
    );

    expect(marks(rows)).toEqual([
      ["natura", true],
      ["rossmann", false],
      ["hebe", false],
    ]);
    expect(summary).toMatchObject({ kind: "cheapest", shops: ["natura"], price: 17.49, savings: { than: "rossmann" } });
  });

  it("orders eligible rows first, then the other rows with a price, then the rows without one", () => {
    const rows = [
      { ...row("natura", null), label: "no price yet" },
      { ...row("natura", check({ price: 5.99, checkedAgo: 2 * DAY })), label: "stale" },
      { ...row("rossmann", check({ price: 30.99 })), label: "dearer, fresh" },
      { ...row("rossmann", neverPriced), label: "never priced" },
      { ...row("natura", check({ price: 26.99 })), label: "cheaper, fresh" },
      { ...row("rossmann", check({ price: 3.99, available: false })), label: "not orderable" },
    ];

    const compared = compareShops(rows, NOW).rows;

    expect(compared.map(({ label, cheapest }) => [label, cheapest])).toEqual([
      ["cheaper, fresh", true],
      ["dearer, fresh", false],
      ["not orderable", false],
      ["stale", false],
      ["no price yet", false],
      ["never priced", false],
    ]);
    expect(compared.map(({ state }) => state)).toEqual(["fresh", "fresh", "fresh", "stale", "none", "none"]);
  });
});

describe("verdictOf", () => {
  /** The verdict on these rows, compared at NOW, with or without a price that couldn't be read. */
  const verdictOn = (rows: ShopPrice[], unread = false) => verdictOf(compareShops(rows, NOW), NOW, unread);

  const cheaperNatura = row("natura", check({ price: 16.99, checkedAgo: 2 * HOUR }));

  it("says a price couldn't be read before anything else, whatever the other prices say", () => {
    const rows = [row("rossmann", check({ price: 26.99 })), cheaperNatura];

    expect(verdictOn(rows, true)).toEqual({ kind: "unread", at: NOW });
    expect(verdictOn(rows).kind).toBe("cheapest");
    expect(verdictOn([row("rossmann", null)], true)).toEqual({ kind: "unread", at: NOW });
  });

  it("names the cheapest shop with its price, its age and the savings, as the comparison gives them", () => {
    expect(verdictOn([row("rossmann", check({ price: 26.99 })), cheaperNatura])).toEqual({
      kind: "cheapest",
      shops: ["natura"],
      price: 16.99,
      ageFrom: ago(2 * HOUR),
      savings: { amount: 10, than: "rossmann" },
      at: NOW,
    });
  });

  it("names both shops of a tie, with the older price's age and no savings", () => {
    const rows = [
      row("rossmann", check({ price: 16.99, checkedAgo: 5 * MINUTE })),
      row("natura", check({ price: 16.99, checkedAgo: HOUR })),
    ];

    expect(verdictOn(rows)).toEqual({
      kind: "cheapest",
      shops: ["rossmann", "natura"],
      price: 16.99,
      ageFrom: ago(HOUR),
      savings: null,
      at: NOW,
    });
  });

  it.each<{ why: string; lower: LatestCheck }>([
    { why: "a lower price 1 ms past 24 hours old", lower: check({ price: 9.99, checkedAgo: STALE_AFTER_MS + 1 }) },
    {
      why: "a lower price whose promotion ended yesterday",
      lower: check({ price: 5.99, promoEndsOn: ENDED_YESTERDAY }),
    },
    {
      why: "a lower price whose item the shop no longer returns",
      lower: check({ price: 5.99, status: "missing", checkedAgo: MINUTE, pricedAgo: HOUR }),
    },
  ])("names the fresh price cheapest beside $why, which can't win", ({ lower }) => {
    expect(verdictOn([row("rossmann", lower), cheaperNatura])).toMatchObject({
      kind: "cheapest",
      shops: ["natura"],
      price: 16.99,
      savings: null,
    });
  });

  it("names the only fresh price cheapest beside a shop never checked", () => {
    expect(verdictOn([row("rossmann", check({ price: 26.99 })), row("natura", null)])).toMatchObject({
      kind: "cheapest",
      shops: ["rossmann"],
      savings: null,
    });
  });

  it("gives only for the one shop's fresh price that can be ordered online, up to exactly 24 hours old", () => {
    expect(verdictOn([row("rossmann", check({ price: 26.99, checkedAgo: STALE_AFTER_MS }))])).toEqual({
      kind: "only",
      shop: "rossmann",
      price: 26.99,
      pricedAt: ago(STALE_AFTER_MS),
      at: NOW,
    });
    expect(verdictOn([row("rossmann", check({ price: 26.99, checkedAgo: STALE_AFTER_MS + 1 }))]).kind).toBe("stale");
  });

  it("gives unavailable for the one shop's fresh price that can't be ordered online", () => {
    expect(verdictOn([row("rossmann", check({ price: 26.99, available: false }))])).toEqual({
      kind: "unavailable",
      shop: "rossmann",
      price: 26.99,
      pricedAt: ago(5 * MINUTE),
      at: NOW,
    });
  });

  it("gives the lowest offer that can't be ordered online when neither shop's can be", () => {
    const rows = [
      row("rossmann", check({ price: 26.99, available: false })),
      row("natura", check({ price: 24.99, available: false, checkedAgo: HOUR })),
    ];

    expect(verdictOn(rows)).toEqual({
      kind: "unavailable",
      shop: "natura",
      price: 24.99,
      pricedAt: ago(HOUR),
      at: NOW,
    });
  });

  it("gives a fresh offer that can't be ordered online before a lower stale one", () => {
    const rows = [
      row("rossmann", check({ price: 12.99, checkedAgo: 2 * DAY })),
      row("natura", check({ price: 24.99, available: false })),
    ];

    expect(verdictOn(rows)).toMatchObject({ kind: "unavailable", shop: "natura", price: 24.99 });
  });

  it.each<{ why: string; latest: LatestCheck; pricedAt: string }>([
    {
      why: "1 ms past 24 hours old",
      latest: check({ price: 26.99, checkedAgo: STALE_AFTER_MS + 1 }),
      pricedAt: ago(STALE_AFTER_MS + 1),
    },
    {
      why: "from a promotion that ended yesterday",
      latest: check({ price: 26.99, promoEndsOn: ENDED_YESTERDAY }),
      pricedAt: ago(5 * MINUTE),
    },
    {
      why: "for an item the shop no longer returns",
      latest: check({ price: 26.99, status: "missing", checkedAgo: MINUTE, pricedAgo: 3 * HOUR }),
      pricedAt: ago(3 * HOUR),
    },
  ])("gives stale with the last price when the one shop's price is $why", ({ latest, pricedAt }) => {
    expect(verdictOn([row("rossmann", latest)])).toEqual({
      kind: "stale",
      shop: "rossmann",
      price: 26.99,
      pricedAt,
      at: NOW,
    });
  });

  it("gives the lowest stale offer when no shop's price is fresh", () => {
    const rows = [
      row("rossmann", check({ price: 26.99, checkedAgo: 2 * DAY })),
      row("natura", check({ price: 16.99, status: "missing", checkedAgo: MINUTE, pricedAgo: 3 * DAY })),
    ];

    expect(verdictOn(rows)).toEqual({
      kind: "stale",
      shop: "natura",
      price: 16.99,
      pricedAt: ago(3 * DAY),
      at: NOW,
    });
  });

  it("gives none when no shop has a price", () => {
    expect(verdictOn([])).toEqual({ kind: "none", at: NOW });
    expect(verdictOn([row("rossmann", null)])).toEqual({ kind: "none", at: NOW });
    expect(verdictOn([row("rossmann", neverPriced)])).toEqual({ kind: "none", at: NOW });
    expect(verdictOn([row("rossmann", null), row("natura", neverPriced)])).toEqual({ kind: "none", at: NOW });
  });
});

// The owner's rule of 2026-10-06 (FR-012): a cheapest or only price is good below what it's compared with, and ordinary
// at it or above, in grosze. It's compared with the product's own history once the product has been on the list for 30
// days and its shops had a price on 5 different days, else with the 30-day low its cheapest shops declare, else with
// nothing. Every judgement expected below is worked out from that rule, never from the code.
describe("judgementOf", () => {
  // NOW is 28 September in Poland, so a history's days are the days before it.
  const DAYS_BEFORE = ["2026-09-27", "2026-09-26", "2026-09-25", "2026-09-24", "2026-09-23"];
  // A product 40 days on the list: long enough for its own history to count, once that history is enough.
  const LISTED_LONG_AGO = ago(40 * DAY);

  /** A history whose lowest price is `low`, with a price on the first `count` days before NOW's. */
  const historyOf = (low: number, count: number): PriceHistory => ({ low, days: DAYS_BEFORE.slice(0, count) });

  /** The judgement on these rows' verdict at NOW, for a product added at `addedAt`. */
  function judgementOn(rows: ShopPrice[], addedAt = LISTED_LONG_AGO): PriceJudgement | null {
    const compared = compareShops(rows, NOW);
    return judgementOf(verdictOf(compared, NOW, false), compared.rows, addedAt, NOW);
  }

  it("names the owner's thresholds: 30 days on the list and in the history, and a price on 5 different days", () => {
    expect(HISTORY_WINDOW_DAYS).toBe(30);
    expect(HISTORY_DAYS_NEEDED).toBe(5);
  });

  it.each<{ low: number; kind: "good" | "ordinary" }>([
    { low: 17.99, kind: "good" },
    { low: 16.99, kind: "ordinary" },
    { low: 15.99, kind: "ordinary" },
  ])("judges the cheapest 16,99 zł against its shop's 30-day low of $low as $kind", ({ low, kind }) => {
    const rows = [
      row("rossmann", check({ price: 26.99 })),
      row("natura", check({ price: 16.99, lowestPrice30d: low })),
    ];

    expect(judgementOn(rows)).toEqual({ kind, basis: "shop", baseline: low, history: "short" });
  });

  it("reads 7,49 zł against a 30-day low of 7,49 zł as ordinary, comparing whole grosze", () => {
    const rows = (low: number) => [
      row("rossmann", check({ price: 9.99 })),
      row("natura", check({ price: 7.49, lowestPrice30d: low })),
    ];

    expect(judgementOn(rows(7.49))).toEqual({ kind: "ordinary", basis: "shop", baseline: 7.49, history: "short" });
    // A low a hair above 7,49 zł, as arithmetic in złoty can leave it, is still 7,49 zł.
    expect(judgementOn(rows(7.49 + 1e-9))).toMatchObject({ kind: "ordinary", basis: "shop" });
  });

  it("compares a tie with the lowest 30-day low among its shops", () => {
    const rows = [
      row("rossmann", check({ price: 16.99, lowestPrice30d: 17.49 })),
      row("natura", check({ price: 16.99, lowestPrice30d: 16.49 })),
      row("hebe", check({ price: 16.99, lowestPrice30d: 16.99 })),
    ];

    // Rossmann's low alone would make 16,99 zł good, and Hebe's would be equal to it.
    expect(judgementOn(rows)).toEqual({ kind: "ordinary", basis: "shop", baseline: 16.49, history: "short" });
  });

  it("has nothing to compare with when the cheapest shop declares no low and there's no history, and names it", () => {
    const rows = [
      // A dearer shop's low never stands in for the cheapest shop's.
      row("rossmann", check({ price: 26.99, lowestPrice30d: 19.99 })),
      row("natura", check({ price: 16.99 })),
    ];

    expect(judgementOn(rows)).toEqual({ kind: "none", shops: ["natura"], history: "short" });
  });

  it("names every shop of a tie when none of them declares a low", () => {
    const rows = [row("rossmann", check({ price: 16.99 })), row("natura", check({ price: 16.99 }))];

    expect(judgementOn(rows)).toEqual({ kind: "none", shops: ["rossmann", "natura"], history: "short" });
  });

  // Natura's 16,99 zł is below the 17,99 zł Natura declares as its 30-day low, but above the 15,99 zł its history holds:
  // the two comparisons disagree, so each judgement shows which one was made.
  const disagreeing = (history: PriceHistory) => [
    row("rossmann", check({ price: 26.99 })),
    row("natura", check({ price: 16.99, lowestPrice30d: 17.99, history })),
  ];
  const BY_SHOP: PriceJudgement = { kind: "good", basis: "shop", baseline: 17.99, history: "short" };
  const BY_HISTORY: PriceJudgement = { kind: "ordinary", basis: "history", baseline: 15.99, history: "enough" };

  it.each<{ when: string; addedAt: string; judgement: PriceJudgement }>([
    { when: "added 29 days and 23 hours ago", addedAt: ago(29 * DAY + 23 * HOUR), judgement: BY_SHOP },
    { when: "added exactly 30 days ago", addedAt: ago(30 * DAY), judgement: BY_HISTORY },
    { when: "added at a time that doesn't parse", addedAt: "wczoraj", judgement: BY_SHOP },
  ])("uses the product's own history only 30 days after it was added: $when", ({ addedAt, judgement }) => {
    expect(judgementOn(disagreeing(historyOf(15.99, 5)), addedAt)).toEqual(judgement);
  });

  it.each<{ count: number; judgement: PriceJudgement }>([
    { count: 4, judgement: BY_SHOP },
    { count: 5, judgement: BY_HISTORY },
  ])("uses the product's history only with prices on 5 different days: $count days", ({ count, judgement }) => {
    expect(judgementOn(disagreeing(historyOf(15.99, count)))).toEqual(judgement);
  });

  it("counts a day seen in two shops once", () => {
    // Rossmann had a price on 27, 26 and 25 September.
    const rossmann = row("rossmann", check({ price: 26.99, history: historyOf(21.99, 3) }));
    const natura = (days: string[]) =>
      row("natura", check({ price: 16.99, lowestPrice30d: 17.99, history: { low: 15.99, days } }));

    // 5 days between the two shops, but 25 September is in both: 4 different days, which aren't enough.
    expect(judgementOn([rossmann, natura(["2026-09-25", "2026-09-24"])])).toEqual(BY_SHOP);
    // A fifth different day is enough, though neither shop alone has 5.
    expect(judgementOn([rossmann, natura(["2026-09-25", "2026-09-24", "2026-09-23"])])).toEqual(BY_HISTORY);
  });

  it.each<{ low: number; declared: number | null; judgement: PriceJudgement }>([
    {
      low: 15.99,
      declared: 16.49,
      judgement: { kind: "ordinary", basis: "history", baseline: 15.99, history: "enough" },
    },
    // The shop declares a lower 30-day low than the history holds, so „Dobra cena!” never contradicts it.
    { low: 17.49, declared: 16.49, judgement: { kind: "ordinary", basis: "shop", baseline: 16.49, history: "enough" } },
    { low: 17.49, declared: 17.99, judgement: { kind: "good", basis: "history", baseline: 17.49, history: "enough" } },
    // A tie is the history's.
    {
      low: 16.49,
      declared: 16.49,
      judgement: { kind: "ordinary", basis: "history", baseline: 16.49, history: "enough" },
    },
    { low: 17.49, declared: null, judgement: { kind: "good", basis: "history", baseline: 17.49, history: "enough" } },
  ])(
    "judges the cheapest 16,99 zł against the lower of the lowest history low, $low, and the declared $declared",
    ({ low, declared, judgement }) => {
      // The lowest price of the 30 days was Rossmann's, though Natura is the cheapest today.
      const rossmann = check({ price: 26.99, history: { low, days: DAYS_BEFORE.slice(0, 2) } });
      const natura = check({
        price: 16.99,
        lowestPrice30d: declared,
        history: { low: 18.99, days: DAYS_BEFORE.slice(2) },
      });

      expect(judgementOn([row("rossmann", rossmann), row("natura", natura)])).toEqual(judgement);
    },
  );

  it("never judges by a history some shop's row didn't read, and calls it unread, never short", () => {
    // Natura's history alone holds 5 days, but Rossmann's wasn't read, and it may have held a lower price.
    const unread = row("rossmann", check({ price: 26.99, history: null }));
    const natura = (lowestPrice30d: number | null) =>
      row("natura", check({ price: 16.99, lowestPrice30d, history: historyOf(15.99, 5) }));

    expect(judgementOn([unread, natura(17.99)])).toEqual({
      kind: "good",
      basis: "shop",
      baseline: 17.99,
      history: "unread",
    });
    expect(judgementOn([unread, natura(null)])).toEqual({ kind: "none", shops: ["natura"], history: "unread" });
  });

  it("judges the only shop's price as it judges the cheapest", () => {
    const only = (options: CheckOptions) => judgementOn([row("rossmann", check({ price: 12.99, ...options }))]);

    expect(only({ lowestPrice30d: 13.49 })).toEqual({
      kind: "good",
      basis: "shop",
      baseline: 13.49,
      history: "short",
    });
    expect(only({ lowestPrice30d: 13.49, history: historyOf(11.99, 5) })).toEqual({
      kind: "ordinary",
      basis: "history",
      baseline: 11.99,
      history: "enough",
    });
    expect(only({})).toEqual({ kind: "none", shops: ["rossmann"], history: "short" });
  });

  // Each with a 30-day low and enough history, so only its verdict keeps it from being judged.
  const judgeable = { lowestPrice30d: 13.49, history: historyOf(11.99, 5) };

  it.each<{ verdict: PriceVerdict["kind"]; rows: ShopPrice[]; unread?: boolean }>([
    { verdict: "stale", rows: [row("rossmann", check({ price: 12.99, checkedAgo: 2 * DAY, ...judgeable }))] },
    { verdict: "unavailable", rows: [row("rossmann", check({ price: 12.99, available: false, ...judgeable }))] },
    {
      verdict: "unread",
      rows: [row("rossmann", check({ price: 12.99, ...judgeable })), row("natura", null)],
      unread: true,
    },
    { verdict: "none", rows: [row("rossmann", null), row("natura", neverPriced)] },
  ])("judges nothing when the verdict is $verdict", ({ verdict, rows, unread = false }) => {
    const compared = compareShops(rows, NOW);
    const named = verdictOf(compared, NOW, unread);

    expect(named.kind).toBe(verdict);
    expect(judgementOf(named, compared.rows, LISTED_LONG_AGO, NOW)).toBeNull();
  });
});

describe("namesOf", () => {
  it('lists shops on their own or after "w", joined the Polish way', () => {
    expect(namesOf(["natura"])).toBe("Natura");
    expect(namesOf(["rossmann", "natura"])).toBe("Rossmann i Natura");
    expect(namesOf(["rossmann", "natura"], "in")).toBe("w Rossmannie i w Naturze");
    expect(namesOf([])).toBe("");
  });

  it('lists three shops with commas, the last after "i", a matched shop not yet priced included', () => {
    expect(namesOf(["rossmann", "natura", "hebe"])).toBe("Rossmann, Natura i Hebe");
    expect(namesOf(["natura", "hebe"], "in")).toBe("w Naturze i w Hebe");
  });
});

describe("listJoin", () => {
  it('joins parts the Polish way: commas between them, and the last after "i"', () => {
    expect(listJoin([])).toBe("");
    expect(listJoin(["rossmann.pl"])).toBe("rossmann.pl");
    expect(listJoin(["rossmann.pl", "drogerienatura.pl"])).toBe("rossmann.pl i drogerienatura.pl");
    expect(listJoin(["rossmann.pl", "drogerienatura.pl", "hebe.pl"])).toBe("rossmann.pl, drogerienatura.pl i hebe.pl");
  });

  it("leaves the parts it joins as they were", () => {
    const parts = ["a", "b", "c"] as const;

    expect(listJoin(parts)).toBe("a, b i c");
    expect(parts).toEqual(["a", "b", "c"]);
  });
});

describe("ageText", () => {
  it.each([
    { age: 0, text: "przed chwilą" },
    { age: 59 * SECOND, text: "przed chwilą" },
    { age: MINUTE, text: "1 min temu" },
    { age: HOUR - 1, text: "59 min temu" },
    { age: HOUR, text: "1 godz. temu" },
    { age: DAY - 1, text: "23 godz. temu" },
    { age: DAY, text: "wczoraj" },
    { age: 2 * DAY - 1, text: "wczoraj" },
    { age: 2 * DAY, text: "2 dni temu" },
    { age: 10 * DAY + 5 * HOUR, text: "10 dni temu" },
    // A browser clock a little behind the server's.
    { age: -30 * SECOND, text: "przed chwilą" },
  ])("reads $age ms as $text", ({ age, text }) => {
    expect(ageText(ago(age), NOW)).toBe(text);
  });

  it("says the time is unknown when it doesn't parse", () => {
    expect(ageText("wczoraj", NOW)).toBe("czas nieznany");
  });
});

describe("sinceText", () => {
  it.each([
    { age: 0, text: "chwili" },
    { age: 59 * SECOND, text: "chwili" },
    { age: MINUTE, text: "1 min" },
    { age: HOUR - 1, text: "59 min" },
    { age: HOUR, text: "1 godz." },
    { age: DAY - 1, text: "23 godz." },
    { age: DAY, text: "doby" },
    { age: 2 * DAY - 1, text: "doby" },
    { age: 2 * DAY, text: "2 dni" },
    { age: 10 * DAY + 5 * HOUR, text: "10 dni" },
    // A browser clock a little behind the server's.
    { age: -30 * SECOND, text: "chwili" },
  ])('reads $age ms after "sprzed" as $text, on ageText\'s steps', ({ age, text }) => {
    expect(sinceText(ago(age), NOW)).toBe(text);
  });

  it("gives nothing for a time that doesn't parse", () => {
    expect(sinceText("wczoraj", NOW)).toBeNull();
  });
});

describe("formatting", () => {
  it("writes prices in złoty the Polish way", () => {
    expect(formatPrice(16.99)).toBe(`16,99${NO_BREAK_SPACE}zł`);
    expect(formatPrice(5)).toBe(`5,00${NO_BREAK_SPACE}zł`);
  });

  it("writes a promotion's end as day and month", () => {
    expect(formatDay("2026-09-30")).toBe("30.09");
    expect(formatDay("2027-01-05")).toBe("05.01");
  });

  it("writes the day an instant fell on in Poland, as day and month", () => {
    expect(formatDayOf("2026-09-20T08:00:00.000Z")).toBe("20.09");
    // 00:30 on 21 September in Poland, in summer time, is still 20 September in UTC.
    expect(formatDayOf("2026-09-20T22:30:00.000Z")).toBe("21.09");
    // 00:30 on 1 January in Poland, in winter time.
    expect(formatDayOf("2026-12-31T23:30:00.000Z")).toBe("01.01");
  });

  it("gives no day for a time that doesn't parse", () => {
    expect(formatDayOf("wczoraj")).toBeNull();
  });
});

describe("priceParts", () => {
  it("splits a price into its złote and its grosze", () => {
    expect(priceParts(22.99)).toEqual({ zlote: "22", grosze: "99" });
    expect(priceParts(0.99)).toEqual({ zlote: "0", grosze: "99" });
  });

  it("writes both grosze digits, even for a whole price", () => {
    expect(priceParts(5)).toEqual({ zlote: "5", grosze: "00" });
    expect(priceParts(12.5)).toEqual({ zlote: "12", grosze: "50" });
  });

  it("groups the złote as formatPrice does: with a no-break space, from five digits", () => {
    // Polish leaves a four-digit amount ungrouped.
    expect(priceParts(1234.56)).toEqual({ zlote: "1234", grosze: "56" });
    expect(priceParts(12345.67)).toEqual({ zlote: `12${NO_BREAK_SPACE}345`, grosze: "67" });
  });

  it("rounds as formatPrice does, carrying into the złote", () => {
    expect(priceParts(16.999)).toEqual({ zlote: "17", grosze: "00" });
    expect(priceParts(2.675)).toEqual({ zlote: "2", grosze: "68" });
  });

  it.each([22.99, 5, 0.99, 1234.56, 12345.67, 16.999, 2.675])(
    "reads %d as the parts of formatPrice's text",
    (amount) => {
      const { zlote, grosze } = priceParts(amount);

      expect(`${zlote},${grosze}${NO_BREAK_SPACE}zł`).toBe(formatPrice(amount));
    },
  );
});

// Hebe's Nivea Soft 200 ml, as its 18-digit id.
const HEBE_SOFT_ID = "000000000000218807";
// Super-Pharm's Nivea Soft 300 ml, by its record's objectID.
const SUPER_PHARM_SOFT_ID = "10132";

/** A product's match in `shop`, to the shop's item `shopItemId`, as its prices read it. */
const matchIn = (shop: ShopId, shopItemId: string): PriceDecision => ({ shop, state: "matched", shopItemId });

describe("productPriceKeys", () => {
  const soft = { source: "rossmann", sourceItemId: "26900" } as const;

  it("gives a Rossmann product's own item, then its Natura match when it has one", () => {
    expect(productPriceKeys(soft, [matchIn("natura", "NV89063")])).toEqual([
      { shop: "rossmann", shopItemId: "26900" },
      { shop: "natura", shopItemId: "NV89063" },
    ]);
    expect(productPriceKeys(soft, [])).toEqual([{ shop: "rossmann", shopItemId: "26900" }]);
  });

  it.each(["unmatched", "not_found"] as const)("adds nothing for a Natura decision that's %s", (state) => {
    expect(productPriceKeys(soft, [{ shop: "natura", state }])).toEqual([{ shop: "rossmann", shopItemId: "26900" }]);
  });

  it("leaves out a product's own item when it wasn't picked in Rossmann, the one shop products are picked in", () => {
    expect(productPriceKeys({ source: "super-pharm", sourceItemId: "39477" }, [matchIn("natura", "NV89063")])).toEqual([
      { shop: "natura", shopItemId: "NV89063" },
    ]);
  });

  it("gives the match of each matched shop, Hebe's and Super-Pharm's too, in the shops' order, whatever the decisions' order", () => {
    const decisions = [
      matchIn("super-pharm", SUPER_PHARM_SOFT_ID),
      matchIn("hebe", HEBE_SOFT_ID),
      matchIn("natura", "NV89063"),
    ];

    expect(productPriceKeys(soft, decisions)).toEqual([
      { shop: "rossmann", shopItemId: "26900" },
      { shop: "natura", shopItemId: "NV89063" },
      { shop: "hebe", shopItemId: HEBE_SOFT_ID },
      { shop: "super-pharm", shopItemId: SUPER_PHARM_SOFT_ID },
    ]);
  });

  it("adds nothing for a matched shop without a match, nor for a match in a shop outside the list", () => {
    const declinedInNatura: PriceDecision = { shop: "natura", state: "unmatched" };

    expect(productPriceKeys(soft, [declinedInNatura, matchIn("hebe", HEBE_SOFT_ID)])).toEqual([
      { shop: "rossmann", shopItemId: "26900" },
      { shop: "hebe", shopItemId: HEBE_SOFT_ID },
    ]);
    // A test's list that leaves Super-Pharm out, as a shop switched off again would be.
    expect(
      productPriceKeys(
        soft,
        [matchIn("natura", "NV89063"), matchIn("super-pharm", SUPER_PHARM_SOFT_ID)],
        ["natura", "hebe"],
      ),
    ).toEqual([
      { shop: "rossmann", shopItemId: "26900" },
      { shop: "natura", shopItemId: "NV89063" },
    ]);
    expect(productPriceKeys(soft, [matchIn("natura", "NV89063"), matchIn("hebe", HEBE_SOFT_ID)], ["hebe"])).toEqual([
      { shop: "rossmann", shopItemId: "26900" },
      { shop: "hebe", shopItemId: HEBE_SOFT_ID },
    ]);
  });
});

describe("listPricedItems", () => {
  it("gives each product its own item and its matches in a test's list of shops, Natura and Hebe, each with its latest price", () => {
    const soft = { id: "soft", source: "rossmann", sourceItemId: "26900" } as const;
    const felix = { id: "felix", source: "rossmann", sourceItemId: "131225" } as const;
    const softInRossmann: LatestPrice = { shop: "rossmann", shopItemId: "26900", ...check({ price: 26.99 }) };
    const softInNatura: LatestPrice = { shop: "natura", shopItemId: "NV89063", ...check({ price: 16.99 }) };
    const softInHebe: LatestPrice = { shop: "hebe", shopItemId: HEBE_SOFT_ID, ...check({ price: 15.99 }) };
    // Another shop's item with Felix's id: it isn't Felix's price.
    const lookalike: LatestPrice = { shop: "natura", shopItemId: "131225", ...check({ price: 1.99 }) };
    const matches: ShopMatchState[] = [
      {
        watchlistItemId: "soft",
        shop: "natura",
        state: "matched",
        shopItemId: "NV89063",
        brand: "NIVEA",
        size: { value: 300, unit: "ml" },
        decidedBy: "auto",
      },
      {
        watchlistItemId: "soft",
        shop: "hebe",
        state: "matched",
        shopItemId: HEBE_SOFT_ID,
        brand: "Nivea",
        size: { value: 200, unit: "ml" },
        decidedBy: "user",
      },
      { watchlistItemId: "felix", shop: "natura", state: "not_found", shopItemId: null },
      // A match in a shop the list leaves out, as a shop switched off again would be, adds nothing.
      {
        watchlistItemId: "felix",
        shop: "super-pharm",
        state: "matched",
        shopItemId: "39477",
        brand: "Felix",
        size: null,
        decidedBy: "user",
      },
    ];

    const items = listPricedItems(
      [soft, felix],
      matches,
      [softInRossmann, softInNatura, softInHebe, lookalike],
      ["natura", "hebe"],
    );

    expect([...items]).toEqual([
      [
        "soft",
        [
          { shop: "rossmann", shopItemId: "26900", latest: softInRossmann },
          { shop: "natura", shopItemId: "NV89063", latest: softInNatura },
          { shop: "hebe", shopItemId: HEBE_SOFT_ID, latest: softInHebe },
        ],
      ],
      // Never checked yet.
      ["felix", [{ shop: "rossmann", shopItemId: "131225", latest: null }]],
    ]);
  });

  it("gives each product its match in every matched shop, in the shops' order, each with its latest price", () => {
    const soft = { id: "soft", source: "rossmann", sourceItemId: "26900" } as const;
    const felix = { id: "felix", source: "rossmann", sourceItemId: "131225" } as const;
    // Felix's item in Hebe, made up: Hebe's ids are 18 digits.
    const felixInHebeId = "000000000000131225";
    const softInNatura: LatestPrice = { shop: "natura", shopItemId: "NV89063", ...check({ price: 16.99 }) };
    const softInHebe: LatestPrice = { shop: "hebe", shopItemId: HEBE_SOFT_ID, ...check({ price: 15.99 }) };
    const softInSuperPharm: LatestPrice = {
      shop: "super-pharm",
      shopItemId: SUPER_PHARM_SOFT_ID,
      ...check({ price: 19.49 }),
    };
    const felixInRossmann: LatestPrice = { shop: "rossmann", shopItemId: "131225", ...check({ price: 5.99 }) };
    const matches: ShopMatchState[] = [
      // Super-Pharm's match, always the user's pick, and Hebe's come first, but the list's order is the shops'.
      {
        watchlistItemId: "soft",
        shop: "super-pharm",
        state: "matched",
        shopItemId: SUPER_PHARM_SOFT_ID,
        brand: "Nivea",
        size: { value: 300, unit: "ml" },
        decidedBy: "user",
      },
      {
        watchlistItemId: "soft",
        shop: "hebe",
        state: "matched",
        shopItemId: HEBE_SOFT_ID,
        brand: "Nivea",
        size: { value: 200, unit: "ml" },
        decidedBy: "auto",
      },
      {
        watchlistItemId: "soft",
        shop: "natura",
        state: "matched",
        shopItemId: "NV89063",
        brand: "NIVEA",
        size: { value: 300, unit: "ml" },
        decidedBy: "auto",
      },
      { watchlistItemId: "felix", shop: "natura", state: "unmatched", shopItemId: null },
      {
        watchlistItemId: "felix",
        shop: "hebe",
        state: "matched",
        shopItemId: felixInHebeId,
        brand: "Felix",
        size: null,
        decidedBy: "user",
      },
    ];

    const items = listPricedItems([soft, felix], matches, [
      softInSuperPharm,
      softInHebe,
      softInNatura,
      felixInRossmann,
    ]);

    expect([...items]).toEqual([
      [
        "soft",
        [
          // Never checked yet.
          { shop: "rossmann", shopItemId: "26900", latest: null },
          { shop: "natura", shopItemId: "NV89063", latest: softInNatura },
          { shop: "hebe", shopItemId: HEBE_SOFT_ID, latest: softInHebe },
          { shop: "super-pharm", shopItemId: SUPER_PHARM_SOFT_ID, latest: softInSuperPharm },
        ],
      ],
      [
        "felix",
        [
          { shop: "rossmann", shopItemId: "131225", latest: felixInRossmann },
          { shop: "hebe", shopItemId: felixInHebeId, latest: null },
        ],
      ],
    ]);
  });
});

/** A priced item on the list, as listPricedItems gives it. */
const priced = (shop: PricedShop, shopItemId: string, latest: LatestCheck | null): PricedItem => ({
  shop,
  shopItemId,
  latest,
});

describe("staleTargets", () => {
  it("takes the items checked more than 15 minutes ago, those never checked first, then the oldest check first", () => {
    const entries = [
      priced("rossmann", "1", check({ checkedAgo: 20 * MINUTE })),
      priced("rossmann", "2", check({ checkedAgo: 5 * MINUTE })),
      priced("natura", "NV1", null),
      priced("rossmann", "3", check({ checkedAgo: 2 * DAY })),
      priced("natura", "NV2", check({ checkedAgo: REFETCH_AFTER_MS })),
      priced("natura", "NV3", check({ checkedAgo: REFETCH_AFTER_MS + 1 })),
      priced("rossmann", "4", null),
    ];

    expect(staleTargets(entries, NOW)).toEqual([
      { shop: "natura", shopItemId: "NV1" },
      { shop: "rossmann", shopItemId: "4" },
      { shop: "rossmann", shopItemId: "3" },
      { shop: "rossmann", shopItemId: "1" },
      { shop: "natura", shopItemId: "NV3" },
    ]);
  });

  it("goes by the last check, even one that found the item missing", () => {
    const entries = [
      priced("natura", "NV1", check({ status: "missing", checkedAgo: MINUTE, pricedAgo: 3 * DAY })),
      priced("rossmann", "1", neverPriced),
    ];

    expect(staleTargets(entries, NOW)).toEqual([]);
  });

  it("takes an item once when two products are matched to it", () => {
    const entries = [priced("natura", "NV1", null), priced("rossmann", "1", null), priced("natura", "NV1", null)];

    expect(staleTargets(entries, NOW)).toEqual([
      { shop: "natura", shopItemId: "NV1" },
      { shop: "rossmann", shopItemId: "1" },
    ]);
  });

  it("takes a price whose promotion ended after its check, however recent the check", () => {
    // Both checked at 23:55 in Poland on 28 September, ten minutes before the list refresh at 00:05.
    const pastMidnight = Date.parse("2026-09-28T22:05:00.000Z");
    const entries = [
      priced("rossmann", "1", promoCheck("2026-09-28T21:55:00.000Z", "2026-09-28")),
      priced("rossmann", "2", promoCheck("2026-09-28T21:55:00.000Z", "2026-09-29")),
    ];

    expect(staleTargets(entries, pastMidnight)).toEqual([{ shop: "rossmann", shopItemId: "1" }]);
  });

  it("takes nothing when every item was checked in the last 15 minutes, or there are none", () => {
    expect(staleTargets([priced("rossmann", "1", check({ checkedAgo: MINUTE }))], NOW)).toEqual([]);
    expect(staleTargets([], NOW)).toEqual([]);
  });
});

describe("listSummaryText", () => {
  /** A line as the plan spells it, with the no-break space Intl writes before "zł". */
  const line = (text: string) => text.replaceAll(" zł", `${NO_BREAK_SPACE}zł`);

  /** The list's line for a product with these rows, compared at NOW. */
  function listLine(...rows: { shop: PricedShop; latest: LatestCheck | null }[]): string {
    const { summary, rows: judged } = compareShops(rows, NOW);
    return listSummaryText(summary, judged, NOW);
  }

  const cheaperNatura = row("natura", check({ price: 16.99, checkedAgo: 2 * HOUR }));

  it("names the cheapest shop, its price, how much cheaper it is than the other, and its age", () => {
    expect(listLine(row("rossmann", check({ price: 26.99 })), cheaperNatura)).toBe(
      line("Najtaniej: Natura 16,99 zł, o 10,00 zł taniej niż Rossmann · 2 godz. temu"),
    );
  });

  it.each<{ why: string; latest: LatestCheck | null; note: string }>([
    { why: "an out-of-date price", latest: check({ price: 12.99, checkedAgo: 2 * DAY }), note: "cena nieaktualna" },
    {
      why: "a promotion that has ended",
      latest: check({ price: 12.99, promoEndsOn: ENDED_YESTERDAY }),
      note: "cena nieaktualna",
    },
    {
      why: "an item it no longer returns",
      latest: check({ price: 12.99, status: "missing", checkedAgo: MINUTE, pricedAgo: HOUR }),
      note: "cena nieaktualna",
    },
    {
      why: "an item it can't sell online",
      latest: check({ price: 12.99, available: false }),
      note: "niedostępny online",
    },
    { why: "no price yet", latest: null, note: "brak ceny" },
    { why: "no price ever found", latest: neverPriced, note: "brak ceny" },
  ])("leaves the difference out and says why when the other shop has $why", ({ latest, note }) => {
    expect(listLine(row("rossmann", latest), cheaperNatura)).toBe(
      line(`Najtaniej: Natura 16,99 zł · 2 godz. temu · Rossmann: ${note}`),
    );
  });

  it("names both shops of a tie", () => {
    expect(listLine(row("rossmann", check({ price: 16.99 })), row("natura", check({ price: 16.99 })))).toBe(
      line("Najtaniej: Rossmann i Natura, 16,99 zł · 5 min temu"),
    );
  });

  it("gives the only shop's price and its age", () => {
    expect(listLine(row("rossmann", check({ price: 26.99 })))).toBe(line("Tylko w Rossmannie: 26,99 zł · 5 min temu"));
  });

  it.each<{ why: string; latest: LatestCheck; text: string }>([
    {
      why: "out of date",
      latest: check({ price: 26.99, checkedAgo: 2 * DAY }),
      text: "Tylko w Rossmannie: 26,99 zł · 2 dni temu · nieaktualna",
    },
    {
      why: "out of date after its promotion ended",
      latest: check({ price: 5.99, promoEndsOn: ENDED_YESTERDAY }),
      text: "Tylko w Rossmannie: 5,99 zł · 5 min temu · nieaktualna",
    },
    {
      why: "for an item the shop no longer returns",
      latest: check({ price: 26.99, status: "missing", checkedAgo: MINUTE, pricedAgo: 3 * HOUR }),
      text: "Tylko w Rossmannie: 26,99 zł · 3 godz. temu · nieaktualna",
    },
    {
      why: "for an item it can't sell online",
      latest: check({ price: 26.99, available: false }),
      text: "Tylko w Rossmannie: 26,99 zł · 5 min temu · niedostępny online",
    },
  ])("says when the only shop's price is $why", ({ latest, text }) => {
    expect(listLine(row("rossmann", latest))).toBe(line(text));
  });

  it("names the last price's shop and age, as the row's tag shows them, when no shop's price can be named cheapest", () => {
    expect(listLine(row("rossmann", check({ price: 26.99, checkedAgo: 2 * DAY })), row("natura", null))).toBe(
      line("Nieaktualna cena: Rossmann 26,99 zł · 2 dni temu. Odśwież ceny lub otwórz produkt."),
    );
  });

  it("says when no shop's fresh price can be ordered online, never that the prices are out of date", () => {
    const rossmannToo = row("rossmann", check({ price: 26.99, available: false }));
    const naturaUnorderable = row("natura", check({ price: 24.99, available: false }));

    expect(listLine(rossmannToo, naturaUnorderable)).toBe(
      line("Niedostępny online: Natura 24,99 zł · 5 min temu · Rossmann: niedostępny online"),
    );
    expect(listLine(row("rossmann", check({ price: 12.99, checkedAgo: 2 * DAY })), naturaUnorderable)).toBe(
      line("Niedostępny online: Natura 24,99 zł · 5 min temu · Rossmann: cena nieaktualna"),
    );
  });

  it("says a price couldn't be read, whatever the other prices say", () => {
    const { summary, rows } = compareShops([row("rossmann", check({ price: 26.99 })), row("natura", null)], NOW);

    expect(listSummaryText(summary, rows, NOW, true)).toBe(PRICE_UNREAD_TEXT);
    expect(PRICE_UNREAD_TEXT).toBe("Nie udało się wczytać ceny.");
  });

  it("says there are no prices yet when no shop has been checked", () => {
    const noPrices = "Jeszcze bez cen. Otwórz produkt, aby je pobrać.";

    expect(listLine(row("rossmann", null), row("natura", null))).toBe(noPrices);
    expect(listLine(row("rossmann", null))).toBe(noPrices);
  });

  it("says a shop doesn't return a product checked before its first price, never that there are no prices yet", () => {
    expect(listLine(row("rossmann", neverPriced))).toBe("Brak ceny online · Rossmann: nie zwraca tego produktu");
    expect(listLine(row("rossmann", null), row("natura", neverPriced))).toBe(
      "Brak ceny online · Rossmann: jeszcze nie sprawdzono · Natura: nie zwraca tego produktu",
    );
  });
});
