import { z } from "astro/zod";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import type { ShopGate } from "@/lib/services/shop-gate";
import { storableOffer } from "@/lib/services/shops/shop-offer";
import { gateUnavailable, isRefusal } from "@/lib/services/shops/shop-outcome";
import { parseSize } from "@/lib/services/size";
import type { GateOutcome, PriceCheck, ShopCandidate, ShopOffer, ShopSearch, ShopUnavailable, Size } from "@/types";

// Natura's product search runs on Luigi's Box (research note §2.5): one query, an EAN or text, answered with hits. The
// same endpoint also answers a filter by SKU without a query, which fetches several pinned items' prices at once.
const SEARCH_URL = "https://live.luigisbox.com/search";
/**
 * The public Luigi's Box tracker id from Natura's page (research note §2.5). It's kept here rather than read from the
 * 3.3 MB page at runtime; if Luigi's Box rejects it, update it here.
 */
export const NATURA_TRACKER_ID = "703598-939363";
// Each search waits at most 4 s for Natura, well inside the gate's own 8 s limit, so a lookup's two searches wait at
// most 8 s. Each price request waits as long.
const SEARCH_TIMEOUT_MS = 4000;
const PRICE_TIMEOUT_MS = 4000;
// The most SKUs one price request asks for; Luigi's Box documents up to 200 hits per answer.
const SKUS_PER_REQUEST = 50;
// The only attributes a price request asks for (Luigi's Box adds the title): a hit is then about 350 characters
// instead of about 20 KB.
const PRICE_FIELDS = "sku,price_amount,price_old_amount,lowest_price,availability";
const EAN = /^\d{8,14}$/;
// Natura's SKU, such as "NV89063". It goes into forms and URLs, so only these characters.
const SHOP_ITEM_ID = /^[A-Za-z0-9._-]+$/;
// The one host the recorded hits load their images from.
const IMAGE_HOST = "media.drogerienatura.pl";

// Only the fields a candidate or a price uses; Luigi's Box sends many more, which are ignored. A product hit needs its
// SKU and a positive price. The other attributes are read one by one, so an odd value costs only that value, never the
// hit.
const hitSchema = z.object({
  url: z.string().max(PRODUCT_LIMITS.shopItemId).regex(SHOP_ITEM_ID),
  attributes: z.object({
    price_amount: z.number().positive(),
    price_old_amount: z.unknown().optional(),
    lowest_price: z.unknown().optional(),
    availability: z.unknown().optional(),
    title: z.unknown().optional(),
    brand: z.unknown().optional(),
    size: z.unknown().optional(),
    size_unit: z.unknown().optional(),
    ean: z.unknown().optional(),
    web_url: z.unknown().optional(),
    image_link: z.unknown().optional(),
  }),
});
const responseSchema = z.object({ results: z.object({ hits: z.array(z.unknown()) }) });

/**
 * Searches Natura through the gate, asking for at most `size` hits. Resolves to the candidates (possibly none), or to
 * `unavailable` with the reason: the gate skipped or refused the call, the call failed, or the answer wasn't readable,
 * including an answer whose products all fail their check. It never throws. The query must already be an EAN of 8-14
 * digits or have passed `searchQuerySchema`.
 */
