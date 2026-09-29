import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { refuseJsonRequest } from "@/lib/json-request";
import { listMatches } from "@/lib/services/matches";
import { PRICED_SHOPS, type PricedShop } from "@/lib/services/price-comparison";
import { refreshPrices } from "@/lib/services/price-refresh";
import { shopGateFor } from "@/lib/services/shop-gate";
import { getWatchlistProduct, watchlistItemIdSchema } from "@/lib/services/watchlist";
import type { PriceCheck, PriceKey, PriceRefreshAnswer } from "@/types";

/** Why the route refused or failed a request, as a code in its JSON answer. */
type PriceRouteError = "unsupported" | "forbidden" | "invalid" | "config" | "gone" | "failed";

// Which of the user's products, and which shop. The shop item to fetch comes from the user's own rows, never from the
// request, so the browser can't choose what gets fetched.
const requestSchema = z.object({ itemId: watchlistItemIdSchema, shop: z.enum(PRICED_SHOPS) });

function json(status: number, body: PriceRefreshAnswer | { error: PriceRouteError }): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * The shop item a refresh of the user's product fetches: the product's own item for Rossmann, where it was picked, and
 * its matched item for Natura. Null when the product isn't on the user's list (RLS answers another user's product the
 * same way) or has no matched item in that shop; `failed` when the rows couldn't be read.
 */
async function shopItemFor(
  supabase: SupabaseClient,
  itemId: string,
  shop: PricedShop,
): Promise<PriceKey | null | "failed"> {
  if (shop === "rossmann") {
    const product = await getWatchlistProduct(supabase, itemId);
    if (product === "failed") {
      return "failed";
    }
    return product?.source === "rossmann" ? { shop, shopItemId: product.sourceItemId } : null;
  }
  const [product, matches] = await Promise.all([getWatchlistProduct(supabase, itemId), listMatches(supabase, itemId)]);
  if (product === "failed" || matches === null) {
    return "failed";
  }
  const match = matches.find((decision) => decision.shop === shop);
  return product !== null && match?.state === "matched" ? { shop, shopItemId: match.item.shopItemId } : null;
}

/** The answer for one check, stamped with the server's time after it. */
function answerFor(check: PriceCheck, saved: boolean): PriceRefreshAnswer {
  const checkedAt = new Date().toISOString();
  switch (check.kind) {
    case "price":
      return { kind: "price", offer: check.offer, checkedAt, saved };
    case "missing":
      return { kind: "missing", checkedAt, saved };
    case "unavailable":
      return check;
  }
}

// The product page's island refreshes one shop of one of the signed-in user's products here: fetched through the gate
// and stored as a shared observation, like every price. Only the app's own pages may ask (json-request.ts), and the
// middleware answers a signed-out request with its redirect to the sign-in page.
export const POST: APIRoute = async (context) => {
  // The request URL's origin, which Astro's own checkOrigin compares with too.
  const refusal = refuseJsonRequest(context.request.headers, context.url.origin);
  if (refusal === 403) {
    return json(403, { error: "forbidden" });
  }
  if (refusal === 415) {
    return json(415, { error: "unsupported" });
  }
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    // The body isn't JSON at all.
    return json(400, { error: "invalid" });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { error: "invalid" });
  }
  const supabase = context.locals.supabase;
  if (!supabase) {
    return json(503, { error: "config" });
  }

  const { itemId, shop } = parsed.data;
  // Read before any shop request: an unknown product or a shop without a match costs no request.
  const key = await shopItemFor(supabase, itemId, shop);
  if (key === "failed") {
    return json(503, { error: "failed" });
  }
  if (key === null) {
    return json(404, { error: "gone" });
  }
  const refresh = await refreshPrices(shopGateFor(supabase), supabase, [key]);
  // One item gives one check.
  const check: PriceCheck = refresh.results.at(0)?.check ?? { kind: "unavailable", reason: "failed" };
  return json(200, answerFor(check, refresh.saved === "saved"));
};
