// The dev kitchen sink's fixtures (src/dev/product-page.astro): one made-up product in Rossmann, Natura, Hebe and
// Super-Pharm, its stored prices and its decisions in the three matched shops, on a fixed clock, the design handoff's
// three sample products, and the prices and brands its primitives are shown with. Every state is built by the product
// page's own code, the price island's reducer, the match view builders and the matching rule, so the kitchen sink
// shows only states the page can reach. The product area's states pair every price state with Natura in every kind,
// beside a Hebe and a Super-Pharm the user declined: the states with Natura's price need a saved match, and the rest
// stand with Rossmann's price alone, each beside another of Natura's kinds. Three shops' states follow: the cheapest of
// three, Hebe's price that can't win, Hebe's decision that couldn't be read, both shops still to match, Hebe's button
// beside Natura's open choice, and two choices at once. Then four shops' states: Super-Pharm the cheapest, one price in
// all four, Super-Pharm's button on a page opened from a link, beside Rossmann's price alone and beside three shops
// still to match, and Super-Pharm's first choice, which its lookup on the product's opening leaves to the user. Natura's
// own states, Hebe's and Super-Pharm's include the choice that changes a stored decision, Natura's in each of the
// outcomes its searches can have, and Super-Pharm's from its automatic match by name and from the user's pick, and the
// product's removal at the page's foot is drawn closed, open and after a failure. Nothing here is real user data, and
// nothing here asks Supabase or a shop.
import { unreadableShopsOf, type MatchedShopView } from "@/components/watchlist/match-card";
import type { PriceSize } from "@/components/watchlist/Price";
import type { TitleProduct } from "@/components/watchlist/ProductTitle";
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
import {
  chooseView,
  decidedView,
  matchedView,
  notFoundView,
  promptView,
  repinView,
  storedView,
  type MatchRepin,
  type MatchView,
} from "@/lib/services/match-view";
import { matchErrorMessage } from "@/lib/services/matches";
import { judge, orderChoice, pickMatch } from "@/lib/services/matching";
import { SHOP_LABELS, STALE_AFTER_MS, type MatchedShop, type PricedShop } from "@/lib/services/price-comparison";
import { parseSize } from "@/lib/services/size";
import { removalErrorMessage, removalGoneNotice } from "@/lib/services/watchlist";
import { shopUnavailableText } from "@/lib/shop-messages";
import type {
  CandidateOption,
  LatestPrice,
  MatchedItem,
  RepinnableMatch,
  ShopCandidate,
  ShopChoices,
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
const DAY = 24 * HOUR;
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

/** An online offer: a regular price, unless `extra` adds a promotion or makes it unorderable online. */
function offer(price: number, extra: Partial<ShopOffer> = {}): ShopOffer {
  return { price, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available: true, ...extra };
}

// Natura's promotion: its price, the regular one, its last day, and the lowest price of 30 days that Natura reports.
const NATURA_PROMO = offer(22.99, { regularPrice: 27.99, lowestPrice30d: 23.99, promoEndsOn: "2026-10-05" });
const NATURA_SKU = "NV10000";
// The product's made-up item in Hebe, whose ids are 18 digits; Hebe's real ones start with twelve zeros.
const HEBE_ITEM_ID = "990000000000000001";
// The product's made-up item in Super-Pharm, whose ids are digits, as its records' objectIDs are.
const SUPER_PHARM_ITEM_ID = "990001";

/** The item the page shows in a shop: the product's own in Rossmann, and its match in Natura, Hebe and Super-Pharm. */
function itemIn(shop: PricedShop): string {
  switch (shop) {
    case "rossmann":
      return PRODUCT.sourceItemId;
    case "natura":
      return NATURA_SKU;
    case "hebe":
      return HEBE_ITEM_ID;
    case "super-pharm":
      return SUPER_PHARM_ITEM_ID;
  }
}

/** A shop's row as the page hands it to the island: its item, the item's page, and its stored price or none. */
function row(shop: PricedShop, latest: LatestPrice | null): PriceComparisonShop {
  return { shop, shopItemId: itemIn(shop), productUrl: HERE, latest };
}

/** A shop's row whose last check found `price`, `ago` before the page was rendered. */
function priced(shop: PricedShop, price: ShopOffer, ago: number): PriceComparisonShop {
  const at = new Date(NOW_MS - ago).toISOString();
  const shopItemId = itemIn(shop);
  return row(shop, {
    shop,
    shopItemId,
    lastCheckedAt: at,
    lastStatus: "price",
    offer: { ...price, pricedAt: at },
    history: null,
  });
}

// Both shops checked in the last 15 minutes, so opening the page asks neither again. Natura's promotion is cheaper.
const ROSSMANN_CHECKED = priced("rossmann", offer(26.99), 10 * MINUTE);
const CHECKED = [ROSSMANN_CHECKED, priced("natura", NATURA_PROMO, 5 * MINUTE)];

// Both shops' refetches started, as "Odśwież ceny" starts them.
const REFETCH = [start("rossmann"), start("natura")];
const MISSING: RefreshResult = { kind: "missing", checkedAt: CHECKED_AT, saved: true };
const SESSION_ENDED: RefreshResult = { kind: "session-ended" };
const MATCH_CHANGED: RefreshResult = { kind: "match-changed" };

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

/** The product's item in Natura: the same EAN and size, and its brand in capitals, which the brand rule agrees with. */
const NATURA_ITEM: MatchedItem = {
  shopItemId: NATURA_SKU,
  brand: "PRZYKŁAD",
  name: "Krem nawilżający do twarzy i ciała",
  ...sized("300 ml"),
  eans: [EAN],
  productUrl: HERE,
  imageUrl: null,
};

/**
 * An item of another brand in Natura with the product's EAN and size: the matching rule leaves it to the user, while
 * before the brand rule a lookup accepted it on its own.
 */
const OTHER_BRAND_ITEM: MatchedItem = { ...NATURA_ITEM, shopItemId: "NV10003", brand: "WZÓR" };

// A decision stored for the product in Natura, at 21:45 in Poland on 27 September.
const DECISION = { watchlistItemId: PRODUCT_ID, shop: "natura", checkedAt: "2026-09-27T19:45:00.000Z" } as const;

// The product's match, found by its EAN and size, as it's stored: the re-pin's states open its choice.
const AUTO_MATCHED: RepinnableMatch = { ...DECISION, decidedBy: "auto", state: "matched", item: NATURA_ITEM };
// The user confirmed the candidate in another size (the first of CANDIDATES), so the match's size is flagged. Its
// re-pin's choice marks it without offering it again.
const CONFIRMED: RepinnableMatch = {
  ...DECISION,
  decidedBy: "user",
  state: "matched",
  item: { ...NATURA_ITEM, shopItemId: "NV10001", ...sized("200 ml") },
};
// A lookup accepted the item of another brand on its own before the brand rule, so the match's brand is flagged.
const AUTO_OTHER_BRAND: ShopMatch = { ...DECISION, decidedBy: "auto", state: "matched", item: OTHER_BRAND_ITEM };
const DECLINED: RepinnableMatch = { ...DECISION, decidedBy: "user", state: "unmatched", item: null };
const NOT_FOUND: ShopMatch = { ...DECISION, decidedBy: "auto", state: "not_found", item: null };

// The kitchen sink's product is opened from the whole list, so its views' links carry no filter. A stored decision's
// view is drawn as the page draws it before its choice is opened (REPINNING draws it with the choice open).
const LINKS = { filter: "all" } as const;
const REPINNING = { filter: "all", repinning: true } as const;

/** What a matched shop's view comes with, as a test sets it: a decision's notice and error, and an unsaved outcome. */
type ViewExtra = Partial<Omit<MatchedShopView, "shop" | "view">>;

/** Natura as the page hands it to the island, with this view and, unless `extra` adds them, no notices. */
function naturaOf(view: MatchView, extra: ViewExtra = {}): MatchedShopView {
  return { shop: "natura", view, notice: null, error: null, unsaved: false, ...extra };
}

/** Hebe as the page hands it to the island, with this view and, unless `extra` adds them, no notices. */
function hebeOf(view: MatchView, extra: ViewExtra = {}): MatchedShopView {
  return { shop: "hebe", view, notice: null, error: null, unsaved: false, ...extra };
}

/** Super-Pharm as the page hands it to the island, with this view and, unless `extra` adds them, no notices. */
function superPharmOf(view: MatchView, extra: ViewExtra = {}): MatchedShopView {
  return { shop: "super-pharm", view, notice: null, error: null, unsaved: false, ...extra };
}

/**
 * The island's state for `shops` beside the matched shops' views, as the island starts it from the page's props, at
 * NOW: a decision that couldn't be read keeps every shop from being named cheapest.
 */
function islandBeside(matched: MatchedShopView[], shops: PriceComparisonShop[]): PriceComparisonState {
  return initialState({ shops, now: NOW, unreadable: unreadableShopsOf(matched) });
}

// The product's stored match, found by its EAN and size, which every price state of the product area has but one.
const MATCHED = naturaOf(matchedView("natura", NATURA_ITEM, "auto", PRODUCT, LINKS));
// A Natura decision that couldn't be read.
const NATURA_UNREAD = naturaOf({ kind: "read-failed" });

/** The product's item in Hebe: the same EAN and size, its brand as Hebe writes it, and its legal name with the size. */
const HEBE_ITEM: MatchedItem = {
  shopItemId: HEBE_ITEM_ID,
  brand: "Przykład",
  name: "Przykład Krem nawilżający do twarzy i ciała, 300 ml",
  ...sized("300 ml"),
  eans: [EAN],
  productUrl: HERE,
  imageUrl: null,
};

// A decision stored for the product in Hebe, at the same time as Natura's.
const HEBE_DECISION = { ...DECISION, shop: "hebe" } as const;

// The product's match in Hebe, found by its EAN and size, as it's stored; its re-pin's state opens its choice.
const HEBE_AUTO_MATCHED: RepinnableMatch = { ...HEBE_DECISION, decidedBy: "auto", state: "matched", item: HEBE_ITEM };
// The user confirmed Hebe's item in another size (the first of HEBE_CANDIDATES), so the match's size is flagged.
const HEBE_CONFIRMED: RepinnableMatch = {
  ...HEBE_DECISION,
  decidedBy: "user",
  state: "matched",
  item: { ...HEBE_ITEM, shopItemId: "990000000000000002", ...sized("200 ml") },
};
const HEBE_DECLINED: RepinnableMatch = { ...HEBE_DECISION, decidedBy: "user", state: "unmatched", item: null };
const HEBE_NOT_FOUND: ShopMatch = { ...HEBE_DECISION, decidedBy: "auto", state: "not_found", item: null };

// Hebe's stored match, beside which the three shops' prices stand.
const HEBE_MATCHED = hebeOf(matchedView("hebe", HEBE_ITEM, "auto", PRODUCT, LINKS));
// Hebe declined by the user: the Hebe every state of Natura stands beside, with no price row and no wait.
const HEBE_DECLINED_VIEW = hebeOf(storedView("hebe", HEBE_DECLINED, PRODUCT, LINKS));
// A Hebe decision that couldn't be read.
const HEBE_UNREAD = hebeOf({ kind: "read-failed" });

/**
 * The product's item in Super-Pharm: its size and brand, as Super-Pharm writes them, a name of only the product's
 * words, its brand's and the packaging's, and no EAN, which Super-Pharm's index doesn't hold, so the matching rule
 * accepts it by its name.
 */
const SUPER_PHARM_ITEM: MatchedItem = {
  shopItemId: SUPER_PHARM_ITEM_ID,
  brand: "Przykład",
  name: "Przykład Krem nawilżający do twarzy i ciała (Pudełko)",
  ...sized("300 ml"),
  eans: [],
  productUrl: HERE,
  imageUrl: null,
};

// A decision stored for the product in Super-Pharm, at the same time as Natura's.
const SUPER_PHARM_DECISION = { ...DECISION, shop: "super-pharm" } as const;

// The rule's match in Super-Pharm, accepted by the item's name, as it's stored: it shares no EAN with the product. Its
// re-pin's state opens its choice.
const SUPER_PHARM_AUTO_MATCHED: RepinnableMatch = {
  ...SUPER_PHARM_DECISION,
  decidedBy: "auto",
  state: "matched",
  item: SUPER_PHARM_ITEM,
};
// The user's pick in Super-Pharm, as it's stored; its re-pin's state opens its choice.
const SUPER_PHARM_PICKED: RepinnableMatch = {
  ...SUPER_PHARM_DECISION,
  decidedBy: "user",
  state: "matched",
  item: SUPER_PHARM_ITEM,
};
const SUPER_PHARM_DECLINED: RepinnableMatch = {
  ...SUPER_PHARM_DECISION,
  decidedBy: "user",
  state: "unmatched",
  item: null,
};
const SUPER_PHARM_NOT_FOUND: ShopMatch = { ...SUPER_PHARM_DECISION, decidedBy: "auto", state: "not_found", item: null };

// Super-Pharm's stored match, beside which the four shops' prices stand.
const SUPER_PHARM_MATCHED = superPharmOf(storedView("super-pharm", SUPER_PHARM_PICKED, PRODUCT, LINKS));
// Super-Pharm declined by the user: the Super-Pharm every state of Natura and of three shops stands beside, with no
// price row and no wait.
const SUPER_PHARM_DECLINED_VIEW = superPharmOf(storedView("super-pharm", SUPER_PHARM_DECLINED, PRODUCT, LINKS));
// Super-Pharm with no decision on a page that may not look it up, one opened from a link or for another shop's choice
// or retry: its card's button, which leads to the plain page, as Natura's and Hebe's do. The user's own navigation to
// the plain page looks Super-Pharm up by name.
const SUPER_PHARM_PROMPT = superPharmOf(promptView("super-pharm", PRODUCT, false, "all"));

/** A matched shop's choice below the island: its first candidates, or the ones that change its stored decision. */
export interface ShopChoice {
  shop: MatchedShop;
  view: Extract<MatchView, { kind: "choose" }> | MatchRepin;
}

/** One state of the product area, with the kitchen sink's label for it: the island's state and the product it's for. */
export interface PriceFixture {
  code: string;
  text: string;
  state: PriceComparisonState;
  /** The product the title names. */
  product: TitleProduct;
  /**
   * The matched shops as the page read them, Natura, Hebe and Super-Pharm: each one's card among the shops', and, still
   * to match, what the hero and the hint say.
   */
  matched: MatchedShopView[];
  /** The choices the page's sections below the island hold, in the shops' order, while each card points to its own. */
  choices: ShopChoice[];
}

/**
 * One state of the product area as the fixtures below write it: Natura, Hebe and Super-Pharm as the page read them,
 * Hebe and Super-Pharm declined unless the state gives them, the choices below the island, none unless the state gives
 * them, and the product, the made-up one unless the state names another.
 */
type AreaState = Omit<PriceFixture, "product" | "matched" | "choices"> & {
  natura: MatchedShopView;
  hebe?: MatchedShopView;
  superPharm?: MatchedShopView;
  choices?: ShopChoice[];
  product?: TitleProduct;
};

/**
 * The product area's fixture for one written state: Natura, Hebe and Super-Pharm as the matched shops, in the page's
 * order, and the state's product.
 */
function areaFixture({
  natura,
  hebe = HEBE_DECLINED_VIEW,
  superPharm = SUPER_PHARM_DECLINED_VIEW,
  choices = [],
  product = PRODUCT,
  ...fixture
}: AreaState): PriceFixture {
  return { ...fixture, product, matched: [natura, hebe, superPharm], choices };
}

// The island's states for the made-up product, whose Natura match is stored, so Natura has its price row.
const PRICE_STATES: AreaState[] = [
  {
    code: "cheapest",
    text: "Natura najtańsza, w promocji: z ceną regularną, końcem promocji i najniższą ceną z 30 dni",
    state: island(CHECKED),
    natura: MATCHED,
  },
  {
    code: "tie",
    text: "ta sama cena w obu sklepach: oba oznaczone",
    state: island([priced("rossmann", offer(24.99), 10 * MINUTE), priced("natura", offer(24.99), 5 * MINUTE)]),
    natura: MATCHED,
  },
  {
    code: "stale",
    text: "cena Rossmanna sprzed ponad 24 godzin: niższa, ale nieaktualna, więc wygrywa Natura",
    state: island([
      priced("rossmann", offer(21.99), STALE_AFTER_MS + 2 * HOUR),
      priced("natura", NATURA_PROMO, 5 * MINUTE),
    ]),
    natura: MATCHED,
  },
  {
    code: "all-stale",
    text: "obie ceny sprzed ponad 24 godzin: najniższa ostatnia znana, a żaden sklep nie jest nazwany",
    state: island([
      priced("rossmann", offer(26.99), STALE_AFTER_MS + 2 * HOUR),
      priced("natura", offer(22.99), STALE_AFTER_MS + 5 * HOUR),
    ]),
    natura: MATCHED,
  },
  {
    code: "promo-ended",
    text: "promocja Rossmanna skończyła się wczoraj: jej cena jest nieaktualna, więc wygrywa Natura",
    state: island([
      priced("rossmann", offer(19.99, { regularPrice: 24.99, promoEndsOn: "2026-09-28" }), 10 * MINUTE),
      priced("natura", offer(22.99), 5 * MINUTE),
    ]),
    natura: MATCHED,
  },
  {
    code: "not-orderable",
    text: "Natury nie da się zamówić online: jej niższa cena nie wygrywa",
    state: island([ROSSMANN_CHECKED, priced("natura", offer(19.99, { available: false }), 5 * MINUTE)]),
    natura: MATCHED,
  },
  {
    code: "all-unavailable",
    text: "żadnego sklepu nie da się zamówić online: najniższa cena, bez oznaczenia",
    state: island([
      priced("rossmann", offer(26.99, { available: false }), 10 * MINUTE),
      priced("natura", offer(22.99, { available: false }), 5 * MINUTE),
    ]),
    natura: MATCHED,
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
    natura: MATCHED,
  },
  {
    code: "missing-without-price",
    text: "Natura nie zwraca produktu, a ceny wcześniej nie było",
    state: island([ROSSMANN_CHECKED, row("natura", null)], start("natura"), done("natura", MISSING, ANSWERED_AT)),
    natura: MATCHED,
  },
  {
    code: "never-checked",
    text: "Natura jeszcze niesprawdzona",
    state: island([ROSSMANN_CHECKED, row("natura", null)]),
    natura: MATCHED,
  },
  {
    code: "refreshing",
    text: "oba sklepy w trakcie odświeżania, przy cenach z cheapest",
    state: island(CHECKED, ...REFETCH),
    natura: MATCHED,
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
    natura: MATCHED,
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
    natura: MATCHED,
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
    natura: MATCHED,
  },
  {
    code: "match-changed",
    text: "dopasowanie w Naturze zmieniono w innej karcie: cena Natury zostaje, a strona prosi o odświeżenie",
    // "Odśwież ceny" on a page left open: Rossmann answers, while Natura's stored match is no longer the page's item.
    state: island(
      CHECKED,
      ...REFETCH,
      done("rossmann", { kind: "price", offer: offer(26.99), checkedAt: CHECKED_AT, saved: true }, ANSWERED_AT),
      done("natura", MATCH_CHANGED, ANSWERED_AT),
    ),
    natura: MATCHED,
  },
  {
    code: "read-failed",
    text: "nie udało się wczytać zapisanych cen",
    state: unread(),
    natura: MATCHED,
  },
  {
    code: "read-failed-one-answered",
    text: "po odpowiedzi Natury: jej wiersz ma cenę, ale bez „Najtaniej”, bo Rossmann wciąż się odświeża",
    state: unread(
      ...REFETCH,
      done("natura", { kind: "price", offer: NATURA_PROMO, checkedAt: CHECKED_AT, saved: true }, ANSWERED_AT),
    ),
    natura: MATCHED,
  },
  {
    code: "read-failed-one-shop",
    text: "nie udało się odczytać zapisanej ceny Natury: Rossmann ma cenę, ale bez „Najtaniej”, dopóki Natura nie odpowie",
    // The page read the stored prices, but Natura's row came back odd, so it hands that shop over unread.
    state: island([ROSSMANN_CHECKED, { ...row("natura", null), readFailed: true }]),
    natura: MATCHED,
  },
];

export const PRICE_FIXTURES: PriceFixture[] = PRICE_STATES.map(areaFixture);

/** One of the design handoff's sample products: no photo, so its title shows its brand's tile. */
function sample(brand: string, name: string, caption: string, sizeText: string, addedOn: string): TitleProduct {
  return { brand, name, caption, sizeText, imageUrl: null, addedAt: `${addedOn}T08:00:00.000Z` };
}

/**
 * The handoff's samples (context/changes/etykiety-redesign/design-captures/2a-*, 2b-*), as the rules judge them: Nivea
 * cheapest in Natura on a promotion, Ziaja only in Rossmann with Natura still to match, and Colgate's stale price.
 * Natura sends no promotion's end, so Nivea's promotion has none, and Ziaja's price is 3 hours old, since the
 * handoff's "wczoraj" would be stale by the 24-hour rule. Colgate's Natura was declined, so it has no Natura row. Their
 * Natura cards lead to the made-up product, whose page answers 404 before any lookup.
 */
const HANDOFF_STATES: AreaState[] = [
  {
    code: "nivea",
    text: "próbka z projektu: Natura najtańsza, w promocji, z najniższą ceną z 30 dni, bez końca promocji",
    state: island([
      priced("rossmann", offer(26.99), 10 * MINUTE),
      priced("natura", offer(22.99, { regularPrice: 27.99, lowestPrice30d: 23.99 }), 5 * MINUTE),
    ]),
    product: sample("Nivea", "Soft", "krem intensywnie nawilżający", "300 ml", "2026-09-20"),
    natura: MATCHED,
  },
  {
    code: "ziaja",
    text: "próbka z projektu: jedna cena, w Rossmannie, sprzed 3 godzin, a Natura czeka na dopasowanie",
    state: island([priced("rossmann", offer(12.99), 3 * HOUR)]),
    product: sample("Ziaja", "Mleczko do ciała", "kozie mleko", "400 ml", "2026-09-24"),
    natura: naturaOf(promptView("natura", PRODUCT, false, "all")),
  },
  {
    code: "colgate",
    text: "próbka z projektu: cena Rossmanna sprzed 2 dni, z najniższą ceną z 30 dni; Natura odrzucona",
    state: island([priced("rossmann", offer(11.49, { lowestPrice30d: 10.99 }), 2 * DAY)]),
    product: sample("Colgate", "Total", "pasta do zębów", "75 ml", "2026-09-26"),
    natura: naturaOf(storedView("natura", DECLINED, PRODUCT, LINKS)),
  },
];

export const HANDOFF_FIXTURES: PriceFixture[] = HANDOFF_STATES.map(areaFixture);

// What Natura's search by the product's EAN returned. The only one that shares both the EAN and the size is of
// another brand, so the matching rule leaves the choice to the user, and between them the candidates carry every flag
// one can have. The rule offers at most three.
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
  // The same EAN and size, of another brand, without a price that can be stored.
  { ...OTHER_BRAND_ITEM, shop: "natura", offer: null },
];

