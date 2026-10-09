import { z } from "astro/zod";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import type { ShopGate } from "@/lib/services/shop-gate";
import {
  failed,
  FAILED_REQUESTS_BEFORE_STOP,
  failuresAfter,
  logOddValues,
  logRequestsStopped,
} from "@/lib/services/shops/pinned-prices";
import { storableOffer } from "@/lib/services/shops/shop-offer";
import { gateUnavailable, isRefusal, shopResponded } from "@/lib/services/shops/shop-outcome";
import { countOf, kindOf, within } from "@/lib/services/shops/shop-values";
import { parseSize } from "@/lib/services/size";
import { rowProductOf } from "@/lib/services/watchlist-rows";
import type {
  PriceCheck,
  ProductCandidate,
  ProductSearch,
  ShopCandidate,
  ShopOffer,
  ShopSearch,
  ShopUnavailable,
} from "@/types";

// Rossmann's own product search (research note §2.1): text only, one page of as many items as asked for, several EANs
// per item, and each item's offer in the same fields as its detail's.
const SEARCH_URL = "https://www.rossmann.pl/products/v4/api/Products";
// One product's detail by its id (research note §2.1), with its current offer: Rossmann has no batch route, so a
// pinned product's price is asked for one product per request.
const DETAIL_URL = "https://www.rossmann.pl/products/v2/api/Products";
// Each item's `navigateUrl` is a path on this site, such as "/Produkt/Kremy-do-twarzy/NIVEA-Soft-…,26900,13049".
const SITE_URL = "https://www.rossmann.pl";
const SITE_HOST = "www.rossmann.pl";
// A search the user waits for gives up after 5 s, well inside the gate's own 8 s limit, and so does a price check.
const SEARCH_TIMEOUT_MS = 5000;
const PRICE_TIMEOUT_MS = 5000;
// Rossmann's product id, such as "26900". A stored id becomes a path, so only digits: never a dot segment like "..".
const PRODUCT_ID = /^\d{1,12}$/;

// The fields an offer is read from, which a product's detail and a search's item both carry (research note §2.1). Each
// is read on its own (toOffer): a price that can't be stored costs the offer, and any other odd value only itself. A
// search's item needs no price: one whose price can't be stored is still a product to add, only without an offer.
const offerSchema = z.object({
  price: z.unknown().optional(),
  oldPrice: z.unknown().optional(),
  lastLowestPrice: z.unknown().optional(),
  promotionTo: z.unknown().optional(),
  availability: z.unknown().optional(),
});

// Only the fields the watchlist uses; Rossmann sends many more, which are ignored. Pictures, EANs and the offer's
// fields are checked one by one, so an odd value costs a thumbnail, an EAN or the offer, never the whole item.
const pictureSchema = z.object({ type: z.number().nullish(), medium: z.string().nullish() });
const itemSchema = offerSchema.extend({
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
  data: offerSchema.extend({ id: z.union([z.number(), z.string()]), price: z.number() }),
});
const isoDate = z.iso.date();

/** What an offer is read from: a product's detail or a search's item, each field as Rossmann sent it (toOffer). */
type OfferFields = z.infer<typeof offerSchema>;

/** A search's item as its parse reads it. */
type SearchItem = z.infer<typeof itemSchema>;

/**
 * Searches Rossmann through the gate for products the user can add, asking for at most `size` items. Resolves to the
 * candidates (possibly none) with Rossmann's spelling hint, or to `unavailable` with the reason: the gate skipped or
 * refused the call, the call failed, or the answer wasn't readable, including one whose items all fail their check and
 * one without items whose count isn't 0 (searchItems). It never throws. The query must already have passed
 * `searchQuerySchema`.
 */
export async function searchRossmann(gate: ShopGate, query: string, size: number): Promise<ProductSearch> {
  const found = await searchItems(gate, query, size);
  if (found.kind === "unavailable") {
    return found;
  }
  return { kind: "results", candidates: found.items.map(({ product }) => product), spellingHint: found.spellingHint };
}

/**
 * Searches Rossmann through the gate for a watched product's match there, asking for at most `size` items, by the same
 * rules as searchRossmann (searchItems): the candidates (possibly none), or `unavailable` with the reason. Each
 * candidate carries its item's offer, or none when its price can't be stored, so an automatic match brings its first
 * price, and its name with its caption, where Rossmann keeps the shade or the scent (toShopCandidate). It never throws.
 * The query must already have passed `searchQuerySchema`. An EAN finds nothing here (research note §2.1), so a lookup
 * never sends one (`searchesByEan` in the registry).
 */
