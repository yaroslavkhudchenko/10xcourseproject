// The list's kitchen sink's fixtures (src/dev/watchlist.astro): made-up products on no one's list, their shops' latest
// checks and their decisions in Natura, Hebe and Super-Pharm, on a fixed clock, and search results. Every row is built
// by the list's own row service (watchlist-rows.ts): one product at a time from its shops, or the whole list from its
// three reads as the page gets them, so the kitchen sink shows only rows the page can reach. The tag states' rows stand
// beside a Hebe and a Super-Pharm the user declined, and Hebe's own rows follow them: the cheapest of three, still to
// match, not found, a match that differs from its product, and a decision that couldn't be read. Super-Pharm's rows
// close them: the cheapest of four, and still to match. Nothing here is real user data, and nothing here asks Supabase
// or a shop.
import type { LatestCheck, PricedShop } from "@/lib/services/price-comparison";
import { parseSize } from "@/lib/services/size";
import {
  filterCounts,
  listRowOf,
  listRowsOf,
  type ListFilter,
  type ListMatchState,
  type ListMatchStates,
  type ListRow,
  type RowShop,
} from "@/lib/services/watchlist-rows";
import type { LatestPrice, ProductCandidate, ShopMatchState, WatchlistItem } from "@/types";

/** Every link the kitchen sink draws itself leads back here, so a stray tap goes nowhere. */
export const HERE = "/dev/watchlist";

// The server's clock when it rendered the page, 12:00 in Poland.
const NOW_MS = Date.parse("2026-09-29T10:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The ISO time `ago` before the page was rendered. */
const before = (ago: number) => new Date(NOW_MS - ago).toISOString();

/**
 * A product on no one's list, numbered `n`: its row links to a product page that answers 404 before any lookup, and
 * its made-up Rossmann id is no shop's. Its size is parsed from its text, as "Dodaj" stores it.
 */
function product(n: number, fields: Pick<WatchlistItem, "brand" | "name"> & Partial<WatchlistItem>): WatchlistItem {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    source: "rossmann",
    sourceItemId: String(900000 + n),
    caption: null,
    sizeText: null,
    size: parseSize(fields.sizeText ?? null),
    imageUrl: null,
    addedAt: "2026-09-20T08:00:00.000Z",
    ...fields,
  };
}

interface CheckOptions {
  regularPrice?: number | null;
  promoEndsOn?: string | null;
  available?: boolean;
}

/** A shop item's check `ago` before the page was rendered, which found it at `price`. */
function checked(
  ago: number,
  price: number,
  { regularPrice = null, promoEndsOn = null, available = true }: CheckOptions = {},
): LatestCheck {
  return {
    lastCheckedAt: before(ago),
    lastStatus: "price",
    offer: { price, regularPrice, lowestPrice30d: null, promoEndsOn, available, pricedAt: before(ago) },
  };
}

/** One of a product's shops, as its row compares it. */
const shop = (name: PricedShop, latest: LatestCheck | null, readFailed = false): RowShop => ({
  shop: name,
  latest,
  readFailed,
});

// The handoff's products, and more, each in one of the tag's states.
const NIVEA = product(1, { brand: "NIVEA", name: "Soft", caption: "krem intensywnie nawilżający", sizeText: "300 ml" });
const ISANA = product(2, { brand: "Isana", name: "Żel pod prysznic", caption: "Mango", sizeText: "500 ml" });
const ZIAJA = product(3, { brand: "Ziaja", name: "Mleczko do ciała", caption: "kozie mleko", sizeText: "400 ml" });
const GARNIER = product(4, { brand: "Garnier", name: "Fructis", caption: "szampon wzmacniający", sizeText: "400 ml" });
const COLGATE = product(5, { brand: "Colgate", name: "Total", caption: "pasta do zębów", sizeText: "75 ml" });
const BIELENDA = product(6, { brand: "Bielenda", name: "Kremowy żel do mycia twarzy", sizeText: "150 ml" });
const DOVE = product(7, { brand: "Dove", name: "Original", caption: "mydło w kostce", sizeText: "90 g" });
const LOREAL = product(8, {
  brand: "L'Oréal Paris",
  name: "Elseve Dream Long",
  caption: "odżywka wygładzająca do włosów długich i zniszczonych, bez spłukiwania",
  sizeText: "200 ml + 150 ml, zestaw promocyjny",
});
// The app's own icon as the product's photo, never an image from elsewhere.
const PHOTO = product(9, { brand: "Przykład", name: "Krem nawilżający", sizeText: "50 ml", imageUrl: "/favicon.png" });