/** The options the matching rule leaves to the user for these candidates, as a lookup hands them to the page. */
function leftToUser(candidates: ShopCandidate[]): CandidateOption[] {
  const pick = pickMatch(PRODUCT, candidates);
  if (pick.kind !== "choose") {
    // The page never offers a choice the rule settles itself, so neither does the kitchen sink.
    throw new Error(`The kitchen sink's candidates must be left to the user; the rule answered ${pick.kind}.`);
  }
  return pick.options;
}

// What Natura's two searches found again when the user opened the choice to change the decision: by the product's EAN,
// the matched item, the one in another size and the one of another brand; by its name, the set as well.
const FOUND_BY_EAN: ShopCandidate[] = [
  { ...NATURA_ITEM, shop: "natura", offer: NATURA_PROMO },
  ...CANDIDATES.filter((candidate) => candidate.eans.includes(EAN)),
];
const FOUND_BY_NAME: ShopCandidate[] = CANDIDATES.filter((candidate) => !candidate.eans.includes(EAN));

/** The candidates judged by the matching rule, as the choice's lookup offers them, none accepted on its own. */
function judged(candidates: ShopCandidate[]): CandidateOption[] {
  return candidates.map((candidate) => ({ candidate, verdict: judge(PRODUCT, candidate) }));
}