export async function searchNatura(gate: ShopGate, query: string, size: number): Promise<ShopSearch> {
  const url = `${SEARCH_URL}?tracker_id=${NATURA_TRACKER_ID}&q=${encodeURIComponent(query)}&size=${size}`;
  const outcome = await gate.fetch("natura", url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (outcome.kind !== "ok") {
    return naturaUnavailable(outcome, "natura-search");
  }
  const hits = await readHits(outcome.response, "natura-search");
  if (hits === null) {
    return { kind: "unavailable", reason: "failed" };
  }

  // Luigi's Box can send a query suggestion among the products (research note §2.2); only products become candidates.
  const productHits = hits.filter(isProductHit);
  // Each hit is checked on its own, so one odd hit doesn't blank the whole search.
  const candidates = productHits.flatMap((hit) => {
    const candidate = toCandidate(hit);
    return candidate ? [candidate] : [];
  });
  const dropped = productHits.length - candidates.length;
  if (dropped > 0) {
    // How many, never which: a hit carries the product's name and EAN, which can echo the search.
    logFailure("natura-search", "hits dropped", `${dropped} of ${productHits.length} product hits`);
  }
  // Products that all fail their check point to a changed format, not to a product Natura doesn't sell: a lookup would
  // store that as "not found".
  if (productHits.length > 0 && candidates.length === 0) {
    return { kind: "unavailable", reason: "failed" };
  }
  return { kind: "results", candidates };
}

/**
 * Fetches the offers of pinned Natura items by SKU through the gate: one request per 50 SKUs, each after the one
 * before. Once Natura refuses, busy under the cap, paused or stopped, the SKUs of the requests after it get that same
 * answer with no request and no reservation. Resolves to a check for every SKU given: its offer, `missing` when Natura
 * answered without it, or `unavailable` when the SKU can't go into a filter, the gate skipped or refused its request,
 * or the answer wasn't readable. It never throws.
 */
export async function fetchNaturaPrices(gate: ShopGate, skus: string[]): Promise<Map<string, PriceCheck>> {
  // Every SKU starts as unanswered, once each, in the order given; each SKU that's sent gets its request's answer.
  const checks = new Map<string, PriceCheck>();
  const sendable: string[] = [];
  for (const sku of new Set(skus)) {
    checks.set(sku, failed());
    if (isSku(sku)) {
      sendable.push(sku);
    }
  }
  const unsent = checks.size - sendable.length;
  if (unsent > 0) {
    // How many, never which: a SKU names the product.
    logFailure("natura-prices", "invalid SKUs", `${unsent} of ${checks.size} SKUs not sent`);
  }
  // A failed request doesn't stop the next one; a refusal does.
  let refusal: ShopUnavailable | null = null;
  for (let start = 0; start < sendable.length; start += SKUS_PER_REQUEST) {
    const batch = sendable.slice(start, start + SKUS_PER_REQUEST);
    if (refusal !== null) {
      for (const sku of batch) {
        checks.set(sku, { ...refusal });
      }
      continue;
    }
    for (const [sku, check] of await fetchPriceBatch(gate, batch)) {
      checks.set(sku, check);
      if (isRefusal(check)) {
        refusal = check;
      }
    }
  }
  return checks;
}

/**
 * True for a hit that stands for a product: its type says so, as on every recorded hit, or it has no type but carries
 * attributes. Anything else is a query suggestion.
 */
function isProductHit(hit: unknown): boolean {
  if (typeof hit !== "object" || hit === null) {
    return false;
  }
  const type = "type" in hit ? hit.type : undefined;
  if (type === "product") {
    return true;
  }
  const attributes = "attributes" in hit ? hit.attributes : undefined;
  return (
    (type === undefined || type === null) &&
    typeof attributes === "object" &&
    attributes !== null &&
    Object.keys(attributes).length > 0
  );
}

/** True for an https URL on drogerienatura.pl or one of its subdomains: the only product pages a candidate links to. */
export function isNaturaProductUrl(url: string): boolean {
  const host = httpsHost(url);
  return host !== null && (host === "drogerienatura.pl" || host.endsWith(".drogerienatura.pl"));
}

/** True for an https URL on the host Natura's product images come from: the only images a candidate shows. */
export function isNaturaImage(url: string): boolean {
  return httpsHost(url) === IMAGE_HOST;
}

/** A Luigi's Box hit as a candidate within PRODUCT_LIMITS, so it can always be confirmed; null when it can't be one. */
function toCandidate(raw: unknown): ShopCandidate | null {
  const parsed = hitSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const { url, attributes } = parsed.data;
  const name = textOf(attributes.title);
  if (name === null) {
    return null;
  }
  const { sizeText, size } = readSize(attributes.size, attributes.size_unit);
  const productUrl = within(textOf(attributes.web_url), PRODUCT_LIMITS.productUrl);
  const imageUrl = within(textOf(attributes.image_link), PRODUCT_LIMITS.imageUrl);
  return {
    shop: "natura",
    shopItemId: url,
    brand: textOf(attributes.brand)?.slice(0, PRODUCT_LIMITS.brand) ?? null,
    name: name.slice(0, PRODUCT_LIMITS.name),
    sizeText,
    size,
    eans: valuesOf(attributes.ean)
      .filter((ean): ean is string => typeof ean === "string" && EAN.test(ean))
      .slice(0, PRODUCT_LIMITS.eans),
    productUrl: productUrl !== null && isNaturaProductUrl(productUrl) ? productUrl : null,
    imageUrl: imageUrl !== null && isNaturaImage(imageUrl) ? imageUrl : null,
    offer: toOffer(attributes),
  };
}

/**
 * A hit's offer as it can be stored, or null when its price can't be: the price before a promotion comes from
 * `price_old_amount`, and the 30-day low from `lowest_price`, which Natura reports even without a promotion. Natura
 * names no promotion's end.
 */
function toOffer(attributes: z.infer<typeof hitSchema>["attributes"]): ShopOffer | null {
  return storableOffer({
    price: attributes.price_amount,
    regularPrice: amountOf(attributes.price_old_amount),
    lowestPrice30d: amountOf(attributes.lowest_price),
    promoEndsOn: null,
    available: attributes.availability === 1,
  });
}

/** One price request for up to 50 SKUs, and each SKU's check from its answer. */
async function fetchPriceBatch(gate: ShopGate, skus: string[]): Promise<Map<string, PriceCheck>> {
  const outcome = await gate.fetch("natura", priceUrl(skus), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
  });
  if (outcome.kind !== "ok") {
    const unavailable = naturaUnavailable(outcome, "natura-prices");
    return new Map(skus.map((sku): [string, PriceCheck] => [sku, { ...unavailable }]));
  }
  const hits = await readHits(outcome.response, "natura-prices");
  if (hits === null) {
    return new Map(skus.map((sku): [string, PriceCheck] => [sku, failed()]));
  }

  const asked = new Set(skus);
  const productHits = hits.filter(isProductHit);
  const offers = new Map<string, ShopOffer>();
  let dropped = 0;
  let notAsked = 0;
  for (const raw of productHits) {
    const hit = hitSchema.safeParse(raw);
    const offer = hit.success ? toOffer(hit.data.attributes) : null;
    if (!hit.success || offer === null) {
      dropped++;
      continue;
    }
    if (asked.has(hit.data.url)) {
      offers.set(hit.data.url, offer);
    } else {
      notAsked++;
    }
  }
  // How many, never which: a hit carries the product's SKU and name.
  if (dropped > 0) {
    logFailure("natura-prices", "hits dropped", `${dropped} of ${productHits.length} product hits`);
  }
  if (notAsked > 0) {
    // Hits for SKUs nobody asked for mean the SKU filter wasn't applied.
    logFailure("natura-prices", "hits not asked for", `${notAsked} of ${productHits.length} product hits`);
  }
  // A SKU without a hit is missing only when every hit was read and was one asked for. Otherwise an unread hit could
  // be that SKU's, and a changed format would be stored as items Natura no longer sells: so, as in searchNatura, hits
  // that all fail their check make every SKU unavailable.
  const clear = dropped === 0 && notAsked === 0;
  return new Map(
    skus.map((sku): [string, PriceCheck] => {
      const offer = offers.get(sku);
      if (offer !== undefined) {
        return [sku, { kind: "price", offer }];
      }
      return [sku, clear ? { kind: "missing" } : failed()];
    }),
  );
}

