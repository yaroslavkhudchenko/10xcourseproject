import { z } from "astro/zod";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import type { ShopGate } from "@/lib/services/shop-gate";
import { amountOf, createLuigisBoxClient, eansOf, isUnreadAmount } from "@/lib/services/shops/luigis-box";
import { storableOffer } from "@/lib/services/shops/shop-offer";
import { httpsHost, textOf, within } from "@/lib/services/shops/shop-values";
import { parseSize } from "@/lib/services/size";
import type { PriceCheck, ShopCandidate, ShopOffer, ShopSearch, Size } from "@/types";

// Natura's product search runs on Luigi's Box (research note §2.5), through the shared client: one query, an EAN or
// text, answered with hits, and a filter by SKU without a query, which fetches several pinned items' prices at once.
// This module maps Natura's attributes.
/**
 * The public Luigi's Box tracker id from Natura's page (research note §2.5). It's kept here rather than read from the
 * 3.3 MB page at runtime; if Luigi's Box rejects it, update it here.
 */
export const NATURA_TRACKER_ID = "703598-939363";
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

const natura = createLuigisBoxClient({
  shop: "natura",
  trackerId: NATURA_TRACKER_ID,
  itemType: "product",
  idField: "sku",
  // The only attributes a price request asks for (Luigi's Box adds the title): a hit is then about 350 characters
  // instead of about 20 KB.
  priceFields: ["sku", "price_amount", "price_old_amount", "lowest_price", "availability"],
  log: { search: "natura-search", prices: "natura-prices", id: "SKU", tracker: "NATURA_TRACKER_ID" },
  toCandidate,
  toOffer,
  isItemId: isNaturaItemId,
  hasOddAvailability,
  // Each costs only itself when it can't be read (offerOf), so only its line shows a renamed or reformatted field.
  oddValues: [
    ["30-day low unread", (hit) => hasUnreadAmount(hit, "lowest_price")],
    ["regular price unread", (hit) => hasUnreadAmount(hit, "price_old_amount")],
  ],
});

/**
 * Searches Natura through the gate, asking for at most `size` hits. Resolves to the candidates (possibly none), or to
 * `unavailable` with the reason: the gate skipped or refused the call, the call failed, or the answer wasn't readable,
 * including an answer whose hits all fail their check, a hit that isn't a product among them, and an answer without
 * hits that doesn't say it matched none. It never throws. The query must already be an EAN of 8-14 digits or have
 * passed `searchQuerySchema`.
 */
export function searchNatura(gate: ShopGate, query: string, size: number): Promise<ShopSearch> {
  return natura.search(gate, query, size);
}

/**
 * Fetches the offers of pinned Natura items by SKU through the gate: one request per 50 SKUs, each after the one
 * before. Once Natura refuses, busy under the cap, paused or stopped, the SKUs of the requests after it get that same
 * answer with no request and no reservation. Resolves to a check for every SKU given: its offer, `missing` when Natura
 * answered without it, or `unavailable` when the SKU can't go into a filter, the gate skipped or refused its request,
 * or the answer wasn't readable, a hit that isn't a product included. It never throws.
 */
export function fetchNaturaPrices(gate: ShopGate, skus: string[]): Promise<Map<string, PriceCheck>> {
  return natura.fetchPrices(gate, skus);
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
    eans: eansOf(attributes.ean),
    productUrl: productUrl !== null && isNaturaProductUrl(productUrl) ? productUrl : null,
    imageUrl: imageUrl !== null && isNaturaImage(imageUrl) ? imageUrl : null,
    offer: offerOf(attributes),
  };
}

/** A price hit's offer as it can be stored, or null when the hit can't be read or its price can't be stored. */
function toOffer(raw: unknown): ShopOffer | null {
  const parsed = hitSchema.safeParse(raw);
  return parsed.success ? offerOf(parsed.data.attributes) : null;
}

/**
 * A hit's offer as it can be stored, or null when its price can't be: the price before a promotion comes from
 * `price_old_amount`, and the 30-day low from `lowest_price`, which Natura reports even without a promotion. Either one
 * that can't be read costs only itself, and is counted in a log line (hasUnreadAmount). Natura names no promotion's
 * end. Orderable online means an `availability` of 1; any value but 1 or 0 is counted in a log line too
 * (hasOddAvailability).
 */
function offerOf(attributes: z.infer<typeof hitSchema>["attributes"]): ShopOffer | null {
  return storableOffer({
    price: attributes.price_amount,
    regularPrice: amountOf(attributes.price_old_amount),
    lowestPrice30d: amountOf(attributes.lowest_price),
    promoEndsOn: null,
    available: attributes.availability === 1,
  });
}

/**
 * True for a hit whose `availability` isn't the number 1 or 0, such as one missing or sent as text: its offer reads
 * that as not orderable online (offerOf), and the client counts such hits in a log line.
 */
function hasOddAvailability(hit: unknown): boolean {
  const parsed = hitSchema.safeParse(hit);
  return parsed.success && parsed.data.attributes.availability !== 1 && parsed.data.attributes.availability !== 0;
}

/**
 * True for a hit whose optional price, `price_old_amount` or `lowest_price`, is there but can't be read
 * (isUnreadAmount): its offer goes without it (offerOf), and the client counts such hits in a log line.
 */
function hasUnreadAmount(hit: unknown, attribute: "price_old_amount" | "lowest_price"): boolean {
  const parsed = hitSchema.safeParse(hit);
  return parsed.success && isUnreadAmount(parsed.data.attributes[attribute]);
}

/**
 * True for a SKU that can go into a filter, so the only kind a decision can pin: the characters the table allows in a
 * shop item id, at most 40, with a letter or digit among them, so never a dot segment such as "..".
 */
export function isNaturaItemId(value: string): boolean {
  return value.length <= PRODUCT_LIMITS.shopItemId && SHOP_ITEM_ID.test(value) && /[A-Za-z0-9]/.test(value);
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