// The choice from both searches, from the EAN search alone after a name search Natura was too busy to answer, from
// searches that found nothing, and from an EAN search Natura refused.
const FOUND_BY_BOTH: ShopChoices = {
  kind: "choices",
  options: judged([...FOUND_BY_EAN, ...FOUND_BY_NAME]),
  via: "both",
  incomplete: null,
};
const NAME_SEARCH_BUSY: ShopChoices = {
  kind: "choices",
  options: judged(FOUND_BY_EAN),
  via: "ean",
  incomplete: { kind: "unavailable", reason: "busy" },
};
const NOTHING_FOUND: ShopChoices = { kind: "not-found" };
const NATURA_STOPPED: ShopChoices = { kind: "unavailable", reason: "stopped" };

/** The choice that changes a stored decision, as the page builds it once Natura's searches have answered. */
function repinOf(choices: ShopChoices, current: RepinnableMatch): MatchRepin {
  return repinView("natura", choices, current, new Date(NOW), PRODUCT, "all");
}

// The product's match with its choice open: the card points below and offers "Anuluj", and keeps its price row.
const MATCHED_REPINNING = naturaOf(storedView("natura", AUTO_MATCHED, PRODUCT, REPINNING));

/**
 * One state of Natura, with the kitchen sink's label, the prefix that keeps its choice's ids its own, Natura as the
 * page hands it to the island, the island's state beside it, Rossmann's price, with Natura's while its match is saved,
 * and, while the user changes a stored decision, the choice below the cards.
 */
