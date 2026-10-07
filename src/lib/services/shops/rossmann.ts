import { z } from "astro/zod";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import type { ShopGate } from "@/lib/services/shop-gate";
import { storableOffer } from "@/lib/services/shops/shop-offer";
import { gateUnavailable } from "@/lib/services/shops/shop-outcome";
import { countOf, kindOf } from "@/lib/services/shops/shop-values";
import { parseSize } from "@/lib/services/size";
import type { PriceCheck, ProductCandidate, ProductSearch, ShopOffer } from "@/types";

// Rossmann's own product search (research note §2.1): text only, one page of up to 24 items, several EANs per item.
const SEARCH_URL = "https://www.rossmann.pl/products/v4/api/Products";
// One product's detail by its id (research note §2.1), with its current offer: Rossmann has no batch route, so a
// pinned product's price is asked for one product per request.
const DETAIL_URL = "https://www.rossmann.pl/products/v2/api/Products";
// Each item's `navigateUrl` is a path on this site, such as "/Produkt/Kremy-do-twarzy/NIVEA-Soft-…,26900,13049".
const SITE_URL = "https://www.rossmann.pl";
const SITE_HOST = "www.rossmann.pl";
const PAGE_SIZE = 24;
// A search the user waits for gives up after 5 s, well inside the gate's own 8 s limit, and so does a price check.
const SEARCH_TIMEOUT_MS = 5000;
const PRICE_TIMEOUT_MS = 5000;
// Rossmann's product id, such as "26900". A stored id becomes a path, so only digits: never a dot segment like "..".
const PRODUCT_ID = /^\d{1,12}$/;

// Only the fields the watchlist uses; Rossmann sends many more, which are ignored. Pictures and EANs are checked one by
// one, so an odd value costs a thumbnail or an EAN, never the whole item.
const pictureSchema = z.object({ type: z.number().nullish(), medium: z.string().nullish() });
const itemSchema = z.object({
  id: z.union([z.number(), z.string()]),
  brand: z.string().nullish(),
  // Required, though it may be empty or null: every recorded item has it. Its fallbackName is only a generic
  // description, such as "Krem uniwersalny" beside the name "Soft ", which stands in where the name is empty (11790).
  // So an item without the field is dropped, rather than shown under that description as if it were its name.
  name: z.string().nullable(),
  fallbackName: z.string().nullish(),
  caption: z.string().nullish(),
  unit: z.string().nullish(),
  eanNumber: z.array(z.unknown()).nullish(),
  pictures: z.array(z.unknown()).nullish(),
  // Checked on its own too: an odd or missing one costs only the link.
  navigateUrl: z.unknown().optional(),
});
// `totalCount` is how many items the search matched, checked only when the answer holds none.
const responseSchema = z.object({
  data: z.object({ items: z.array(z.unknown()), totalCount: z.unknown().optional(), spellCheckHint: z.unknown() }),
});

// Only the fields an offer uses; the detail carries many more, which are ignored. The product's id and a numeric price
// are required. The other fields are read one by one, so an odd value costs only that value, never the offer.
const detailSchema = z.object({
  data: z.object({
    id: z.union([z.number(), z.string()]),
    price: z.number(),
    oldPrice: z.unknown().optional(),
    lastLowestPrice: z.unknown().optional(),
    promotionTo: z.unknown().optional(),
    availability: z.unknown().optional(),
  }),
});
const isoDate = z.iso.date();

/**
 * Searches Rossmann through the gate. Resolves to the candidates (possibly none) with Rossmann's spelling hint, or to
 * `unavailable` with the reason: the gate skipped or refused the call, the call failed, or the answer wasn't readable,
 * including one whose items all fail their check and one without items whose count isn't 0. It never throws. The
 * query must already have passed `searchQuerySchema`.
 */
