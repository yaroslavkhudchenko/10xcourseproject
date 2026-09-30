import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { optionalText, optionalUrl } from "@/lib/services/form-fields";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import { isNaturaImage, isNaturaProductUrl } from "@/lib/services/shops/natura";
import { parseSize } from "@/lib/services/size";
import { watchlistItemIdSchema } from "@/lib/services/watchlist";
import { SHOP_IDS, type MatchedItem, type ShopId, type ShopLookup, type ShopMatch, type ShopMatchState } from "@/types";

// Each watched product's decision per shop (public.watchlist_matches), private to its user. Every read and write goes
// through the user's own client, so RLS does the enforcing: a user reads and adds only their own decisions, and
// changes only a lookup that found nothing. Each call gives up after 2 s, like the watchlist's.
const DATABASE_TIMEOUT_MS = 2000;
const TABLE = "watchlist_matches";

// Every decision names the user's product and the shop. Only Natura asks the user for now.
const decisionFields = { itemId: watchlistItemIdSchema, shop: z.literal("natura") };

/**
 * The "To ten produkt" and "Żaden z nich" forms from a product's page. A confirmed candidate's fields come back from
 * the page and end up in the user's row, so they're checked against the same PRODUCT_LIMITS and Natura URL rules the
 * adapter applies, and the size is parsed again from its text.
 */
const matchFormSchema = z.discriminatedUnion("action", [
  z.object({ ...decisionFields, action: z.literal("decline") }),
  z.object({
    ...decisionFields,
    action: z.literal("confirm"),
    shopItemId: z
      .string()
      .max(PRODUCT_LIMITS.shopItemId)
      .regex(/^[A-Za-z0-9._-]+$/),
    name: z.string().trim().min(1).max(PRODUCT_LIMITS.name),
    brand: optionalText(PRODUCT_LIMITS.brand),
    sizeText: optionalText(PRODUCT_LIMITS.sizeText),
    eans: z.array(z.string().regex(/^\d{8,14}$/)).max(PRODUCT_LIMITS.eans),
    productUrl: optionalUrl(PRODUCT_LIMITS.productUrl, isNaturaProductUrl),
    imageUrl: optionalUrl(PRODUCT_LIMITS.imageUrl, isNaturaImage),
  }),
]);

/** What the user decided for one shop: the candidate they confirmed, or "Żaden z nich". */
export type MatchDecision = { action: "confirm"; item: MatchedItem } | { action: "decline" };

/** A posted decision, checked: which of the user's products, which shop, and what the user chose. */
export interface MatchForm {
  itemId: string;
  shop: ShopId;
  decision: MatchDecision;
}

