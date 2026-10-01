import { describe, expect, it } from "vitest";
import {
  listPricedItems,
  STALE_AFTER_MS,
  type LatestCheck,
  type PricedItem,
  type PricedShop,
} from "@/lib/services/price-comparison";
import {
  filterCounts,
  filterHref,
  inFilter,
  LIST_FILTERS,
  listChipsOf,
  listRowOf,
  listRowsOf,
  naturaStateOf,
  parseListFilter,
  rowProductOf,
  rowShopsOf,
  rowTagOf,
  type ListRow,
  type NaturaListState,
  type PriceTag,
  type RowShop,
} from "@/lib/services/watchlist-rows";
import type { LatestPrice, PriceKey, ProductCandidate, ShopMatchState, WatchlistItem } from "@/types";

// Every time here is measured back from one fixed moment: 14:00 on 28 September in Poland.
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Intl writes Polish prices with a no-break space before "zł".
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

const SOFT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const OTHER_ID = "4f1c2a8e-5b7d-4c3e-9a1f-0d2b3c4e5f60";

/** The ISO timestamp `ms` before NOW. */
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** A text as the plan spells it, with the no-break space Intl writes before "zł". */
const said = (text: string) => text.replaceAll(" zł", `${NO_BREAK_SPACE}zł`);

interface CheckOptions {
  price?: number;
  regularPrice?: number | null;
  promoEndsOn?: string | null;
  available?: boolean;
  status?: "price" | "missing";
  checkedAgo?: number;
  pricedAgo?: number;
}

/** An item last checked `checkedAgo` before NOW, with a price fetched `pricedAgo` before NOW (by default, then). */
function check({
  price = 16.99,
  regularPrice = null,
  promoEndsOn = null,
  available = true,
  status = "price",
  checkedAgo = 5 * MINUTE,
  pricedAgo = checkedAgo,
}: CheckOptions = {}): LatestCheck {
  return {
    lastCheckedAt: ago(checkedAgo),
    lastStatus: status,
    offer: { price, regularPrice, lowestPrice30d: null, promoEndsOn, available, pricedAt: ago(pricedAgo) },
  };
}

/** An item checked once, when the shop answered without it: no price at all. */
const neverPriced: LatestCheck = { lastCheckedAt: ago(MINUTE), lastStatus: "missing", offer: null };

const shop = (name: PricedShop, latest: LatestCheck | null, readFailed = false): RowShop => ({
  shop: name,
  latest,
  readFailed,
});

// Rossmann's Nivea Soft 300 ml as the list reads it: Rossmann splits its name into a name and a caption.
const soft: WatchlistItem = {
  id: SOFT_ID,
  source: "rossmann",
  sourceItemId: "26900",
  brand: "NIVEA",
  name: "Soft ",
  caption: "krem uniwersalny, nawilżający",
  sizeText: "300 ml",
  imageUrl: "https://www.rossmann.pl/zdjecia/26900.jpg",
  addedAt: "2026-09-20T08:00:00.000Z",
};

// The handoff's Nivea: Natura 22,99 zł on promotion instead of 27,99 zł, beside Rossmann's 26,99 zł.
const naturaOnPromotion = shop("natura", check({ price: 22.99, regularPrice: 27.99 }));
const rossmannRegular = shop("rossmann", check({ price: 26.99, checkedAgo: 10 * MINUTE }));

/** The row of Nivea Soft with these shops and this Natura state, at NOW. */
const rowOf = (shops: RowShop[], natura: NaturaListState = "matched"): ListRow => listRowOf(soft, shops, natura, NOW);

describe("parseListFilter", () => {
  it("reads each filter the chips link to", () => {
    for (const filter of LIST_FILTERS) {
      expect(parseListFilter(filter)).toBe(filter);
    }
  });

  it.each([null, "", "PROMO", "promo ", "wszystkie", "toString", "__proto__"])(
    "reads %j, which no chip links to, as every product",
    (raw) => {
      expect(parseListFilter(raw)).toBe("all");
    },
  );

  it("reads a form's field that isn't text as every product", () => {
    expect(parseListFilter(new File(["promo"], "f.txt"))).toBe("all");
  });
});