// Natura's promotion on the handoff's Nivea, beside Rossmann's regular price.
const NIVEA_SHOPS = [
  shop("rossmann", checked(10 * MINUTE, 26.99)),
  shop("natura", checked(5 * MINUTE, 22.99, { regularPrice: 27.99 })),
];

/** A product's state in one matched shop, by its name there: a match agrees with the product. */
function stateOf(state: ListMatchState["state"]): ListMatchState {
  return state === "matched" ? { state, mismatch: { size: false, brand: false } } : { state };
}

/** A product's state in every matched shop, by its name there: Hebe and Super-Pharm declined by the user unless given. */
function statesOf(
  natura: ListMatchState["state"],
  hebe: ListMatchState["state"] = "unmatched",
  superPharm: ListMatchState["state"] = "unmatched",
): ListMatchStates {
  return { natura: stateOf(natura), hebe: stateOf(hebe), "super-pharm": stateOf(superPharm) };
}

/** The row of `item` with these shops and these states in Natura, Hebe and Super-Pharm, at the page's time. */
const rowOf = (
  item: WatchlistItem,
  shops: RowShop[],
  natura: ListMatchState["state"],
  hebe?: ListMatchState["state"],
  superPharm?: ListMatchState["state"],
): ListRow => listRowOf(item, shops, statesOf(natura, hebe, superPharm), NOW_MS);

/** A product's decline in Super-Pharm, as the list reads it, which the rows built from the list's reads stand beside. */
const superPharmDeclined = (watchlistItemId: string): ShopMatchState => ({
  watchlistItemId,
  shop: "super-pharm",
  state: "unmatched",
  shopItemId: null,
});

// A shampoo matched in Natura to an item of another brand in its size, which a lookup accepted on its own before the
// brand rule, and declined in Hebe and in Super-Pharm. Nobody has seen it differ, so the list counts the product in "Do
// sprawdzenia", and the row's line for screen readers says why, while the row looks like any other. The row comes from
// the list's own reads as the page gets them, so the list's rule decides all that.
const JOANNA = product(15, { brand: "Joanna", name: "Naturia", caption: "szampon z pokrzywą", sizeText: "500 ml" });
const JOANNA_SKU = "NV90015";
const OTHER_BRAND_MATCH: ShopMatchState = {
  watchlistItemId: JOANNA.id,
  shop: "natura",
  state: "matched",
  shopItemId: JOANNA_SKU,
  brand: "WZÓR",
  size: { value: 500, unit: "ml" },
  decidedBy: "auto",
};
const [OTHER_BRAND_ROW] = listRowsOf(
  [JOANNA],
  {
    states: [
      OTHER_BRAND_MATCH,
      { watchlistItemId: JOANNA.id, shop: "hebe", state: "unmatched", shopItemId: null },
      superPharmDeclined(JOANNA.id),
    ],
    unread: [],
    unattributed: [],
  },
  {
    prices: [
      { shop: "rossmann", shopItemId: JOANNA.sourceItemId, ...checked(15 * MINUTE, 8.99) },
      { shop: "natura", shopItemId: JOANNA_SKU, ...checked(15 * MINUTE, 9.49) },
    ],
    unread: [],
    unattributed: 0,
  },
  NOW_MS,
);

