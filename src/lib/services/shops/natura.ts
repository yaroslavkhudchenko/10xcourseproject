import { z } from "astro/zod";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import type { ShopGate } from "@/lib/services/shop-gate";
import { gateUnavailable } from "@/lib/services/shops/shop-outcome";
import { parseSize } from "@/lib/services/size";
import type { ShopCandidate, ShopSearch, Size } from "@/types";

// Natura's product search runs on Luigi's Box (research note §2.5): one query, an EAN or text, answered with hits.
const SEARCH_URL = "https://live.luigisbox.com/search";
/**
 * The public Luigi's Box tracker id from Natura's page (research note §2.5). It's kept here rather than read from the
 * 3.3 MB page at runtime; if Luigi's Box rejects it, update it here.
 */
export const NATURA_TRACKER_ID = "703598-939363";
// Each search waits at most 4 s for Natura, well inside the gate's own 8 s limit, so a lookup's two searches wait at
// most 8 s.
const SEARCH_TIMEOUT_MS = 4000;
const EAN = /^\d{8,14}$/;
// Natura's SKU, such as "NV89063". It goes into forms and URLs, so only these characters.
const SHOP_ITEM_ID = /^[A-Za-z0-9._-]+$/;
// The one host the recorded hits load their images from.
const IMAGE_HOST = "media.drogerienatura.pl";

// Only the fields a candidate uses; Luigi's Box sends many more, which are ignored. A product hit needs its SKU and a
// positive price. The other attributes are read one by one, so an odd value costs only that value, never the hit.
const hitSchema = z.object({
  url: z.string().max(PRODUCT_LIMITS.shopItemId).regex(SHOP_ITEM_ID),
  attributes: z.object({
    price_amount: z.number().positive(),
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
    // The gate has already logged why. Luigi's Box answers a tracker id it doesn't know with a 404.
    if (outcome.kind === "failed" && outcome.status === 404) {
      logFailure("tracker id rejected", "HTTP 404: NATURA_TRACKER_ID may have changed");
    }
    return gateUnavailable(outcome);
  }

  let body: unknown;
  try {
    // Read the body right away: the time limits cover it too.
    body = await outcome.response.json();
  } catch (error) {
    // Only the error's name: a parse error quotes the body, which can echo the user's search.
    logFailure("unreadable body", error instanceof Error ? error.name : typeof error);
    return { kind: "unavailable", reason: "failed" };
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    // Where the shape differs, not what the answer holds, for the same reason.
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")} ${issue.code}`);
    logFailure("unexpected response shape", issues.join("; "));
    return { kind: "unavailable", reason: "failed" };
  }

  // Luigi's Box can send a query suggestion among the products (research note §2.2); only products become candidates.
  const productHits = parsed.data.results.hits.filter(isProductHit);
  // Each hit is checked on its own, so one odd hit doesn't blank the whole search.
  const candidates = productHits.flatMap((hit) => {
    const candidate = toCandidate(hit);
    return candidate ? [candidate] : [];
  });
  const dropped = productHits.length - candidates.length;
  if (dropped > 0) {
    // How many, never which: a hit carries the product's name and EAN, which can echo the search.
    logFailure("hits dropped", `${dropped} of ${productHits.length} product hits`);
  }
  // Products that all fail their check point to a changed format, not to a product Natura doesn't sell: a lookup would
  // store that as "not found".
  if (productHits.length > 0 && candidates.length === 0) {
    return { kind: "unavailable", reason: "failed" };
  }
  return { kind: "results", candidates };
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
    price: attributes.price_amount,
  };
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

/** Keeps text within its limit, or drops it: a cut-off size or URL would be wrong, not just shorter. */
function within(value: string | null, max: number): string | null {
  return value !== null && value.length <= max ? value : null;
}

function logFailure(reason: string, detail: string): void {
  // eslint-disable-next-line no-console -- one line per unusable Natura answer; Workers observability collects it.
  console.warn(JSON.stringify({ event: "natura-search", reason, detail }));
}