export interface NaturaFixture {
  code: string;
  text: string;
  idPrefix: string;
  natura: MatchedShopView;
  state: PriceComparisonState;
  repin?: MatchRepin;
}

// Only Rossmann's price: Natura has none while its match isn't saved.
const ROSSMANN_ONLY = island([ROSSMANN_CHECKED]);

export const NATURA_FIXTURES: NaturaFixture[] = [
  {
    code: "matched",
    text: "dopasowane automatycznie, zaraz po wyszukaniu: stopka nazywa pozycję z Natury, bez ostrzeżeń, z „Zmień”",
    idPrefix: "natura-auto",
    natura: MATCHED,
    state: island(CHECKED),
  },
  {
    code: "matched + unsaved",
    text: "dopasowane automatycznie, ale zapis się nie udał: bez wiersza ceny karta pokazuje pozycję z Natury, bez „Zmień”",
    idPrefix: "natura-auto-unsaved",
    natura: naturaOf(matchedView("natura", NATURA_ITEM, "auto", PRODUCT, { ...LINKS, unsaved: true }), {
      unsaved: true,
    }),
    state: ROSSMANN_ONLY,
  },
  {
    code: "matched + notice",
    text: "potwierdzone przez Ciebie w innym rozmiarze, zaraz po zapisie: stopka ostrzega o rozmiarze",
    idPrefix: "natura-confirmed",
    // The page's notice for `?matched`.
    natura: naturaOf(storedView("natura", CONFIRMED, PRODUCT, LINKS), { notice: DECISION_NOTICES.matched }),
    state: island([ROSSMANN_CHECKED, priced("natura", offer(17.99), 5 * MINUTE)]),
  },
  {
    code: "matched + brand",
    text: "dopasowane automatycznie, zanim porównywano marki: stopka ostrzega o innej marce",
    idPrefix: "natura-other-brand",
    natura: naturaOf(storedView("natura", AUTO_OTHER_BRAND, PRODUCT, LINKS)),
    state: island([ROSSMANN_CHECKED, priced("natura", offer(21.99), 5 * MINUTE)]),
  },
  {
    code: "matched + repin",
    text: "po „Zmień”: karta ma „Anuluj”, a wybór z obu wyszukiwań oznacza obecne, automatyczne dopasowanie i daje je potwierdzić",
    idPrefix: "natura-repin",
    natura: MATCHED_REPINNING,
    state: island(CHECKED),
    repin: repinOf(FOUND_BY_BOTH, AUTO_MATCHED),
  },
  {
    code: "confirmed + repin",
    text: "po „Zmień” przy dopasowaniu potwierdzonym przez Ciebie: wybór oznacza je, ale nie daje go potwierdzić ponownie",
    idPrefix: "natura-confirmed-repin",
    natura: naturaOf(storedView("natura", CONFIRMED, PRODUCT, REPINNING)),
    state: island([ROSSMANN_CHECKED, priced("natura", offer(17.99), 5 * MINUTE)]),
    repin: repinOf(FOUND_BY_BOTH, CONFIRMED),
  },
  {
    code: "repin + incomplete",
    text: "po „Zmień”: wyszukiwanie po nazwie się nie udało, więc wybór ma tylko kandydatów znalezionych po EAN",
    idPrefix: "natura-repin-incomplete",
    natura: MATCHED_REPINNING,
    state: island(CHECKED),
    repin: repinOf(NAME_SEARCH_BUSY, AUTO_MATCHED),
  },
  {
    code: "repin + not found",
    text: "po „Zmień”: oba wyszukiwania nic nie znalazły; zostają „Żaden z nich” i „Anuluj”",
    idPrefix: "natura-repin-not-found",
    natura: MATCHED_REPINNING,
    state: island(CHECKED),
    repin: repinOf(NOTHING_FOUND, AUTO_MATCHED),
  },
  {
    code: "repin + unavailable",
    text: "po „Zmień”: Natura zablokowała zapytania; wybór to mówi, a „Żaden z nich” wciąż odrzuca dopasowanie",
    idPrefix: "natura-repin-unavailable",
    natura: MATCHED_REPINNING,
    state: island(CHECKED),
    repin: repinOf(NATURA_STOPPED, AUTO_MATCHED),
  },
  {
    code: "unmatched",
    text: "odrzucone przez Ciebie, z „Dopasuj ponownie”",
    idPrefix: "natura-declined",
    natura: naturaOf(storedView("natura", DECLINED, PRODUCT, LINKS)),
    state: ROSSMANN_ONLY,
  },
  {
    code: "unmatched + repin",
    text: "po „Dopasuj ponownie”: karta wskazuje wybór poniżej, a wybór nie ma „Żaden z nich”, tylko „Anuluj”",
    idPrefix: "natura-declined-repin",
    natura: naturaOf(storedView("natura", DECLINED, PRODUCT, REPINNING)),
    state: ROSSMANN_ONLY,
    repin: repinOf(FOUND_BY_BOTH, DECLINED),
  },
  {
    code: "not-found",
    text: "zapisane „nie znaleziono”",
    idPrefix: "natura-not-found",
    natura: naturaOf(storedView("natura", NOT_FOUND, PRODUCT, LINKS)),
    state: ROSSMANN_ONLY,
  },
  {
    code: "choose + error",
    text: "kandydaci znalezieni po EAN, po nieudanym zapisie wyboru",
    idPrefix: "natura-choose",
    natura: naturaOf(chooseView("natura", leftToUser(CANDIDATES), "ean", new Date(NOW), PRODUCT), {
      error: matchErrorMessage("failed"),
    }),
    state: ROSSMANN_ONLY,
  },
  {
    code: "unavailable",
    text: "wyszukiwarka Natury zajęta",
    idPrefix: "natura-unavailable",
    natura: naturaOf({ kind: "unavailable", message: shopUnavailableText(SHOP_LABELS.natura.name, "busy") }),
    state: ROSSMANN_ONLY,
  },
  {
    code: "prompt",
    text: "strona otwarta z linku: przycisk zamiast wyszukiwania",
    idPrefix: "natura-prompt",
    natura: naturaOf(promptView("natura", PRODUCT, false, "all")),
    state: ROSSMANN_ONLY,
  },
  {
    code: "decided",
    text: "inna karta zapisała decyzję w międzyczasie",
    idPrefix: "natura-decided",
    natura: naturaOf(decidedView(PRODUCT, "all")),
    state: ROSSMANN_ONLY,
  },
  {
    code: "read-failed",
    text: "nie udało się wczytać zapisanej decyzji",
    idPrefix: "natura-read-failed",
    natura: NATURA_UNREAD,
    state: islandBeside([NATURA_UNREAD], [ROSSMANN_CHECKED]),
  },
  {
    code: "not-found + unsaved",
    text: "świeże „nie znaleziono”, którego nie udało się zapisać",
    idPrefix: "natura-unsaved",
    natura: naturaOf(notFoundView("natura", new Date(NOW), PRODUCT, "all"), { unsaved: true }),
    state: ROSSMANN_ONLY,
  },
];

