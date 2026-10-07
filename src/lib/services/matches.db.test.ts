import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { beforeAll, describe, expect, it } from "vitest";
import { recordDecision, recordLookup } from "@/lib/services/matches";
import type { MatchedItem, ShopCandidate } from "@/types";

// The decision write against the local stack's Postgres (risk #6 of context/foundation/test-plan.md). RLS lets a user
// change their own decision in any state, so `record` in matches.ts narrows each write to the decision it expects to
// replace (CLAUDE.md, "Data"). The unit tests prove the query it builds, through a stand-in. These prove what the
// database does with it: a write from a stale tab, or a lookup that finishes late, never overwrites a newer decision.
// `npm run test:db` (vitest.db.config.ts) runs them in CI's smoke job. The default run, which has no database, leaves
// them out. Each run signs up a fresh throwaway user through Auth and adds a product per test.

/** The local stack's URL and key, refused before any request when they name anything else. */
function localStack(): { url: string; key: string } {
  const { SUPABASE_URL: url, SUPABASE_KEY: key } = process.env;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must name the local stack");
  }
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`refusing to run against ${hostname}: point SUPABASE_URL at the local Supabase`);
  }
  return { url, key };
}

const SHOP = "natura";
// Natura SKUs of the shape the shop uses. A decision is the user's own, so no other run or user sees them.
const X = "NV10001";
const Y = "NV10002";
const Z = "NV10003";

// A Natura item as a decision stores it, without a price.
function itemOf(shopItemId: string): MatchedItem {
  return {
    shopItemId,
    brand: "NIVEA",
    name: `NIVEA SOFT krem intensywnie nawilżający 300 ml (${shopItemId})`,
    sizeText: "300 ml",
    size: { value: 300, unit: "ml" },
    eans: ["4005900009319"],
    productUrl: null,
    imageUrl: null,
  };
}

// The same item as a lookup accepts it on its own.
function candidateOf(shopItemId: string): ShopCandidate {
  return { shop: SHOP, ...itemOf(shopItemId), offer: null };
}

const confirm = (shopItemId: string) => ({ action: "confirm" as const, item: itemOf(shopItemId) });
const decline = { action: "decline" as const };
const overMatch = (shopItemId: string) => ({ state: "matched" as const, shopItemId });
const overDecline = { state: "unmatched" as const };

// What the product's Natura decision is, read back as the user: exactly one row.
const decisionRows = z.tuple([
  z.object({ id: z.string(), state: z.string(), decided_by: z.string(), shop_item_id: z.string().nullable() }),
]);
const idRow = z.object({ id: z.string() });

let client: SupabaseClient;
let products = 0;

beforeAll(async () => {
  const { url, key } = localStack();
  // Without a Database type, createClient infers its schema as `any`, a client type the services don't take.
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as SupabaseClient;
  // Local sign-up is on with email confirmation off (supabase/config.toml), so signing up returns a session.
  const email = `decisions-${String(Date.now())}@example.com`;
  const { data, error } = await client.auth.signUp({ email, password: "Decisions-Passw0rd!" });
  if (error || !data.session) {
    throw new Error(`signing up a throwaway user failed: ${error?.message ?? "no session returned"}`);
  }
});

/** Adds a fresh product to the user's list and gives its id. */
async function addProduct(): Promise<string> {
  products += 1;
  const { data, error } = await client
    .from("watchlist_items")
    .insert({
      source: "rossmann",
      source_item_id: `${String(Date.now())}${String(products)}`,
      brand: "NIVEA",
      name: "Soft",
      size_text: "300 ml",
      size_value: 300,
      size_unit: "ml",
      eans: ["4005900009319"],
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`adding a product failed: ${error.message}`);
  }
  return idRow.parse(data).id;
}

/** The product's Natura decision as it stands in the database. */
async function decisionOf(productId: string) {
  const { data, error } = await client
    .from("watchlist_matches")
    .select("id, state, decided_by, shop_item_id")
    .eq("watchlist_item_id", productId)
    .eq("shop_id", SHOP);
  if (error) {
    throw new Error(`reading the decision failed: ${error.message}`);
  }
  const [row] = decisionRows.parse(data);
  return row;
}

/** A product matched to `shopItemId` by a lookup, as an automatic match. */
async function matchedProduct(shopItemId: string): Promise<string> {
  const productId = await addProduct();
  await expect(
    recordLookup(client, productId, SHOP, { kind: "accepted", candidate: candidateOf(shopItemId) }),
  ).resolves.toBe("saved");
  return productId;
}

