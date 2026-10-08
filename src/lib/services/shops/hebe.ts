import { z } from "astro/zod";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import type { ShopGate } from "@/lib/services/shop-gate";
import { amountOf, createLuigisBoxClient, eansOf, isUnreadAmount } from "@/lib/services/shops/luigis-box";
import { storableOffer } from "@/lib/services/shops/shop-offer";
import { httpsHost, textOf, valuesOf, within } from "@/lib/services/shops/shop-values";
import { parseSize, trailingSizeText } from "@/lib/services/size";
import type { PriceCheck, ShopCandidate, ShopOffer, ShopSearch, Size } from "@/types";

// Hebe's product search runs on Luigi's Box (research note §2.2), through the shared client: one query, an EAN or text,
// answered with hits, and a filter by item id without a query, which fetches several pinned items' prices at once.
// This module maps Hebe's attributes, as its answers recorded on 2026-10-02 and 2026-10-04 show them. A search also
// returns items Hebe lists but doesn't sell online (`searchable: [false]`), which a request without a query never
// returns, so a pinned one's price could never be refreshed: they are never offered.
/**
 * The public Luigi's Box tracker id from Hebe's script `LBX-505233.js` (research note §2.2). It's kept here rather than
 * read at runtime; if Luigi's Box rejects it, update it here.
 */
export const HEBE_TRACKER_ID = "421168-505233";
// Hebe's item id, the hit's `url` of 18 digits, such as "000000000000218807". It goes into forms and URLs, so only
// digits.
const ITEM_ID = /^\d+$/;
// The one host Hebe's product pages and images are on.
const HOST = "www.hebe.pl";

// Only the fields an offer uses: a price request asks for no others (Luigi's Box adds the title). An item needs its id
// and a positive price. A sale price, when there is one, is the price, so one that can't be read costs the hit rather
// than leaving the regular price as the price.
const offerHitSchema = z.object({
  url: z.string().max(PRODUCT_LIMITS.shopItemId).regex(ITEM_ID),
  attributes: z.object({
    price_amount: z.number().positive(),
    price_sale_amount: z.number().positive().optional(),
    price_omnibus_amount: z.unknown().optional(),
    online_flag: z.unknown().optional(),
  }),
});
// A search's item hit is offered only when it's an item Hebe sells online, with the fields a candidate shows. Those are
// read one by one, so an odd value costs only that value, never the hit. `Pojemność` isn't read: it gave 237 ml for a
// 300 ml item, and it's litres without a unit, so 0.100 is a 100 g soap.
const candidateHitSchema = offerHitSchema.extend({
  type: z.literal("item"),
  attributes: offerHitSchema.shape.attributes.extend({
    searchable: z.tuple([z.literal(true)]),
    "Nazwa wymagana przez prawo": z.unknown().optional(),
    title: z.unknown().optional(),
    ShortDescription: z.unknown().optional(),
    brand: z.unknown().optional(),
    EAN: z.unknown().optional(),
    web_url: z.unknown().optional(),
    image_link: z.unknown().optional(),
  }),
});
// An item Hebe lists but doesn't sell online, left out of a search as a query suggestion is. Any `searchable` other
// than `[true]` or `[false]` can't be read, so it costs the hit: a format change must not read as "found nothing".
const notSoldOnlineSchema = z.object({ attributes: z.object({ searchable: z.tuple([z.literal(false)]) }) });

const hebe = createLuigisBoxClient({
  shop: "hebe",
  trackerId: HEBE_TRACKER_ID,
  itemType: "item",
  idField: "ID",
  priceFields: ["price_amount", "price_sale_amount", "price_omnibus_amount", "online_flag"],
  log: { search: "hebe-search", prices: "hebe-prices", id: "ID", tracker: "HEBE_TRACKER_ID" },
  toCandidate,
  toOffer,
  isItemId: isHebeItemId,
  isNotSoldOnline: (hit) => notSoldOnlineSchema.safeParse(hit).success,
  hasOddAvailability: hasOddOnlineFlag,
  // It costs only itself when it can't be read (offerOf), so only its line shows a renamed or reformatted field.
  oddValues: [["30-day low unread", hasUnreadLowest]],
});

/**
 * Searches Hebe through the gate, asking for at most `size` hits. Resolves to the candidates (possibly none: an item
 * Hebe doesn't sell online is left out, as a query suggestion is), or to `unavailable` with the reason: the gate
 * skipped or refused the call, the call failed, or the answer wasn't readable, including an answer whose hits all fail
 * their check, a hit that isn't an item among them, and an answer without hits that doesn't say it matched none. It
 * never throws. The query must already be an EAN of 8-14 digits or have passed `searchQuerySchema`.
 */
export function searchHebe(gate: ShopGate, query: string, size: number): Promise<ShopSearch> {
  return hebe.search(gate, query, size);
}

/**
 * Fetches the offers of pinned Hebe items by id through the gate: one request per 50 ids, each after the one before.
 * Once Hebe refuses, busy under the cap, paused or stopped, the ids of the requests after it get that same answer with
 * no request and no reservation, and once two of its requests in a row failed, the ids after them get no request and
 * no reservation either (fetchPinnedPrices). Resolves to a check for every id given: its offer, `missing` when Hebe
 * answered without it (as it does for an item it no longer sells online), or `unavailable` when the id can't go into a
 * filter, the gate skipped or refused its request, the request was never sent, or the answer wasn't readable, a hit
 * that isn't an item included. It never throws.
 */
