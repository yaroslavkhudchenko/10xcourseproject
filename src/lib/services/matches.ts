import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { ERROR_PARAM, SHOP_PARAM, type DecisionCode } from "@/lib/notices";
import { linksOfShop, optionalText } from "@/lib/services/form-fields";
import { PRICED_SHOPS, type MatchableShop } from "@/lib/services/price-comparison";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import { SHOP_ADAPTERS } from "@/lib/services/shops/registry";
import { parseSize } from "@/lib/services/size";
import { watchlistItemIdSchema } from "@/lib/services/watchlist";
import { filterHref, type ListFilter } from "@/lib/services/watchlist-rows";
import {
  SHOP_IDS,
  type MatchedItem,
  type RepinnableMatch,
  type ShopId,
  type ShopLookup,
  type ShopMatch,
  type ShopMatchState,
  type Size,
} from "@/types";

// Each watched product's decision per shop (public.watchlist_matches), private to its user. Every read and write goes
// through the user's own client, so RLS keeps each user to their own decisions: a user reads, adds and changes only
// their own. RLS lets a user change their decision in any state, so each write narrows itself to the decision it
// expects (record). Each call gives up after 2 s, like the watchlist's.
const DATABASE_TIMEOUT_MS = 2000;
const TABLE = "watchlist_matches";

/**
 * A shop's own id for an item, such as Natura's SKU: the characters the table allows, within its limit. It goes into
 * a match's row and into a re-pin's `replaces` field, and names the item a product page shows in the island's price
 * request (price-targets.ts).
 */
export const shopItemIdSchema = z
  .string()
  .max(PRODUCT_LIMITS.shopItemId)
  .regex(/^[A-Za-z0-9._-]+$/);

// How a re-pin's `replaces` field names a match: this prefix, then the matched item's id.
const MATCHED_PREFIX = "matched:";

/**
 * The stored decision a re-pin's form was shown with: a match to one item, or the user's decline. The write replaces
 * only that decision, as a compare-and-swap, so a form from a stale tab can't overwrite a newer one.
 */
export type ExpectedDecision = { state: "matched"; shopItemId: string } | { state: "unmatched" };

/**
 * The `replaces` field a re-pin's forms post for the decision they were shown with: `matched:<the item's id>` for a
 * match, `unmatched` for the user's decline. The decision form reads it back (replacesSchema).
 */
export function replacesFieldOf(current: RepinnableMatch): string {
  return current.item === null ? "unmatched" : `${MATCHED_PREFIX}${current.item.shopItemId}`;
}

// A re-pin's `replaces` field, as replacesFieldOf writes it: anything else fails the form.
const replacesSchema = z.union([
  z.literal("unmatched").transform((): ExpectedDecision => ({ state: "unmatched" })),
  z
    .string()
    .startsWith(MATCHED_PREFIX)
    .transform((value) => value.slice(MATCHED_PREFIX.length))
    .pipe(shopItemIdSchema)
    .transform((shopItemId): ExpectedDecision => ({ state: "matched", shopItemId })),
]);

/**
 * What every decision names, for one of `shops`: the user's product and the shop, and a re-pin's the decision it
 * replaces. The route takes every priced shop (PRICED_SHOPS), any of which can be a product's matched shop, so a
 * decision for a shop that isn't switched on fails. The form doesn't say which shop is the product's own, and a
 * decision stored there is left out of every read of that product's decisions (the rules below).
 */
function decisionFieldsFor(shops: readonly MatchableShop[]) {
  return {
    itemId: watchlistItemIdSchema,
    shop: z.enum(shops),
    replaces: replacesSchema.optional(),
  };
}

/**
 * Whether the item ids a decision names, the candidate it confirms and the match a re-pin replaces, are ids its own
 * shop's items can have, as that shop's adapter reads them (SHOP_ADAPTERS): a form can't pin one shop's id on another.
 */
function itemIdsOfShop(shop: MatchableShop, confirmed: string | null, replaces: ExpectedDecision | undefined): boolean {
  const { isItemId } = SHOP_ADAPTERS[shop];
  return (
    (confirmed === null || isItemId(confirmed)) && (replaces?.state !== "matched" || isItemId(replaces.shopItemId))
  );
}