export async function searchRossmann(gate: ShopGate, query: string): Promise<ProductSearch> {
  const url = `${SEARCH_URL}?search=${encodeURIComponent(query)}&page=1&pageSize=${PAGE_SIZE}`;
  const outcome = await gate.fetch("rossmann", url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (outcome.kind !== "ok") {
    // The gate has already logged why.
    return gateUnavailable(outcome);
  }
  const body = await readBody(outcome.response, responseSchema, "rossmann-search");
  if (body === null) {
    return { kind: "unavailable", reason: "failed" };
  }
  const { items, totalCount } = body.data;
  // No items means nothing matched only when Rossmann's own count says 0, as the recorded empty answer does: an empty
  // list beside another count, or without one, would show „Brak wyników” for a search whose answer changed.
  if (items.length === 0 && totalCount !== 0) {
    // Only the count, never anything else the answer holds.
    logFailure("rossmann-search", "unexpected empty answer", `0 items, totalCount ${countOf(totalCount)}`);
    return { kind: "unavailable", reason: "failed" };
  }

  // Each item is checked on its own, so one odd item doesn't blank the whole search.
  const candidates = items.flatMap((item) => {
    const candidate = toCandidate(item);
    return candidate ? [candidate] : [];
  });
  const dropped = items.length - candidates.length;
  if (dropped > 0) {
    // How many, never which: an item carries the product's name, which can echo the search.
    logFailure("rossmann-search", "items dropped", `${dropped} of ${items.length} items`);
  }
  // Items that all fail their check point to a changed format, not to a search that found nothing: the page would say
  // „Brak wyników”.
  if (items.length > 0 && candidates.length === 0) {
    return { kind: "unavailable", reason: "failed" };
  }
  const rawHint = body.data.spellCheckHint;
  const hint = typeof rawHint === "string" ? clean(rawHint) : null;
  // Rossmann answers a misspelling with results for its correction; a hint equal to the query says nothing new.
  const spellingHint = hint && hint.toLowerCase() !== query.toLowerCase() ? hint : null;
  return { kind: "results", candidates, spellingHint };
}

/**
 * Fetches a pinned Rossmann product's current offer by its id, through the gate. Resolves to the offer, to `missing`
 * when Rossmann answers that it has no such product (a 404 in `application/problem+json`, as
 * rossmann-detail-unknown.json recorded), or to `unavailable` with the reason: the id isn't one of Rossmann's, the
 * gate skipped or refused the call, the call failed (any other 404 included, such as a moved route's or a page's), or
 * the answer wasn't readable. It never throws. The stored id is checked again here, before it becomes a path.
 */
export async function fetchRossmannPrice(gate: ShopGate, sourceItemId: string): Promise<PriceCheck> {
  if (!PRODUCT_ID.test(sourceItemId)) {
    // Never the id itself: it names the product.
    logFailure("rossmann-price", "invalid product id", "not 1-12 digits, not sent");
    return { kind: "unavailable", reason: "failed" };
  }
  const outcome = await gate.fetch("rossmann", `${DETAIL_URL}/${sourceItemId}?shopNumber=null`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
  });
  if (outcome.kind !== "ok") {
    // The gate has already logged why, with the status and the media type. Only Rossmann's own "no such product", a
    // 404 in problem+json, says the product is gone: a 404 of another type, or of none, could be a moved route's,
    // which would mark every product gone for everyone who watches it. Any other refusal is no answer either.
    const gone =
      outcome.kind === "failed" && outcome.status === 404 && outcome.contentType === "application/problem+json";
    return gone ? { kind: "missing" } : gateUnavailable(outcome);
  }
  const body = await readBody(outcome.response, detailSchema, "rossmann-price");
  if (body === null) {
    return { kind: "unavailable", reason: "failed" };
  }
  const item = body.data;
  // An answer about another product would put its price on this one.
  if (String(item.id) !== sourceItemId) {
    logFailure("rossmann-price", "unexpected product", "the answer's id isn't the one asked for");
    return { kind: "unavailable", reason: "failed" };
  }
  const offer = toOffer(item);
  if (offer === null) {
    logFailure("rossmann-price", "unexpected offer", "price not above 0 and within PRICE_LIMITS");
    return { kind: "unavailable", reason: "failed" };
  }
  if (typeof item.availability !== "string") {
    // It reads as not orderable, so the price can't be named cheapest, and only this line shows a renamed field.
    const kind = kindOf(item.availability);
    logFailure("rossmann-price", "availability unread", `availability ${kind}, read as not orderable`);
  }
  return { kind: "price", offer };
}

/** True for an https URL on a rossmann.pl host: the only images the watchlist shows. */
export function isRossmannImage(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "rossmann.pl" || hostname.endsWith(".rossmann.pl"));
  } catch {
    return false;
  }
}

/** True for an https URL on Rossmann's shop site: the only product pages "Zobacz w sklepie" links to. */
export function isRossmannProductUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname === SITE_HOST;
  } catch {
    return false;
  }
}

/** Where a log line comes from: a search or a price check. */
type LogEvent = "rossmann-search" | "rossmann-price";

/**
 * An `ok` answer's body in the given shape, or null when it isn't JSON of that shape. Either is logged without the
 * answer's content, which can echo the user's search or name the product.
 */