describe("listRowOf: the product", () => {
  it("gives the row's product, its brand and size above its name, and its photo", () => {
    expect(rowOf([rossmannRegular, naturaOnPromotion])).toMatchObject({
      itemId: SOFT_ID,
      eyebrow: "NIVEA · 300 ml",
      name: "Soft krem uniwersalny, nawilżający",
      brand: "NIVEA",
      imageUrl: soft.imageUrl,
    });
  });

  it.each<{ why: string; item: Partial<WatchlistItem>; eyebrow: string | null; name: string }>([
    { why: "no brand", item: { brand: null }, eyebrow: "300 ml", name: "Soft krem uniwersalny, nawilżający" },
    { why: "no size", item: { sizeText: null }, eyebrow: "NIVEA", name: "Soft krem uniwersalny, nawilżający" },
    {
      why: "neither",
      item: { brand: null, sizeText: null },
      eyebrow: null,
      name: "Soft krem uniwersalny, nawilżający",
    },
    { why: "no caption", item: { caption: null }, eyebrow: "NIVEA · 300 ml", name: "Soft" },
  ])("leaves out what a product with $why doesn't have", ({ item, eyebrow, name }) => {
    expect(listRowOf({ ...soft, ...item }, [rossmannRegular], "matched", NOW)).toMatchObject({ eyebrow, name });
  });

  it("draws a search result as the product's row on the list draws it, before it's added", () => {
    const candidate: ProductCandidate = {
      source: "rossmann",
      sourceItemId: soft.sourceItemId,
      brand: soft.brand,
      name: soft.name,
      caption: soft.caption,
      sizeText: soft.sizeText,
      size: { value: 300, unit: "ml" },
      eans: ["4005900009319"],
      productUrl: null,
      imageUrl: soft.imageUrl,
    };
    const { eyebrow, name, brand, imageUrl } = rowOf([rossmannRegular]);

    expect(rowProductOf(candidate)).toEqual({
      eyebrow: "NIVEA · 300 ml",
      name: "Soft krem uniwersalny, nawilżający",
      brand: "NIVEA",
      imageUrl: soft.imageUrl,
    });
    expect(rowProductOf(candidate)).toEqual({ eyebrow, name, brand, imageUrl });
  });
});