/**
 * The "To ten produkt" and "Żaden z nich" forms from a product's page, from a first choice or a re-pin's, for one of
 * `shops`. A confirmed candidate's fields come back from the page and end up in the user's row, so they're checked
 * against the same PRODUCT_LIMITS and the id and URL rules its shop's adapter applies (SHOP_ADAPTERS), and the size is
 * parsed again from its text.
 */
function matchFormSchemaFor(shops: readonly MatchableShop[]) {
  const decisionFields = decisionFieldsFor(shops);
  const schema = z.discriminatedUnion("action", [
    z.object({ ...decisionFields, action: z.literal("decline") }),
    z
      .object({
        ...decisionFields,
        action: z.literal("confirm"),
        shopItemId: shopItemIdSchema,
        name: z.string().trim().min(1).max(PRODUCT_LIMITS.name),
        brand: optionalText(PRODUCT_LIMITS.brand),
        sizeText: optionalText(PRODUCT_LIMITS.sizeText),
        eans: z.array(z.string().regex(/^\d{8,14}$/)).max(PRODUCT_LIMITS.eans),
        // Empty for none; the links that are there must be the decision's own shop's, which linksOfShop checks.
        productUrl: optionalText(PRODUCT_LIMITS.productUrl),
        imageUrl: optionalText(PRODUCT_LIMITS.imageUrl),
      })
      .refine(linksOfShop),
  ]);
  return schema.refine((fields) =>
    itemIdsOfShop(fields.shop, fields.action === "confirm" ? fields.shopItemId : null, fields.replaces),
  );
}

/** What the user decided for one shop: the candidate they confirmed, or "Żaden z nich". */
export type MatchDecision = { action: "confirm"; item: MatchedItem } | { action: "decline" };

/**
 * A posted decision, checked: which of the user's products, which shop, what the user chose, and, from a re-pin's
 * form, the decision it replaces; null from a first choice, which replaces only a lookup that found nothing.
 */
export interface MatchForm {
  itemId: string;
  shop: MatchableShop;
  decision: MatchDecision;
  replaces: ExpectedDecision | null;
}

/**
 * Reads a posted decision form for one of `shops`, the priced shops unless a test names others, or null when any field
 * fails its check, the shop included.
 */
export function parseMatchForm(form: FormData, shops: readonly MatchableShop[] = PRICED_SHOPS): MatchForm | null {
  const parsed = matchFormSchemaFor(shops).safeParse({
    itemId: form.get("itemId"),
    shop: form.get("shop"),
    // A first choice's forms post none.
    replaces: form.get("replaces") ?? undefined,
    action: form.get("action"),
    shopItemId: form.get("shopItemId"),
    name: form.get("name"),
    brand: form.get("brand") ?? "",
    sizeText: form.get("sizeText") ?? "",
    eans: form.getAll("eans"),
    productUrl: form.get("productUrl") ?? "",
    imageUrl: form.get("imageUrl") ?? "",
  });
  if (!parsed.success) {
    return null;
  }
  const fields = parsed.data;
  const replaces = fields.replaces ?? null;
  if (fields.action === "decline") {
    return { itemId: fields.itemId, shop: fields.shop, decision: { action: "decline" }, replaces };
  }
  const item: MatchedItem = {
    shopItemId: fields.shopItemId,
    brand: fields.brand,
    name: fields.name,
    sizeText: fields.sizeText,
    size: parseSize(fields.sizeText),
    eans: fields.eans,
    productUrl: fields.productUrl,
    imageUrl: fields.imageUrl,
  };
  return { itemId: fields.itemId, shop: fields.shop, decision: { action: "confirm", item }, replaces };
}

/** Why saving a decision failed, as a code the product's page turns into its own text. */
export type MatchError = "invalid" | "failed" | "config" | "gone";

/** The text the product's page shows for each error code. */
export const MATCH_ERRORS: Record<MatchError, string> = {
  invalid: "Nie udało się zapisać wyboru: nieprawidłowe dane.",
  failed: "Nie udało się zapisać wyboru. Spróbuj ponownie.",
  config: "Supabase nie jest skonfigurowany.",
  gone: "Nie udało się zapisać wyboru: tego produktu nie ma na Twojej liście.",
};

