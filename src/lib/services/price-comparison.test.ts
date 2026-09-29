import { describe, expect, it } from "vitest";
import {
  ageText,
  compareShops,
  formatDay,
  formatPrice,
  needsRefetch,
  priceState,
  REFETCH_AFTER_MS,
  STALE_AFTER_MS,
  type LatestCheck,
  type PricedShop,
} from "@/lib/services/price-comparison";

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
}

/** An item last checked `checkedAgo` before NOW, with a price fetched `pricedAgo` before NOW (by default, then). */
function check({
  price = 16.99,
  available = true,
  status = "price",
  checkedAgo = 5 * MINUTE,
  pricedAgo = checkedAgo,
}: CheckOptions = {}): LatestCheck {
  return {
    lastCheckedAt: ago(checkedAgo),
    lastStatus: status,
    offer: { price, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available, pricedAt: ago(pricedAgo) },
  };
}

/** An item checked once, when the shop answered without it: no price at all. */
const neverPriced: LatestCheck = { lastCheckedAt: ago(MINUTE), lastStatus: "missing", offer: null };

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

describe("formatting", () => {
  it("writes prices in złoty the Polish way", () => {
    expect(formatPrice(16.99)).toBe(`16,99${NO_BREAK_SPACE}zł`);
    expect(formatPrice(5)).toBe(`5,00${NO_BREAK_SPACE}zł`);
  });

  it("writes a promotion's end as day and month", () => {
    expect(formatDay("2026-09-30")).toBe("30.09");
    expect(formatDay("2027-01-05")).toBe("05.01");
  });
});