// Hebe's rows. A cleanser priced in all three shops, cheapest in Hebe.
const GARNIER_MICELLAR = product(16, {
  brand: "Garnier",
  name: "Płyn micelarny",
  caption: "do skóry wrażliwej",
  sizeText: "400 ml",
});
const THREE_SHOPS = [
  shop("rossmann", checked(10 * MINUTE, 19.99)),
  shop("natura", checked(5 * MINUTE, 17.49)),
  shop("hebe", checked(5 * MINUTE, 16.99)),
];
// A foot cream matched in Natura, still to match in Hebe, and a hand cream Hebe's lookup didn't find.
const ZIAJA_FEET = product(17, { brand: "Ziaja", name: "Krem do stóp", caption: "z mocznikiem", sizeText: "100 ml" });
const ISANA_HANDS = product(18, { brand: "Isana", name: "Krem do rąk", caption: "z masłem shea", sizeText: "75 ml" });
const FOOT_SHOPS = [shop("rossmann", checked(30 * MINUTE, 8.99)), shop("natura", checked(30 * MINUTE, 9.49))];
const HAND_SHOPS = [shop("rossmann", checked(30 * MINUTE, 6.99)), shop("natura", checked(30 * MINUTE, 7.29))];
const HEBE_NONE_ROW = rowOf(ZIAJA_FEET, FOOT_SHOPS, "matched", "none");
const HEBE_NOT_FOUND_ROW = rowOf(ISANA_HANDS, HAND_SHOPS, "matched", "not_found");

// A lip balm declined in Natura and Super-Pharm and matched automatically in Hebe to its item in another size, as such a
// match is stored: nobody has seen it differ, so the list counts the product in "Do sprawdzenia", and the line says why.
const LABELLO = product(19, { brand: "Labello", name: "Original", caption: "pomadka do ust", sizeText: "4,8 g" });
const LABELLO_HEBE_ID = "990000000000000019";
const [HEBE_SIZE_ROW] = listRowsOf(
  [LABELLO],
  {
    states: [
      { watchlistItemId: LABELLO.id, shop: "natura", state: "unmatched", shopItemId: null },
      {
        watchlistItemId: LABELLO.id,
        shop: "hebe",
        state: "matched",
        shopItemId: LABELLO_HEBE_ID,
        brand: "Labello",
        size: parseSize("5,5 ml"),
        decidedBy: "auto",
      },
      superPharmDeclined(LABELLO.id),
    ],
    unread: [],
    unattributed: [],
  },
  {
    prices: [
      { shop: "rossmann", shopItemId: LABELLO.sourceItemId, ...checked(20 * MINUTE, 9.99) },
      { shop: "hebe", shopItemId: LABELLO_HEBE_ID, ...checked(20 * MINUTE, 10.49) },
    ],
    unread: [],
    unattributed: 0,
  },
  NOW_MS,
);

// A shower gel matched in Natura, declined in Super-Pharm, whose Hebe decision came back odd: Hebe's match may name a
// lower price, so the row names no shop.
const PALMOLIVE = product(20, { brand: "Palmolive", name: "Żel pod prysznic", caption: "Aroma", sizeText: "500 ml" });
const PALMOLIVE_SKU = "NV90020";
const [HEBE_UNREAD_ROW] = listRowsOf(
  [PALMOLIVE],
  {
    states: [
      {
        watchlistItemId: PALMOLIVE.id,
        shop: "natura",
        state: "matched",
        shopItemId: PALMOLIVE_SKU,
        brand: "PALMOLIVE",
        size: parseSize("500 ml"),
        decidedBy: "auto",
      },
      superPharmDeclined(PALMOLIVE.id),
    ],
    unread: [{ watchlistItemId: PALMOLIVE.id, shop: "hebe" }],
    unattributed: [],
  },
  {
    prices: [
      { shop: "rossmann", shopItemId: PALMOLIVE.sourceItemId, ...checked(15 * MINUTE, 11.99) },
      { shop: "natura", shopItemId: PALMOLIVE_SKU, ...checked(15 * MINUTE, 10.99) },
    ],
    unread: [],
    unattributed: 0,
  },
  NOW_MS,
);

// Super-Pharm's rows. A body lotion priced in all four shops, cheapest in Super-Pharm, where the user picked its item.
const CETAPHIL = product(21, {
  brand: "Cetaphil",
  name: "Balsam nawilżający",
  caption: "do skóry suchej i wrażliwej",
  sizeText: "236 ml",
});
const FOUR_SHOPS = [
  shop("rossmann", checked(10 * MINUTE, 39.99)),
  shop("natura", checked(5 * MINUTE, 37.49)),
  shop("hebe", checked(5 * MINUTE, 36.99)),
  shop("super-pharm", checked(5 * MINUTE, 34.49)),
];
// A body balm matched in Natura and Hebe, and still to match in Super-Pharm, whose button nobody has tapped yet.
const EVELINE_BODY = product(22, {
  brand: "Eveline",
  name: "Balsam do ciała",
  caption: "z masłem kakaowym",
  sizeText: "350 ml",
});
const SUPER_PHARM_NONE_ROW = rowOf(
  EVELINE_BODY,
  [
    shop("rossmann", checked(30 * MINUTE, 14.99)),
    shop("natura", checked(30 * MINUTE, 13.99)),
    shop("hebe", checked(30 * MINUTE, 14.49)),
  ],
  "matched",
  "matched",
  "none",
);