describe("the price tag", () => {
  // Each tag with a price names that price's shop and its age on the line under it, and one without a price names none.
  it.each<{ verdict: string; shops: RowShop[]; tag: PriceTag }>([
    {
      verdict: "cheapest",
      shops: [rossmannRegular, naturaOnPromotion],
      tag: { tone: "sun", price: 22.99, label: "Natura", meta: "Natura · 5 min temu" },
    },
    {
      // A tie's line gives its older price's age, so it never looks fresher than one of its prices.
      verdict: "cheapest, in a tie",
      shops: [
        shop("rossmann", check({ price: 16.99, checkedAgo: 5 * MINUTE })),
        shop("natura", check({ price: 16.99, checkedAgo: HOUR })),
      ],
      tag: { tone: "sun", price: 16.99, label: "Rossmann i Natura", meta: "Rossmann i Natura · 1 godz. temu" },
    },
    {
      verdict: "only",
      shops: [shop("rossmann", check({ price: 12.99, checkedAgo: DAY }))],
      tag: { tone: "muted", price: 12.99, label: "Tylko Rossmann", meta: "Rossmann · wczoraj" },
    },
    {
      verdict: "unavailable",
      shops: [shop("rossmann", check({ price: 26.99, available: false }))],
      tag: { tone: "muted", price: 26.99, label: "Niedostępny", meta: "Rossmann · 5 min temu" },
    },
    {
      verdict: "unavailable, in both shops",
      shops: [
        shop("rossmann", check({ price: 26.99, available: false })),
        shop("natura", check({ price: 24.99, available: false, checkedAgo: 20 * MINUTE })),
      ],
      tag: { tone: "muted", price: 24.99, label: "Niedostępny", meta: "Natura · 20 min temu" },
    },
    {
      verdict: "stale",
      shops: [shop("rossmann", check({ price: 11.49, checkedAgo: 2 * DAY }))],
      tag: { tone: "warn", price: 11.49, label: "Nieaktualna", meta: "Rossmann · 2 dni temu" },
    },
    {
      verdict: "stale, beside a shop never checked",
      shops: [shop("rossmann", check({ price: 11.49, checkedAgo: STALE_AFTER_MS + 1 })), shop("natura", null)],
      tag: { tone: "warn", price: 11.49, label: "Nieaktualna", meta: "Rossmann · wczoraj" },
    },
    {
      // The shop checked a minute ago no longer returns the item: the price from 3 days ago is the one shown.
      verdict: "stale, from an item the shop no longer returns",
      shops: [
        shop("natura", check({ price: 19.99, status: "missing", checkedAgo: MINUTE, pricedAgo: 3 * DAY })),
        shop("rossmann", null),
      ],
      tag: { tone: "warn", price: 19.99, label: "Nieaktualna", meta: "Natura · 3 dni temu" },
    },
    {
      verdict: "unread",
      shops: [rossmannRegular, shop("natura", null, true)],
      tag: { tone: "outline", price: null, label: "Błąd odczytu", meta: null },
    },
    {
      verdict: "none",
      shops: [shop("rossmann", null)],
      tag: { tone: "outline", price: null, label: "Bez ceny", meta: null },
    },
    {
      verdict: "none, after a check that found no item",
      shops: [shop("rossmann", neverPriced)],
      tag: { tone: "outline", price: null, label: "Bez ceny", meta: null },
    },
  ])("shows the $verdict verdict, on the list and in the live tag alike", ({ shops, tag }) => {
    const natura = shops.some((each) => each.shop === "natura") ? "matched" : "unmatched";

    expect(rowOf(shops, natura).tag).toEqual(tag);
    expect(rowTagOf(shops, NOW)).toEqual(tag);
  });

  it("reads the price's age at the time the tag is judged, as the live tag does on the browser's clock", () => {
    expect(rowTagOf([rossmannRegular, naturaOnPromotion], NOW + 2 * HOUR)).toEqual({
      tone: "sun",
      price: 22.99,
      label: "Natura",
      meta: "Natura · 2 godz. temu",
    });
    expect(listRowOf(soft, [rossmannRegular, naturaOnPromotion], "matched", NOW + 2 * HOUR).tag.meta).toBe(
      "Natura · 2 godz. temu",
    );
  });

  it("shows no price while Natura's match can't be read, since it may name a lower one", () => {
    expect(rowOf([rossmannRegular], "unreadable").tag).toEqual({
      tone: "outline",
      price: null,
      label: "Błąd odczytu",
      meta: null,
    });
    // The live tag hears of it as a Natura shop whose price couldn't be read.
    expect(rowTagOf([rossmannRegular, shop("natura", null, true)], NOW)).toEqual(
      rowOf([rossmannRegular], "unreadable").tag,
    );
  });
});

describe("the Promocje filter", () => {
  it.each<{ why: string; shops: RowShop[] }>([
    {
      why: "a dearer shop's promotion beside a cheaper shop: Rossmann's 24,99 zł instead of 29,99 zł",
      shops: [shop("rossmann", check({ price: 24.99, regularPrice: 29.99 })), shop("natura", check({ price: 22.99 }))],
    },
    { why: "a promotion ending today", shops: [shop("rossmann", check({ price: 5.99, promoEndsOn: "2026-09-28" }))] },
    {
      why: "a promotion's end without a regular price, as Rossmann can send it",
      shops: [shop("rossmann", check({ price: 5.99, promoEndsOn: "2026-10-05" }))],
    },
    {
      why: "a promotion on a price that can't be ordered online",
      shops: [shop("rossmann", check({ price: 5.99, regularPrice: 9.99, available: false }))],
    },
    {
      why: "a promotion on a price exactly 24 hours old",
      shops: [shop("rossmann", check({ regularPrice: 29.99, checkedAgo: DAY }))],
    },
  ])("holds a product with $why", ({ shops }) => {
    expect(rowOf(shops, "unmatched").promo).toBe(true);
  });

  it.each<{ why: string; shops: RowShop[] }>([
    { why: "no promotion", shops: [rossmannRegular, shop("natura", check({ price: 22.99 }))] },
    {
      why: "a promotion on a price checked 2 days ago",
      shops: [shop("rossmann", check({ price: 24.99, regularPrice: 29.99, checkedAgo: 2 * DAY }))],
    },
    {
      why: "a promotion that ended yesterday",
      shops: [shop("rossmann", check({ price: 5.99, regularPrice: 9.99, promoEndsOn: "2026-09-27" }))],
    },
    {
      why: "a promotion on an item the shop no longer returns",
      shops: [
        shop(
          "rossmann",
          check({ price: 5.99, regularPrice: 9.99, status: "missing", checkedAgo: MINUTE, pricedAgo: HOUR }),
        ),
      ],
    },
    { why: "a price that couldn't be read", shops: [shop("rossmann", null, true)] },
  ])("leaves out a product with $why", ({ shops }) => {
    expect(rowOf(shops, "unmatched").promo).toBe(false);
  });
});