/** The view of candidates left to the user, which is a choice among them. */
function choiceOf(view: MatchView): Extract<MatchView, { kind: "choose" }> {
  if (view.kind !== "choose") {
    throw new Error(`The kitchen sink's candidates must make a choice; the view is ${view.kind}.`);
  }
  return view;
}

// Natura's candidates to choose from, as the page's view holds them for the choice below the island; the island's card
// gets the view without them.
const CHOICE = choiceOf(chooseView("natura", leftToUser(CANDIDATES), "ean", new Date(NOW), PRODUCT));

// Rossmann's price alone: without a saved match Natura has no price row, so every other kind of Natura stands here, each
// beside one of Rossmann's states, and every state of Rossmann's price stands beside one of them. The rules tell those
// kinds apart only as still to match (prompt, choose, unavailable), decided (unmatched, not-found, decided, a match
// that wasn't saved) and unreadable (read-failed): a state looks the same beside another kind of its group, but for
// Natura's own card, which the Natura section shows in every kind.
const ALONE_STATES: AreaState[] = [
  {
    code: "lone",
    text: "jeden sklep, Natura odrzucona: nie ma z czym porównać, więc bez oznaczenia",
    state: island([ROSSMANN_CHECKED]),
    natura: naturaOf(storedView("natura", DECLINED, PRODUCT, LINKS)),
  },
  {
    code: "lone-promo",
    text: "jeden sklep w promocji do 05.10, z ceną regularną; Natura odrzucona",
    state: island([priced("rossmann", offer(22.49, { regularPrice: 26.99, promoEndsOn: "2026-10-05" }), 10 * MINUTE)]),
    natura: naturaOf(storedView("natura", DECLINED, PRODUCT, LINKS)),
  },
  {
    code: "lone-not-orderable",
    text: "jeden sklep, bez zamówienia online; wyszukiwarka Natury zajęta",
    state: island([priced("rossmann", offer(26.99, { available: false }), 10 * MINUTE)]),
    natura: naturaOf({ kind: "unavailable", message: shopUnavailableText(SHOP_LABELS.natura.name, "busy") }),
  },
  {
    code: "lone-missing-with-price",
    text: "Rossmann nie zwraca już produktu: jego ostatnia cena zostaje ze swoim wiekiem; Natura go nie znalazła",
    state: island(
      [priced("rossmann", offer(26.99), 3 * HOUR)],
      start("rossmann"),
      done("rossmann", MISSING, ANSWERED_AT),
    ),
    natura: naturaOf(storedView("natura", NOT_FOUND, PRODUCT, LINKS)),
  },
  {
    code: "lone-missing-without-price",
    text: "Rossmann nie zwraca produktu, a ceny wcześniej nie było; decyzję Natury zapisała w międzyczasie inna karta",
    state: island([row("rossmann", null)], start("rossmann"), done("rossmann", MISSING, ANSWERED_AT)),
    natura: naturaOf(decidedView(PRODUCT, "all")),
  },
  {
    code: "lone-never-checked",
    text: "świeżo dodany: Rossmann jeszcze niesprawdzony, a kandydaci Natury czekają na wybór pod kartami",
    state: island([row("rossmann", null)]),
    natura: naturaOf({ ...CHOICE, options: [] }),
    choices: [{ shop: "natura", view: CHOICE }],
  },
  {
    code: "lone-refreshing",
    text: "Rossmann w trakcie odświeżania; Natura czeka na dopasowanie",
    state: island([ROSSMANN_CHECKED], start("rossmann")),
    natura: naturaOf(promptView("natura", PRODUCT, false, "all")),
  },
  {
    code: "lone-notice",
    text: "Rossmann prosi o przerwę: ostatnia cena zostaje; Natura odrzucona",
    state: island(
      [ROSSMANN_CHECKED],
      start("rossmann"),
      done("rossmann", { kind: "unavailable", reason: "paused", until: PAUSED_UNTIL }, ANSWERED_AT),
    ),
    natura: naturaOf(storedView("natura", DECLINED, PRODUCT, LINKS)),
  },
  {
    code: "lone-read-failed",
    text: "nie udało się wczytać zapisanych cen, a dopasowania Natury nie udało się zapisać, więc nie ma jej ceny",
    state: initialState({ shops: [row("rossmann", null)], now: NOW, pricesFailed: true }),
    natura: naturaOf(matchedView("natura", NATURA_ITEM, "auto", PRODUCT, { ...LINKS, unsaved: true }), {
      unsaved: true,
    }),
  },
  {
    code: "lone-read-failed-row",
    text: "nie udało się odczytać zapisanej ceny Rossmanna; Natura czeka na dopasowanie",
    state: island([{ ...row("rossmann", null), readFailed: true }]),
    natura: naturaOf(promptView("natura", PRODUCT, false, "all")),
  },
  {
    code: "natura-read-failed",
    text: "nie udało się wczytać decyzji Natury: świeża cena Rossmanna, ale żaden sklep nie jest nazwany",
    // Without the decision there's no Natura row, and a match it hides could name a lower price.
    state: islandBeside([NATURA_UNREAD], [ROSSMANN_CHECKED]),
    natura: NATURA_UNREAD,
  },
];

export const ALONE_FIXTURES: PriceFixture[] = ALONE_STATES.map(areaFixture);

// What Hebe's search by the product's name returned besides its item. None shares both the EAN and the size without a
// brand that differs, so the matching rule leaves the choice to the user.
const HEBE_CANDIDATES: ShopCandidate[] = [
  // The same EAN in another size.
  {
    ...HEBE_ITEM,
    shop: "hebe",
    shopItemId: "990000000000000002",
    name: "Przykład Krem nawilżający do twarzy i ciała, 200 ml",
    ...sized("200 ml"),
    imageUrl: "/favicon.png",
    offer: offer(18.49),
  },
  // Another EAN, in the product's size, on promotion.
  {
    ...HEBE_ITEM,
    shop: "hebe",
    shopItemId: "990000000000000003",
    name: "Przykład Krem nawilżający z witaminą E, 300 ml",
    eans: ["2000000000025"],
    offer: offer(24.99, { regularPrice: 29.99 }),
  },
  // The same EAN and size, of another brand, which Hebe doesn't sell online just now.
  {
    ...HEBE_ITEM,
    shop: "hebe",
    shopItemId: "990000000000000004",
    brand: "Wzór",
    name: "Wzór Krem nawilżający, 300 ml",
    offer: offer(21.99, { available: false }),
  },
];

// Hebe's candidates to choose from, found by the product's name, as the page's view holds them for Hebe's choice below
// the island; Hebe's card gets the view without them.
const HEBE_CHOICE = choiceOf(chooseView("hebe", leftToUser(HEBE_CANDIDATES), "name", new Date(NOW), PRODUCT));