/** What a screen reader hears of a row, as a fixture's label quotes it. */
const heard = (row: ListRow) => `czytnik ekranu słyszy: „${row.summary}”`;

/** One row of the list, with the kitchen sink's label for it. */
export interface RowFixture {
  code: string;
  text: string;
  row: ListRow;
  selected?: boolean;
}

export const ROW_FIXTURES: RowFixture[] = [
  {
    code: "cheapest",
    text: "Natura najtańsza, w promocji: etykieta w kolorze sun z nazwą sklepu",
    row: rowOf(NIVEA, NIVEA_SHOPS, "matched"),
  },
  {
    code: "cheapest, selected",
    text: "ten sam wiersz, wybrany obok strony produktu: krawędź, cień i uniesienie",
    row: rowOf(NIVEA, NIVEA_SHOPS, "matched"),
    selected: true,
  },
  {
    code: "tie",
    text: "ta sama cena w obu sklepach: oba w etykiecie",
    row: rowOf(
      ISANA,
      [shop("rossmann", checked(10 * MINUTE, 7.49)), shop("natura", checked(12 * MINUTE, 7.49))],
      "matched",
    ),
  },
  {
    code: "only",
    text: "tylko Rossmann, Natura do dopasowania",
    row: rowOf(ZIAJA, [shop("rossmann", checked(20 * HOUR, 12.99))], "none"),
  },
  {
    code: "unavailable",
    text: "świeża cena, ale bez zamówienia online",
    row: rowOf(GARNIER, [shop("rossmann", checked(30 * MINUTE, 18.49, { available: false }))], "unmatched"),
  },
  {
    code: "stale",
    text: "cena sprzed 2 dni: ostatnia znana, nieaktualna",
    row: rowOf(COLGATE, [shop("rossmann", checked(2 * DAY, 11.49))], "unmatched"),
  },
  {
    code: "unread",
    text: "nie udało się odczytać zapisanej ceny",
    row: rowOf(BIELENDA, [shop("rossmann", null, true)], "unmatched"),
  },
  {
    code: "none",
    text: "jeszcze niesprawdzony",
    row: rowOf(DOVE, [shop("rossmann", null)], "none"),
  },
  {
    code: "long",
    text: "długa nazwa i rozmiar",
    row: rowOf(
      LOREAL,
      [shop("rossmann", checked(3 * HOUR, 1234.5)), shop("natura", checked(3 * HOUR, 1299.99))],
      "matched",
    ),
  },
  {
    code: "photo",
    text: "ze zdjęciem produktu",
    row: rowOf(PHOTO, [shop("rossmann", checked(MINUTE, 9.99)), shop("natura", checked(MINUTE, 11.99))], "matched"),
  },
  {
    code: "suspicious",
    text:
      "dopasowane automatycznie do innej marki, zanim porównywano marki: wygląda jak inne, ale liczy się " +
      `w „Do sprawdzenia”, a ${heard(OTHER_BRAND_ROW)}`,
    row: OTHER_BRAND_ROW,
  },
  {
    code: "hebe-cheapest",
    text: "trzy sklepy, Hebe najtańsza: etykieta w kolorze sun z nazwą Hebe",
    row: rowOf(GARNIER_MICELLAR, THREE_SHOPS, "matched", "matched"),
  },
  {
    code: "hebe-none",
    text: `Hebe do dopasowania: wiersz liczy się w „Do sprawdzenia”, a ${heard(HEBE_NONE_ROW)}`,
    row: HEBE_NONE_ROW,
  },
  {
    code: "hebe-not-found",
    text: `Hebe nie znalazła produktu: wiersz liczy się w „Do sprawdzenia”, a ${heard(HEBE_NOT_FOUND_ROW)}`,
    row: HEBE_NOT_FOUND_ROW,
  },
  {
    code: "hebe-suspicious",
    text:
      "dopasowane automatycznie w Hebe w innym rozmiarze: wygląda jak inne, ale liczy się w „Do sprawdzenia”, a " +
      heard(HEBE_SIZE_ROW),
    row: HEBE_SIZE_ROW,
  },
  {
    code: "hebe-unread",
    text: `nie udało się wczytać decyzji Hebe: żaden sklep nie jest nazwany, a ${heard(HEBE_UNREAD_ROW)}`,
    row: HEBE_UNREAD_ROW,
  },
  {
    code: "super-pharm-cheapest",
    text: "cztery sklepy, Super-Pharm najtańszy: etykieta w kolorze sun z nazwą Super-Pharmu",
    row: rowOf(CETAPHIL, FOUR_SHOPS, "matched", "matched", "matched"),
  },
  {
    code: "super-pharm-none",
    text:
      "Super-Pharm do dopasowania, czeka na przycisk na stronie produktu: wiersz liczy się w „Do sprawdzenia”, a " +
      heard(SUPER_PHARM_NONE_ROW),
    row: SUPER_PHARM_NONE_ROW,
  },
];

