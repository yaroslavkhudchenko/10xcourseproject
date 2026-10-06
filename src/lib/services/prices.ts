import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { keyText, PRICED_SHOPS } from "@/lib/services/price-comparison";
import { SHOP_IDS, type LatestPrice, type PriceCheck, type PriceHistory, type PriceKey, type ShopId } from "@/types";

// Every price check of a shop item (public.price_observations), shared by the item's watchers: a user reads and adds
// only observations of items they watch, and nobody changes or removes one. Every read and write goes through the
// user's own client, so RLS does the enforcing. Users can't read who recorded a row, so an insert never asks for its
// rows back and every read names its columns. Each call gives up after 2 s, like the watchlist's.
const DATABASE_TIMEOUT_MS = 2000;
const TABLE = "price_observations";

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

// Only the columns the pages show; the views name no recording user.
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

// An item's prices in the 30 days in Poland before today, as price_summaries gives them: the lowest one a check found
// it orderable online at, and the days of those checks as YYYY-MM-DD; or no low and no day, when no check did. A low
// without a day, or a day without a low, is odd.
const historyColumnsSchema = z.union([
  z.object({ history_low: z.number().positive(), history_days: z.array(z.iso.date()).min(1) }),
  z.object({ history_low: z.null(), history_days: z.array(z.iso.date()).max(0) }),
]);

/** A view the latest prices are read from: its name, the columns a read names, and one row as a price, null if odd. */
interface LatestView {
  name: string;
  columns: string;
  parse: (raw: unknown) => LatestPrice | null;
}

// The list's view, each item's latest check without its history, which the list doesn't judge a price by: its prices
// say their history wasn't read.
const LIST_VIEW: LatestView = {
  name: "latest_price_observations",
  columns: LATEST_COLUMNS,
  parse: (raw) => {
    const row = latestRowSchema.safeParse(raw);
    return row.success ? toLatestPrice(row.data, null) : null;
  },
};

// The product page's view, the same latest check with the item's history, which the page judges today's price by
// (judgementOf in price-comparison.ts). A row whose history can't be read is odd, as one with any other odd column is,
// so the page never judges a price by a history it couldn't read.
const PAGE_VIEW: LatestView = {
  name: "price_summaries",
  columns: `${LATEST_COLUMNS}, history_low, history_days`,
  parse: (raw) => {
    const row = latestRowSchema.safeParse(raw);
    const history = historyColumnsSchema.safeParse(raw);
    return row.success && history.success
      ? toLatestPrice(row.data, { low: history.data.history_low, days: history.data.history_days })
      : null;
  },
};

/**
 * The latest prices a read found, and the items whose rows came back odd, so a page never shows such an item as one
 * that was never checked.
 */
export interface LatestPricesRead {
  prices: LatestPrice[];
  unread: PriceKey[];
}

/**
 * The list's read of the latest prices: also how many odd rows couldn't say which item they're about. Such a row may
 * be the latest of any item without a readable row, so the list counts those items' prices as unread, and every other
 * item keeps its price.
 */
export interface ListPricesRead extends LatestPricesRead {
  unattributed: number;
}

// An odd row of the list's read, read for its item alone: first its shop, since a shop whose prices the list doesn't
// compare can't hold any listed product's price, whatever the row's item id, and then its item id.
const oddShopSchema = z.object({ shop_id: z.string() });
const listShopSchema = z.enum(PRICED_SHOPS);
const oddItemSchema = z.object({ shop_item_id: z.string() });

/**
 * The latest state of every shop item the user watches, as RLS lets them see it, for the list: their prices, without
 * their history, which the list doesn't read (`history: null`), the items whose rows came back odd, and how many odd
 * rows couldn't say which item they're about, which never empties the list. An odd row of a shop whose prices the list
 * doesn't compare is left out. Odd rows are logged. Null only when the prices couldn't be read at all.
 */
export async function listLatestPrices(supabase: SupabaseClient): Promise<ListPricesRead | null> {
  const rows = await readLatestRows(supabase, LIST_VIEW);
  if (rows === null) {
    return null;
  }
  const read: ListPricesRead = { prices: rows.prices, unread: [], unattributed: 0 };
  for (const raw of rows.odd) {
    const shop = oddShopSchema.safeParse(raw);
    if (!shop.success) {
      read.unattributed++;
      continue;
    }
    const listShop = listShopSchema.safeParse(shop.data.shop_id);
    if (!listShop.success) {
      continue;
    }
    const item = oddItemSchema.safeParse(raw);
    if (item.success) {
      read.unread.push({ shop: listShop.data, shopItemId: item.data.shop_item_id });
    } else {
      read.unattributed++;
    }
  }
  return read;
}

/**
 * The latest state of the given shop items, as a product's page needs it: their prices, each with the item's history
 * of the 30 days in Poland before today (`{ low: null, days: [] }` when it has none), and the items whose rows came
 * back odd, a history that can't be read included, so the page never shows such an item as one that was never checked.
 * Odd rows are logged. Null when the prices couldn't be read, and when an odd row can't even say which item it's
 * about, since it could be any of them: the read is one product's, so that empties nothing else.
 */
export async function readLatestPrices(supabase: SupabaseClient, keys: PriceKey[]): Promise<LatestPricesRead | null> {
  if (keys.length === 0) {
    return { prices: [], unread: [] };
  }
  const rows = await readLatestRows(supabase, PAGE_VIEW, keys);
  if (rows === null) {
    return null;
  }
  const wanted = new Set(keys.map(keyText));
  const unread: PriceKey[] = [];
  for (const raw of rows.odd) {
    const key = rowKeySchema.safeParse(raw);
    if (!key.success) {
      return null;
    }
    const item: PriceKey = { shop: key.data.shop_id, shopItemId: key.data.shop_item_id };
    if (wanted.has(keyText(item))) {
      unread.push(item);
    }
  }
  return { prices: rows.prices, unread };
}

/**
 * What one read of the latest rows came to: the prices of the items asked for (every item, without `keys`), and the
 * rows that came back odd, as they came, for each read to say whose they are.
 */
interface LatestRows {
  prices: LatestPrice[];
  odd: unknown[];
}

/**
 * Reads the latest rows of the given items, or of every item RLS lets the user see without `keys`, from `view`, in one
 * query within a time limit. Each row is checked on its own, so one odd row doesn't hide the other prices. Null when
 * the rows couldn't be read at all.
 */
async function readLatestRows(
  supabase: SupabaseClient,
  view: LatestView,
  keys?: PriceKey[],
): Promise<LatestRows | null> {
  // The filter is on the item id alone, which two shops could share, so each row is matched to its key below.
  const select = supabase.from(view.name).select(view.columns);
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
  const read: LatestRows = { prices: [], odd: [] };
  for (const raw of rows) {
    const latest = view.parse(raw);
    if (latest === null) {
      read.odd.push(raw);
      continue;
    }
    if (wanted === null || wanted.has(keyText(latest))) {
      read.prices.push(latest);
    }
  }
  if (read.odd.length > 0) {
    logFailure("unexpected rows dropped", String(read.odd.length));
  }
  return read;
}

/** A readable row as a latest price, with the item's history: null when the read didn't bring one. */
function toLatestPrice(row: z.infer<typeof latestRowSchema>, history: PriceHistory | null): LatestPrice {
  const latest = {
    shop: row.shop_id,
    shopItemId: row.shop_item_id,
    lastCheckedAt: row.last_checked_at,
    lastStatus: row.last_status,
    history,
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