// What Hebe's two searches found again when the user opened the choice to change its match: its item, then the rest.
const HEBE_FOUND_BY_BOTH: ShopChoices = {
  kind: "choices",
  options: judged([{ ...HEBE_ITEM, shop: "hebe", offer: offer(24.99) }, ...HEBE_CANDIDATES]),
  via: "both",
  incomplete: null,
};

// Rossmann's and Natura's prices beside Hebe's 24,99 zł, all three checked in the last 15 minutes: Natura is cheapest.
const CHECKED_WITH_HEBE = [...CHECKED, priced("hebe", offer(24.99), 5 * MINUTE)];

/**
 * The three shops' states: every one beside Natura's stored match and its price, except where both matched shops wait
 * for their match, and the choices below the island, a re-pin's beside Hebe's button, and two first choices at once.
 */
const THREE_SHOP_STATES: AreaState[] = [
  {
    code: "three-cheapest",
    text: "trzy sklepy, Hebe najtańsza: „Najtaniej” tylko na jej karcie, a hero mówi „w Hebe”",
    state: island([
      priced("rossmann", offer(19.99), 10 * MINUTE),
      priced("natura", offer(17.49), 5 * MINUTE),
      priced("hebe", offer(16.99), 5 * MINUTE),
    ]),
    natura: MATCHED,
    hebe: HEBE_MATCHED,
  },
  {
    code: "three-tie",
    text: "ta sama cena w trzech sklepach: jeden podpis na pasku, z trzema nazwami i ceną, a znaczniki stoją obok siebie",
    state: island([
      priced("rossmann", offer(24.99), 10 * MINUTE),
      priced("natura", offer(24.99), 5 * MINUTE),
      priced("hebe", offer(24.99), 5 * MINUTE),
    ]),
    natura: MATCHED,
    hebe: HEBE_MATCHED,
  },
  {
    code: "three-two-tied",
    text: "Rossmann i Natura w tej samej cenie, Hebe tuż obok: trzy podpisy się nie mieszczą, więc jeden mówi „od” najniższej",
    state: island([
      priced("rossmann", offer(19.99), 10 * MINUTE),
      priced("natura", offer(19.99, { lowestPrice30d: 15.99 }), 5 * MINUTE),
      priced("hebe", offer(20.49), 5 * MINUTE),
    ]),
    natura: MATCHED,
    hebe: HEBE_MATCHED,
  },
  {
    code: "three-roomy",
    text: "trzy ceny blisko siebie, ale z miejscem: skrajne podpisy odwrócone od środkowego",
    state: island([
      priced("rossmann", offer(19.99), 10 * MINUTE),
      priced("natura", offer(17.99), 5 * MINUTE),
      priced("hebe", offer(15.99, { lowestPrice30d: 13.99 }), 5 * MINUTE),
    ]),
    natura: MATCHED,
    hebe: HEBE_MATCHED,
  },
  {
    code: "three-hebe-stale",
    text: "cena Hebe sprzed 2 dni: najniższa, ale nieaktualna, więc wygrywa Natura",
    state: island([
      priced("rossmann", offer(19.99), 10 * MINUTE),
      priced("natura", offer(17.49), 5 * MINUTE),
      priced("hebe", offer(15.99), 2 * DAY),
    ]),
    natura: MATCHED,
    hebe: HEBE_MATCHED,
  },
  {
    code: "three-hebe-read-failed",
    text: "nie udało się wczytać decyzji Hebe: świeże ceny Rossmanna i Natury, ale żaden sklep nie jest nazwany",
    // Without the decision there's no Hebe row, and a match it hides could name a lower price.
    state: islandBeside([MATCHED, HEBE_UNREAD], CHECKED),
    natura: MATCHED,
    hebe: HEBE_UNREAD,
  },
  {
    code: "three-waiting",
    text: "jedna cena, w Rossmannie, a Natura i Hebe czekają na dopasowanie: hero i podpowiedź nazywają oba sklepy",
    state: island([ROSSMANN_CHECKED]),
    natura: naturaOf(promptView("natura", PRODUCT, false, "all")),
    hebe: hebeOf(promptView("hebe", PRODUCT, false, "all")),
  },
  {
    code: "three-natura-repin",
    text: "po „Zmień” w Naturze: wybór Natury otwarty, a Hebe bez decyzji ma tylko przycisk, bo strona jej nie szuka",
    state: island(CHECKED),
    natura: MATCHED_REPINNING,
    hebe: hebeOf(promptView("hebe", PRODUCT, false, "all")),
    choices: [{ shop: "natura", view: repinOf(FOUND_BY_BOTH, AUTO_MATCHED) }],
  },
  {
    code: "three-two-choices",
    text: "świeżo dodany: kandydaci Natury i Hebe czekają na wybór, dwie sekcje pod kartami",
    state: island([row("rossmann", null)]),
    natura: naturaOf({ ...CHOICE, options: [] }),
    hebe: hebeOf({ ...HEBE_CHOICE, options: [] }),
    choices: [
      { shop: "natura", view: CHOICE },
      { shop: "hebe", view: HEBE_CHOICE },
    ],
  },
];

export const THREE_SHOP_FIXTURES: PriceFixture[] = THREE_SHOP_STATES.map(areaFixture);

// What Super-Pharm's one search, by the product's name, returned when the user opened the product, in Super-Pharm's
// order. None shares the product's EAN, since Super-Pharm's index holds none, so the matching rule accepts only by its
// name check: the product's item, the one whose name holds nothing the product's lacks.
const SUPER_PHARM_FOUND: ShopCandidate[] = [
  // Another size, of the product's brand, which Super-Pharm lists first.
  {
    ...SUPER_PHARM_ITEM,
    shop: "super-pharm",
    shopItemId: "990002",
    name: "Przykład Krem nawilżający do twarzy i ciała (Tubka)",
    ...sized("100 ml"),
    imageUrl: "/favicon.png",
    offer: offer(9.99, { lowestPrice30d: 9.49 }),
  },
  // The product's item, of its size and brand, on sale without its regular price, which Super-Pharm's record leaves out.
  { ...SUPER_PHARM_ITEM, shop: "super-pharm", offer: offer(19.49, { lowestPrice30d: 33.99 }) },
  // A sibling in the product's size and brand, whose name adds a sun filter the product's lacks: another product.
  {
    ...SUPER_PHARM_ITEM,
    shop: "super-pharm",
    shopItemId: "990004",
    name: "Przykład Krem nawilżający do twarzy i ciała SPF 30 (Pudełko)",
    offer: offer(24.99),
  },
  // Another brand, in the product's size, which Super-Pharm sells only in its shops just now.
  {
    ...SUPER_PHARM_ITEM,
    shop: "super-pharm",
    shopItemId: "990003",
    brand: "Wzór",
    name: "Wzór Krem nawilżający",
    offer: offer(17.99, { available: false }),
  },
];

// The same search's other items, which the matching rule leaves to the user, as a search without the product's item
// would bring them: the sibling first, the best name fit in the product's size and brand, then the rest.
const SUPER_PHARM_CANDIDATES = SUPER_PHARM_FOUND.filter(({ shopItemId }) => shopItemId !== SUPER_PHARM_ITEM_ID);

// Super-Pharm's candidates to choose from when its lookup on the product's opening accepts none, as the page's view
// holds them for its choice below the island; Super-Pharm's card gets the view without them.
const SUPER_PHARM_CHOICE = choiceOf(
  chooseView("super-pharm", leftToUser(SUPER_PHARM_CANDIDATES), "name", new Date(NOW), PRODUCT),
);

// What Super-Pharm's search by name found again when the user opened the choice to change its match: every item, in
// the choice's order, the best name fit first, as the re-pin's lookup offers them in a shop whose search can't find an
// EAN (orderChoice). The choice marks the current match.
const SUPER_PHARM_FOUND_BY_NAME: ShopChoices = {
  kind: "choices",
  options: orderChoice(PRODUCT, SUPER_PHARM_FOUND),
  via: "name",
  incomplete: null,
};

