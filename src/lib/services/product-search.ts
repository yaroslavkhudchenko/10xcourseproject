import { pickMatch, sharesAnEan } from "@/lib/services/matching";
import {
  keyText,
  listJoin,
  matchedShopsOf,
  PRICED_SHOPS,
  SHOP_LABELS,
  type PricedShop,
} from "@/lib/services/price-comparison";
import type { ShopGate } from "@/lib/services/shop-gate";
import { SHOP_ADAPTERS } from "@/lib/services/shops/registry";
import { searchRossmann } from "@/lib/services/shops/rossmann";
import { rowProductOf } from "@/lib/services/watchlist-rows";
import type { ProductCandidate, ShopCandidate, ShopMatchState, ShopUnavailable, WatchlistItem } from "@/types";

// The list's product search (FR-003) across the priced shops: what it asks, how the items the shops found join into one
// entry per product, what each shop's line says, and which entries the list already holds.
//
// A search asks every priced shop once, all at once, for 10 items (the owner's call 9 of 2026-10-06): Rossmann through
// its own search, which keeps each product's caption and Rossmann's spelling hint, and every other shop through its
// adapter (SHOP_ADAPTERS). So a search costs 4 shop requests, one per shop, each charged to its own shop's cap, and only
// on the user's own navigation (searchStepOf in search-query.ts): a link on another site or a prefetch costs none. A
// reload repeats them, since nothing is cached. A shop the gate skips, stopped, paused or at its cap, costs no request,
// and like a shop whose answer can't be read, it reads as not answering, never as one that found nothing.
//
// The entries follow the owner's calls of 2026-10-06 (change.md): items of different shops are one product when the
// matching rule accepts one for the other (pickMatch), by a shared EAN, the size and a brand that doesn't differ, and a
// Super-Pharm item, whose index holds no EAN, by the name rule. An entry names the shops whose searches found its
// product and claims nothing about the others (call 2). Its product is its first item's, in the shops' order, which
// "Dodaj" adds; the search stores nothing else, its other items no match (call 4). Server-only: it asks shops.

/** How many items the list's search asks each shop for (the owner's call 9 of 2026-10-06). */
export const SEARCH_SIZE = 10;

/**
 * The shops whose items may join an entry by the name rule: Super-Pharm, whose index holds no EAN (research note §2.3),
 * by the owner's call of 2026-10-06 (change.md). Every other shop's items carry EANs, and join an entry only by one they
 * share with its product, so a name never overrules what the EANs say.
 */
const JOINS_BY_NAME: readonly PricedShop[] = ["super-pharm"];

/** What one shop's search came to: the products it found, in its own ranking, possibly none, or why it gave no answer. */
export type ShopFound = { kind: "results"; products: ProductCandidate[] } | ShopUnavailable;

/** What the list's search came to: each asked shop's outcome, and Rossmann's spelling hint. */
export interface SearchOutcomes {
  /** Each shop's outcome, by its shop: every priced shop's, unless a test asks fewer. */
  shops: Readonly<Partial<Record<PricedShop, ShopFound>>>;
  /** Rossmann's spelling hint for the text, when its search gave one. */
  spellingHint: string | null;
}

/**
 * Searches each of `shops`, the priced shops unless a test names others, for the user's text, all at once, each with
 * one request for at most 10 items through the gate: Rossmann's own search, which keeps each product's caption and
 * gives Rossmann's spelling hint, and every other shop's through its adapter, whose candidates become products of that
 * shop (productOf). Resolves to each shop's outcome: its products, possibly none, or why it gave no answer. Each shop
 * settles on its own, so one whose search throws is logged and reads as not answering beside the others. It never
 * throws. The text must already have passed `searchQuerySchema`.
 */
export async function searchShops(
  gate: ShopGate,
  query: string,
  shops: readonly PricedShop[] = PRICED_SHOPS,
): Promise<SearchOutcomes> {
  const searched = await Promise.all(shops.map((shop) => searchShop(gate, shop, query)));
  const outcomes: Partial<Record<PricedShop, ShopFound>> = {};
  let spellingHint: string | null = null;
  shops.forEach((shop, index) => {
    outcomes[shop] = searched[index].found;
    spellingHint ??= searched[index].spellingHint;
  });
  return { shops: outcomes, spellingHint };
}

/** One shop's search (searchShops), settled on its own: a search that throws reads as the shop not answering. */
async function searchShop(
  gate: ShopGate,
  shop: PricedShop,
  query: string,
): Promise<{ found: ShopFound; spellingHint: string | null }> {
  try {
    if (shop === "rossmann") {
      const search = await searchRossmann(gate, query, SEARCH_SIZE);
      return search.kind === "results"
        ? { found: { kind: "results", products: search.candidates }, spellingHint: search.spellingHint }
        : { found: search, spellingHint: null };
    }
    const search = await SHOP_ADAPTERS[shop].search(gate, query, SEARCH_SIZE);
    const found: ShopFound =
      search.kind === "results" ? { kind: "results", products: search.candidates.map(productOf) } : search;
    return { found, spellingHint: null };
  } catch (error) {
    logSearchFailure(shop, error);
    return { found: { kind: "unavailable", reason: "failed" }, spellingHint: null };
  }
}

