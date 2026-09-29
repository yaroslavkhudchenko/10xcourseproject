import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { keyText } from "@/lib/services/price-comparison";
import { SHOP_IDS, type LatestPrice, type PriceCheck, type PriceKey, type ShopId } from "@/types";

// Every price check of a shop item (public.price_observations), shared by the item's watchers: a user reads and adds
// only observations of items they watch, and nobody changes or removes one. Every read and write goes through the
// user's own client, so RLS does the enforcing. Users can't read who recorded a row, so an insert never asks for its
// rows back and every read names its columns. Each call gives up after 2 s, like the watchlist's.
const DATABASE_TIMEOUT_MS = 2000;
const TABLE = "price_observations";
const LATEST_VIEW = "latest_price_observations";

/** What storing checks came to. `none`: no check was a price or a missing item, so nothing was sent. */
export type PriceRecordResult = "saved" | "failed" | "none";

/** The columns one check fills. The database sets the row's id, time, source and recording user itself. */
interface ObservationRow {
  shop_id: ShopId;
  shop_item_id: string;
  status: "price" | "missing";
  price: number | null;
  regular_price: number | null;
  lowest_price_30d: number | null;
  promo_ends_on: string | null;
  available: boolean | null;
}

// A missing item carries none of the offer's columns, as the table's checks require. Its row still names them, so one
// insert carries rows of both kinds with the same columns.
const NO_OFFER = {
  price: null,
  regular_price: null,
  lowest_price_30d: null,
  promo_ends_on: null,
  available: null,
};

/** The row a check adds: the offer for a price, none of it for a missing item, and none when the shop didn't answer. */
function observationRow({ shop, shopItemId }: PriceKey, check: PriceCheck): ObservationRow | null {
  const item = { shop_id: shop, shop_item_id: shopItemId };
  if (check.kind === "price") {
    const { offer } = check;
    return {
      ...item,
      status: "price",
      price: offer.price,
      regular_price: offer.regularPrice,
      lowest_price_30d: offer.lowestPrice30d,
      promo_ends_on: offer.promoEndsOn,
      available: offer.available,
    };
  }
  if (check.kind === "missing") {
    return { ...item, status: "missing", ...NO_OFFER };
  }
  return null;
}

/**
 * Stores what each check found, one row per price or missing item, all in a single insert that asks for no rows back.
 * A check the shop gave no answer to stores nothing, so the last known price keeps its age. `failed` covers a refusal
 * by RLS (42501), which means the user doesn't watch one of the items, and any other error.
 */
export async function recordPriceChecks(
  supabase: SupabaseClient,
  checks: { key: PriceKey; check: PriceCheck }[],
): Promise<PriceRecordResult> {
  const rows = checks.flatMap(({ key, check }) => {
    const row = observationRow(key, check);
    return row === null ? [] : [row];
  });
  if (rows.length === 0) {
    return "none";
  }
  const { error } = await supabase.from(TABLE).insert(rows).abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (error) {
    logFailure("insert failed", codeOf(error));
    return "failed";
  }
  return "saved";
}

// Only the columns the pages show; the view names no recording user.
const LATEST_COLUMNS =
  "shop_id, shop_item_id, last_checked_at, last_status, price, regular_price, lowest_price_30d, promo_ends_on, " +
  "available, priced_at";

// A time the page can show: an unreadable one would make its clock throw.
const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

// The item a row is about. An odd row is read for these alone too, so it can still say whose price couldn't be read.
const keyColumns = {
  shop_id: z.enum(SHOP_IDS),
  shop_item_id: z.string(),
};
const rowKeySchema = z.object(keyColumns);

const checkColumns = {
  ...keyColumns,
  last_checked_at: timestamp,
};

// A row carries the item's latest price, whatever its last check found, or no price at all when every check so far
// found the item missing. A row in between is odd.
const latestRowSchema = z.union([
  z.object({
    ...checkColumns,
    last_status: z.enum(["price", "missing"]),
    price: z.number().positive(),
    regular_price: z.number().positive().nullable(),
    lowest_price_30d: z.number().positive().nullable(),
    promo_ends_on: z.iso.date().nullable(),
    available: z.boolean(),
    priced_at: timestamp,
  }),
  z.object({
    ...checkColumns,
    last_status: z.literal("missing"),
    price: z.null(),
    regular_price: z.null(),
    lowest_price_30d: z.null(),
    promo_ends_on: z.null(),
    available: z.null(),
    priced_at: z.null(),
  }),
]);

/**
 * The latest state of the shop items the user watches: every one RLS lets them see without `keys`, as the list needs,
 * or only the given ones. Odd rows are dropped and logged. Null when the prices couldn't be read.
 */