describe("the Do sprawdzenia filter", () => {
  it.each<{ why: string; shops: RowShop[]; natura: NaturaListState }>([
    {
      why: "a stale price",
      shops: [shop("rossmann", check({ checkedAgo: 2 * DAY })), naturaOnPromotion],
      natura: "matched",
    },
    {
      why: "an item the shop no longer returns",
      shops: [shop("rossmann", check({ status: "missing", checkedAgo: MINUTE, pricedAgo: HOUR })), naturaOnPromotion],
      natura: "matched",
    },
    { why: "an item never checked", shops: [rossmannRegular, shop("natura", null)], natura: "matched" },
    { why: "a check that found no item", shops: [rossmannRegular, shop("natura", neverPriced)], natura: "matched" },
    { why: "a price that couldn't be read", shops: [rossmannRegular, shop("natura", null, true)], natura: "matched" },
    { why: "no Natura decision yet, a pending choice included", shops: [rossmannRegular], natura: "none" },
    { why: "Natura's lookup that found nothing", shops: [rossmannRegular], natura: "not_found" },
    { why: "Natura's match that couldn't be read", shops: [rossmannRegular], natura: "unreadable" },
  ])("holds a product with $why", ({ shops, natura }) => {
    expect(rowOf(shops, natura).check).toBe(true);
  });

  it.each<{ why: string; shops: RowShop[]; natura: NaturaListState }>([
    { why: "fresh prices in both shops", shops: [rossmannRegular, naturaOnPromotion], natura: "matched" },
    { why: "Natura declined by the user", shops: [rossmannRegular], natura: "unmatched" },
    {
      why: "a fresh price that can't be ordered online",
      shops: [shop("rossmann", check({ available: false })), naturaOnPromotion],
      natura: "matched",
    },
  ])("leaves out a product with $why", ({ shops, natura }) => {
    expect(rowOf(shops, natura).check).toBe(false);
  });
});

describe("the row's line for screen readers", () => {
  it("gives the price line alone for a product matched in Natura, whose line names Natura's price", () => {
    expect(rowOf([rossmannRegular, naturaOnPromotion]).summary).toBe(
      said("Najtaniej: Natura 22,99 zł, o 4,00 zł taniej niż Rossmann · 5 min temu."),
    );
  });

  it.each<{ natura: NaturaListState; status: string }>([
    { natura: "none", status: "Natura: do dopasowania." },
    { natura: "not_found", status: "Natura: nie znaleziono." },
    { natura: "unmatched", status: "Natura: brak (Twój wybór)." },
  ])("adds Natura's status for a product $natura there", ({ natura, status }) => {
    const only = shop("rossmann", check({ price: 12.99, checkedAgo: DAY }));

    expect(rowOf([only], natura).summary).toBe(said(`Tylko w Rossmannie: 12,99 zł · wczoraj. ${status}`));
  });

  it("says a price or a match couldn't be read, never that the product has no price or awaits a match", () => {
    expect(rowOf([rossmannRegular], "unreadable").summary).toBe(
      "Nie udało się wczytać ceny. Natura: nie udało się wczytać dopasowania.",
    );
    expect(rowOf([rossmannRegular, shop("natura", null, true)]).summary).toBe("Nie udało się wczytać ceny.");
  });

  it("ends each sentence once", () => {
    expect(rowOf([shop("rossmann", null)], "none").summary).toBe(
      "Jeszcze bez cen. Otwórz produkt, aby je pobrać. Natura: do dopasowania.",
    );
  });
});