/**
 * A shop's candidate as a product "Dodaj" can add from that shop, which becomes its own: its fields, without a caption,
 * which only Rossmann writes apart from the name, and without its offer, since the results show no price.
 */
function productOf(candidate: ShopCandidate): ProductCandidate {
  const { shop, shopItemId, brand, name, sizeText, size, eans, productUrl, imageUrl } = candidate;
  return {
    source: shop,
    sourceItemId: shopItemId,
    brand,
    name,
    caption: null,
    sizeText,
    size,
    eans,
    productUrl,
    imageUrl,
  };
}

/** One shop's item an entry holds: the shop, and the shop's own id for the item. */
export interface EntryItem {
  shop: PricedShop;
  shopItemId: string;
}

/** One entry of the list's search: a product, and the item of each shop whose search found it. */
export interface SearchEntry {
  /** The product "Dodaj" adds: the entry's first item's, as its shop's search gave it. */
  product: ProductCandidate;
  /** The item of each shop that has the product, at most one per shop, in the shops' order. */
  items: EntryItem[];
}

/**
 * The search's entries, one per product, from each shop's products in the shops' order (PRICED_SHOPS), each shop's in
 * its own ranking. A shop that gave no answer adds none. Every product of the first shop that answered is an entry of
 * its own. Each later shop's items are then judged against each entry's product, its first item's, all at once
 * (pickMatch): a Rossmann's keeps its name and caption, any other's has no caption, so the name rule needs every word of
 * its name. An item joins the entry that accepts it: a Super-Pharm item whichever way it's accepted, by the name rule,
 * since its index holds no EAN, and any other shop's item only when it shares an EAN with the entry's product, so a
 * name never joins two items whose EANs say nothing of each other. An item two entries would both take joins neither,
 * since one of them must be wrong, and an item that joins no entry is an entry of its own, after the entries of the
 * shops before it. So the entries come in the order of their first items.
 */
export function searchEntriesOf(outcomes: SearchOutcomes): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const shop of PRICED_SHOPS) {
    const found = outcomes.shops[shop];
    if (found?.kind !== "results") {
      continue;
    }
    const candidates = found.products.map(candidateOf);
    // The entries that would take each of this shop's items, among those so far, all of the shops before it.
    const takers = new Map<ShopCandidate, SearchEntry[]>();
    for (const entry of entries) {
      const pick = pickMatch(entry.product, candidates);
      if (pick.kind === "accepted" && joins(shop, entry.product, pick.candidate)) {
        takers.set(pick.candidate, [...(takers.get(pick.candidate) ?? []), entry]);
      }
    }
    found.products.forEach((product, index) => {
      const item = { shop, shopItemId: product.sourceItemId };
      const taking = takers.get(candidates[index]) ?? [];
      if (taking.length === 1) {
        taking[0].items.push(item);
      } else {
        entries.push({ product, items: [item] });
      }
    });
  }
  return entries;
}

/**
 * Whether an item of `shop` the matching rule accepted for an entry's product joins that entry: an item of a shop whose
 * items join by the name rule (JOINS_BY_NAME), and any other only with an EAN it shares with the product.
 */
function joins(shop: PricedShop, product: ProductCandidate, candidate: ShopCandidate): boolean {
  return JOINS_BY_NAME.includes(shop) || sharesAnEan(product, candidate);
}

/**
 * A shop's product as a candidate the matching rule judges for an entry's product: its fields, its name with its
 * caption, where Rossmann keeps the shade or the scent, as a row shows them and a lookup's candidate in Rossmann carries
 * them (searchRossmannItems), and no offer, which the rule doesn't read.
 */
function candidateOf(product: ProductCandidate): ShopCandidate {
  const { source, sourceItemId, brand, sizeText, size, eans, productUrl, imageUrl } = product;
  const name = rowProductOf(product).name;
  return {
    shop: source,
    shopItemId: sourceItemId,
    brand,
    name,
    sizeText,
    size,
    eans,
    productUrl,
    imageUrl,
    offer: null,
  };
}

/** What one shop's search came to, as the line above the results says it, such as „Natura: 9 wyników”. */
export interface ShopLine {
  shop: PricedShop;
  text: string;
}

/**
 * Each asked shop's part of the line above the results, in the shops' order: the shop's name, then how many items its
 * search found, „brak wyników” for none, or „nie odpowiada” when it gave no answer, whatever the reason: the gate
 * skipped it, it refused, the call failed, or its answer couldn't be read, which never reads as nothing found.
 */
export function shopLinesOf(outcomes: SearchOutcomes): ShopLine[] {
  return PRICED_SHOPS.flatMap((shop) => {
    const found = outcomes.shops[shop];
    return found === undefined ? [] : [{ shop, text: `${SHOP_LABELS[shop].name}: ${foundText(found)}` }];
  });
}

