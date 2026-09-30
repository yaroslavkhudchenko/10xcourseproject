// The dev kitchen sink's fixtures (src/dev/product-page.astro): one made-up product in Rossmann and Natura, its stored
// prices and its Natura decisions, on a fixed clock, and the prices and brands its primitives are shown with. Every
// state is built by the product page's own code, the price island's reducer, the Natura view builders and the matching
// rule, so the kitchen sink shows only states the page can reach. Nothing here is real user data, and nothing here
// asks Supabase or a shop.
import type { PriceSize } from "@/components/watchlist/Price";
import {
  done,
  initialState,
  priceComparisonReducer,
  start,
  type PriceComparisonAction,
  type PriceComparisonShop,
  type PriceComparisonState,
  type RefreshResult,
} from "@/components/watchlist/price-comparison-state";
import { tileOf, TILES, type Tile } from "@/components/watchlist/thumb-tile";
import { DECISION_NOTICES } from "@/lib/notices";
import { matchErrorMessage } from "@/lib/services/matches";
import { pickMatch } from "@/lib/services/matching";
import {
  chooseView,
  matchedView,
  notFoundView,
  promptView,
  storedView,
  type NaturaView,
} from "@/lib/services/natura-view";
import { SHOP_LABELS, STALE_AFTER_MS, type PricedShop } from "@/lib/services/price-comparison";
import { parseSize } from "@/lib/services/size";
import { shopUnavailableText } from "@/lib/shop-messages";
import type {
  CandidateOption,
  LatestPrice,
  MatchedItem,
  ShopCandidate,
  ShopMatch,
  ShopOffer,
  WatchlistProduct,
} from "@/types";

/** Every link the kitchen sink draws itself leads back here, so a stray tap goes nowhere. */
export const HERE = "/dev/product-page";

/**
 * The one made-up product every fixture, form and link names. It is on no one's list, so a stray tap on a form or a
 * link reaches no shop: the page and the routes read the product before any shop request, and find none.
 */
export const PRODUCT_ID = "00000000-0000-4000-8000-000000000000";

// The server's clock when it rendered the page, 12:00 in Poland. The shops' answers come a few seconds later.
const NOW = "2026-09-29T10:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const CHECKED_AT = new Date(NOW_MS + 2000).toISOString();
const ANSWERED_AT = NOW_MS + 3000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// A pause Natura asks for, until 12:15 in Poland.
const PAUSED_UNTIL = new Date(NOW_MS + 15 * MINUTE).toISOString();

// The product's made-up EAN, which some of Natura's items share.
const EAN = "2000000000001";

/** A size as a shop writes it, parsed the way the adapters parse it. */
function sized(sizeText: string) {
  return { sizeText, size: parseSize(sizeText) };
}

/** The watched product, picked in Rossmann. Its photo is the app's own icon, never an image from elsewhere. */
const PRODUCT: WatchlistProduct = {
  id: PRODUCT_ID,
  source: "rossmann",
  sourceItemId: "100000",
  brand: "Przykład",
  name: "Krem nawilżający",
  caption: "do twarzy i ciała",
  ...sized("300 ml"),
  eans: [EAN],
  productUrl: HERE,
  imageUrl: "/favicon.png",
  addedAt: "2026-09-20T08:00:00.000Z",
};

/** One look of the page's header card, with the kitchen sink's label for it. */
export interface HeaderFixture {
  code: string;
  text: string;
  product: WatchlistProduct;
}

export const HEADER_FIXTURES: HeaderFixture[] = [
  { code: "photo", text: "ze zdjęciem produktu", product: PRODUCT },
  { code: "no-photo", text: "bez zdjęcia", product: { ...PRODUCT, imageUrl: null } },
];

/** An online offer: a regular price, unless `extra` adds a promotion or makes it unorderable online. */
function offer(price: number, extra: Partial<ShopOffer> = {}): ShopOffer {
  return { price, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available: true, ...extra };
}

// Natura's promotion: its price, the regular one, its last day, and the lowest price of 30 days that Natura reports.
const NATURA_PROMO = offer(22.99, { regularPrice: 27.99, lowestPrice30d: 23.99, promoEndsOn: "2026-10-05" });
const NATURA_SKU = "NV10000";

/** A shop's row as the page hands it to the island: its item's page, and its stored price or none. */
function row(shop: PricedShop, latest: LatestPrice | null): PriceComparisonShop {
  return { shop, productUrl: HERE, latest };
}

/** A shop's row whose last check found `price`, `ago` before the page was rendered. */
function priced(shop: PricedShop, price: ShopOffer, ago: number): PriceComparisonShop {
  const at = new Date(NOW_MS - ago).toISOString();
  const shopItemId = shop === "rossmann" ? PRODUCT.sourceItemId : NATURA_SKU;
  return row(shop, { shop, shopItemId, lastCheckedAt: at, lastStatus: "price", offer: { ...price, pricedAt: at } });
}

