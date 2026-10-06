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
  fetchSuperPharmPrices,
  isSuperPharmImage,
  isSuperPharmItemId,
  isSuperPharmProductUrl,
  searchSuperPharm,
} from "@/lib/services/shops/super-pharm";
import type { PriceCheck, ShopSearch } from "@/types";

// Each shop the code can match a watched product in, mapped to its adapter in one place: the lookups search it, the
// decision form checks a decision's item ids and a confirmed candidate's links with it, and the price refresh fetches
// its pinned items. A shop has an entry here as soon as the code knows it; whether anything reaches it is
// MATCHED_SHOPS' to say. Server-only: the adapters call shops through the gate.

/** What the app asks of a matched shop's adapter. None of its calls ever throws. */
export interface ShopAdapter {
  /**
   * Searches the shop through the gate for an EAN of 8-14 digits or text that passed `searchQuerySchema`, asking for at
   * most `size` hits: the candidates (possibly none), or why the shop gave no answer.
   */
  search: (gate: ShopGate, query: string, size: number) => Promise<ShopSearch>;
  /**
   * Whether the shop's search finds an item by its EAN. Super-Pharm's index holds none (research note §2.3), so its
   * lookups search it by name alone: an EAN search there would spend a request to learn nothing.
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
