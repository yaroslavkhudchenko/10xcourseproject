/** The shops the deployment calls, as one list: the ids match the rows seeded into `public.shops`. */
export const SHOP_IDS = ["rossmann", "hebe", "super-pharm", "natura"] as const;

/** A shop the deployment calls. */
export type ShopId = (typeof SHOP_IDS)[number];

/**
 * What one request through the shop gate (`src/lib/services/shop-gate.ts`) came to. Only `ok` carries the shop's
 * response; every other kind means the call produced no price.
 *
 * - `skipped`: the gate didn't call the shop. The per-minute cap was reached (`capped`), the shop is paused after a
 *   429 (`paused`, with `until`), it's stopped after a block (`stopped`), or the request counter couldn't be reached
 *   (`unavailable`).
 * - `rate-limited`: the shop answered 429, or 503 with Retry-After, and the gate paused it.
 * - `blocked`: the shop answered 403 or a bot challenge, and the gate stopped it until the owner re-enables it.
 * - `failed`: the request timed out, failed on the network, or got another non-2xx status (`http`).
 */
export type GateOutcome =
  | { kind: "ok"; response: Response }
  | { kind: "skipped"; reason: "capped" | "paused" | "stopped" | "unavailable"; until?: string }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "blocked"; status: number }
  | { kind: "failed"; reason: "timeout" | "network" | "http"; status?: number };

/** The units sizes are compared in: millilitres, grams or pieces. */
export type SizeUnit = "ml" | "g" | "pcs";

/** A size in a comparable unit, parsed from a shop's size text. */
export interface Size {
  value: number;
  unit: SizeUnit;
}

/**
 * One product a shop's search returned, as the user can pick it for their watchlist. Picking it fixes the product's
 * identity; its EANs are only helpers for later shop lookups (FR-004).
 */
export interface ProductCandidate {
  source: ShopId;
  /** The shop's own product id. */
  sourceItemId: string;
  brand: string | null;
  name: string;
  caption: string | null;
  /** The size as the shop wrote it, and parsed when that was possible. */
  sizeText: string | null;
  size: Size | null;
  eans: string[];
  /** The item's own page in the shop, for "Zobacz w sklepie". */
  productUrl: string | null;
  imageUrl: string | null;
}

/** A product on the user's own watchlist, as the list shows it. */
export interface WatchlistItem {
  id: string;
  source: ShopId;
  sourceItemId: string;
  brand: string | null;
  name: string;
  caption: string | null;
  sizeText: string | null;
  imageUrl: string | null;
  /** When the user added it, as an ISO timestamp. */
  addedAt: string;
}

/** A product on the user's own watchlist, as its page shows it and a shop lookup needs it. */
export interface WatchlistProduct extends WatchlistItem {
  size: Size | null;
  /** Helpers for shop lookups, never the product's identity (FR-004). */
  eans: string[];
  /** The product's own page in the shop it was picked from; null for products added before S-02 stored it. */
  productUrl: string | null;
}

/**
 * How a watched product stands in one shop: matched to an item, declined by the user ("Żaden z nich"), or not found by
 * the lookup, which a retry may still change.
 */
export type MatchState = "matched" | "unmatched" | "not_found";

/** The shop's item a watched product is matched to: a copy of what the shop showed for it, without its price. */
export interface MatchedItem {
  /** The shop's own id for the item, such as Natura's SKU: the product's anchor in that shop (FR-004). */
  shopItemId: string;
  brand: string | null;
  name: string;
  sizeText: string | null;
  size: Size | null;
  eans: string[];
  productUrl: string | null;
  imageUrl: string | null;
}

/** The stored decision for one watched product in one shop. Only a match carries the shop's item. */
export type ShopMatch = {
  watchlistItemId: string;
  shop: ShopId;
  /** Whether the matching rule decided on its own or the user did. */
  decidedBy: "auto" | "user";
  /** When the decision was made or the lookup last ran, as an ISO timestamp. */
  checkedAt: string;
} & ({ state: "matched"; item: MatchedItem } | { state: "unmatched" | "not_found"; item: null });

/**
 * Why a shop search produced nothing to show: the shop's cap was reached (`busy`), the shop asked for a pause
 * (`paused`, with its end), the shop blocked us and stays stopped until the owner re-enables it (`stopped`), or the call
 * failed (`failed`).
 */