// Both shops checked in the last 15 minutes, so opening the page asks neither again. Natura's promotion is cheaper.
const ROSSMANN_CHECKED = priced("rossmann", offer(26.99), 10 * MINUTE);
const CHECKED = [ROSSMANN_CHECKED, priced("natura", NATURA_PROMO, 5 * MINUTE)];

// Both shops' refetches started, as "Odśwież ceny" starts them.
const REFETCH = [start("rossmann"), start("natura")];
const MISSING: RefreshResult = { kind: "missing", checkedAt: CHECKED_AT, saved: true };
const SESSION_ENDED: RefreshResult = { kind: "session-ended" };

/** The island's state for `shops` as the server rendered it at NOW, then after each action in turn. */
function island(shops: PriceComparisonShop[], ...actions: PriceComparisonAction[]): PriceComparisonState {
  return actions.reduce(priceComparisonReducer, initialState({ shops, now: NOW }));
}

/** The island's state when the page couldn't read the stored prices, then after each action in turn. */
function unread(...actions: PriceComparisonAction[]): PriceComparisonState {
  // A failed read hands the island every shop without a stored price, so opening the page refetches both.
  const shops = [row("rossmann", null), row("natura", null)];
  return actions.reduce(priceComparisonReducer, initialState({ shops, now: NOW, pricesFailed: true }));
}

/** One state of the price island, with the kitchen sink's label for it. */
export interface PriceFixture {
  code: string;
  text: string;
  state: PriceComparisonState;
}

export const PRICE_FIXTURES: PriceFixture[] = [
  {
    code: "cheapest",
    text: "Natura najtańsza, w promocji: z ceną regularną, końcem promocji i najniższą ceną z 30 dni",
    state: island(CHECKED),
  },
  {
    code: "tie",
    text: "ta sama cena w obu sklepach: oba oznaczone",
    state: island([priced("rossmann", offer(24.99), 10 * MINUTE), priced("natura", offer(24.99), 5 * MINUTE)]),
  },
  {
    code: "lone",
    text: "jeden sklep: nie ma z czym porównać, więc bez oznaczenia",
    state: island([ROSSMANN_CHECKED]),
  },
  {
    code: "stale",
    text: "cena Rossmanna sprzed ponad 24 godzin: niższa, ale nieaktualna, więc wygrywa Natura",
    state: island([
      priced("rossmann", offer(21.99), STALE_AFTER_MS + 2 * HOUR),
      priced("natura", NATURA_PROMO, 5 * MINUTE),
    ]),
  },
  {
    code: "not-orderable",
    text: "Natury nie da się zamówić online: jej niższa cena nie wygrywa",
    state: island([ROSSMANN_CHECKED, priced("natura", offer(19.99, { available: false }), 5 * MINUTE)]),
  },
  {
    code: "missing-with-price",
    text: "Natura nie zwraca już produktu: ostatnia znana cena zostaje ze swoim wiekiem",
    // Natura's price is 3 hours old, so opening the page refetches it alone.
    state: island(
      [ROSSMANN_CHECKED, priced("natura", NATURA_PROMO, 3 * HOUR)],
      start("natura"),
      done("natura", MISSING, ANSWERED_AT),
    ),
  },
  {
    code: "missing-without-price",
    text: "Natura nie zwraca produktu, a ceny wcześniej nie było",
    state: island([ROSSMANN_CHECKED, row("natura", null)], start("natura"), done("natura", MISSING, ANSWERED_AT)),
  },
  {
    code: "never-checked",
    text: "Natura jeszcze niesprawdzona",
    state: island([ROSSMANN_CHECKED, row("natura", null)]),
  },
  {
    code: "refreshing",
    text: "oba sklepy w trakcie odświeżania, przy cenach z cheapest",
    state: island(CHECKED, ...REFETCH),
  },
  {
    code: "notice-busy-paused",
    text: "Rossmann zajęty, Natura prosi o przerwę: ostatnie znane ceny zostają",
    state: island(
      CHECKED,
      ...REFETCH,
      done("rossmann", { kind: "unavailable", reason: "busy" }, ANSWERED_AT),
      done("natura", { kind: "unavailable", reason: "paused", until: PAUSED_UNTIL }, ANSWERED_AT),
    ),
  },
  {
    code: "notice-stopped-failed",
    text: "Rossmann zablokował zapytania, a pobranie z Natury się nie udało",
    state: island(
      CHECKED,
      ...REFETCH,
      done("rossmann", { kind: "unavailable", reason: "stopped" }, ANSWERED_AT),
      done("natura", { kind: "unavailable", reason: "failed" }, ANSWERED_AT),
    ),
  },
  {
    code: "session-ended",
    text: "sesja wygasła w trakcie odświeżania: ceny zostają",
    state: island(
      CHECKED,
      ...REFETCH,
      done("rossmann", SESSION_ENDED, ANSWERED_AT),
      done("natura", SESSION_ENDED, ANSWERED_AT),
    ),
  },
  {
    code: "read-failed",
    text: "nie udało się wczytać zapisanych cen",
    state: unread(),
  },
  {
    code: "read-failed-one-answered",
    text: "po odpowiedzi Natury: jej wiersz ma cenę, ale bez „Najtaniej”, bo Rossmann wciąż się odświeża",
    state: unread(
      ...REFETCH,
      done("natura", { kind: "price", offer: NATURA_PROMO, checkedAt: CHECKED_AT, saved: true }, ANSWERED_AT),
    ),
  },
  {
    code: "read-failed-one-shop",
    text: "nie udało się odczytać zapisanej ceny Natury: Rossmann ma cenę, ale bez „Najtaniej”, dopóki Natura nie odpowie",
    // The page read the stored prices, but Natura's row came back odd, so it hands that shop over unread.
    state: island([ROSSMANN_CHECKED, { ...row("natura", null), readFailed: true }]),
  },
];