export async function searchRossmannItems(gate: ShopGate, query: string, size: number): Promise<ShopSearch> {
  const found = await searchItems(gate, query, size);
  if (found.kind === "unavailable") {
    return found;
  }
  const kept = found.items.map(({ item, product }) => ({ item, candidate: toShopCandidate(product, toOffer(item)) }));
  // An item's availability is read only beside its offer, as a detail's is (priceCheckOf), so only an item with an
  // offer is counted.
  const offered = kept.flatMap(({ item, candidate }) => (candidate.offer === null ? [] : [item]));
  logOddValues("rossmann-search", [["availability unread", hasUnreadAvailability]], offered, found.total);
  return { kind: "results", candidates: kept.map(({ candidate }) => candidate) };
}

/** A search's item that can be a candidate: as Rossmann sent it, and as a product the user can add (productOf). */
interface FoundItem {
  item: SearchItem;
  product: ProductCandidate;
}

/**
 * What a search's answer came to (searchItems): its items that can be candidates, in Rossmann's order, how many items
 * it held, and Rossmann's spelling hint; or why there's none to read.
 */
type ItemsFound = { kind: "items"; items: FoundItem[]; total: number; spellingHint: string | null } | ShopUnavailable;

/**
 * Asks Rossmann's search for at most `size` items through the gate and reads its answer: the one parse both searches
 * share. Each item is checked on its own (readItem), and the answer comes with Rossmann's spelling hint. It's
 * `unavailable` with the reason when the gate skipped or refused the call, the call failed, or the answer wasn't
 * readable, including one whose items all fail their check and one without items whose count isn't 0. It never throws.
 */