/**
 * The price request for the given SKUs: products only, one `f[]=sku:` filter per SKU, which Luigi's Box combines with
 * OR, no query, as many hits as SKUs and only the price attributes. Each SKU is a parameter of its own, never joined
 * into one value.
 */
function priceUrl(skus: string[]): string {
  const params = new URLSearchParams();
  params.append("tracker_id", NATURA_TRACKER_ID);
  params.append("f[]", "type:product");
  for (const sku of skus) {
    params.append("f[]", `sku:${sku}`);
  }
  params.append("size", String(skus.length));
  params.append("hit_fields", PRICE_FIELDS);
  return `${SEARCH_URL}?${params.toString()}`;
}

/**
 * True for a SKU that can go into a filter: the characters the table allows in a shop item id, at most 40, with a
 * letter or digit among them, so never a dot segment such as "..".
 */
function isSku(value: string): boolean {
  return value.length <= PRODUCT_LIMITS.shopItemId && SHOP_ITEM_ID.test(value) && /[A-Za-z0-9]/.test(value);
}

/** Where a log line comes from: a search or a price request. */
type LogEvent = "natura-search" | "natura-prices";

/** Says why the gate produced no answer, and flags a 404: Luigi's Box answers a tracker id it doesn't know with one. */
function naturaUnavailable(outcome: Exclude<GateOutcome, { kind: "ok" }>, event: LogEvent): ShopUnavailable {
  // The gate has already logged why.
  if (outcome.kind === "failed" && outcome.status === 404) {
    logFailure(event, "tracker id rejected", "HTTP 404: NATURA_TRACKER_ID may have changed");
  }
  return gateUnavailable(outcome);
}