export async function listLatestPrices(supabase: SupabaseClient, keys?: PriceKey[]): Promise<LatestPrice[] | null> {
  if (keys?.length === 0) {
    return [];
  }
  const rows = await readLatestRows(supabase, keys);
  return rows === null ? null : rows.prices;
}

/** The latest prices of the items a product's page asked for, and the asked-for items whose rows couldn't be read. */
export interface LatestPricesRead {
  prices: LatestPrice[];
  unread: PriceKey[];
}

/**
 * The latest state of the given shop items, as a product's page needs it: their prices, and the items whose rows came
 * back odd, so the page never shows such an item as one that was never checked. Odd rows are logged. Null when the
 * prices couldn't be read, and when an odd row can't even say which item it's about, since it could be any of them.
 */
export async function readLatestPrices(supabase: SupabaseClient, keys: PriceKey[]): Promise<LatestPricesRead | null> {
  if (keys.length === 0) {
    return { prices: [], unread: [] };
  }
  const rows = await readLatestRows(supabase, keys);
  if (rows === null || rows.unattributed > 0) {
    return null;
  }
  return { prices: rows.prices, unread: rows.unread };
}

/**
 * What one read of the latest rows came to: the prices of the items asked for, the items asked for whose rows couldn't
 * be read, and how many odd rows couldn't say which item they're about.
 */
interface LatestRows {
  prices: LatestPrice[];
  unread: PriceKey[];
  unattributed: number;
}

/**
 * Reads the latest rows of the given items, or of every item RLS lets the user see without `keys`, in one query within
 * a time limit. Each row is checked on its own, so one odd row doesn't hide the other prices. Null when the rows
 * couldn't be read at all.
 */
async function readLatestRows(supabase: SupabaseClient, keys?: PriceKey[]): Promise<LatestRows | null> {
  // The filter is on the item id alone, which two shops could share, so each row is matched to its key below.
  const select = supabase.from(LATEST_VIEW).select(LATEST_COLUMNS);
  const itemIds = keys?.map((key) => key.shopItemId);
  const query = itemIds === undefined ? select : select.in("shop_item_id", [...new Set(itemIds)]);
  const { data, error } = await query.abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  if (error) {
    logFailure("list failed", codeOf(error));
    return null;
  }
  const rows: unknown = data;
  if (!Array.isArray(rows)) {
    logFailure("unexpected list shape", typeof rows);
    return null;
  }
  const wanted = keys === undefined ? null : new Set(keys.map(keyText));
  const isWanted = (key: PriceKey) => wanted === null || wanted.has(keyText(key));
  const read: LatestRows = { prices: [], unread: [], unattributed: 0 };
  let dropped = 0;
  for (const raw of rows) {
    const row = latestRowSchema.safeParse(raw);
    if (row.success) {
      const latest = toLatestPrice(row.data);
      if (isWanted(latest)) {
        read.prices.push(latest);
      }
      continue;
    }
    dropped++;
    const key = rowKeySchema.safeParse(raw);
    if (!key.success) {
      read.unattributed++;
      continue;
    }
    const item: PriceKey = { shop: key.data.shop_id, shopItemId: key.data.shop_item_id };
    if (isWanted(item)) {
      read.unread.push(item);
    }
  }
  if (dropped > 0) {
    logFailure("unexpected rows dropped", String(dropped));
  }
  return read;
}

function toLatestPrice(row: z.infer<typeof latestRowSchema>): LatestPrice {
  const latest = {
    shop: row.shop_id,
    shopItemId: row.shop_item_id,
    lastCheckedAt: row.last_checked_at,
    lastStatus: row.last_status,
  };
  if (row.price === null) {
    return { ...latest, offer: null };
  }
  return {
    ...latest,
    offer: {
      price: row.price,
      regularPrice: row.regular_price,
      lowestPrice30d: row.lowest_price_30d,
      promoEndsOn: row.promo_ends_on,
      available: row.available,
      pricedAt: row.priced_at,
    },
  };
}

/**
 * A database error's code, never its message: a message can quote a row or a filter, and a shop item id names the
 * product. A failure that never reached the database has no code.
 */
function codeOf(error: { code?: unknown }): string {
  return typeof error.code === "string" && error.code !== "" ? error.code : "no code";
}

function logFailure(reason: string, detail: string): void {
  // eslint-disable-next-line no-console -- one line per failed price query; Workers observability collects it.
  console.warn(JSON.stringify({ event: "price-observations", reason, detail: detail.slice(0, 300) }));
}