describe("the chips", () => {
  const rows = [
    { promo: true, check: false },
    { promo: true, check: true },
    { promo: false, check: true },
    { promo: false, check: false },
  ];

  it("counts every chip over the whole list", () => {
    expect(filterCounts(rows)).toEqual({ all: 4, promo: 2, check: 2 });
    expect(filterCounts([])).toEqual({ all: 0, promo: 0, check: 0 });
  });

  it("holds in each chip the rows its count counted", () => {
    expect(rows.filter((row) => inFilter(row, "all"))).toHaveLength(4);
    expect(rows.filter((row) => inFilter(row, "promo"))).toEqual([rows[0], rows[1]]);
    expect(rows.filter((row) => inFilter(row, "check"))).toEqual([rows[1], rows[2]]);
  });

  it.each<{ path: string; filter: (typeof LIST_FILTERS)[number]; href: string }>([
    { path: "/watchlist", filter: "promo", href: "/watchlist?f=promo" },
    { path: "/watchlist", filter: "check", href: "/watchlist?f=check" },
    { path: "/watchlist", filter: "all", href: "/watchlist" },
    { path: `/watchlist/${SOFT_ID}`, filter: "promo", href: `/watchlist/${SOFT_ID}?f=promo` },
    { path: `/watchlist/${SOFT_ID}`, filter: "all", href: `/watchlist/${SOFT_ID}` },
    { path: "/watchlist?q=nivea&prices=done#lista", filter: "check", href: "/watchlist?f=check" },
    { path: `/watchlist/${SOFT_ID}?f=promo&matched=1&list-prices=done`, filter: "all", href: `/watchlist/${SOFT_ID}` },
  ])("links $filter on $path to $href, keeping only the page and the filter", ({ path, filter, href }) => {
    expect(filterHref(path, filter)).toBe(href);
  });

  it.each<{ filter: (typeof LIST_FILTERS)[number]; params: Record<string, string>; href: string }>([
    { filter: "check", params: { retry: "1" }, href: `/watchlist/${SOFT_ID}?f=check&retry=1` },
    { filter: "promo", params: { repin: "1" }, href: `/watchlist/${SOFT_ID}?f=promo&repin=1` },
    { filter: "all", params: { matched: "1" }, href: `/watchlist/${SOFT_ID}?matched=1` },
    { filter: "check", params: { error: "failed" }, href: `/watchlist/${SOFT_ID}?f=check&error=failed` },
    { filter: "check", params: {}, href: `/watchlist/${SOFT_ID}?f=check` },
    { filter: "check", params: { a: "1", b: "x y" }, href: `/watchlist/${SOFT_ID}?f=check&a=1&b=x+y` },
  ])("adds $params after the filter $filter: $href", ({ filter, params, href }) => {
    // The address it's built from had its own query, which it drops.
    expect(filterHref(`/watchlist/${SOFT_ID}?repin=1&prices=done`, filter, params)).toBe(href);
  });

  it("shows the chips of a list whose reads worked, with the filter the address names", () => {
    expect(listChipsOf(rows, true, "promo")).toEqual({ counts: { all: 4, promo: 2, check: 2 }, filter: "promo" });
    expect(listChipsOf(rows, true, null)).toEqual({ counts: { all: 4, promo: 2, check: 2 }, filter: "all" });
    // A filter no chip links to is every product's.
    expect(listChipsOf(rows, true, "najtańsze")).toMatchObject({ filter: "all" });
  });

  it("shows no chips, and every product, for a read that failed, an empty list or one that couldn't be read", () => {
    expect(listChipsOf(rows, false, "promo")).toEqual({ counts: null, filter: "all" });
    expect(listChipsOf([], true, "check")).toEqual({ counts: null, filter: "all" });
    expect(listChipsOf(null, true, "check")).toEqual({ counts: null, filter: "all" });
  });
});

describe("rowShopsOf", () => {
  const items: PricedItem[] = [
    { shop: "rossmann", shopItemId: "26900", latest: check({ price: 26.99 }) },
    { shop: "natura", shopItemId: "NV89063", latest: null },
  ];

  it("gives each item's latest check, marking the items whose rows couldn't be read", () => {
    // Another shop's item with the same id is someone else's row.
    const unread: PriceKey[] = [
      { shop: "natura", shopItemId: "NV89063" },
      { shop: "rossmann", shopItemId: "NV89063" },
    ];

    expect(rowShopsOf(items, { unread, unattributed: 0 })).toEqual([
      { shop: "rossmann", latest: items[0].latest, readFailed: false },
      { shop: "natura", latest: null, readFailed: true },
    ]);
    expect(rowShopsOf(items, { unread: [], unattributed: 0 })).toEqual([
      { shop: "rossmann", latest: items[0].latest, readFailed: false },
      { shop: "natura", latest: null, readFailed: false },
    ]);
  });

  it("marks the items without a readable row when a row couldn't say whose it is, and keeps the others' prices", () => {
    // The odd row may have been Natura's latest, or any other item's without a row of its own.
    expect(rowShopsOf(items, { unread: [], unattributed: 1 })).toEqual([
      { shop: "rossmann", latest: items[0].latest, readFailed: false },
      { shop: "natura", latest: null, readFailed: true },
    ]);
  });

  it("marks every item when the prices couldn't be read at all", () => {
    expect(rowShopsOf(items, null).map((each) => each.readFailed)).toEqual([true, true]);
  });
});