function isMatchError(code: string): code is MatchError {
  return Object.hasOwn(MATCH_ERRORS, code);
}

/** The text for an `?error=` code, or null for anything the app didn't send itself, so a link can't put words there. */
export function matchErrorMessage(code: string | null): string | null {
  return code !== null && isMatchError(code) ? MATCH_ERRORS[code] : null;
}

/** What a decision's post came to, as its product's page reads it back: a notice's code, or why it wasn't saved. */
export type DecisionOutcome = DecisionCode | { error: MatchError };

/**
 * Where a decision's post goes back to: its product's page with the shop the decision was for and a notice
 * (`?shop=natura&matched=1`, `declined=1`, `decided=1`) or an error's code (`?shop=natura&error=failed`), which the page
 * turns into its own text on that shop's card, keeping the list's filter. A post whose shop can't be read, which only a
 * crafted post sends, comes back without one. Without a valid product id, which only a crafted post lacks, the list
 * with its filter and no code: the list's codes belong to "Dodaj".
 */
export function decisionBackTo(
  itemId: string | null,
  shop: MatchableShop | null,
  outcome: DecisionOutcome,
  filter: ListFilter,
): string {
  if (itemId === null) {
    return filterHref("/watchlist", filter);
  }
  const code: Record<string, string> =
    typeof outcome === "string" ? { [outcome]: "1" } : { [ERROR_PARAM]: outcome.error };
  return filterHref(`/watchlist/${itemId}`, filter, shop === null ? code : { [SHOP_PARAM]: shop, ...code });
}

/**
 * What storing a decision came to. `decided`: the product's decision for the shop isn't the one the write expected to
 * replace, as after a double submit or from a stale tab, so it stands. `gone`: the product isn't on the user's list.
 */
export type RecordResult = "saved" | "decided" | "gone" | "failed";

// A decline or a lookup that found nothing carries none of the item's columns, as the table's checks require.
const NO_ITEM = {
  shop_item_id: null,
  name: null,
  brand: null,
  size_text: null,
  size_value: null,
  size_unit: null,
  eans: [],
  product_url: null,
  image_url: null,
};

/** The item's columns: a copy of what the shop showed for it, never its price. */
function itemColumns(item: MatchedItem) {
  return {
    shop_item_id: item.shopItemId,
    name: item.name,
    brand: item.brand,
    size_text: item.sizeText,
    size_value: item.size?.value ?? null,
    size_unit: item.size?.unit ?? null,
    eans: item.eans,
    product_url: item.productUrl,
    image_url: item.imageUrl,
  };
}

/**
 * Stores what a lookup decided on its own: an accepted candidate as an automatic match, or that it found nothing. It
 * changes only a lookup that found nothing, never a decision that's settled.
 */
export function recordLookup(
  supabase: SupabaseClient,
  itemId: string,
  shop: ShopId,
  outcome: Extract<ShopLookup, { kind: "accepted" | "not-found" }>,
): Promise<RecordResult> {
  const columns =
    outcome.kind === "accepted"
      ? { state: "matched", decided_by: "auto", ...itemColumns(outcome.candidate) }
      : { state: "not_found", decided_by: "auto", ...NO_ITEM };
  return record(supabase, itemId, shop, columns, null);
}

/**
 * Stores the user's decision for one shop: the candidate they confirmed, or "Żaden z nich". A re-pin's decision
 * replaces only the decision its form was shown with (`replaces`); a first choice's, only a lookup that found nothing.
 */
export function recordDecision(
  supabase: SupabaseClient,
  itemId: string,
  shop: ShopId,
  decision: MatchDecision,
  replaces: ExpectedDecision | null = null,
): Promise<RecordResult> {
  const columns =
    decision.action === "confirm"
      ? { state: "matched", decided_by: "user", ...itemColumns(decision.item) }
      : { state: "unmatched", decided_by: "user", ...NO_ITEM };
  return record(supabase, itemId, shop, columns, replaces);
}