/** The product's item in Natura: the same EAN and size. */
const NATURA_ITEM: MatchedItem = {
  shopItemId: NATURA_SKU,
  brand: "PRZYKŁAD",
  name: "Krem nawilżający do twarzy i ciała",
  ...sized("300 ml"),
  eans: [EAN],
  productUrl: HERE,
  imageUrl: null,
};

// A decision stored for the product in Natura, at 21:45 in Poland on 27 September.
const DECISION = { watchlistItemId: PRODUCT_ID, shop: "natura", checkedAt: "2026-09-27T19:45:00.000Z" } as const;

// The user confirmed the candidate in another size (the first of CANDIDATES), so the match's size is flagged.
const CONFIRMED: ShopMatch = {
  ...DECISION,
  decidedBy: "user",
  state: "matched",
  item: { ...NATURA_ITEM, shopItemId: "NV10001", ...sized("200 ml") },
};
const DECLINED: ShopMatch = { ...DECISION, decidedBy: "user", state: "unmatched", item: null };
const NOT_FOUND: ShopMatch = { ...DECISION, decidedBy: "auto", state: "not_found", item: null };

// What Natura's search by the product's EAN returned. None shares both the EAN and the size, so the matching rule
// leaves the choice to the user, and between them the candidates carry every flag one can have.
const CANDIDATES: ShopCandidate[] = [
  // The same EAN in another size.
  {
    ...NATURA_ITEM,
    shop: "natura",
    shopItemId: "NV10001",
    ...sized("200 ml"),
    imageUrl: "/favicon.png",
    offer: offer(17.99),
  },
  // Another EAN, in a set whose size can't be compared.
  {
    ...NATURA_ITEM,
    shop: "natura",
    shopItemId: "NV10002",
    name: "Krem nawilżający, zestaw podróżny",
    ...sized("4x75 ml"),
    eans: ["2000000000018"],
    offer: offer(39.99),
  },
  // Another EAN in the same size, without a price that can be stored.
  { ...NATURA_ITEM, shop: "natura", shopItemId: "NV10003", eans: ["2000000000025"], offer: null },
];

/** The options the matching rule leaves to the user for these candidates, as a lookup hands them to the page. */
function leftToUser(candidates: ShopCandidate[]): CandidateOption[] {
  const pick = pickMatch(PRODUCT, candidates);
  if (pick.kind !== "choose") {
    // The page never offers a choice the rule settles itself, so neither does the kitchen sink.
    throw new Error(`The kitchen sink's Natura candidates must be left to the user; the rule answered ${pick.kind}.`);
  }
  return pick.options;
}

/** One state of the Natura section, with the kitchen sink's label and the prefix that keeps its ids its own. */
export interface NaturaFixture {
  code: string;
  text: string;
  idPrefix: string;
  view: NaturaView;
  unsaved: boolean;
  notice: string | null;
  error: string | null;
}