describe("naturaStateOf", () => {
  const state = (watchlistItemId: string, decision: ShopMatchState["state"]): ShopMatchState =>
    decision === "matched"
      ? { watchlistItemId, shop: "natura", state: "matched", shopItemId: "NV89063" }
      : { watchlistItemId, shop: "natura", state: decision, shopItemId: null };

  it.each(["matched", "unmatched", "not_found"] as const)("gives a product's %s decision in Natura", (decision) => {
    const read = { states: [state(OTHER_ID, "matched"), state(SOFT_ID, decision)], unread: [], unattributed: 0 };

    expect(naturaStateOf(SOFT_ID, read)).toBe(decision);
  });

  it("gives none for a product without a decision in Natura, whatever other products and shops have", () => {
    const hebe: ShopMatchState = { watchlistItemId: SOFT_ID, shop: "hebe", state: "unmatched", shopItemId: null };

    expect(
      naturaStateOf(SOFT_ID, { states: [state(OTHER_ID, "matched"), hebe], unread: [OTHER_ID], unattributed: 0 }),
    ).toBe("none");
  });

  it("gives unreadable for a product whose decision couldn't be read, never none", () => {
    expect(naturaStateOf(SOFT_ID, { states: [], unread: [SOFT_ID], unattributed: 0 })).toBe("unreadable");
    expect(naturaStateOf(SOFT_ID, null)).toBe("unreadable");
  });

  it("keeps a Natura decision that was read beside an odd row of the product, which can't be Natura's", () => {
    // A product has one decision per shop, so the odd row is another shop's.
    expect(naturaStateOf(SOFT_ID, { states: [state(SOFT_ID, "unmatched")], unread: [SOFT_ID], unattributed: 0 })).toBe(
      "unmatched",
    );
  });

  it("gives unreadable for a product without a readable Natura row when a row couldn't say whose it is", () => {
    const read = { states: [state(OTHER_ID, "matched")], unread: [], unattributed: 1 };

    // The odd row may be this product's Natura decision; the one that was read stands.
    expect(naturaStateOf(SOFT_ID, read)).toBe("unreadable");
    expect(naturaStateOf(OTHER_ID, read)).toBe("matched");
  });
});