/** Every row of the gallery once, as a list of them. */
export const GALLERY_ROWS: ListRow[] = ROW_FIXTURES.filter((fixture) => fixture.selected !== true).map(
  (fixture) => fixture.row,
);

/** How many of the gallery's rows each chip holds. */
export const GALLERY_COUNTS = filterCounts(GALLERY_ROWS);

/** The product whose page the gallery stands beside, as the list in its left column: the handoff's Nivea. */
export const BESIDE_ID = NIVEA.id;

/** The chips' counts for a list with nothing on promotion and nothing to check: the product with its photo alone. */
export const QUIET_COUNTS = filterCounts([rowOf(PHOTO, [shop("rossmann", checked(MINUTE, 9.99))], "matched")]);

// Five more products, so the long list below holds fifteen.
const MORE: ListRow[] = [
  rowOf(
    product(10, { brand: "Ziaja", name: "Krem do rąk", caption: "masło kakaowe", sizeText: "50 ml" }),
    [shop("rossmann", checked(40 * MINUTE, 6.49))],
    "none",
  ),
  rowOf(
    product(11, {
      brand: "Isana",
      name: "Szampon",
      caption: "z pokrzywą do włosów przetłuszczających się",
      sizeText: "300 ml",
    }),
    [shop("rossmann", checked(2 * HOUR, 5.99)), shop("natura", checked(2 * HOUR, 6.99))],
    "matched",
  ),
  rowOf(
    product(12, { brand: "Bielenda", name: "Tonik", caption: "róża", sizeText: "200 ml" }),
    [shop("rossmann", checked(3 * DAY, 14.99))],
    "unmatched",
  ),
  rowOf(
    product(13, { brand: "Dove", name: "Dezodorant", caption: "Original", sizeText: "150 ml" }),
    [
      shop("rossmann", checked(15 * MINUTE, 13.99)),
      shop("natura", checked(15 * MINUTE, 11.99, { regularPrice: 15.49 })),
    ],
    "matched",
  ),
  rowOf(
    product(14, { brand: "Eveline", name: "Krem pod oczy", caption: "z retinolem", sizeText: "15 ml" }),
    [shop("rossmann", null)],
    "none",
  ),
];

/**
 * A long list, to check that its rows scroll on their own beside a product, between the list's head and its footer,
 * and that the selected row's lift and focus outline stay whole wherever it's scrolled to: the gallery's rows and five
 * more, with the product beside, the handoff's Nivea, at the foot.
 */
export const LONG_ROWS: ListRow[] = [...GALLERY_ROWS.filter((row) => row.itemId !== NIVEA.id), ...MORE].concat(
  GALLERY_ROWS.filter((row) => row.itemId === NIVEA.id),
);

/** How many of the long list's rows each chip holds. */
export const LONG_COUNTS = filterCounts(LONG_ROWS);