export function fetchHebePrices(gate: ShopGate, ids: string[]): Promise<Map<string, PriceCheck>> {
  return hebe.fetchPrices(gate, ids);
}

/** True for an https URL on www.hebe.pl: the only product pages a candidate links to. */
export function isHebeProductUrl(url: string): boolean {
  return httpsHost(url) === HOST;
}

/** True for an https URL on www.hebe.pl, where Hebe's product images are: the only images a candidate shows. */
export function isHebeImage(url: string): boolean {
  return httpsHost(url) === HOST;
}

/** A Luigi's Box hit as a candidate within PRODUCT_LIMITS, so it can always be confirmed; null when it can't be one. */
function toCandidate(raw: unknown): ShopCandidate | null {
  const parsed = candidateHitSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const { url, attributes } = parsed.data;
  // The legal name ends with the size, as on the package; the title is shorter, often without it.
  const legalName = textOf(attributes["Nazwa wymagana przez prawo"]);
  const name = legalName ?? textOf(attributes.title);
  if (name === null) {
    return null;
  }
  const { sizeText, size } = readSize(legalName, textOf(attributes.ShortDescription));
  const productUrl = within(textOf(attributes.web_url), PRODUCT_LIMITS.productUrl);
  const imageUrl = within(textOf(attributes.image_link), PRODUCT_LIMITS.imageUrl);
  return {
    shop: "hebe",
    shopItemId: url,
    brand: textOf(attributes.brand)?.slice(0, PRODUCT_LIMITS.brand) ?? null,
    name: name.slice(0, PRODUCT_LIMITS.name),
    sizeText,
    size,
    eans: eansOf(attributes.EAN),
    productUrl: productUrl !== null && isHebeProductUrl(productUrl) ? productUrl : null,
    imageUrl: imageUrl !== null && isHebeImage(imageUrl) ? imageUrl : null,
    offer: offerOf(attributes),
  };
}

/** A price hit's offer as it can be stored, or null when the hit can't be read or its price can't be stored. */
function toOffer(raw: unknown): ShopOffer | null {
  const parsed = offerHitSchema.safeParse(raw);
  return parsed.success ? offerOf(parsed.data.attributes) : null;
}

/**
 * A hit's offer as it can be stored, or null when its price can't be: the sale price while Hebe has one, with the
 * regular price before it, else the regular price. The 30-day low comes from `price_omnibus_amount`, which Hebe reports
 * without a sale too: one that can't be read costs only itself, and is counted in a log line (hasUnreadLowest).
 * Orderable online means `online_flag`, since `availability` is 1 even for an item Hebe doesn't sell online. Hebe
 * names no sale's end.
 */
function offerOf(attributes: z.infer<typeof offerHitSchema>["attributes"]): ShopOffer | null {
  const sale = attributes.price_sale_amount;
  return storableOffer({
    price: sale ?? attributes.price_amount,
    regularPrice: sale === undefined ? null : attributes.price_amount,
    lowestPrice30d: amountOf(attributes.price_omnibus_amount),
    promoEndsOn: null,
    available: valuesOf(attributes.online_flag)[0] === true,
  });
}

/**
 * True for an offer's hit whose `online_flag` isn't a yes or a no, such as one missing or sent as text: its offer reads
 * that as not orderable online (offerOf), and the client counts such hits in a log line.
 */
function hasOddOnlineFlag(hit: unknown): boolean {
  const parsed = offerHitSchema.safeParse(hit);
  return parsed.success && typeof valuesOf(parsed.data.attributes.online_flag)[0] !== "boolean";
}

/**
 * True for an offer's hit whose `price_omnibus_amount` is there but can't be read (isUnreadAmount): its offer goes
 * without a 30-day low (offerOf), and the client counts such hits in a log line.
 */
function hasUnreadLowest(hit: unknown): boolean {
  const parsed = offerHitSchema.safeParse(hit);
  return parsed.success && isUnreadAmount(parsed.data.attributes.price_omnibus_amount);
}

/**
 * True for an id that can go into a filter, so the only kind a decision can pin: digits only, at most as many as the
 * table allows in a shop item id.
 */
export function isHebeItemId(value: string): boolean {
  return value.length <= PRODUCT_LIMITS.shopItemId && ITEM_ID.test(value);
}

/**
 * Hebe's size: the size its legal name (`name`) ends with, such as "300 ml", else the one its short description ends
 * with, and the size it stands for, which parseSize reads back the same when a form posts the text. No such size, or
 * text over its limit, gives neither.
 */
function readSize(name: string | null, description: string | null): { sizeText: string | null; size: Size | null } {
  const trailing = (text: string | null) => (text === null ? null : trailingSizeText(text));
  const sizeText = within(trailing(name) ?? trailing(description), PRODUCT_LIMITS.sizeText);
  const size = parseSize(sizeText);
  return size === null ? { sizeText: null, size: null } : { sizeText, size };
}
