// The list's kitchen sink's fixtures (src/dev/watchlist.astro): made-up products on no one's list, their shops' latest
// checks and their Natura decisions, on a fixed clock, and search results. Every row is built by the list's own row
// service (watchlist-rows.ts): one product at a time from its shops, or the whole list from its three reads as the
// page gets them, so the kitchen sink shows only rows the page can reach. Nothing here is real user data, and nothing
// here asks Supabase or a shop.
import type { LatestCheck, PricedShop } from "@/lib/services/price-comparison";
import {
  filterCounts,
  listRowOf,
  listRowsOf,
  type ListFilter,
  type ListRow,
  type NaturaListState,
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
 * its made-up Rossmann id is no shop's.
 */
function product(n: number, fields: Pick<WatchlistItem, "brand" | "name"> & Partial<WatchlistItem>): WatchlistItem {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    source: "rossmann",
    sourceItemId: String(900000 + n),
    caption: null,
    sizeText: null,
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

/** The row of `item` with these shops and this Natura state, at the page's time. */
const rowOf = (item: WatchlistItem, shops: RowShop[], natura: NaturaListState): ListRow =>
  listRowOf(item, shops, natura, NOW_MS);

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

// Five more products, so the long list below holds fourteen.
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

// The whole list's three reads as the page gets them, from which the read failures are built: Nivea matched in Natura,
// Ziaja still to match, Colgate declined there.
const LIST: WatchlistItem[] = [NIVEA, ZIAJA, COLGATE];
const LIST_STATES: ShopMatchState[] = [
  { watchlistItemId: NIVEA.id, shop: "natura", state: "matched", shopItemId: "NV90001" },
  { watchlistItemId: COLGATE.id, shop: "natura", state: "unmatched", shopItemId: null },
];
const LIST_PRICES: LatestPrice[] = [
  { shop: "rossmann", shopItemId: NIVEA.sourceItemId, ...checked(10 * MINUTE, 26.99) },
  { shop: "natura", shopItemId: "NV90001", ...checked(5 * MINUTE, 22.99, { regularPrice: 27.99 }) },
  { shop: "rossmann", shopItemId: ZIAJA.sourceItemId, ...checked(20 * HOUR, 12.99) },
  { shop: "rossmann", shopItemId: COLGATE.sourceItemId, ...checked(2 * DAY, 11.49) },
];
const MATCH_READ = { states: LIST_STATES, unread: [], unattributed: 0 };
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
    text: "nie udało się wczytać decyzji Natury: żaden wiersz nie mówi, że czeka na dopasowanie",
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