// The whole list's three reads as the page gets them, from which the read failures are built: Nivea matched in Natura
// on its own, to an item of its brand and size, Ziaja still to match, Colgate declined there; none of them has a
// decision in Hebe or Super-Pharm yet.
const LIST: WatchlistItem[] = [NIVEA, ZIAJA, COLGATE];
const LIST_STATES: ShopMatchState[] = [
  {
    watchlistItemId: NIVEA.id,
    shop: "natura",
    state: "matched",
    shopItemId: "NV90001",
    brand: "NIVEA",
    size: { value: 300, unit: "ml" },
    decidedBy: "auto",
  },
  { watchlistItemId: COLGATE.id, shop: "natura", state: "unmatched", shopItemId: null },
];
const LIST_PRICES: LatestPrice[] = [
  { shop: "rossmann", shopItemId: NIVEA.sourceItemId, ...checked(10 * MINUTE, 26.99) },
  { shop: "natura", shopItemId: "NV90001", ...checked(5 * MINUTE, 22.99, { regularPrice: 27.99 }) },
  { shop: "rossmann", shopItemId: ZIAJA.sourceItemId, ...checked(20 * HOUR, 12.99) },
  { shop: "rossmann", shopItemId: COLGATE.sourceItemId, ...checked(2 * DAY, 11.49) },
];
const MATCH_READ = { states: LIST_STATES, unread: [], unattributed: [] };
const PRICE_READ = { prices: LIST_PRICES, unread: [], unattributed: 0 };

/** One state of the list's rows, with the kitchen sink's label for it. */
export interface RowsFixture {
  code: string;
  text: string;
  rows: ListRow[] | null;
  filter: ListFilter;
  matchesFailed: boolean;
  pricesFailed: boolean;
}

export const ROWS_FIXTURES: RowsFixture[] = [
  {
    code: "empty",
    text: "pusta lista",
    rows: [],
    filter: "all",
    matchesFailed: false,
    pricesFailed: false,
  },
  {
    code: "list-failed",
    text: "nie udało się wczytać listy",
    rows: null,
    filter: "all",
    matchesFailed: false,
    pricesFailed: false,
  },
  {
    code: "matches-failed",
    text: "nie udało się wczytać decyzji Natury, Hebe i Super-Pharmu: żaden wiersz nie mówi, że czeka na dopasowanie",
    rows: listRowsOf(LIST, null, PRICE_READ, NOW_MS),
    filter: "all",
    matchesFailed: true,
    pricesFailed: false,
  },
  {
    code: "prices-failed",
    text: "nie udało się wczytać cen: żaden wiersz nie mówi, że nie ma ceny",
    rows: listRowsOf(LIST, MATCH_READ, null, NOW_MS),
    filter: "all",
    matchesFailed: false,
    pricesFailed: true,
  },
  {
    code: "filter-empty",
    text: "filtr, który nie obejmuje żadnego produktu: Promocje bez promocji",
    rows: listRowsOf([ZIAJA, COLGATE], MATCH_READ, PRICE_READ, NOW_MS),
    filter: "promo",
    matchesFailed: false,
    pricesFailed: false,
  },
];

/** A search result, as Rossmann's search gives it: an item of no real product. */
function candidate(
  fields: Pick<ProductCandidate, "sourceItemId" | "brand" | "name"> & Partial<ProductCandidate>,
): ProductCandidate {
  return {
    source: "rossmann",
    caption: null,
    sizeText: null,
    size: null,
    eans: [],
    productUrl: null,
    imageUrl: null,
    ...fields,
  };
}

/**
 * The search results, one of them already on the list. The one "Dodaj" offers has an id the add form refuses, so a
 * stray tap stores nothing and comes back to the list with its error.
 */
export const SEARCH_CANDIDATES: ProductCandidate[] = [
  candidate({
    sourceItemId: "dev-sink",
    brand: "NIVEA",
    name: "Soft",
    caption: "krem nawilżający",
    sizeText: "200 ml",
  }),
  candidate({
    sourceItemId: NIVEA.sourceItemId,
    brand: NIVEA.brand,
    name: NIVEA.name,
    caption: NIVEA.caption,
    sizeText: NIVEA.sizeText,
  }),
  candidate({
    sourceItemId: "dev-sink-long",
    brand: LOREAL.brand,
    name: LOREAL.name,
    caption: LOREAL.caption,
    sizeText: LOREAL.sizeText,
    imageUrl: "/favicon.png",
  }),
];

/** The products the search results are checked against: Nivea's is on the list. */
export const SEARCH_LISTED = [NIVEA];

/** The kitchen sink's signed-in user, made up. */
export const EMAIL = "ania@example.com";
