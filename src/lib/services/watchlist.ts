import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import {
  ERROR_PARAM,
  REMOVAL_ANCHOR,
  REMOVAL_CODES,
  REMOVAL_GONE_NOTICES,
  REMOVAL_NOTICES,
  REMOVAL_PARAM,
  REMOVED_CODES,
  REMOVED_NOTICES,
  REMOVED_PARAM,
  type RemovalCode,
  type RemovedCode,
} from "@/lib/notices";
import { linksOfShop, optionalText } from "@/lib/services/form-fields";
import { PRICED_SHOPS } from "@/lib/services/price-comparison";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import { SHOP_ADAPTERS } from "@/lib/services/shops/registry";
import { parseSize } from "@/lib/services/size";
import { filterHref, type ListFilter } from "@/lib/services/watchlist-rows";
import { SHOP_IDS, type ProductCandidate, type WatchlistItem, type WatchlistProduct } from "@/types";

// All reads and writes go through the user's own client, so RLS keeps every row private to its owner. Each database
// call gives up after 2 s, like the shop gate's, so a stalled connection can't hold the page open.
const DATABASE_TIMEOUT_MS = 2000;

/** A watched product's id: the UUID the database gave its row. */
export const watchlistItemIdSchema = z.uuid();

/**
 * A watched product's id from a URL or a form, or null when it can't be one: only a UUID reaches a query or a
 * redirect.
 */
export function parseWatchlistItemId(value: unknown): string | null {
  const parsed = watchlistItemIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The "Dodaj" form, whose fields come back from the results page, for an item of any priced shop, which becomes the
 * product's own shop. Only the user's own row depends on them, but they are still checked against the same
 * PRODUCT_LIMITS the adapters apply, and by the rules of the item's own shop's adapter (SHOP_ADAPTERS), as a decision's
 * item is (parseMatchForm): its id must be one that shop's items can have, and its image and product page on that
 * shop's hosts. The size is parsed again from its text, and the caption, which only Rossmann writes apart from the
 * name, is optional for every shop.
 */
export const watchlistAddSchema = z
  .object({
    source: z.enum(PRICED_SHOPS),
    sourceItemId: z.string(),
    name: z.string().trim().min(1).max(PRODUCT_LIMITS.name),
    brand: optionalText(PRODUCT_LIMITS.brand),
    caption: optionalText(PRODUCT_LIMITS.caption),
    sizeText: optionalText(PRODUCT_LIMITS.sizeText),
    eans: z.array(z.string().regex(/^\d{8,14}$/)).max(PRODUCT_LIMITS.eans),
    // Empty for none; the links that are there must be the item's own shop's, which linksOfShop checks.
    productUrl: optionalText(PRODUCT_LIMITS.productUrl),
    imageUrl: optionalText(PRODUCT_LIMITS.imageUrl),
  })
  .refine(
    ({ source, sourceItemId, productUrl, imageUrl }) =>
      SHOP_ADAPTERS[source].isItemId(sourceItemId) && linksOfShop({ shop: source, productUrl, imageUrl }),
  );

/** Reads a posted "Dodaj" form into a candidate, or null when any field fails its check. */
export function parseWatchlistForm(form: FormData): ProductCandidate | null {
  const parsed = watchlistAddSchema.safeParse({
    source: form.get("source"),
    sourceItemId: form.get("sourceItemId"),
    name: form.get("name"),
    brand: form.get("brand") ?? "",
    caption: form.get("caption") ?? "",
    sizeText: form.get("sizeText") ?? "",
    eans: form.getAll("eans"),
    productUrl: form.get("productUrl") ?? "",
    imageUrl: form.get("imageUrl") ?? "",
  });
  if (!parsed.success) {
    return null;
  }
  const fields = parsed.data;
  return { ...fields, size: parseSize(fields.sizeText) };
}

/** Why adding a product failed, as a code the page turns into its own text. */
export type WatchlistError = "invalid" | "failed" | "config";

/** The text the watchlist page shows for each error code. */
export const WATCHLIST_ERRORS: Record<WatchlistError, string> = {
  invalid: "Nie udało się dodać produktu: nieprawidłowe dane.",
  failed: "Nie udało się dodać produktu. Spróbuj ponownie.",
  config: "Supabase nie jest skonfigurowany.",
};

function isWatchlistError(code: string): code is WatchlistError {
  return Object.hasOwn(WATCHLIST_ERRORS, code);
}

/** The text for an `?error=` code, or null for anything the app didn't send itself, so a link can't put words there. */
export function watchlistErrorMessage(code: string | null): string | null {
  return code !== null && isWatchlistError(code) ? WATCHLIST_ERRORS[code] : null;
}

/**
 * A product's full name, as a page's title or a screen reader reads it: its brand, when it has one, then its name, such
 * as "NIVEA Soft". A shop's item for the product reads the same way.
 */
export function productFullName({ brand, name }: { brand: string | null; name: string }): string {
  return brand === null ? name : `${brand} ${name}`;
}

/** What adding a product came to: the new row's id, or `exists` when it was already on the list. */
export type AddResult = { kind: "added"; id: string } | "exists" | "failed";

// The id of the row an insert returns, which the product's page URL is built from.
const insertedSchema = z.object({ id: watchlistItemIdSchema });

export async function addToWatchlist(supabase: SupabaseClient, candidate: ProductCandidate): Promise<AddResult> {
  const { data, error } = await supabase
    .from("watchlist_items")
    .insert({
      source: candidate.source,
      source_item_id: candidate.sourceItemId,
      brand: candidate.brand,
      name: candidate.name,
      caption: candidate.caption,
      size_text: candidate.sizeText,
      size_value: candidate.size?.value ?? null,
      size_unit: candidate.size?.unit ?? null,
      eans: candidate.eans,
      product_url: candidate.productUrl,
      image_url: candidate.imageUrl,
    })
    .select("id")
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS))
    .single();
  if (error) {
    // The unique constraint on (user_id, source, source_item_id).
    if (error.code === "23505") {
      return "exists";
    }
    logFailure("insert failed", error.message);
    return "failed";
  }
  const inserted = insertedSchema.safeParse(data);
  if (!inserted.success) {
    logFailure("unexpected insert result", "no row id");
    return "failed";
  }
  return { kind: "added", id: inserted.data.id };
}