/**
 * Inserts the product's decision for the shop, so a product no longer on the list reads `gone`. When it has one
 * already, the update changes it only while it's still the decision this write expects, as a compare-and-swap: the
 * one `replaces` names, its state and, for a match, its item, or without `replaces` a lookup that found nothing. RLS
 * lets the user change their own decision in any state, so the write narrows itself. The update asks for its rows
 * back, and no row back means the product's decision isn't the one expected: it was decided, or changed meanwhile.
 */
async function record(
  supabase: SupabaseClient,
  itemId: string,
  shop: ShopId,
  columns: Record<string, unknown>,
  replaces: ExpectedDecision | null,
): Promise<RecordResult> {
  const inserted = await supabase
    .from(TABLE)
    .insert({ watchlist_item_id: itemId, shop_id: shop, ...columns })
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (!inserted.error) {
    return "saved";
  }
  // The key to the user's own product: there's no such product on their list.
  if (inserted.error.code === "23503") {
    return "gone";
  }
  // Anything but the one-decision-per-shop key is a failure.
  if (inserted.error.code !== "23505") {
    logFailure("insert failed", inserted.error.message);
    return "failed";
  }

  const update = supabase
    .from(TABLE)
    .update({ ...columns, checked_at: new Date().toISOString() })
    .eq("watchlist_item_id", itemId)
    .eq("shop_id", shop);
  const expected =
    replaces === null
      ? update.eq("state", "not_found")
      : replaces.state === "matched"
        ? update.eq("state", "matched").eq("shop_item_id", replaces.shopItemId)
        : update.eq("state", "unmatched");
  const updated = await expected.select("id").abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (updated.error) {
    logFailure("update failed", updated.error.message);
    return "failed";
  }
  const rows: unknown = updated.data;
  if (!Array.isArray(rows)) {
    logFailure("unexpected update result", typeof rows);
    return "failed";
  }
  return rows.length > 0 ? "saved" : "decided";
}

// Only the columns a decision shows; the row's own id and owner stay in the database.
const COLUMNS =
  "watchlist_item_id, shop_id, state, decided_by, shop_item_id, name, brand, size_text, size_value, size_unit, eans, " +
  "product_url, image_url, checked_at";

const decisionColumns = {
  watchlist_item_id: z.string(),
  shop_id: z.enum(SHOP_IDS),
  decided_by: z.enum(["auto", "user"]),
  // A time the page can show: an unreadable one would make its clock throw.
  checked_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
};
// A matched item's size, in the two columns the table keeps together: both or neither.
const sizeColumns = {
  size_value: z.number().positive().nullable(),
  size_unit: z.enum(["ml", "g", "pcs"]).nullable(),
};

/** A matched item's size from its two columns, or null when it has none. */
function sizeOf(value: number | null, unit: Size["unit"] | null): Size | null {
  return value !== null && unit !== null ? { value, unit } : null;
}

const rowSchema = z.discriminatedUnion("state", [
  z.object({
    ...decisionColumns,
    state: z.literal("matched"),
    shop_item_id: z.string(),
    name: z.string(),
    brand: z.string().nullable(),
    size_text: z.string().nullable(),
    ...sizeColumns,
    eans: z.array(z.string()),
    product_url: z.string().nullable(),
    image_url: z.string().nullable(),
  }),
  z.object({ ...decisionColumns, state: z.enum(["unmatched", "not_found"]) }),
]);

// Both reads take the shops whose decisions they read, the priced shops unless a test names others, and read each row
// on its own, by four rules, so an odd row costs only the decisions it may be:
// 1. A row of a shop outside the list, known to the app or not, readable or odd, is left out: it holds no decision the
//    pages use, such as one stored while another shop was switched on.
// 2. An odd row of a listed shop costs only that shop's decision of its product.
// 3. An odd row whose shop can't be read may be any listed shop's, so it costs each of them, for its product.
// 4. An odd row whose product can't be read may be any product's, so it costs its shop's decision, or each listed shop's
//    when its shop can't be read either, of every product without a readable decision there.
// A product has one decision per shop, so a decision that was read stands beside any odd row. The rules hold per
// product: its list is its own matched shops, every priced shop but the one it was picked in (matchedShopsOf), so a
// row of its own shop, a decision or an odd row, is left out as one outside the list (rule 1). The reads can't know a
// product's own shop, since its row is read at the same time, so they read every priced shop, and whoever reads a
// product's decisions narrows them to its matched shops: the product page's steps run in those shops alone
// (runMatchSteps), a refetch reads a decision only in one of them (shopItemFor), a product's refresh keeps theirs
// (productTargets), and the list's rows and priced items theirs (matchStatesOf, listPricedItems). Narrowing a read to
// fewer shops gives what reading those shops alone gives.