export const NATURA_FIXTURES: NaturaFixture[] = [
  {
    code: "matched",
    text: "dopasowane automatycznie, zaraz po wyszukaniu",
    idPrefix: "natura-auto",
    view: matchedView(NATURA_ITEM, "auto", PRODUCT),
    unsaved: false,
    notice: null,
    error: null,
  },
  {
    code: "matched + unsaved",
    text: "dopasowane automatycznie, ale zapis się nie udał: bez wiersza ceny sekcja pokazuje pozycję z Natury",
    idPrefix: "natura-auto-unsaved",
    view: matchedView(NATURA_ITEM, "auto", PRODUCT, { unsaved: true }),
    unsaved: true,
    notice: null,
    error: null,
  },
  {
    code: "matched + notice",
    text: "potwierdzone przez Ciebie w innym rozmiarze, zaraz po zapisie",
    idPrefix: "natura-confirmed",
    view: storedView(CONFIRMED, PRODUCT),
    unsaved: false,
    // The page's notice for `?matched`.
    notice: DECISION_NOTICES.matched,
    error: null,
  },
  {
    code: "unmatched",
    text: "odrzucone przez Ciebie",
    idPrefix: "natura-declined",
    view: storedView(DECLINED, PRODUCT),
    unsaved: false,
    notice: null,
    error: null,
  },
  {
    code: "not-found",
    text: "zapisane „nie znaleziono”",
    idPrefix: "natura-not-found",
    view: storedView(NOT_FOUND, PRODUCT),
    unsaved: false,
    notice: null,
    error: null,
  },
  {
    code: "choose + error",
    text: "kandydaci znalezieni po EAN, po nieudanym zapisie wyboru",
    idPrefix: "natura-choose",
    view: chooseView(leftToUser(CANDIDATES), "ean", new Date(NOW), PRODUCT),
    unsaved: false,
    notice: null,
    error: matchErrorMessage("failed"),
  },
  {
    code: "unavailable",
    text: "wyszukiwarka Natury zajęta",
    idPrefix: "natura-unavailable",
    view: { kind: "unavailable", message: shopUnavailableText(SHOP_LABELS.natura.name, "busy") },
    unsaved: false,
    notice: null,
    error: null,
  },
  {
    code: "prompt",
    text: "strona otwarta z linku: przycisk zamiast wyszukiwania",
    idPrefix: "natura-prompt",
    view: promptView(PRODUCT, false),
    unsaved: false,
    notice: null,
    error: null,
  },
  {
    code: "decided",
    text: "inna karta zapisała decyzję w międzyczasie",
    idPrefix: "natura-decided",
    view: { kind: "decided" },
    unsaved: false,
    notice: null,
    error: null,
  },
  {
    code: "read-failed",
    text: "nie udało się wczytać zapisanej decyzji",
    idPrefix: "natura-read-failed",
    view: { kind: "read-failed" },
    unsaved: false,
    notice: null,
    error: null,
  },
  {
    code: "not-found + unsaved",
    text: "świeże „nie znaleziono”, którego nie udało się zapisać",
    idPrefix: "natura-unsaved",
    view: notFoundView(new Date(NOW), PRODUCT),
    unsaved: true,
    notice: null,
    error: null,
  },
];

/** The page's text for `?error=gone`, which its not-found branch shows: a decision posted for a product not listed. */
export const GONE_ERROR = matchErrorMessage("gone");

/**
 * The prices each size of Price is shown with: the handoff's 22,99 zł in every size, and between them a whole price, a
 * price under 1 zł, a four-digit price, which Polish leaves ungrouped, and a five-digit one, grouped with a no-break
 * space. The hero's are short enough for the kitchen sink's column.
 */
export const PRICE_SAMPLES: Record<PriceSize, number[]> = {
  hero: [22.99, 1234.5],
  card: [22.99, 26.99, 5],
  tag: [22.99, 0.99, 12345.67],
};

/** One look of a product's thumbnail, with the kitchen sink's label for it. */
export interface ThumbFixture {
  code: string;
  text: string;
  brand: string | null;
  imageUrl: string | null;
}

// Brands to show each tile with: the first that tileOf puts on it.
const TILE_BRANDS = ["Nivea", "Isana", "Ziaja", "Colgate", "Garnier", "Dove", "Bielenda", "Eveline"];

/** A brand that tileOf puts on `tile`, so the kitchen sink shows every tile. */
function brandOn(tile: Tile): string {
  const brand = TILE_BRANDS.find((candidate) => tileOf(candidate) === tile);
  if (brand === undefined) {
    throw new Error(`None of the kitchen sink's brands falls on tile ${tile}: add one that does.`);
  }
  return brand;
}

export const THUMB_FIXTURES: ThumbFixture[] = [
  { code: "photo", text: "ze zdjęciem produktu", brand: PRODUCT.brand, imageUrl: PRODUCT.imageUrl },
  ...TILES.map((tile) => {
    const brand = brandOn(tile);
    return { code: `tile-${tile}`, text: `bez zdjęcia: ${brand}`, brand, imageUrl: null };
  }),
  { code: "no-brand", text: "bez zdjęcia i bez marki", brand: null, imageUrl: null },
];