async function readBody<T>(response: Response, schema: z.ZodType<T>, event: LogEvent): Promise<T | null> {
  let body: unknown;
  try {
    // Read the body right away: the time limits cover it too.
    body = await response.json();
  } catch (error) {
    // Only the error's name: a parse error quotes the body.
    logFailure(event, "unreadable body", error instanceof Error ? error.name : typeof error);
    return null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Where the shape differs, not what the answer holds, for the same reason.
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")} ${issue.code}`);
    logFailure(event, "unexpected response shape", issues.join("; "));
    return null;
  }
  return parsed.data;
}

/**
 * A detail's offer as it can be stored, or null when its price can't be. `oldPrice` is the price before a reduction
 * and `lastLowestPrice` the 30-day low, as rossmann-detail-reduced.json shows; an item without a reduction carries
 * neither. `promotionTo` has no UTC offset, so only its date is kept. Only an `availability` of "available" is
 * orderable online; one that's missing or isn't text is counted in a log line (fetchRossmannPrice).
 */
function toOffer(item: z.infer<typeof detailSchema>["data"]): ShopOffer | null {
  return storableOffer({
    price: item.price,
    regularPrice: typeof item.oldPrice === "number" ? item.oldPrice : null,
    lowestPrice30d: typeof item.lastLowestPrice === "number" ? item.lastLowestPrice : null,
    promoEndsOn: dateOf(item.promotionTo),
    available: item.availability === "available",
  });
}

/** The date of a time such as "2026-09-30T00:00:00", when it's a real date; null for anything else. */
function dateOf(value: unknown): string | null {
  const date = typeof value === "string" ? /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value.trim())?.[1] : undefined;
  return date !== undefined && isoDate.safeParse(date).success ? date : null;
}

/** A Rossmann item as a candidate within PRODUCT_LIMITS, so it can always be added; null when it can't be one. */
function toCandidate(raw: unknown): ProductCandidate | null {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const item = parsed.data;
  const sourceItemId = String(item.id);
  // Some items carry an empty name and keep it in fallbackName instead.
  const name = clean(item.name) ?? clean(item.fallbackName);
  if (!PRODUCT_ID.test(sourceItemId) || name === null) {
    return null;
  }
  const sizeText = within(clean(item.unit), PRODUCT_LIMITS.sizeText);
  return {
    source: "rossmann",
    sourceItemId,
    brand: cut(clean(item.brand), PRODUCT_LIMITS.brand),
    name: name.slice(0, PRODUCT_LIMITS.name),
    caption: cut(clean(item.caption), PRODUCT_LIMITS.caption),
    sizeText,
    size: parseSize(sizeText),
    eans: (item.eanNumber ?? [])
      .filter((ean): ean is string => typeof ean === "string" && /^\d{8,14}$/.test(ean))
      .slice(0, PRODUCT_LIMITS.eans),
    productUrl: productUrlFor(item.navigateUrl),
    imageUrl: pickImage(item.pictures ?? []),
  };
}

/**
 * The item's page from its `navigateUrl`, a path on Rossmann's site; null for anything else. A full or
 * protocol-relative URL could point anywhere, so only a path counts, and the result must still be on the site.
 */
function productUrlFor(navigateUrl: unknown): string | null {
  const path = typeof navigateUrl === "string" ? clean(navigateUrl) : null;
  if (path === null || !path.startsWith("/") || path.startsWith("//")) {
    return null;
  }
  const url = within(`${SITE_URL}${path}`, PRODUCT_LIMITS.productUrl);
  return url !== null && isRossmannProductUrl(url) ? url : null;
}

/**
 * The front shot's medium-sized image (type 1), or else the first picture's. Only URLs on Rossmann's hosts within the
 * limit count, so a picture without a usable URL is passed over rather than costing the thumbnail.
 */
function pickImage(pictures: unknown[]): string | null {
  const usable = pictures.flatMap((raw) => {
    const picture = pictureSchema.safeParse(raw);
    if (!picture.success) {
      return [];
    }
    const url = within(clean(picture.data.medium), PRODUCT_LIMITS.imageUrl);
    return url !== null && isRossmannImage(url) ? [{ type: picture.data.type, url }] : [];
  });
  return (usable.find((picture) => picture.type === 1) ?? usable.at(0))?.url ?? null;
}

/** Trims a text field, and treats an empty one as missing. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Cuts text to its limit. */
function cut(value: string | null, max: number): string | null {
  return value === null ? null : value.slice(0, max);
}

/** Keeps text within its limit, or drops it: a cut-off size or URL would be wrong, not just shorter. */
function within(value: string | null, max: number): string | null {
  return value !== null && value.length <= max ? value : null;
}

function logFailure(event: LogEvent, reason: string, detail: string): void {
  // eslint-disable-next-line no-console -- one line per unusable Rossmann answer; Workers observability collects it.
  console.warn(JSON.stringify({ event, reason, detail: detail.slice(0, 300) }));
}