/** A shop the reads use: one of `shops`, or undefined for any other value. */
function listedShop(shop: unknown, shops: readonly MatchableShop[]): MatchableShop | undefined {
  return shops.find((listed) => listed === shop);
}

// An odd row, read for its shop and its product alone, so it can still say whose decision couldn't be read.
const oddShopSchema = z.object({ shop_id: z.string() });
const oddProductSchema = z.object({ watchlist_item_id: z.string() });

/**
 * Whose decision an odd row may be (the rules above): null for a row of a shop outside `shops`, which holds none the
 * reads use; otherwise the product it names, null when that can't be read, and the listed shops it may be the decision
 * of, its own or every one of `shops` when its shop can't be read.
 */
function oddRowOf(
  raw: unknown,
  shops: readonly MatchableShop[],
): { product: string | null; shops: readonly MatchableShop[] } | null {
  const shop = oddShopSchema.safeParse(raw);
  let hidden = shops;
  if (shop.success) {
    const listed = listedShop(shop.data.shop_id, shops);
    if (listed === undefined) {
      return null;
    }
    hidden = [listed];
  }
  const product = oddProductSchema.safeParse(raw);
  return { product: product.success ? product.data.watchlist_item_id : null, shops: hidden };
}

/**
 * What one product's stored decisions came to: the decisions that were read, and the shops whose decision couldn't be,
 * each once. A listed shop in neither has no decision.
 */
export interface MatchesRead {
  matches: ShopMatch[];
  unreadable: MatchableShop[];
}

/**
 * One product's stored decisions in `shops`, read row by row (the rules above). A shop whose decision couldn't be read
 * is unreadable, never undecided: its page would take the dropped decision for none and look the product up there
 * again. Every row the query gives is the product's, whether or not its product can be read. Null only when the
 * decisions couldn't be read at all.
 */
export async function listMatches(
  supabase: SupabaseClient,
  itemId: string,
  shops: readonly MatchableShop[] = PRICED_SHOPS,
): Promise<MatchesRead | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq("watchlist_item_id", itemId)
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (error) {
    logFailure("list failed", error.message);
    return null;
  }
  const read = parseRows(data, rowSchema);
  if (read === null) {
    return null;
  }
  const matches = read.rows.filter((row) => listedShop(row.shop_id, shops) !== undefined).map(toMatch);
  const decided = new Set<ShopId>(matches.map((match) => match.shop));
  const hidden = new Set(read.odd.flatMap((raw) => oddRowOf(raw, shops)?.shops ?? []));
  return { matches, unreadable: shops.filter((shop) => hidden.has(shop) && !decided.has(shop)) };
}

// Only the columns the list needs: which product, which shop, where the product stands there, and a match's item, whose
// prices the list shows, with the item's brand and size and who decided on it, which tell an automatic match that
// differs from the product (FR-007). A match whose brand, size or decider can't be read is odd, never one that agrees.
const stateColumns = { watchlist_item_id: z.string(), shop_id: z.enum(SHOP_IDS) };
const stateRowSchema = z.discriminatedUnion("state", [
  z.object({
    ...stateColumns,
    state: z.literal("matched"),
    shop_item_id: z.string(),
    brand: z.string().nullable(),
    ...sizeColumns,
    decided_by: decisionColumns.decided_by,
  }),
  z.object({ ...stateColumns, state: z.enum(["unmatched", "not_found"]) }),
]);

/** A product's decision in one shop that came back odd. */
export interface UnreadDecision {
  watchlistItemId: string;
  shop: MatchableShop;
}

/**
 * Where the products on the list stand in the listed shops, the decisions that came back odd, by product and shop, so
 * the list never shows such a product as one still to be matched there, nor its match as one that agrees with it, and
 * the shops some odd row of which couldn't say which product it's about.
 */