describe("the decision write against the real database", () => {
  it("lets a first choice replace a lookup that found nothing", async () => {
    const productId = await addProduct();
    await expect(recordLookup(client, productId, SHOP, { kind: "not-found" })).resolves.toBe("saved");

    await expect(recordDecision(client, productId, SHOP, confirm(X))).resolves.toBe("saved");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: X });
  });

  it("keeps the user's pick when a lookup that started before it stores its outcome after it", async () => {
    const productId = await addProduct();
    await expect(recordLookup(client, productId, SHOP, { kind: "not-found" })).resolves.toBe("saved");
    await expect(recordDecision(client, productId, SHOP, confirm(X))).resolves.toBe("saved");

    await expect(recordLookup(client, productId, SHOP, { kind: "accepted", candidate: candidateOf(Y) })).resolves.toBe(
      "decided",
    );
    await expect(recordLookup(client, productId, SHOP, { kind: "not-found" })).resolves.toBe("decided");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: X });
  });

  it("refuses a stale tab's re-pin of a match another tab re-pinned meanwhile", async () => {
    const productId = await matchedProduct(X);
    await expect(recordDecision(client, productId, SHOP, confirm(Y), overMatch(X))).resolves.toBe("saved");

    // A tab still showing the match to X picks Z.
    await expect(recordDecision(client, productId, SHOP, confirm(Z), overMatch(X))).resolves.toBe("decided");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: Y });
  });

  it("refuses a stale tab's decline of a match that changed meanwhile", async () => {
    const productId = await matchedProduct(X);
    await expect(recordDecision(client, productId, SHOP, confirm(Y), overMatch(X))).resolves.toBe("saved");

    // A tab still showing the match to X chooses "Żaden z nich".
    await expect(recordDecision(client, productId, SHOP, decline, overMatch(X))).resolves.toBe("decided");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: Y });
  });

  it("refuses a stale tab's re-pin of a decline the user changed meanwhile", async () => {
    const productId = await addProduct();
    await expect(recordLookup(client, productId, SHOP, { kind: "not-found" })).resolves.toBe("saved");
    await expect(recordDecision(client, productId, SHOP, decline)).resolves.toBe("saved");
    await expect(recordDecision(client, productId, SHOP, confirm(X), overDecline)).resolves.toBe("saved");

    // A tab still showing the decline ("Dopasuj ponownie") picks Y.
    await expect(recordDecision(client, productId, SHOP, confirm(Y), overDecline)).resolves.toBe("decided");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: X });
  });

  it("answers a decision for a product removed meanwhile as gone", async () => {
    const productId = await matchedProduct(X);
    const removed = await client.from("watchlist_items").delete().eq("id", productId).select("id");
    expect(removed.error).toBeNull();
    expect(z.array(idRow).parse(removed.data)).toHaveLength(1);

    await expect(recordDecision(client, productId, SHOP, confirm(Y), overMatch(X))).resolves.toBe("gone");
    await expect(recordLookup(client, productId, SHOP, { kind: "not-found" })).resolves.toBe("gone");
  });

  it("lets exactly one of two re-pins from the same match win", async () => {
    const productId = await matchedProduct(X);

    const [repin, declined] = await Promise.all([
      recordDecision(client, productId, SHOP, confirm(Y), overMatch(X)),
      recordDecision(client, productId, SHOP, decline, overMatch(X)),
    ]);

    expect([repin, declined].sort()).toEqual(["decided", "saved"]);
    expect(await decisionOf(productId)).toMatchObject(
      repin === "saved"
        ? { state: "matched", decided_by: "user", shop_item_id: Y }
        : { state: "unmatched", decided_by: "user", shop_item_id: null },
    );
  });

  it("makes the current automatic match the user's own with „To ten produkt”, within the update's column grant", async () => {
    const productId = await matchedProduct(X);
    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "auto", shop_item_id: X });

    await expect(recordDecision(client, productId, SHOP, confirm(X), overMatch(X))).resolves.toBe("saved");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: X });
  });

  // The negative control: the database alone would let a stale write through, so the cases above prove the narrowing.
  it("lets an update that ignores the decision it replaces overwrite a newer one", async () => {
    const productId = await matchedProduct(X);
    await expect(recordDecision(client, productId, SHOP, confirm(Y), overMatch(X))).resolves.toBe("saved");
    const { id } = await decisionOf(productId);

    const overwritten = await client
      .from("watchlist_matches")
      .update({
        state: "unmatched",
        decided_by: "user",
        shop_item_id: null,
        name: null,
        brand: null,
        size_text: null,
        size_value: null,
        size_unit: null,
        eans: [],
        product_url: null,
        image_url: null,
        checked_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id");

    expect(overwritten.error).toBeNull();
    expect(z.array(idRow).parse(overwritten.data)).toHaveLength(1);
    expect(await decisionOf(productId)).toMatchObject({ state: "unmatched", decided_by: "user", shop_item_id: null });
  });
});