/** An `ok` answer's hits, or null when it isn't JSON with a list of hits. Either is logged without the answer. */
async function readHits(response: Response, event: LogEvent): Promise<unknown[] | null> {
  let body: unknown;
  try {
    // Read the body right away: the time limits cover it too.
    body = await response.json();
  } catch (error) {
    // Only the error's name: a parse error quotes the body, which can echo the user's search.
    logFailure(event, "unreadable body", error instanceof Error ? error.name : typeof error);
    return null;
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    // Where the shape differs, not what the answer holds, for the same reason.
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")} ${issue.code}`);
    logFailure(event, "unexpected response shape", issues.join("; "));
    return null;
  }
  return parsed.data.results.hits;
}

/** A shop answer that couldn't be used, fresh for each SKU. */
function failed(): ShopUnavailable {
  return { kind: "unavailable", reason: "failed" };
}

/**
 * Natura's size, such as "300.0000" and "ml", as text like "300 ml" or "0,5 l", with the size it stands for. The text
 * drops trailing zeros and writes a fraction with a decimal comma, so parseSize reads it back as the same size when a
 * form posts it. A size that doesn't parse, or text over its limit, gives neither.
 */
function readSize(amountAttribute: unknown, unitAttribute: unknown): { sizeText: string | null; size: Size | null } {
  const amount = textOf(amountAttribute);
  const unit = textOf(unitAttribute);
  if (amount === null || unit === null || !/^\d+(?:[.,]\d+)?$/.test(amount)) {
    return { sizeText: null, size: null };
  }
  const [whole, fraction = ""] = amount.split(/[.,]/);
  const decimals = fraction.replace(/0+$/, "");
  const number = decimals === "" ? whole : `${whole},${decimals}`;
  const sizeText = within(`${number} ${unit}`, PRODUCT_LIMITS.sizeText);
  const size = parseSize(sizeText);
  return size === null ? { sizeText: null, size: null } : { sizeText, size };
}

/** The host of an https URL, or null for any other URL and for text that isn't one. */
function httpsHost(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" ? hostname : null;
  } catch {
    return null;
  }
}

/** A Luigi's Box attribute's values: most attributes come as a list, a few (such as `title`) as a single value. */
function valuesOf(attribute: unknown): unknown[] {
  return Array.isArray(attribute) ? attribute : [attribute];
}

/** An attribute's first value as trimmed text, or null when it isn't text or is empty. */
function textOf(attribute: unknown): string | null {
  const [value] = valuesOf(attribute);
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

/** An attribute's first value as an amount: a number, or decimal text such as "17.990000"; null for anything else. */
function amountOf(attribute: unknown): number | null {
  const [value] = valuesOf(attribute);
  if (typeof value === "number") {
    return value;
  }
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}

/** Keeps text within its limit, or drops it: a cut-off size or URL would be wrong, not just shorter. */
function within(value: string | null, max: number): string | null {
  return value !== null && value.length <= max ? value : null;
}

function logFailure(event: LogEvent, reason: string, detail: string): void {
  // eslint-disable-next-line no-console -- one line per unusable Natura answer; Workers observability collects it.
  console.warn(JSON.stringify({ event, reason, detail }));
}