export interface MatchStatesRead {
  states: ShopMatchState[];
  /** The decisions that couldn't be read, by product and shop, each once. */
  unread: UnreadDecision[];
  /**
   * The shops some odd row of which couldn't say which product it's about, each once. Such a row may be any product's
   * decision there, so the list counts every product without a readable decision there as one whose decision there
   * couldn't be read.
   */
  unattributed: MatchableShop[];
}

/**
 * Where each product on the user's list stands in `shops`, with a match's item id, brand and size and who decided on
 * it, read with one query for the whole list and only the columns the list needs. Each row is read on its own (the
 * rules above): odd rows, such as a match without its item or with a size it can't read, are logged, and the decisions
 * they may be reported by product and shop, or by shop alone when their product can't be read, which never empties
 * the list. Null only when the decisions couldn't be read at all.
 */
export async function listMatchStates(
  supabase: SupabaseClient,
  shops: readonly MatchableShop[] = PRICED_SHOPS,
): Promise<MatchStatesRead | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("watchlist_item_id, shop_id, state, shop_item_id, brand, size_value, size_unit, decided_by")
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (error) {
    logFailure("list failed", error.message);
    return null;
  }
  const read = parseRows(data, stateRowSchema);
  if (read === null) {
    return null;
  }
  const unread: UnreadDecision[] = [];
  const unattributed = new Set<MatchableShop>();
  for (const raw of read.odd) {
    const odd = oddRowOf(raw, shops);
    if (odd === null) {
      continue;
    }
    const { product } = odd;
    for (const shop of odd.shops) {
      if (product === null) {
        unattributed.add(shop);
      } else if (!unread.some((each) => each.watchlistItemId === product && each.shop === shop)) {
        unread.push({ watchlistItemId: product, shop });
      }
    }
  }
  return {
    states: read.rows.filter((row) => listedShop(row.shop_id, shops) !== undefined).map(toMatchState),
    unread,
    unattributed: shops.filter((shop) => unattributed.has(shop)),
  };
}

function toMatchState(row: z.infer<typeof stateRowSchema>): ShopMatchState {
  const decision = { watchlistItemId: row.watchlist_item_id, shop: row.shop_id };
  if (row.state !== "matched") {
    return { ...decision, state: row.state, shopItemId: null };
  }
  return {
    ...decision,
    state: "matched",
    shopItemId: row.shop_item_id,
    brand: row.brand,
    size: sizeOf(row.size_value, row.size_unit),
    decidedBy: row.decided_by,
  };
}

/**
 * Checks each row on its own, so one odd row doesn't hide the others: the rows that parse, and the ones that didn't,
 * as they came, whose count is logged. Null when the answer isn't a list.
 */
function parseRows<Row>(data: unknown, schema: z.ZodType<Row>): { rows: Row[]; odd: unknown[] } | null {
  if (!Array.isArray(data)) {
    logFailure("unexpected list shape", typeof data);
    return null;
  }
  const rows: Row[] = [];
  const odd: unknown[] = [];
  for (const raw of data) {
    const row = schema.safeParse(raw);
    if (row.success) {
      rows.push(row.data);
    } else {
      odd.push(raw);
    }
  }
  if (odd.length > 0) {
    logFailure("unexpected rows dropped", String(odd.length));
  }
  return { rows, odd };
}

function toMatch(row: z.infer<typeof rowSchema>): ShopMatch {
  const decision = {
    watchlistItemId: row.watchlist_item_id,
    shop: row.shop_id,
    decidedBy: row.decided_by,
    checkedAt: row.checked_at,
  };
  if (row.state !== "matched") {
    return { ...decision, state: row.state, item: null };
  }
  return {
    ...decision,
    state: "matched",
    item: {
      shopItemId: row.shop_item_id,
      brand: row.brand,
      name: row.name,
      sizeText: row.size_text,
      size: sizeOf(row.size_value, row.size_unit),
      eans: row.eans,
      productUrl: row.product_url,
      imageUrl: row.image_url,
    },
  };
}

function logFailure(reason: string, detail: string): void {
  // eslint-disable-next-line no-console -- one line per failed match query; Workers observability collects it.
  console.warn(JSON.stringify({ event: "watchlist-matches", reason, detail: detail.slice(0, 300) }));
}