// A product as the list reads it. Its brand and size are what its matches are compared with (FR-007), so a row whose
// size can't be read is odd, never one without a size.
const rowSchema = z.object({
  id: z.string(),
  source: z.enum(SHOP_IDS),
  source_item_id: z.string(),
  brand: z.string().nullable(),
  name: z.string(),
  caption: z.string().nullable(),
  size_text: z.string().nullable(),
  size_value: z.number().positive().nullable(),
  size_unit: z.enum(["ml", "g", "pcs"]).nullable(),
  image_url: z.string().nullable(),
  created_at: z.string(),
});

/** The user's watchlist, newest first, or null when it couldn't be read. */
export async function listWatchlist(supabase: SupabaseClient): Promise<WatchlistItem[] | null> {
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("id, source, source_item_id, brand, name, caption, size_text, size_value, size_unit, image_url, created_at")
    .order("created_at", { ascending: false })
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (error) {
    logFailure("list failed", error.message);
    return null;
  }
  const rows: unknown = data;
  if (!Array.isArray(rows)) {
    logFailure("unexpected list shape", typeof rows);
    return null;
  }
  // Each row is checked on its own, so one odd row (say, from a shop added later) doesn't blank the list.
  const items: WatchlistItem[] = [];
  let dropped = 0;
  for (const raw of rows) {
    const row = rowSchema.safeParse(raw);
    if (row.success) {
      items.push(toItem(row.data));
    } else {
      dropped++;
    }
  }
  if (dropped > 0) {
    logFailure("unexpected rows dropped", String(dropped));
  }
  return items;
}

function toItem(row: z.infer<typeof rowSchema>): WatchlistItem {
  const { size_value: value, size_unit: unit } = row;
  return {
    id: row.id,
    source: row.source,
    sourceItemId: row.source_item_id,
    brand: row.brand,
    name: row.name,
    caption: row.caption,
    sizeText: row.size_text,
    size: value !== null && unit !== null ? { value, unit } : null,
    imageUrl: row.image_url,
    addedAt: row.created_at,
  };
}

// A product's page also needs the EANs its shop lookups look for, and the product's page in its shop.
const productRowSchema = rowSchema.extend({
  eans: z.array(z.string()),
  product_url: z.string().nullable(),
});

/**
 * One product on the user's watchlist, or null when there's no such row: RLS answers another user's product the same
 * way. `failed` when it couldn't be read. The id must already be a UUID.
 */
