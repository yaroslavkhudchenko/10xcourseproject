import type { SupabaseClient } from "@supabase/supabase-js";
import { autoRefreshOf, repinShopOf, retryShopOf } from "@/lib/services/match-step";
import type { PriceComparisonShop, PricedShop } from "@/lib/services/price-comparison";
import { productPricesOf } from "@/lib/services/prices";
import type { ShopGate } from "@/lib/services/shop-gate";
import { runMatchSteps, type MatchStepResult } from "@/lib/services/shop-matching";
import { matchedShopsIn, type LoadedProduct } from "@/lib/services/watched-product";
import type { ListFilter } from "@/lib/services/watchlist-rows";

// A product's page, from the product it loaded (loadWatchedProduct) to what it shows, in one place the page and the
// seam table (price-pages.test.ts) both call: its matched shops, the shops its address may name, each matched shop's
// step and the island's prices. It stores through the user's own client and asks the shops only through the gate, so
// it runs on the server alone, like the guardian whose view it takes.

/** What a product's page opens with: the product it loaded, its address, and how it was opened. */
export interface ProductPageInput {
  /** The user's own client, which the steps store their automatic outcomes with and the prices are read through. */
  supabase: SupabaseClient;
  /** The gate every search goes through, charged to the shop it asks. */
  gate: ShopGate;
  /** The product the page shows, with where it stands in each of its matched shops (loadWatchedProduct). */
  loaded: LoadedProduct;
  /** The page's address, for `?repin=` and `?retry=`. */
  params: URLSearchParams;
  /** The request is the user's own navigation, as `isOwnNavigation` tells. */
  ownNavigation: boolean;
  /** The filter the list is shown with, which every link, form and redirect of the page keeps. */
  filter: ListFilter;
}

/**
 * What opening a product's page came to: a retry that stored its outcome, after which the page goes back to its plain
 * address (`retried`), or the page to show (`shown`): its matched shops, the only ones its decision notices may name,
 * each matched shop's step, the island's priced shops, whether their stored prices couldn't be read at all, and whether
 * the island may refetch out-of-date prices on its own.
 */
export type OpenedProductPage =
  | { kind: "retried" }
  | {
      kind: "shown";
      matchedShops: PricedShop[];
      steps: MatchStepResult[];
      shops: PriceComparisonShop[];
      pricesFailed: boolean;
      autoRefresh: boolean;
    };

/**
 * Opens a loaded product's page. Its matched shops are the guardian's (matchedShopsIn): every priced shop but its own,
 * the only ones its address may name, so `?repin=` or `?retry=` naming its own shop, or any other, opens the plain page
 * (repinShopOf, retryShopOf). It runs a step in each of them (runMatchSteps), which only the user's own navigation lets
 * ask a shop. A retry that stored its outcome comes back before any price is read, for the page to go to its plain
 * address. Otherwise the island's prices are read once the steps are done (productPricesOf), so a match a step has just
 * stored comes with the price it was found with, and the island refetches on its own only on the user's own navigation
 * with no re-pin's choice open (autoRefreshOf).
 */
export async function openProductPage({
  supabase,
  gate,
  loaded,
  params,
  ownNavigation,
  filter,
}: ProductPageInput): Promise<OpenedProductPage> {
  const matchedShops = matchedShopsIn(loaded.watched);
  const steps = await runMatchSteps({
    supabase,
    gate,
    loaded,
    retryShop: retryShopOf(params, matchedShops),
    repinShop: repinShopOf(params, matchedShops),
    ownNavigation,
    filter,
  });
  if (steps.some((each) => each.retried)) {
    // The plain address shows the stored outcome, so a `?retry=<shop>` left in the address bar can't repeat the lookup.
    return { kind: "retried" };
  }
  const { shops, pricesFailed } = await productPricesOf(supabase, loaded.product, steps);
  return {
    kind: "shown",
    matchedShops,
    steps,
    shops,
    pricesFailed,
    autoRefresh: autoRefreshOf(
      steps.map(({ step }) => step),
      ownNavigation,
    ),
  };
}