/**
 * The four shops' states: Super-Pharm, matched by the user's pick, the cheapest, and one price in all four; then the
 * states of a Super-Pharm still to match: its button, on a page opened from a link, beside Rossmann's price alone and
 * beside three shops still to match, and its first choice open below the island, when its lookup on the product's
 * opening accepts none.
 */
const FOUR_SHOP_STATES: AreaState[] = [
  {
    code: "four-cheapest",
    text: "cztery sklepy, Super-Pharm najtańszy: „Najtaniej” tylko na jego karcie, a hero mówi „w Super-Pharmie”",
    state: island([
      priced("rossmann", offer(19.99), 10 * MINUTE),
      priced("natura", offer(17.49), 5 * MINUTE),
      priced("hebe", offer(16.99), 5 * MINUTE),
      priced("super-pharm", offer(15.49, { lowestPrice30d: 14.99 }), 5 * MINUTE),
    ]),
    natura: MATCHED,
    hebe: HEBE_MATCHED,
    superPharm: SUPER_PHARM_MATCHED,
  },
  {
    code: "four-tie",
    text: "ta sama cena w czterech sklepach: jeden podpis na pasku, z czterema nazwami i ceną, a znaczniki stoją obok siebie",
    state: island([
      priced("rossmann", offer(24.99), 10 * MINUTE),
      priced("natura", offer(24.99), 5 * MINUTE),
      priced("hebe", offer(24.99), 5 * MINUTE),
      priced("super-pharm", offer(24.99), 5 * MINUTE),
    ]),
    natura: MATCHED,
    hebe: HEBE_MATCHED,
    superPharm: SUPER_PHARM_MATCHED,
  },
  {
    code: "four-super-pharm-waiting",
    text:
      "jedna cena, w Rossmannie; Natura i Hebe odrzucone, a Super-Pharm bez decyzji ma na stronie otwartej z linku " +
      "tylko przycisk: hero i podpowiedź nazywają go",
    state: island([ROSSMANN_CHECKED]),
    natura: naturaOf(storedView("natura", DECLINED, PRODUCT, LINKS)),
    superPharm: SUPER_PHARM_PROMPT,
  },
  {
    code: "four-waiting",
    text: "jedna cena, w Rossmannie, a Natura, Hebe i Super-Pharm czekają na dopasowanie: hero nazywa trzy sklepy",
    state: island([ROSSMANN_CHECKED]),
    natura: naturaOf(promptView("natura", PRODUCT, false, "all")),
    hebe: hebeOf(promptView("hebe", PRODUCT, false, "all")),
    superPharm: SUPER_PHARM_PROMPT,
  },
  {
    code: "four-super-pharm-choice",
    text:
      "Super-Pharm szukany po nazwie przy otwarciu produktu, gdy żaden kandydat nie przeszedł sprawdzenia nazwy: " +
      "kandydaci czekają na wybór pod kartami, najlepiej pasujący najpierw, obok cen trzech sklepów",
    state: island(CHECKED_WITH_HEBE),
    natura: MATCHED,
    hebe: HEBE_MATCHED,
    superPharm: superPharmOf({ ...SUPER_PHARM_CHOICE, options: [] }),
    choices: [{ shop: "super-pharm", view: SUPER_PHARM_CHOICE }],
  },
];

export const FOUR_SHOP_FIXTURES: PriceFixture[] = FOUR_SHOP_STATES.map(areaFixture);

/**
 * Natura's stored match, as Hebe's states show it among the shops' cards: every one of Hebe's kinds stands beside
 * Rossmann's and Natura's prices.
 */
export const NATURA_BESIDE_HEBE = MATCHED;

/**
 * One state of Hebe, with the kitchen sink's label, the prefix that keeps its choice's ids its own, Hebe as the page
 * hands it to the island, the island's state beside it, Rossmann's and Natura's prices, with Hebe's while its match is
 * saved, and, while the user changes Hebe's stored decision, the choice below the cards.
 */
export interface HebeFixture {
  code: string;
  text: string;
  idPrefix: string;
  hebe: MatchedShopView;
  state: PriceComparisonState;
  repin?: MatchRepin;
}

export const HEBE_FIXTURES: HebeFixture[] = [
  {
    code: "matched",
    text: "dopasowane automatycznie: karta z ceną Hebe, a stopka nazywa pozycję z Hebe, bez ostrzeżeń, z „Zmień”",
    idPrefix: "hebe-auto",
    hebe: HEBE_MATCHED,
    state: island(CHECKED_WITH_HEBE),
  },
  {
    code: "matched + notice",
    text: "potwierdzone przez Ciebie w innym rozmiarze, zaraz po zapisie: stopka ostrzega o rozmiarze",
    idPrefix: "hebe-confirmed",
    hebe: hebeOf(storedView("hebe", HEBE_CONFIRMED, PRODUCT, LINKS), { notice: DECISION_NOTICES.matched }),
    state: island([...CHECKED, priced("hebe", offer(18.49), 5 * MINUTE)]),
  },
  {
    code: "matched + repin",
    text: "po „Zmień”: karta ma „Anuluj”, a wybór z obu wyszukiwań w Hebe oznacza obecne, automatyczne dopasowanie",
    idPrefix: "hebe-repin",
    hebe: hebeOf(storedView("hebe", HEBE_AUTO_MATCHED, PRODUCT, REPINNING)),
    state: island(CHECKED_WITH_HEBE),
    repin: repinView("hebe", HEBE_FOUND_BY_BOTH, HEBE_AUTO_MATCHED, new Date(NOW), PRODUCT, "all"),
  },
  {
    code: "unmatched + notice",
    text: "odrzucone przez Ciebie, zaraz po „Żaden z nich”: duch karty z „Dopasuj ponownie”, a Natura najtańsza",
    idPrefix: "hebe-declined",
    hebe: hebeOf(storedView("hebe", HEBE_DECLINED, PRODUCT, LINKS), { notice: DECISION_NOTICES.declined("hebe") }),
    state: island(CHECKED),
  },
  {
    code: "prompt",
    text: "bez decyzji, strona otwarta z linku albo przy wyborze w Naturze: przycisk zamiast wyszukiwania",
    idPrefix: "hebe-prompt",
    hebe: hebeOf(promptView("hebe", PRODUCT, false, "all")),
    state: island(CHECKED),
  },
  {
    code: "choose",
    text: "kandydaci z Hebe znalezieni po nazwie: karta wskazuje wybór poniżej",
    idPrefix: "hebe-choose",
    hebe: hebeOf(HEBE_CHOICE),
    state: island(CHECKED),
  },
  {
    code: "not-found",
    text: "zapisane „nie znaleziono” w Hebe, z „Szukaj ponownie”",
    idPrefix: "hebe-not-found",
    hebe: hebeOf(storedView("hebe", HEBE_NOT_FOUND, PRODUCT, LINKS)),
    state: island(CHECKED),
  },
  {
    code: "unavailable",
    text: "Hebe zablokowała zapytania: wyszukiwanie wyłączone, dopóki właściciel go nie włączy",
    idPrefix: "hebe-unavailable",
    hebe: hebeOf({ kind: "unavailable", message: shopUnavailableText(SHOP_LABELS.hebe.name, "stopped") }),
    state: island(CHECKED),
  },
  {
    code: "read-failed",
    text: "nie udało się wczytać zapisanej decyzji Hebe: ceny Rossmanna i Natury bez „Najtaniej”",
    idPrefix: "hebe-read-failed",
    hebe: HEBE_UNREAD,
    state: islandBeside([MATCHED, HEBE_UNREAD], CHECKED),
  },
];

/**
 * Natura's and Hebe's stored matches, as Super-Pharm's states show them among the shops' cards: every one of
 * Super-Pharm's kinds stands beside Rossmann's, Natura's and Hebe's prices.
 */
export const BESIDE_SUPER_PHARM = [MATCHED, HEBE_MATCHED];

/**
 * One state of Super-Pharm, with the kitchen sink's label, the prefix that keeps its choice's ids its own, Super-Pharm
 * as the page hands it to the island, the island's state beside it, Rossmann's, Natura's and Hebe's prices, with
 * Super-Pharm's while its match is saved, and, while the user changes Super-Pharm's stored decision, the choice below
 * the cards.
 */