async function searchItems(gate: ShopGate, query: string, size: number): Promise<ItemsFound> {
  const url = `${SEARCH_URL}?search=${encodeURIComponent(query)}&page=1&pageSize=${size}`;
  const outcome = await gate.fetch("rossmann", url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (outcome.kind !== "ok") {
    // The gate has already logged why.
    return gateUnavailable(outcome);
  }
  const read = await readBody(outcome.response, responseSchema, "rossmann-search");
  if (read.kind === "unread") {
    return { kind: "unavailable", reason: "failed" };
  }
  const { items, totalCount } = read.body.data;
  // No items means nothing matched only when Rossmann's own count says 0, as the recorded empty answer does: an empty
  // list beside another count, or without one, would show „Brak wyników” for a search whose answer changed.
  if (items.length === 0 && totalCount !== 0) {
    // Only the count, never anything else the answer holds.
    logFailure("rossmann-search", "unexpected empty answer", `0 items, totalCount ${countOf(totalCount)}`);
    return { kind: "unavailable", reason: "failed" };
  }

  // Each item is checked on its own, so one odd item doesn't blank the whole search.
  const found = items.flatMap((raw) => {
    const item = readItem(raw);
    return item ? [item] : [];
  });
  const dropped = items.length - found.length;
  if (dropped > 0) {
    // How many, never which: an item carries the product's name, which can echo the search.
    logFailure("rossmann-search", "items dropped", `${dropped} of ${items.length} items`);
  }
  // Items that all fail their check point to a changed format, not to a search that found nothing: the page would say
  // „Brak wyników”.
  if (items.length > 0 && found.length === 0) {
    return { kind: "unavailable", reason: "failed" };
  }
  const rawHint = read.body.data.spellCheckHint;
  const hint = typeof rawHint === "string" ? clean(rawHint) : null;
  // Rossmann answers a misspelling with results for its correction; a hint equal to the query says nothing new.
  const spellingHint = hint && hint.toLowerCase() !== query.toLowerCase() ? hint : null;
  return { kind: "items", items: found, total: items.length, spellingHint };
}

/**
 * Asks Rossmann for each product's offer, one request at a time in the order given. Once Rossmann refuses, the
 * products after it get that same answer with no request and no reservation. Only a request Rossmann gave no response
 * to counts toward the stop (requestRossmannPrice's `responded`): one that timed out, its body included, or failed on
 * the network, or that the counter's skip kept from being sent. Any answer Rossmann gave resets the count, whatever its
 * status or body: a redirect, a page or a detail that can't be used is about that one product, which stores nothing,
 * so a list refresh, asking the oldest checks first, would ask it first again, and counting it would keep the products
 * after it unasked on every list refresh. Once FAILED_REQUESTS_BEFORE_STOP requests in a row got no response, the
 * products after them get no request and no reservation either, and stay unanswered, counted in a log line. A product
 * whose id can't be Rossmann's (isRossmannProductId) is never sent, so it neither counts nor resets: the price check
 * still says why it's unanswered.
 */
export async function fetchRossmannPrices(gate: ShopGate, ids: string[]): Promise<Map<string, PriceCheck>> {
  const checks = new Map<string, PriceCheck>();
  let refusal: ShopUnavailable | null = null;
  let failures = 0;
  let unasked = 0;
  for (const id of ids) {
    if (refusal !== null) {
      checks.set(id, { ...refusal });
      continue;
    }
    // An id that can't be Rossmann's is never sent: its price check says why, at no request's cost.
    const sent = isRossmannProductId(id);
    if (sent && failures >= FAILED_REQUESTS_BEFORE_STOP) {
      checks.set(id, failed());
      unasked += 1;
      continue;
    }
    const { check, responded } = await requestRossmannPrice(gate, id);
    if (isRefusal(check)) {
      // It stops Rossmann on its own, so it leaves the count as it was.
      refusal = check;
    } else if (sent) {
      failures = responded ? 0 : failuresAfter(failures, check);
    }
    checks.set(id, check);
  }
  if (unasked > 0) {
    logRequestsStopped("rossmann-price", "product", unasked, ids.length);
  }
  return checks;
}

/**
 * Fetches a pinned Rossmann product's current offer by its id, through the gate. Resolves to the offer, to `missing`
 * when Rossmann answers that it has no such product (a 404 in `application/problem+json`, as
 * rossmann-detail-unknown.json recorded), or to `unavailable` with the reason: the id isn't one of Rossmann's, the
 * gate skipped or refused the call, the call failed (any other 404 included, such as a moved route's or a page's), or
 * the answer wasn't readable. It never throws. The stored id is checked again here, before it becomes a path.
 */
export async function fetchRossmannPrice(gate: ShopGate, sourceItemId: string): Promise<PriceCheck> {
  return (await requestRossmannPrice(gate, sourceItemId)).check;
}

/**
 * Fetches a pinned Rossmann product's current offer as fetchRossmannPrice does, and says beside its check whether
 * Rossmann responded to the request: true for any answer, whatever its status or body, an error status, a redirect, a
 * page or a detail that can't be used included (shopResponded); false for a request that got no response, one that
 * timed out, its body included, failed on the network or that the gate skipped, and for an id that's never sent. A
 * refresh, asking one product per request, counts only the requests Rossmann gave no response to
 * (fetchRossmannPrices). It never throws.
 */
async function requestRossmannPrice(
  gate: ShopGate,
  sourceItemId: string,
): Promise<{ check: PriceCheck; responded: boolean }> {
  if (!isRossmannProductId(sourceItemId)) {
    // Never the id itself: it names the product.
    logFailure("rossmann-price", "invalid product id", "not 1-12 digits, not sent");
    return { check: { kind: "unavailable", reason: "failed" }, responded: false };
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
    return { check: gone ? { kind: "missing" } : gateUnavailable(outcome), responded: shopResponded(outcome) };
  }
  const read = await readBody(outcome.response, detailSchema, "rossmann-price");
  if (read.kind === "unread") {
    // A body a time limit cut off is no response, as a request that timed out isn't: Rossmann sent its headers, and
    // the detail never came. Any other body that can't be read is Rossmann's answer.
    return { check: { kind: "unavailable", reason: "failed" }, responded: !read.timedOut };
  }
  return { check: priceCheckOf(read.body.data, sourceItemId), responded: true };
}

/** The price check a product's detail comes to, by the rules fetchRossmannPrice states. */
function priceCheckOf(item: z.infer<typeof detailSchema>["data"], sourceItemId: string): PriceCheck {
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
  if (hasUnreadAvailability(item)) {
    // It reads as not orderable, so the price can't be named cheapest, and only this line shows a renamed field.
    const kind = kindOf(item.availability);
    logFailure("rossmann-price", "availability unread", `availability ${kind}, read as not orderable`);
  }
  return { kind: "price", offer };
}

/**
 * True for an id that can go into a price check's path, so the only kind the price check sends: Rossmann's product id,
 * 1-12 digits, so never a dot segment such as "..". A refresh tells the ids it never sends apart by it, before asking,
 * and a decision can pin no other (`isItemId` in the registry).
 */
export function isRossmannProductId(value: string): boolean {
  return PRODUCT_ID.test(value);
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
 * What reading an `ok` answer's body came to: the body in its shape, or none, `timedOut` when a time limit cut the body
 * off before it had all come (readBody).
 */
type BodyRead<T> = { kind: "body"; body: T } | { kind: "unread"; timedOut: boolean };

/**
 * An `ok` answer's body in the given shape, or why there's none: a time limit cut it off before it had all come, it
 * couldn't be read otherwise, or it isn't JSON of that shape. Each is logged without the answer's content, which can
 * echo the user's search or name the product.
 */
async function readBody<T>(response: Response, schema: z.ZodType<T>, event: LogEvent): Promise<BodyRead<T>> {
  let body: unknown;
  try {
    // Read the body right away: the time limits cover it too.
    body = await response.json();
  } catch (error) {
    // Only the error's name: a parse error quotes the body.
    logFailure(event, "unreadable body", error instanceof Error ? error.name : typeof error);
    return { kind: "unread", timedOut: isTimeLimit(error) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Where the shape differs, not what the answer holds, for the same reason.
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")} ${issue.code}`);
    logFailure(event, "unexpected response shape", issues.join("; "));
    return { kind: "unread", timedOut: false };
  }
  return { kind: "body", body: parsed.data };
}

/**
 * True for what a body's read rejects with once a time limit fired before the body had all come: the signal's own
 * reason, a DOMException named TimeoutError, whether Rossmann's limit fired or the gate's, or one named AbortError,
 * which a runtime may give in its place. The request's signals are only those two limits, so no other abort is one.
 */
function isTimeLimit(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
}

/**
 * An offer as it can be stored, from a product's detail or a search's item alike, or null when its price can't be: a
 * price that isn't a number, or one storableOffer refuses. `oldPrice` is the price before a reduction and
 * `lastLowestPrice` the 30-day low, as rossmann-detail-reduced.json shows; an item without a reduction carries neither.
 * `promotionTo` has no UTC offset, so only its date is kept. Only an `availability` of "available" is orderable online;
 * one that can't be read is counted in a log line (hasUnreadAvailability).
 */
function toOffer(fields: OfferFields): ShopOffer | null {
  if (typeof fields.price !== "number") {
    return null;
  }
  return storableOffer({
    price: fields.price,
    regularPrice: typeof fields.oldPrice === "number" ? fields.oldPrice : null,
    lowestPrice30d: typeof fields.lastLowestPrice === "number" ? fields.lastLowestPrice : null,
    promoEndsOn: dateOf(fields.promotionTo),
    available: fields.availability === "available",
  });
}

/**
 * True for an offer's `availability` that can't be read: one that's missing or isn't text. Its offer reads it as not
 * orderable online (toOffer), so the price can't be named cheapest, and only a log line shows a renamed field: a price
 * check logs the value's kind (priceCheckOf), and a search counts its items (searchRossmannItems). Text other than
 * "available" is Rossmann's own answer that the item can't be ordered online, so it's never counted.
 */
function hasUnreadAvailability({ availability }: OfferFields): boolean {
  return typeof availability !== "string";
}

/** The date of a time such as "2026-09-30T00:00:00", when it's a real date; null for anything else. */
function dateOf(value: unknown): string | null {
  const date = typeof value === "string" ? /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value.trim())?.[1] : undefined;
  return date !== undefined && isoDate.safeParse(date).success ? date : null;
}

/** A search's item, read for both searches, or null when it can't be a candidate (productOf). */
function readItem(raw: unknown): FoundItem | null {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const product = productOf(parsed.data);
  return product === null ? null : { item: parsed.data, product };
}

/**
 * A product as a candidate the matching rule judges, within PRODUCT_LIMITS, so it can always be confirmed: the
 * product's fields and the given offer. A candidate has no caption, so its name carries the product's, where Rossmann
 * keeps the shade or the scent, joined as a row on the list joins them (rowProductOf). The one conversion both make:
 * Rossmann's item search, each item's product with its offer (toOffer), and the list's search, each shop's product
 * with none, which the rule doesn't read (searchEntriesOf in product-search.ts).
 */
export function toShopCandidate(product: ProductCandidate, offer: ShopOffer | null): ShopCandidate {
  return {
    shop: product.source,
    shopItemId: product.sourceItemId,
    brand: product.brand,
    name: rowProductOf(product).name.slice(0, PRODUCT_LIMITS.name),
    sizeText: product.sizeText,
    size: product.size,
    eans: product.eans,
    productUrl: product.productUrl,
    imageUrl: product.imageUrl,
    offer,
  };
}

/**
 * A search's item as a product the user can add, within PRODUCT_LIMITS, so it can always be added; null when it can't
 * be one.
 */
function productOf(item: SearchItem): ProductCandidate | null {
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

function logFailure(event: LogEvent, reason: string, detail: string): void {
  // eslint-disable-next-line no-console -- one line per unusable Rossmann answer; Workers observability collects it.
  console.warn(JSON.stringify({ event, reason, detail: detail.slice(0, 300) }));
}