/** Reads a posted decision form, or null when any field fails its check. */
export function parseMatchForm(form: FormData): MatchForm | null {
  const parsed = matchFormSchema.safeParse({
    itemId: form.get("itemId"),
    shop: form.get("shop"),
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
  if (fields.action === "decline") {
    return { itemId: fields.itemId, shop: fields.shop, decision: { action: "decline" } };
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
  return { itemId: fields.itemId, shop: fields.shop, decision: { action: "confirm", item } };
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

/**
 * What storing a decision came to. `decided`: the product already has a decision for the shop that can't change, as
 * after a double submit or in a second tab. `gone`: the product isn't on the user's list.
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

/** Stores what a lookup decided on its own: an accepted candidate as an automatic match, or that it found nothing. */
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
  return record(supabase, itemId, shop, columns);
}

/** Stores the user's decision for one shop: the candidate they confirmed, or "Żaden z nich". */
export function recordDecision(
  supabase: SupabaseClient,
  itemId: string,
  shop: ShopId,
  decision: MatchDecision,
): Promise<RecordResult> {
  const columns =
    decision.action === "confirm"
      ? { state: "matched", decided_by: "user", ...itemColumns(decision.item) }
      : { state: "unmatched", decided_by: "user", ...NO_ITEM };
  return record(supabase, itemId, shop, columns);
}

/**
 * Inserts the product's decision for the shop. When it has one already, only a lookup that found nothing may change,
 * so the update asks for its rows back: RLS filters a decided row out without an error, and no row back means the
 * product was already decided.
 */
async function record(
  supabase: SupabaseClient,
  itemId: string,
  shop: ShopId,
  columns: Record<string, unknown>,
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

  const updated = await supabase
    .from(TABLE)
    .update({ ...columns, checked_at: new Date().toISOString() })
    .eq("watchlist_item_id", itemId)
    .eq("shop_id", shop)
    .eq("state", "not_found")
    .select("id")
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
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
const rowSchema = z.discriminatedUnion("state", [
  z.object({
    ...decisionColumns,
    state: z.literal("matched"),
    shop_item_id: z.string(),
    name: z.string(),
    brand: z.string().nullable(),
    size_text: z.string().nullable(),
    size_value: z.number().positive().nullable(),
    size_unit: z.enum(["ml", "g", "pcs"]).nullable(),
    eans: z.array(z.string()),
    product_url: z.string().nullable(),
    image_url: z.string().nullable(),
  }),
  z.object({ ...decisionColumns, state: z.enum(["unmatched", "not_found"]) }),
]);

/**
 * The user's stored decisions: for one product, or for the whole list without `itemId`. Null when they couldn't be
 * read. For one product, an odd row fails the read too: its page would take the dropped decision for none and look the
 * product up in the shop again. The whole list keeps the rows that parse.
 */
export async function listMatches(supabase: SupabaseClient, itemId?: string): Promise<ShopMatch[] | null> {
  const query = supabase.from(TABLE).select(COLUMNS);
  const { data, error } = await (itemId === undefined ? query : query.eq("watchlist_item_id", itemId)).abortSignal(
    AbortSignal.timeout(DATABASE_TIMEOUT_MS),
  );
  if (error) {
    logFailure("list failed", error.message);
    return null;
  }
  const read = parseRows(data, rowSchema);
  if (read === null || (itemId !== undefined && read.odd.length > 0)) {
    return null;
  }
  return read.rows.map(toMatch);
}

// Only the columns the list needs: which product, which shop, where the product stands there, and a match's item, whose
// prices the list shows.
const stateColumns = { watchlist_item_id: z.string(), shop_id: z.enum(SHOP_IDS) };
const stateRowSchema = z.discriminatedUnion("state", [
  z.object({ ...stateColumns, state: z.literal("matched"), shop_item_id: z.string() }),
  z.object({ ...stateColumns, state: z.enum(["unmatched", "not_found"]) }),
]);
// An odd row, read for its shop and its product alone, so it can still say whose decision couldn't be read. A shop the
// app doesn't know holds no decision any page reads, whatever the row's product; a shop that can't be read may be any.
const oddShopSchema = z.object({ shop_id: z.string() });
const knownShopSchema = z.enum(SHOP_IDS);
const stateProductSchema = z.object({ watchlist_item_id: stateColumns.watchlist_item_id });

/**
 * Where the products on the list stand in each shop, the products some of whose decisions came back odd, so the list
 * never shows such a product as one still to be matched, and how many odd rows couldn't say which product they're about.
 */
export interface MatchStatesRead {
  states: ShopMatchState[];
  /** The ids of the products with a decision that couldn't be read, each once. */
  unread: string[];
  /**
   * How many odd rows couldn't say which product they're about. Such a row may be any product's decision, so the list
   * counts every product without a readable decision as one whose decision couldn't be read.
   */
  unattributed: number;
}

/**
 * Where each product on the user's list stands in each shop, with a match's item id, read with one query for the whole
 * list and only the columns the list needs. Odd rows, such as a match without its item, are logged, their products
 * reported and those without one counted, which never empties the list; an odd row of a shop the app doesn't know is
 * left out. Null only when the decisions couldn't be read at all.
 */
export async function listMatchStates(supabase: SupabaseClient): Promise<MatchStatesRead | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("watchlist_item_id, shop_id, state, shop_item_id")
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (error) {
    logFailure("list failed", error.message);
    return null;
  }
  const read = parseRows(data, stateRowSchema);
  if (read === null) {
    return null;
  }
  const unread = new Set<string>();
  let unattributed = 0;
  for (const raw of read.odd) {
    const shop = oddShopSchema.safeParse(raw);
    if (shop.success && !knownShopSchema.safeParse(shop.data.shop_id).success) {
      continue;
    }
    const product = stateProductSchema.safeParse(raw);
    if (product.success) {
      unread.add(product.data.watchlist_item_id);
    } else {
      unattributed++;
    }
  }
  return { states: read.rows.map(toMatchState), unread: [...unread], unattributed };
}

function toMatchState(row: z.infer<typeof stateRowSchema>): ShopMatchState {
  const decision = { watchlistItemId: row.watchlist_item_id, shop: row.shop_id };
  return row.state === "matched"
    ? { ...decision, state: "matched", shopItemId: row.shop_item_id }
    : { ...decision, state: row.state, shopItemId: null };
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
  const { size_value: value, size_unit: unit } = row;
  return {
    ...decision,
    state: "matched",
    item: {
      shopItemId: row.shop_item_id,
      brand: row.brand,
      name: row.name,
      sizeText: row.size_text,
      size: value !== null && unit !== null ? { value, unit } : null,
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
