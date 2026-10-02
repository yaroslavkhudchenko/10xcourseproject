// What a spec seeds and removes (test-plan Phase 1, context/changes/testing-critical-browser-flows/plan.md): its own
// products, a Natura match and exact price states, written as the run's user through supabase-js on the local stack, as
// the database checks do, and deleted again after the test. Two reads and writes act as the local superuser
// (scripts/e2e-local-db.mjs): the check that every shop is stopped, since no API role may read the shops, and backdating
// a check, since the database stamps each check's time. Every product gets fresh shop ids: price checks are shared and
// never deleted, so an id an earlier run used would bring that run's prices along.
import { randomBytes, randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { backdateChecks as backdateLocalChecks, enabledShops } from "../../../scripts/e2e-local-db.mjs";
import type { ShopId } from "@/types";
import { readRun } from "./run";

/** A seeded product: the row on the run user's list, and the Rossmann item it was added from. */
export interface SeededProduct {
  /** The list row's id, which names the product's page (/watchlist/<productId>). */
  productId: string;
  /** Its Rossmann item, which its Rossmann checks are stored under. */
  itemId: string;
  /** Its name on the list and on its page, carrying the run's token. */
  name: string;
}

/** A price check's offer, as a shop answered it. */
export interface SeededPrice {
  price: number;
  /** The price before a promotion, only while one runs. */
  regularPrice?: number;
  /** A promotion's last day, as YYYY-MM-DD (warsawDate). */
  promoEndsOn?: string;
  /** Whether the item can be ordered online. */
  available: boolean;
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// The run's user, once per worker, in the session the setup's sign-up got: no worker signs in, so seeding costs nothing
// against the local auth limit of 30 sign-ins and sign-ups per 5 minutes.
let runUser: Promise<SupabaseClient> | undefined;

// The products the current test added, registered as each insert succeeds, so a test that fails halfway through its
// seeding still leaves nothing behind. A worker runs one test at a time, and removeSeededProducts empties it after each.
const seededProducts: string[] = [];

function asRunUser(): Promise<SupabaseClient> {
  runUser ??= takeOverRunUser();
  return runUser;
}

async function takeOverRunUser(): Promise<SupabaseClient> {
  // A seeded product's page asks every shop whose check is old or missing, so nothing is seeded while a shop is live.
  // Only the setup project stops them, so a run without it (--no-deps) stops here, before any page is opened.
  expect(enabledShops(), "every shop is stopped for the run: run the specs with the setup project").toEqual([]);
  const { SUPABASE_URL, SUPABASE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("SUPABASE_URL and SUPABASE_KEY must be set (.env)");
  const { session } = readRun();
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, clientOptions);
  // The access token outlives a run (an hour), so taking the session over only reads the user, and signs no one in.
  const { error } = await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  expect(error, "the seeding helpers take over the run user's session").toBeNull();
  return client;
}

/** The run's token, its user's email without the domain: every seeded name carries it, so a leftover is findable. */
function runToken(): string {
  const { email } = readRun();
  return email.slice(0, email.indexOf("@"));
}

/** A Rossmann id no run has used: 12 digits (the app takes 1 to 12), starting with 9, unlike Rossmann's real ids. */
function freshRossmannId(): string {
  return `9${String(randomInt(0, 100_000_000_000)).padStart(11, "0")}`;
}

/** A Natura SKU no run has used, in the shape the database takes (letters, digits, dots, dashes, underscores). */
function freshNaturaSku(): string {
  return `E2E-${randomBytes(6).toString("hex").toUpperCase()}`;
}

function idOf(row: unknown): string {
  if (typeof row === "object" && row !== null && "id" in row && typeof row.id === "string") return row.id;
  throw new Error(`the insert returned no row id: ${JSON.stringify(row)}`);
}

// The user watches the item once it's on their list or matched, so they can read its checks: a new id has none.
async function expectNoChecks(client: SupabaseClient, shop: ShopId, shopItemId: string): Promise<void> {
  const { data, error } = await client
    .from("latest_price_observations")
    .select("shop_item_id")
    .eq("shop_id", shop)
    .eq("shop_item_id", shopItemId);
  expect(error).toBeNull();
  expect(data, `${shop} ${shopItemId} is new, so no earlier run's prices come with it`).toEqual([]);
}

/** Adds a product from Rossmann to the run user's list, with no picture or link, which would load from the shop. */
export async function addRossmannProduct({ name }: { name: string }): Promise<SeededProduct> {
  const client = await asRunUser();
  const itemId = freshRossmannId();
  const fullName = `${name} ${runToken()}`;
  const { data, error } = await client
    .from("watchlist_items")
    .insert({ source: "rossmann", source_item_id: itemId, name: fullName })
    .select("id")
    .single();
  expect(error, `${fullName} is added to the run user's list`).toBeNull();
  const productId = idOf(data);
  seededProducts.push(productId);
  test.info().annotations.push({ type: "test-data", description: `${fullName} (${productId})` });
  await expectNoChecks(client, "rossmann", itemId);
  return { productId, itemId, name: fullName };
}

/** Adds a product from Rossmann matched in Natura, the shape every spec compares: its name, ids and Natura's SKU. */
export async function addMatchedProduct(name: string): Promise<SeededProduct & { sku: string }> {
  const product = await addRossmannProduct({ name });
  return { ...product, sku: await matchNatura(product.productId, { name: `Natura ${name}` }) };
}

/** Stores an automatic Natura match for the product, so its page doesn't look Natura up. Returns the matched SKU. */
export async function matchNatura(productId: string, { name }: { name: string }): Promise<string> {
  const client = await asRunUser();
  const sku = freshNaturaSku();
  const { error } = await client.from("watchlist_matches").insert({
    watchlist_item_id: productId,
    shop_id: "natura",
    state: "matched",
    decided_by: "auto",
    shop_item_id: sku,
    name: `${name} ${runToken()}`,
  });
  expect(error, `the product ${productId} is matched with Natura ${sku}`).toBeNull();
  await expectNoChecks(client, "natura", sku);
  return sku;
}

// One check per call, as the app stores them: the database sets its time, source and recording user, and the user may
// not read the recording user, so the insert asks for no rows back. A check stored by a later call is the later one;
// rows of one insert would share their time, and either could read as the latest.

/** Stores a check that found the item at this price, made now. */
export async function recordPrice(shop: ShopId, shopItemId: string, offer: SeededPrice): Promise<void> {
  const client = await asRunUser();
  const { error } = await client.from("price_observations").insert({
    shop_id: shop,
    shop_item_id: shopItemId,
    status: "price",
    price: offer.price,
    regular_price: offer.regularPrice ?? null,
    lowest_price_30d: null,
    promo_ends_on: offer.promoEndsOn ?? null,
    available: offer.available,
  });
  expect(error, `a ${shop} price is stored for ${shopItemId}`).toBeNull();
}

/** Stores a check, made now, whose answer came without the item. */
export async function recordMissing(shop: ShopId, shopItemId: string): Promise<void> {
  const client = await asRunUser();
  const { error } = await client.from("price_observations").insert({
    shop_id: shop,
    shop_item_id: shopItemId,
    status: "missing",
    price: null,
    regular_price: null,
    lowest_price_30d: null,
    promo_ends_on: null,
    available: null,
  });
  expect(error, `a ${shop} check without the item is stored for ${shopItemId}`).toBeNull();
}

/** Moves every check of the item back by whole hours, as the local superuser: no user may set a check's time. */
export function backdateChecks(shop: ShopId, shopItemId: string, hours: number): void {
  expect(
    backdateLocalChecks(shop, shopItemId, hours),
    `the ${shop} checks of ${shopItemId} moved back`,
  ).toBeGreaterThan(0);
}

/**
 * Today's date in Europe/Warsaw moved by whole days, as YYYY-MM-DD: the calendar the app ends promotions by. A UTC date
 * is a day off for the first hour or two of every Polish day.
 */
export function warsawDate(offsetDays: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + offsetDays)).toISOString().slice(0, 10);
}

/**
 * Deletes the spec's products from the run user's list, and fails unless none is left. Their Natura decisions go with
 * them (the cascade); their price checks stay, by design, under ids no one else watches.
 */
export async function removeProducts(productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  const client = await asRunUser();
  const removed = await client.from("watchlist_items").delete().in("id", productIds);
  expect(removed.error, "the spec's products are deleted").toBeNull();
  const left = await client.from("watchlist_items").select("id").in("id", productIds);
  expect(left.error).toBeNull();
  expect(left.data, "none of the spec's products is left on the list").toEqual([]);
}

/** Removes every product the current test added (removeProducts): each spec's afterEach. */
export async function removeSeededProducts(): Promise<void> {
  await removeProducts(seededProducts.splice(0));
}