export async function getWatchlistProduct(
  supabase: SupabaseClient,
  id: string,
): Promise<WatchlistProduct | null | "failed"> {
  const { data, error } = await supabase
    .from("watchlist_items")
    .select(
      "id, source, source_item_id, brand, name, caption, size_text, size_value, size_unit, eans, product_url, image_url, " +
        "created_at",
    )
    .eq("id", id)
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS))
    .maybeSingle();
  if (error) {
    logFailure("product read failed", error.message);
    return "failed";
  }
  const row: unknown = data;
  if (row === null) {
    return null;
  }
  const parsed = productRowSchema.safeParse(row);
  if (!parsed.success) {
    logFailure(
      "unexpected product row",
      parsed.error.issues.map((issue) => issue.path.map(String).join(".")).join("; "),
    );
    return "failed";
  }
  const { eans, product_url: productUrl } = parsed.data;
  return { ...toItem(parsed.data), eans, productUrl };
}

/**
 * What removing a product came to: `removed`, or `gone` when the user had no product by that id any more, as after a
 * second post or a removal in another tab; RLS answers another user's product the same way.
 */
export type RemoveResult = "removed" | "gone" | "failed";

// The rows a removal's delete gives back: none, or the one row its id names, by its id.
const deletedSchema = z.array(z.object({ id: z.string() })).max(1);

/**
 * Removes a product from the user's watchlist: their own row and, through the foreign key's cascade, their own
 * decisions for it, never a price observation, which references no product (FR-005). The delete asks for its rows
 * back, so `removed` is read only from the row it removed, and no row back is `gone`. An error, or an answer that
 * can't be read, is `failed`, logged, never `gone`. The id must already be a UUID.
 */
export async function removeFromWatchlist(supabase: SupabaseClient, id: string): Promise<RemoveResult> {
  const { data, error } = await supabase
    .from("watchlist_items")
    .delete()
    .eq("id", id)
    .select("id")
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (error) {
    logFailure("delete failed", error.message);
    return "failed";
  }
  const rows: unknown = data;
  const deleted = deletedSchema.safeParse(rows);
  if (!deleted.success) {
    logFailure("unexpected delete result", Array.isArray(rows) ? `${rows.length} rows` : typeof rows);
    return "failed";
  }
  return deleted.data.length === 1 ? "removed" : "gone";
}

/** What a removal's post came to, as the page it goes back to says it: the removal's result, or no Supabase. */
export type RemovalOutcome = RemoveResult | "config";

/**
 * Where a removal's post goes back to, keeping the list's filter unless it's every product's (filterHref): the list,
 * saying the product was removed (`?removed=done`), wasn't on it any more (`?removed=gone`) or that Supabase isn't
 * configured (`?error=config`); or, after a failure, the product's page, whose confirm opens again with its error,
 * pointed to by the address (`?removal=failed#remove`). Each page turns the code into its own text.
 */
export function removalBackTo(itemId: string, outcome: RemovalOutcome, filter: ListFilter): string {
  switch (outcome) {
    case "removed":
      return filterHref("/watchlist", filter, { [REMOVED_PARAM]: "done" satisfies RemovedCode });
    case "gone":
      return filterHref("/watchlist", filter, { [REMOVED_PARAM]: "gone" satisfies RemovedCode });
    case "config":
      return filterHref("/watchlist", filter, { [ERROR_PARAM]: "config" satisfies WatchlistError });
    case "failed": {
      // The confirm stands at the page's foot, so the address points to it: the page opens there, at its error.
      const page = filterHref(`/watchlist/${itemId}`, filter, { [REMOVAL_PARAM]: "failed" satisfies RemovalCode });
      return `${page}#${REMOVAL_ANCHOR}`;
    }
  }
}

/** The list's text for a removal's `?removed=` code, or null for anything the app didn't send itself. */
export function removedNotice(value: string | null): string | null {
  const code = REMOVED_CODES.find((each) => each === value);
  return code === undefined ? null : REMOVED_NOTICES[code];
}

/**
 * The product page's text for a failed removal's `?removal=` code, which opens its confirm again, or null for anything
 * the app didn't send itself.
 */
export function removalErrorMessage(value: string | null): string | null {
  const code = REMOVAL_CODES.find((each) => each === value);
  return code === undefined ? null : REMOVAL_NOTICES[code];
}

/**
 * The product page's text for a failed removal's `?removal=` code when the product isn't there any more, which a
 * removal whose answer didn't come may still have deleted, or null for anything the app didn't send itself.
 */
export function removalGoneNotice(value: string | null): string | null {
  const code = REMOVAL_CODES.find((each) => each === value);
  return code === undefined ? null : REMOVAL_GONE_NOTICES[code];
}

function logFailure(reason: string, detail: string): void {
  // eslint-disable-next-line no-console -- one line per failed watchlist query; Workers observability collects it.
  console.warn(JSON.stringify({ event: "watchlist", reason, detail: detail.slice(0, 300) }));
}