export interface SuperPharmFixture {
  code: string;
  text: string;
  idPrefix: string;
  superPharm: MatchedShopView;
  state: PriceComparisonState;
  repin?: MatchRepin;
}

// Super-Pharm's price for the product's item, on sale without its regular price, which its record leaves out during a
// sale, so it shows as a plain price with its 30-day low.
const SUPER_PHARM_SALE = priced("super-pharm", offer(19.49, { lowestPrice30d: 33.99 }), 5 * MINUTE);

export const SUPER_PHARM_FIXTURES: SuperPharmFixture[] = [
  {
    code: "prompt",
    text:
      "bez decyzji, strona otwarta z linku albo dla innego sklepu („Zmień”, „Szukaj ponownie”): przycisk zamiast " +
      "wyszukiwania, jak w Naturze i Hebe, prowadzący do samej strony produktu",
    idPrefix: "super-pharm-prompt",
    superPharm: SUPER_PHARM_PROMPT,
    state: island(CHECKED_WITH_HEBE),
  },
  {
    code: "choose",
    text:
      "wyszukiwanie przy otwarciu produktu, gdy żaden kandydat nie przeszedł sprawdzenia nazwy: kandydaci znalezieni " +
      "po nazwie, najpierw najlepiej pasujący w rozmiarze i marce produktu, potem ci z ostrzeżeniem o innym rozmiarze " +
      "i innej marce, a bez „Ten sam EAN”: karta wskazuje wybór poniżej",
    idPrefix: "super-pharm-choose",
    superPharm: superPharmOf(SUPER_PHARM_CHOICE),
    state: island(CHECKED_WITH_HEBE),
  },
  {
    code: "matched",
    text:
      "dopasowane automatycznie po nazwie, bez wspólnego EAN: karta z ceną Super-Pharmu, a stopka nazywa pozycję, " +
      "mówi „po nazwie”, bez ostrzeżeń, z „Zmień”",
    idPrefix: "super-pharm-auto",
    superPharm: superPharmOf(storedView("super-pharm", SUPER_PHARM_AUTO_MATCHED, PRODUCT, LINKS)),
    state: island([...CHECKED_WITH_HEBE, SUPER_PHARM_SALE]),
  },
  {
    code: "matched + notice",
    text:
      "wybrane przez Ciebie, zaraz po zapisie: promocja, której rekord nie podaje ceny regularnej, więc zwykła cena " +
      "z najniższą z 30 dni",
    idPrefix: "super-pharm-picked",
    superPharm: superPharmOf(storedView("super-pharm", SUPER_PHARM_PICKED, PRODUCT, LINKS), {
      notice: DECISION_NOTICES.matched,
    }),
    state: island([...CHECKED_WITH_HEBE, SUPER_PHARM_SALE]),
  },
  {
    code: "matched + promo",
    text: "promocja z ceną regularną i końcem: „zamiast” i „promocja do” pod ceną, a Super-Pharm najtańszy",
    idPrefix: "super-pharm-promo",
    superPharm: SUPER_PHARM_MATCHED,
    state: island([
      ...CHECKED_WITH_HEBE,
      priced(
        "super-pharm",
        offer(19.49, { regularPrice: 24.99, lowestPrice30d: 19.99, promoEndsOn: "2026-10-05" }),
        5 * MINUTE,
      ),
    ]),
  },
  {
    code: "matched + repin",
    text:
      "po „Zmień” przy dopasowaniu automatycznym po nazwie: karta ma „Anuluj”, a wybór z wyszukiwania po nazwie, " +
      "najlepiej pasujący najpierw, oznacza obecne dopasowanie i daje je potwierdzić („To ten produkt”)",
    idPrefix: "super-pharm-repin",
    superPharm: superPharmOf(storedView("super-pharm", SUPER_PHARM_AUTO_MATCHED, PRODUCT, REPINNING)),
    state: island([...CHECKED_WITH_HEBE, SUPER_PHARM_SALE]),
    repin: repinView("super-pharm", SUPER_PHARM_FOUND_BY_NAME, SUPER_PHARM_AUTO_MATCHED, new Date(NOW), PRODUCT, "all"),
  },
  {
    code: "picked + repin",
    text:
      "po „Zmień” przy Twoim wyborze: karta ma „Anuluj”, a wybór z wyszukiwania po nazwie oznacza Twój wybór, którego " +
      "nie daje potwierdzić ponownie",
    idPrefix: "super-pharm-picked-repin",
    superPharm: superPharmOf(storedView("super-pharm", SUPER_PHARM_PICKED, PRODUCT, REPINNING)),
    state: island([...CHECKED_WITH_HEBE, SUPER_PHARM_SALE]),
    repin: repinView("super-pharm", SUPER_PHARM_FOUND_BY_NAME, SUPER_PHARM_PICKED, new Date(NOW), PRODUCT, "all"),
  },
  {
    code: "not-found",
    text: "zapisane „nie znaleziono” w Super-Pharmie, z „Szukaj ponownie”",
    idPrefix: "super-pharm-not-found",
    superPharm: superPharmOf(storedView("super-pharm", SUPER_PHARM_NOT_FOUND, PRODUCT, LINKS)),
    state: island(CHECKED_WITH_HEBE),
  },
  {
    code: "not-found + unsaved",
    text:
      "świeże „nie znaleziono”, którego nie udało się zapisać: alert mówi, że przy następnym otwarciu produktu " +
      "Super-Pharm zostanie sprawdzony ponownie, jak każdy sklep",
    idPrefix: "super-pharm-unsaved",
    superPharm: superPharmOf(notFoundView("super-pharm", new Date(NOW), PRODUCT, "all"), { unsaved: true }),
    state: island(CHECKED_WITH_HEBE),
  },
  {
    code: "unmatched + notice",
    text: "odrzucone przez Ciebie, zaraz po „Żaden z nich”: duch karty z „Dopasuj ponownie”",
    idPrefix: "super-pharm-declined",
    superPharm: superPharmOf(storedView("super-pharm", SUPER_PHARM_DECLINED, PRODUCT, LINKS), {
      notice: DECISION_NOTICES.declined("super-pharm"),
    }),
    state: island(CHECKED_WITH_HEBE),
  },
  {
    code: "stopped",
    text: "Super-Pharm zablokował zapytania, na przykład odrzuconym kluczem: wyszukiwanie wyłączone, dopóki właściciel go nie włączy",
    idPrefix: "super-pharm-stopped",
    superPharm: superPharmOf({
      kind: "unavailable",
      message: shopUnavailableText(SHOP_LABELS["super-pharm"].name, "stopped"),
    }),
    state: island(CHECKED_WITH_HEBE),
  },
];

/** The page's text for `?error=gone`, which its not-found branch shows: a decision posted for a product not listed. */
export const GONE_ERROR = matchErrorMessage("gone");

/**
 * The page's text for `?removal=failed`, which its not-found branch shows: a removal whose answer didn't come, and
 * which went through after all.
 */
export const REMOVAL_GONE_NOTICE = removalGoneNotice("failed");

/**
 * One state of "Usuń z listy" at the foot of the product's page, with the kitchen sink's label for it: whether its
 * confirm is drawn open, as a tap on its summary opens it, and the page's text for a failed removal, which opens it too.
 */
export interface RemoveFixture {
  code: string;
  text: string;
  open: boolean;
  error: string | null;
}

export const REMOVE_FIXTURES: RemoveFixture[] = [
  { code: "closed", text: "zamknięte, jak strona je pokazuje: sam przycisk", open: false, error: null },
  {
    code: "open",
    text: "otwarte: co zrobi usunięcie i czerwone „Usuń z listy”, opisane tą linią",
    open: true,
    error: null,
  },
  {
    code: "failed",
    text: "po nieudanym usunięciu (?removal=failed): błąd otwiera potwierdzenie",
    open: false,
    error: removalErrorMessage("failed"),
  },
];

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
