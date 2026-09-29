import type { APIRoute } from "astro";
import { refuseJsonRequest } from "@/lib/json-request";
import { refreshPrices } from "@/lib/services/price-refresh";
import { priceRequestSchema, shopItemFor } from "@/lib/services/price-targets";
import { shopGateFor } from "@/lib/services/shop-gate";
import type { PriceCheck, PriceRefreshAnswer } from "@/types";

/** Why the route refused or failed a request, as a code in its JSON answer. */
type PriceRouteError = "unsupported" | "forbidden" | "invalid" | "config" | "gone" | "failed";

function json(status: number, body: PriceRefreshAnswer | { error: PriceRouteError }): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
// and stored as a shared observation, like every price. The request names the product and the shop, and the shop item
// to fetch comes from the user's own rows (price-targets.ts). Only the app's own pages may ask (json-request.ts), and
// the middleware answers a signed-out request with its redirect to the sign-in page.
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
  const parsed = priceRequestSchema.safeParse(body);
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
