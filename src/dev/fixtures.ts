// The dev kitchen sink's fixtures (src/dev/product-page.astro): one made-up product in Rossmann and Natura, its stored
// prices and its Natura decisions, on a fixed clock, the design handoff's three sample products, and the prices and
// brands its primitives are shown with. Every state is built by the product page's own code, the price island's
// reducer, the Natura view builders and the matching rule, so the kitchen sink shows only states the page can reach.
// The product area's states pair every price state with Natura in every kind: the states with Natura's price need a
// saved match, and the rest stand with Rossmann's price alone, each beside another of Natura's kinds. Natura's own
// states include the choice that changes a stored decision, in each of the outcomes its searches can have, and the
// product's removal at the page's foot is drawn closed, open and after a failure. Nothing here is real user data, and
// nothing here asks Supabase or a shop.
import type { NaturaCardInput } from "@/components/watchlist/natura-card";
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
import { matchErrorMessage } from "@/lib/services/matches";
import { judge, pickMatch } from "@/lib/services/matching";
import {
  chooseView,
  decidedView,
  matchedView,
  notFoundView,
  promptView,
  repinView,
  storedView,
  type NaturaRepin,
  type NaturaView,
} from "@/lib/services/natura-view";
import { SHOP_LABELS, STALE_AFTER_MS, type PricedShop } from "@/lib/services/price-comparison";
import { parseSize } from "@/lib/services/size";
import { removalErrorMessage } from "@/lib/services/watchlist";
import { shopUnavailableText } from "@/lib/shop-messages";
import type {
  CandidateOption,
  LatestPrice,
  MatchedItem,
  NaturaChoices,
  RepinnableMatch,
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
// The user confirmed the candidate in another size (the first of CANDIDATES), so the match's size is flagged.
const CONFIRMED: ShopMatch = {
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

/** Natura as the page hands it to the island, with this view and, unless `extra` adds them, no notices. */
function naturaOf(view: NaturaView, extra: Partial<Omit<NaturaCardInput, "view">> = {}): NaturaCardInput {
  return { view, notice: null, error: null, unsaved: false, ...extra };
}

// The product's stored match, found by its EAN and size, which every price state of the product area has but one.
const MATCHED = naturaOf(matchedView(NATURA_ITEM, "auto", PRODUCT, LINKS));

/** One state of the product area, with the kitchen sink's label for it: the island's state and the product it's for. */
export interface PriceFixture {
  code: string;
  text: string;
  state: PriceComparisonState;
  /** The product the title names. */
  product: TitleProduct;
  /** Natura as the page read it: its card among the shops', and, still to match, what the hero and the hint say. */
  natura: NaturaCardInput | null;
  /** Natura's candidates, which the page's choice below the island holds while the island's card points to it. */
  choice?: Extract<NaturaView, { kind: "choose" }>;
}

// The island's states for the made-up product, whose Natura match is stored, so Natura has its price row.
const PRICE_STATES: Omit<PriceFixture, "product">[] = [
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

export const PRICE_FIXTURES: PriceFixture[] = PRICE_STATES.map((fixture) => ({ ...fixture, product: PRODUCT }));

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
export const HANDOFF_FIXTURES: PriceFixture[] = [
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
    natura: naturaOf(promptView(PRODUCT, false, "all")),
  },
  {
    code: "colgate",
    text: "próbka z projektu: cena Rossmanna sprzed 2 dni, z najniższą ceną z 30 dni; Natura odrzucona",
    state: island([priced("rossmann", offer(11.49, { lowestPrice30d: 10.99 }), 2 * DAY)]),
    product: sample("Colgate", "Total", "pasta do zębów", "75 ml", "2026-09-26"),
    natura: naturaOf(storedView(DECLINED, PRODUCT, LINKS)),
  },
];

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
    throw new Error(`The kitchen sink's Natura candidates must be left to the user; the rule answered ${pick.kind}.`);
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
const FOUND_BY_BOTH: NaturaChoices = {
  kind: "choices",
  options: judged([...FOUND_BY_EAN, ...FOUND_BY_NAME]),
  via: "both",
  incomplete: null,
};
const NAME_SEARCH_BUSY: NaturaChoices = {
  kind: "choices",
  options: judged(FOUND_BY_EAN),
  via: "ean",
  incomplete: { kind: "unavailable", reason: "busy" },
};
const NOTHING_FOUND: NaturaChoices = { kind: "not-found" };
const NATURA_STOPPED: NaturaChoices = { kind: "unavailable", reason: "stopped" };

/** The choice that changes a stored decision, as the page builds it once Natura's searches have answered. */
function repinOf(choices: NaturaChoices, current: RepinnableMatch): NaturaRepin {
  return repinView(choices, current, new Date(NOW), PRODUCT, "all");
}

// The product's match with its choice open: the card points below and offers "Anuluj", and keeps its price row.
const MATCHED_REPINNING = naturaOf(storedView(AUTO_MATCHED, PRODUCT, REPINNING));

/**
 * One state of Natura, with the kitchen sink's label, the prefix that keeps its choice's ids its own, Natura as the
 * page hands it to the island, the island's state beside it, Rossmann's price, with Natura's while its match is saved,
 * and, while the user changes a stored decision, the choice below the cards.
 */
export interface NaturaFixture {
  code: string;
  text: string;
  idPrefix: string;
  natura: NaturaCardInput;
  state: PriceComparisonState;
  repin?: NaturaRepin;
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
    natura: naturaOf(matchedView(NATURA_ITEM, "auto", PRODUCT, { ...LINKS, unsaved: true }), { unsaved: true }),
    state: ROSSMANN_ONLY,
  },
  {
    code: "matched + notice",
    text: "potwierdzone przez Ciebie w innym rozmiarze, zaraz po zapisie: stopka ostrzega o rozmiarze",
    idPrefix: "natura-confirmed",
    // The page's notice for `?matched`.
    natura: naturaOf(storedView(CONFIRMED, PRODUCT, LINKS), { notice: DECISION_NOTICES.matched }),
    state: island([ROSSMANN_CHECKED, priced("natura", offer(17.99), 5 * MINUTE)]),
  },
  {
    code: "matched + brand",
    text: "dopasowane automatycznie, zanim porównywano marki: stopka ostrzega o innej marce",
    idPrefix: "natura-other-brand",
    natura: naturaOf(storedView(AUTO_OTHER_BRAND, PRODUCT, LINKS)),
    state: island([ROSSMANN_CHECKED, priced("natura", offer(21.99), 5 * MINUTE)]),
  },
  {
    code: "matched + repin",
    text: "po „Zmień”: karta wskazuje wybór poniżej i ma „Anuluj”, a wybór z obu wyszukiwań oznacza obecne dopasowanie",
    idPrefix: "natura-repin",
    natura: MATCHED_REPINNING,
    state: island(CHECKED),
    repin: repinOf(FOUND_BY_BOTH, AUTO_MATCHED),
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
    natura: naturaOf(storedView(DECLINED, PRODUCT, LINKS)),
    state: ROSSMANN_ONLY,
  },
  {
    code: "unmatched + repin",
    text: "po „Dopasuj ponownie”: karta wskazuje wybór poniżej, a wybór nie ma „Żaden z nich”, tylko „Anuluj”",
    idPrefix: "natura-declined-repin",
    natura: naturaOf(storedView(DECLINED, PRODUCT, REPINNING)),
    state: ROSSMANN_ONLY,
    repin: repinOf(FOUND_BY_BOTH, DECLINED),
  },
  {
    code: "not-found",
    text: "zapisane „nie znaleziono”",
    idPrefix: "natura-not-found",
    natura: naturaOf(storedView(NOT_FOUND, PRODUCT, LINKS)),
    state: ROSSMANN_ONLY,
  },
  {
    code: "choose + error",
    text: "kandydaci znalezieni po EAN, po nieudanym zapisie wyboru",
    idPrefix: "natura-choose",
    natura: naturaOf(chooseView(leftToUser(CANDIDATES), "ean", new Date(NOW), PRODUCT), {
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
    natura: naturaOf(promptView(PRODUCT, false, "all")),
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
    natura: naturaOf({ kind: "read-failed" }),
    state: ROSSMANN_ONLY,
  },
  {
    code: "not-found + unsaved",
    text: "świeże „nie znaleziono”, którego nie udało się zapisać",
    idPrefix: "natura-unsaved",
    natura: naturaOf(notFoundView(new Date(NOW), PRODUCT, "all"), { unsaved: true }),
    state: ROSSMANN_ONLY,
  },
];

/** The view of candidates left to the user, which is a choice among them. */
function choiceOf(view: NaturaView): Extract<NaturaView, { kind: "choose" }> {
  if (view.kind !== "choose") {
    throw new Error(`The kitchen sink's Natura candidates must make a choice; the view is ${view.kind}.`);
  }
  return view;
}

// Natura's candidates to choose from, as the page's view holds them for the choice below the island; the island's card
// gets the view without them.
const CHOICE = choiceOf(chooseView(leftToUser(CANDIDATES), "ean", new Date(NOW), PRODUCT));

// Rossmann's price alone: without a saved match Natura has no price row, so every other kind of Natura stands here, each
// beside one of Rossmann's states, and every state of Rossmann's price stands beside one of them. The rules tell those
// kinds apart only as still to match (prompt, choose, unavailable), decided (unmatched, not-found, decided, a match
// that wasn't saved) and unreadable (read-failed): a state looks the same beside another kind of its group, but for
// Natura's own card, which the Natura section shows in every kind.
const ALONE_STATES: Omit<PriceFixture, "product">[] = [
  {
    code: "lone",
    text: "jeden sklep, Natura odrzucona: nie ma z czym porównać, więc bez oznaczenia",
    state: island([ROSSMANN_CHECKED]),
    natura: naturaOf(storedView(DECLINED, PRODUCT, LINKS)),
  },
  {
    code: "lone-promo",
    text: "jeden sklep w promocji do 05.10, z ceną regularną; Natura odrzucona",
    state: island([priced("rossmann", offer(22.49, { regularPrice: 26.99, promoEndsOn: "2026-10-05" }), 10 * MINUTE)]),
    natura: naturaOf(storedView(DECLINED, PRODUCT, LINKS)),
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
    natura: naturaOf(storedView(NOT_FOUND, PRODUCT, LINKS)),
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
    choice: CHOICE,
  },
  {
    code: "lone-refreshing",
    text: "Rossmann w trakcie odświeżania; Natura czeka na dopasowanie",
    state: island([ROSSMANN_CHECKED], start("rossmann")),
    natura: naturaOf(promptView(PRODUCT, false, "all")),
  },
  {
    code: "lone-notice",
    text: "Rossmann prosi o przerwę: ostatnia cena zostaje; Natura odrzucona",
    state: island(
      [ROSSMANN_CHECKED],
      start("rossmann"),
      done("rossmann", { kind: "unavailable", reason: "paused", until: PAUSED_UNTIL }, ANSWERED_AT),
    ),
    natura: naturaOf(storedView(DECLINED, PRODUCT, LINKS)),
  },
  {
    code: "lone-read-failed",
    text: "nie udało się wczytać zapisanych cen, a dopasowania Natury nie udało się zapisać, więc nie ma jej ceny",
    state: initialState({ shops: [row("rossmann", null)], now: NOW, pricesFailed: true }),
    natura: naturaOf(matchedView(NATURA_ITEM, "auto", PRODUCT, { ...LINKS, unsaved: true }), { unsaved: true }),
  },
  {
    code: "lone-read-failed-row",
    text: "nie udało się odczytać zapisanej ceny Rossmanna; Natura czeka na dopasowanie",
    state: island([{ ...row("rossmann", null), readFailed: true }]),
    natura: naturaOf(promptView(PRODUCT, false, "all")),
  },
  {
    code: "natura-read-failed",
    text: "nie udało się wczytać decyzji Natury: świeża cena Rossmanna, ale żaden sklep nie jest nazwany",
    // Without the decision there's no Natura row, and a match it hides could name a lower price.
    state: island([ROSSMANN_CHECKED]),
    natura: naturaOf({ kind: "read-failed" }),
  },
];

export const ALONE_FIXTURES: PriceFixture[] = ALONE_STATES.map((fixture) => ({ ...fixture, product: PRODUCT }));

/** The page's text for `?error=gone`, which its not-found branch shows: a decision posted for a product not listed. */
export const GONE_ERROR = matchErrorMessage("gone");

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
