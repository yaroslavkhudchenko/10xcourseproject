import type { MatchableShop } from "@/lib/services/price-comparison";
import type { ShopGate } from "@/lib/services/shop-gate";
import { fetchHebePrices, isHebeImage, isHebeItemId, isHebeProductUrl, searchHebe } from "@/lib/services/shops/hebe";
import {
  fetchNaturaPrices,
  isNaturaImage,
  isNaturaItemId,
  isNaturaProductUrl,
  searchNatura,
} from "@/lib/services/shops/natura";
import {
  fetchRossmannPrices,
  isRossmannImage,
  isRossmannProductId,
  isRossmannProductUrl,
  searchRossmannItems,
} from "@/lib/services/shops/rossmann";
import {
  fetchSuperPharmPrices,
  isSuperPharmImage,
  isSuperPharmItemId,
  isSuperPharmProductUrl,
  searchSuperPharm,
} from "@/lib/services/shops/super-pharm";
import type { PriceCheck, ShopSearch } from "@/types";

// Each shop the code can match a watched product in, mapped to its adapter in one place, in the pages' order: the
// lookups search it, the decision form checks a decision's item ids and a confirmed candidate's links with it, "Dodaj"
// checks a product's id and links with it, and the price refresh fetches its pinned items (PRICE_FETCHERS). A shop has
// an entry here as soon as the code knows it; whether a lookup, a decision or a refresh reaches it is PRICED_SHOPS' to
// say, and a product is looked up and decided on only in its matched shops, every priced shop but its own
// (matchedShopsOf). Server-only: the adapters call shops through the gate.

/** What the app asks of a shop's adapter. None of its calls ever throws. */
export interface ShopAdapter {
  /**
   * Searches the shop through the gate for an EAN of 8-14 digits or text that passed `searchQuerySchema`, asking for at
   * most `size` hits: the candidates (possibly none), or why the shop gave no answer.
   */
  search: (gate: ShopGate, query: string, size: number) => Promise<ShopSearch>;
  /**
   * Whether the shop's search finds an item by its EAN. Rossmann's search is text only (research note §2.1) and
   * Super-Pharm's index holds no EAN (§2.3), so their lookups search them by name alone: an EAN search there would
   * spend a request to learn nothing.
   */
  searchesByEan: boolean;
  /** Fetches the offers of pinned items by the shop's own ids through the gate: a check for every id given. */
  fetchPrices: (gate: ShopGate, ids: string[]) => Promise<Map<string, PriceCheck>>;
  /** True for an id the shop's own items can have: the only ids a decision can pin, or name as the match it replaces. */
  isItemId: (id: string) => boolean;
  /** True for a link to the shop's own product page: the only product pages a candidate links to. */
  isProductUrl: (url: string) => boolean;
  /** True for a link to an image on the shop's own image host: the only images a candidate shows. */
  isImage: (url: string) => boolean;
}

export const SHOP_ADAPTERS: Record<MatchableShop, ShopAdapter> = {
  rossmann: {
    search: searchRossmannItems,
    searchesByEan: false,
    fetchPrices: fetchRossmannPrices,
    isItemId: isRossmannProductId,
    isProductUrl: isRossmannProductUrl,
    isImage: isRossmannImage,
  },
  natura: {
    search: searchNatura,
    searchesByEan: true,
    fetchPrices: fetchNaturaPrices,
    isItemId: isNaturaItemId,
    isProductUrl: isNaturaProductUrl,
    isImage: isNaturaImage,
  },
  hebe: {
    search: searchHebe,
    searchesByEan: true,
    fetchPrices: fetchHebePrices,
    isItemId: isHebeItemId,
    isProductUrl: isHebeProductUrl,
    isImage: isHebeImage,
  },
  "super-pharm": {
    search: searchSuperPharm,
    searchesByEan: false,
    fetchPrices: fetchSuperPharmPrices,
    isItemId: isSuperPharmItemId,
    isProductUrl: isSuperPharmProductUrl,
    isImage: isSuperPharmImage,
  },
};