export type SearchUnavailableReason = "busy" | "paused" | "stopped" | "failed";

/** Why a shop gave no answer, as searches and lookups report it. `until` is when a pause ends, as an ISO timestamp. */
export interface ShopUnavailable {
  kind: "unavailable";
  reason: SearchUnavailableReason;
  until?: string;
}

/** What a product search came to: candidates (possibly none) with the shop's spelling hint, or unavailable. */
export type ProductSearch =
  { kind: "results"; candidates: ProductCandidate[]; spellingHint: string | null } | ShopUnavailable;

/**
 * One item a shop's search returned, as a candidate for a watched product's match in that shop. Once confirmed, the
 * item is the product's anchor in that shop (FR-004). Its offer is shown while the user decides, and it's the whole
 * offer, so an automatic match can store the price the shop sent with it.
 */
export interface ShopCandidate {
  shop: ShopId;
  /** The shop's own id for the item, such as Natura's SKU. */
  shopItemId: string;
  brand: string | null;
  name: string;
  /** The size as text a form can post back, such as "300 ml", and parsed: `parseSize(sizeText)` gives `size`. */
  sizeText: string | null;
  size: Size | null;
  eans: string[];
  /** The item's page in the shop. */
  productUrl: string | null;
  imageUrl: string | null;
  /** The shop's current online offer, never a shelf price; null when it sent no price that can be stored. */
  offer: ShopOffer | null;
}

/** How a candidate compares with the watched product: a shared EAN, and whether the sizes agree when both are known. */
export interface CandidateVerdict {
  sharesEan: boolean;
  size: "equal" | "differs" | "unknown";
}

/** A candidate the user can pick, with how it compares with the product. */
export interface CandidateOption {
  candidate: ShopCandidate;
  verdict: CandidateVerdict;
}

/** What a shop's search came to: its candidates (possibly none), or why the shop gave no answer. */
export type ShopSearch = { kind: "results"; candidates: ShopCandidate[] } | ShopUnavailable;

/**
 * What looking a watched product up in a shop came to: the one candidate the matching rule accepts, candidates for the
 * user to choose from (found by the product's EAN or by its name), nothing found, or why the shop gave no answer.
 */
export type ShopLookup =
  | { kind: "accepted"; candidate: ShopCandidate }
  | { kind: "choose"; options: CandidateOption[]; via: "ean" | "name" }
  | { kind: "not-found" }
  | ShopUnavailable;

/** What a shop offers an item for online, in złoty: an online price, never a shelf price. */
export interface ShopOffer {
  price: number;
  /** The price before a promotion, only while one runs. */
  regularPrice: number | null;
  /** The lowest price of the last 30 days, as the shop reports it. */
  lowestPrice30d: number | null;
  /** When the promotion ends, as `YYYY-MM-DD`, when the shop says. */
  promoEndsOn: string | null;
  /** Whether the item can be ordered online. */
  available: boolean;
}

/**
 * What one check of a shop item came to: the item's offer, `missing` when the shop answered without the item, or why
 * the shop gave no answer. Only a price or a missing item is stored.
 */
export type PriceCheck = { kind: "price"; offer: ShopOffer } | { kind: "missing" } | ShopUnavailable;

/**
 * A shop item whose prices are observed: the shop and its own id for the item, such as Rossmann's product id or
 * Natura's SKU. Observations are shared by everyone who watches the item.
 */
export interface PriceKey {
  shop: ShopId;
  shopItemId: string;
}

/**
 * A shop item's latest state: when it was last checked and what that check found, with the latest price and when it
 * was fetched. A check that found the item missing keeps the price from before; `offer` is null only when no check has
 * found a price yet. Times are ISO timestamps.
 */
export type LatestPrice = PriceKey & {
  lastCheckedAt: string;
  lastStatus: "price" | "missing";
  offer: (ShopOffer & { pricedAt: string }) | null;
};

/**
 * What `/api/watchlist/prices` answers when it refreshed one shop of a watched product: the offer it fetched, that the
 * shop answered without the item, or why the shop gave no answer. `checkedAt` is the server's time after the check, as
 * an ISO timestamp, and `saved` says whether the check was stored.
 */
export type PriceRefreshAnswer =
  | { kind: "price"; offer: ShopOffer; checkedAt: string; saved: boolean }
  | { kind: "missing"; checkedAt: string; saved: boolean }
  | ShopUnavailable;