describe("the list beside a row that can't say whose it is", () => {
  const ZIAJA_ID = "7d3e8b1a-2c4f-4e6a-8b9c-1d2e3f4a5b6c";
  const product = (id: string, sourceItemId: string, name: string): WatchlistItem => ({
    ...soft,
    id,
    sourceItemId,
    name,
    caption: null,
  });
  // Nivea Soft is matched in Natura; Ziaja's lotion and Felix are declined there.
  const products = [soft, product(ZIAJA_ID, "300200", "Mleczko do ciała"), product(OTHER_ID, "131225", "Felix")];
  const states: ShopMatchState[] = [
    { watchlistItemId: SOFT_ID, shop: "natura", state: "matched", shopItemId: "NV89063" },
    { watchlistItemId: ZIAJA_ID, shop: "natura", state: "unmatched", shopItemId: null },
    { watchlistItemId: OTHER_ID, shop: "natura", state: "unmatched", shopItemId: null },
  ];
  const latest = (name: PricedShop, shopItemId: string, price: number): LatestPrice => ({
    shop: name,
    shopItemId,
    ...check({ price }),
  });
  const prices = [
    latest("rossmann", "26900", 26.99),
    latest("natura", "NV89063", 22.99),
    latest("rossmann", "300200", 12.99),
    latest("rossmann", "131225", 5.99),
  ];

  /** Each product's tag, as the list page builds its rows from its two reads. */
  function tags(
    matchRead: { states: ShopMatchState[]; unread: string[]; unattributed: number },
    priceRead: { prices: LatestPrice[]; unread: PriceKey[]; unattributed: number },
  ): PriceTag[] {
    const priced = listPricedItems(products, matchRead.states, priceRead.prices);
    return products.map(
      (item) =>
        listRowOf(item, rowShopsOf(priced.get(item.id) ?? [], priceRead), naturaStateOf(item.id, matchRead), NOW).tag,
    );
  }

  const intact: PriceTag[] = [
    { tone: "sun", price: 22.99, label: "Natura", meta: "Natura · 5 min temu" },
    { tone: "muted", price: 12.99, label: "Tylko Rossmann", meta: "Rossmann · 5 min temu" },
  ];
  const unreadTag: PriceTag = { tone: "outline", price: null, label: "Błąd odczytu", meta: null };

  it("keeps the other products' prices when a price row can't say whose it is, marking only those without a readable row", () => {
    // Felix's latest row came back without its shop.
    const priceRead = {
      prices: prices.filter(({ shopItemId }) => shopItemId !== "131225"),
      unread: [],
      unattributed: 1,
    };

    expect(tags({ states, unread: [], unattributed: 0 }, priceRead)).toEqual([...intact, unreadTag]);
  });

  it("keeps the other products' Natura decisions when a match row can't say whose it is, marking only those without one", () => {
    // Felix's decision came back without its product.
    const matchRead = {
      states: states.filter(({ watchlistItemId }) => watchlistItemId !== OTHER_ID),
      unread: [],
      unattributed: 1,
    };

    expect(tags(matchRead, { prices, unread: [], unattributed: 0 })).toEqual([...intact, unreadTag]);
  });

  describe("listRowsOf, the list's rows from its three reads", () => {
    const matchRead = { states, unread: [], unattributed: 0 };
    const priceRead = { prices, unread: [], unattributed: 0 };

    it("builds each product's row in the list's order", () => {
      const rows = listRowsOf(products, matchRead, priceRead, NOW);

      expect(rows.map((row) => row.itemId)).toEqual([SOFT_ID, ZIAJA_ID, OTHER_ID]);
      expect(rows.map((row) => row.tag)).toEqual([
        ...intact,
        { tone: "muted", price: 5.99, label: "Tylko Rossmann", meta: "Rossmann · 5 min temu" },
      ]);
    });

    it("builds the rows as listRowOf does for each product, odd rows included", () => {
      const oddMatches = {
        states: states.filter(({ watchlistItemId }) => watchlistItemId !== OTHER_ID),
        unread: [],
        unattributed: 1,
      };
      const oddPrices = {
        prices: prices.filter(({ shopItemId }) => shopItemId !== "300200"),
        unread: [],
        unattributed: 1,
      };

      expect(listRowsOf(products, oddMatches, priceRead, NOW).map((row) => row.tag)).toEqual(
        tags(oddMatches, priceRead),
      );
      expect(listRowsOf(products, matchRead, oddPrices, NOW).map((row) => row.tag)).toEqual(tags(matchRead, oddPrices));
    });

    it("says every product's match couldn't be read when the decisions couldn't be read at all, never that it awaits one", () => {
      const rows = listRowsOf(products, null, priceRead, NOW);

      expect(rows.map((row) => row.tag)).toEqual([unreadTag, unreadTag, unreadTag]);
      expect(rows.map((row) => row.summary)).toEqual(
        Array.from({ length: 3 }, () => "Nie udało się wczytać ceny. Natura: nie udało się wczytać dopasowania."),
      );
      expect(rows.every((row) => row.check)).toBe(true);
    });

    it("says every product's price couldn't be read when the prices couldn't be read at all, never that it has none", () => {
      const rows = listRowsOf(products, matchRead, null, NOW);

      expect(rows.map((row) => row.tag)).toEqual([unreadTag, unreadTag, unreadTag]);
      expect(rows.map((row) => row.summary)).toEqual([
        "Nie udało się wczytać ceny.",
        "Nie udało się wczytać ceny. Natura: brak (Twój wybór).",
        "Nie udało się wczytać ceny. Natura: brak (Twój wybór).",
      ]);
      expect(rows.every((row) => row.check && !row.promo)).toBe(true);
    });

    it("gives an empty list no rows", () => {
      expect(listRowsOf([], matchRead, priceRead, NOW)).toEqual([]);
    });
  });
});