/** What a shop's search came to, after its name on the line: a count of results, „brak wyników” or „nie odpowiada”. */
function foundText(found: ShopFound): string {
  if (found.kind === "unavailable") {
    return "nie odpowiada";
  }
  return found.products.length === 0 ? "brak wyników" : resultsText(found.products.length);
}

/** A count of results, as Polish says it: „1 wynik”, „3 wyniki”, „5 wyników”, „12 wyników”, „22 wyniki”. */
function resultsText(count: number): string {
  const ones = count % 10;
  const tens = count % 100;
  if (count === 1) {
    return "1 wynik";
  }
  const few = ones >= 2 && ones <= 4 && (tens < 12 || tens > 14);
  return `${count} ${few ? "wyniki" : "wyników"}`;
}

/** An entry as the results show it: whether the list already holds one of its items (onListOf). */
export interface ResultEntry extends SearchEntry {
  onList: boolean;
}

/**
 * The entries, each marked when the list already holds one of its items: as a listed product's own item, the one it was
 * picked in its own shop, or as the item a listed product is matched to in one of its matched shops (matchedShopsOf). A
 * decision in a product's own shop is left out, as every read of its decisions leaves it out, and so is any decision
 * of a product the list couldn't read, whose own shop isn't known. It reads only the list's own reads, its products
 * (listWatchlist) and its decisions (listMatchStates), and asks nothing more. A read that failed (null) can't say an
 * item is listed, so nothing is marked from it: without the products, nothing at all, and without the decisions, only
 * the products' own items.
 */
export function onListOf(
  entries: readonly SearchEntry[],
  products: readonly Pick<WatchlistItem, "id" | "source" | "sourceItemId">[] | null,
  decisions: readonly ShopMatchState[] | null,
): ResultEntry[] {
  const listed = new Set<string>();
  const sources = new Map<string, WatchlistItem["source"]>();
  for (const { id, source, sourceItemId } of products ?? []) {
    listed.add(keyText({ shop: source, shopItemId: sourceItemId }));
    sources.set(id, source);
  }
  for (const decision of decisions ?? []) {
    const source = sources.get(decision.watchlistItemId);
    if (decision.state === "matched" && source !== undefined && matchedShopsOf(source).includes(decision.shop)) {
      listed.add(keyText(decision));
    }
  }
  return entries.map((entry) => ({ ...entry, onList: entry.items.some((item) => listed.has(keyText(item))) }));
}

/** What the list's search results show (searchResultsOf). */
export interface SearchResultsView {
  /** The entries, in their order, each marked when the list holds one of its items. */
  entries: ResultEntry[];
  /** Each asked shop's part of the line above the entries, in the shops' order. */
  lines: ShopLine[];
  /**
   * Whether some shop answered. Without an entry, the results then say nothing was found; when no shop answered, the
   * line alone says so, shop by shop.
   */
  answered: boolean;
  /** Rossmann's spelling hint, which the results offer as a search of its own. */
  spellingHint: string | null;
}

/**
 * What the list's search results show, from the search's outcomes and the list's own reads, its products and its
 * decisions, each null when it couldn't be read: the entries (searchEntriesOf), each marked when the list holds one of
 * its items (onListOf), each shop's line (shopLinesOf), whether any shop answered, and Rossmann's spelling hint.
 */
export function searchResultsOf(
  outcomes: SearchOutcomes,
  products: readonly Pick<WatchlistItem, "id" | "source" | "sourceItemId">[] | null,
  decisions: readonly ShopMatchState[] | null,
): SearchResultsView {
  return {
    entries: onListOf(searchEntriesOf(outcomes), products, decisions),
    lines: shopLinesOf(outcomes),
    answered: PRICED_SHOPS.some((shop) => outcomes.shops[shop]?.kind === "results"),
    spellingHint: outcomes.spellingHint,
  };
}

/** The shops an entry's items are of, as its row names them under its name: „Rossmann · Natura · Super-Pharm”. */
export function entryShopsText(entry: Pick<SearchEntry, "items">): string {
  return entry.items.map((item) => SHOP_LABELS[item.shop].name).join(" · ");
}

/**
 * Where the results come from, as the line under them says it: the searches of the sites of `shops`, the priced shops
 * unless a test names others, listed the Polish way (listJoin): „Wyniki z wyszukiwarek rossmann.pl, drogerienatura.pl,
 * hebe.pl i superpharm.pl”.
 */
export function searchSourcesText(shops: readonly PricedShop[] = PRICED_SHOPS): string {
  return `Wyniki z wyszukiwarek ${listJoin(shops.map((shop) => SHOP_LABELS[shop].site))}`;
}

/**
 * Logs a shop's search that threw, by the shop and the error's kind alone: its message could quote the search, which
 * is the user's own text.
 */
function logSearchFailure(shop: PricedShop, error: unknown): void {
  const entry = {
    event: "product-search",
    shop,
    reason: "search failed",
    error: error instanceof Error ? error.name : typeof error,
  };
  // eslint-disable-next-line no-console -- one line per shop search that threw; Workers observability collects it.
  console.warn(JSON.stringify(entry));
}
