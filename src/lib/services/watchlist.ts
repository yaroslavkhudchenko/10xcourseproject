import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import { isRossmannImage } from "@/lib/services/shops/rossmann";
import { parseSize } from "@/lib/services/size";
import { SHOP_IDS, type ProductCandidate, type WatchlistItem } from "@/types";

// All reads and writes go through the user's own client, so RLS keeps every row private to its owner. Each database
// call gives up after 2 s, like the shop gate's, so a stalled connection can't hold the page open.
const DATABASE_TIMEOUT_MS = 2000;

/** An optional text field: trimmed, capped, and null when empty. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

/**
 * The "Dodaj" form, whose fields come back from the results page. Only the user's own row depends on them, but they
 * are still checked against the same PRODUCT_LIMITS the adapters apply: the size is parsed again from its text, and
 * images must be Rossmann's.
 */
export const watchlistAddSchema = z.object({
  source: z.literal("rossmann"),
  sourceItemId: z.string().regex(/^\d{1,12}$/),
  name: z.string().trim().min(1).max(PRODUCT_LIMITS.name),
  brand: optionalText(PRODUCT_LIMITS.brand),
  caption: optionalText(PRODUCT_LIMITS.caption),
  sizeText: optionalText(PRODUCT_LIMITS.sizeText),
  eans: z.array(z.string().regex(/^\d{8,14}$/)).max(PRODUCT_LIMITS.eans),
  imageUrl: z
    .string()
    .trim()
    .max(PRODUCT_LIMITS.imageUrl)
    .refine((url) => url === "" || isRossmannImage(url))
    .transform((url) => (url === "" ? null : url)),
});

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

/** What adding a product came to. `exists` means it was already on the list. */
export type AddResult = "added" | "exists" | "failed";

export async function addToWatchlist(supabase: SupabaseClient, candidate: ProductCandidate): Promise<AddResult> {
  const { error } = await supabase
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
      image_url: candidate.imageUrl,
    })
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (!error) {
    return "added";
  }
  // The unique constraint on (user_id, source, source_item_id).
  if (error.code === "23505") {
    return "exists";
  }
  logFailure("insert failed", error.message);
  return "failed";
}

const rowSchema = z.object({
  id: z.string(),
  source: z.enum(SHOP_IDS),
  source_item_id: z.string(),
  brand: z.string().nullable(),
  name: z.string(),
  caption: z.string().nullable(),
  size_text: z.string().nullable(),
  image_url: z.string().nullable(),
  created_at: z.string(),
});

/** The user's watchlist, newest first, or null when it couldn't be read. */
export async function listWatchlist(supabase: SupabaseClient): Promise<WatchlistItem[] | null> {
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("id, source, source_item_id, brand, name, caption, size_text, image_url, created_at")
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
  return {
    id: row.id,
    source: row.source,
    sourceItemId: row.source_item_id,
    brand: row.brand,
    name: row.name,
    caption: row.caption,
    sizeText: row.size_text,
    imageUrl: row.image_url,
    addedAt: row.created_at,
  };
}

function logFailure(reason: string, detail: string): void {
  // eslint-disable-next-line no-console -- one line per failed watchlist query; Workers observability collects it.
  console.warn(JSON.stringify({ event: "watchlist", reason, detail: detail.slice(0, 300) }));
}
