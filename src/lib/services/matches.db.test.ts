import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { recordDecision, recordLookup } from "@/lib/services/matches";
import { OVER_DECLINE, overMatch } from "@/lib/services/testing/record-decision";
import type { MatchedItem, ShopCandidate } from "@/types";
import { holdRemoval } from "../../../scripts/e2e-local-db.mjs";

// The decision write against the local stack's Postgres (risk #6 of context/foundation/test-plan.md). RLS lets a user
// change their own decision in any state, so `record` in matches.ts saves each decision in one call to record_decision,
// which replaces the stored decision only while it's the one the write expects: its state, its item and, for a match,
// who decided it (CLAUDE.md, "Data"). The unit tests prove the call it makes, through a stand-in. These prove what the
// database does with it: a write from a stale tab, a lookup that finishes late, or a confirmation of a match that
// changed hands never overwrites a newer decision; a decision in the product's own shop is refused; and a removal held
// open while a save runs makes it answer gone, never decided. `npm run test:db` (vitest.db.config.ts) runs them in CI's
// smoke job. The default run, which has no database, leaves them out. Each run signs up a fresh throwaway user through
// Auth and adds a product per test. The held removals run as the local superuser through the local stack's database
// container (holdRemoval in scripts/e2e-local-db.mjs), so they also need Docker access to it, and .env and .dev.vars
// pointing at the local stack.

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

// What the product's Natura decision is, read back as the user: exactly one row.
const decisionRows = z.tuple([
  z.object({ id: z.string(), state: z.string(), decided_by: z.string(), shop_item_id: z.string().nullable() }),
]);
const idRow = z.object({ id: z.string() });
const shopRow = z.object({ shop_id: z.string() });

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

/** What's left of a product as the user reads it: the product's own row, if any, and its decisions' shops. */
async function whatRemains(productId: string): Promise<{ products: string[]; decisions: string[] }> {
  const [items, matches] = await Promise.all([
    client.from("watchlist_items").select("id").eq("id", productId),
    client.from("watchlist_matches").select("shop_id").eq("watchlist_item_id", productId),
  ]);
  if (items.error || matches.error) {
    throw new Error(`reading what remains failed: ${items.error?.message ?? matches.error?.message ?? ""}`);
  }
  const idRows = z.array(idRow).parse(items.data);
  const shopRows = z.array(shopRow).parse(matches.data);
  return { products: idRows.map(({ id }) => id), decisions: shopRows.map(({ shop_id }) => shop_id) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    await expect(recordDecision(client, productId, SHOP, confirm(Y), overMatch(X, "auto"))).resolves.toBe("saved");

    // A tab still showing the automatic match of X picks Z.
    await expect(recordDecision(client, productId, SHOP, confirm(Z), overMatch(X, "auto"))).resolves.toBe("decided");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: Y });
  });

  it("refuses a stale tab's decline of a match that changed meanwhile", async () => {
    const productId = await matchedProduct(X);
    await expect(recordDecision(client, productId, SHOP, confirm(Y), overMatch(X, "auto"))).resolves.toBe("saved");

    // A tab still showing the automatic match of X chooses "Żaden z nich".
    await expect(recordDecision(client, productId, SHOP, decline, overMatch(X, "auto"))).resolves.toBe("decided");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: Y });
  });

  it("refuses a stale tab's re-pin of a decline the user changed meanwhile", async () => {
    const productId = await addProduct();
    await expect(recordLookup(client, productId, SHOP, { kind: "not-found" })).resolves.toBe("saved");
    await expect(recordDecision(client, productId, SHOP, decline)).resolves.toBe("saved");
    await expect(recordDecision(client, productId, SHOP, confirm(X), OVER_DECLINE)).resolves.toBe("saved");

    // A tab still showing the decline ("Dopasuj ponownie") picks Y.
    await expect(recordDecision(client, productId, SHOP, confirm(Y), OVER_DECLINE)).resolves.toBe("decided");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: X });
  });

  it("answers a decision for a product removed meanwhile as gone", async () => {
    const productId = await matchedProduct(X);
    const removed = await client.from("watchlist_items").delete().eq("id", productId).select("id");
    expect(removed.error).toBeNull();
    expect(z.array(idRow).parse(removed.data)).toHaveLength(1);

    await expect(recordDecision(client, productId, SHOP, confirm(Y), overMatch(X, "auto"))).resolves.toBe("gone");
    await expect(recordLookup(client, productId, SHOP, { kind: "not-found" })).resolves.toBe("gone");
  });

  it("lets exactly one of two re-pins from the same match win", async () => {
    const productId = await matchedProduct(X);

    const [repin, declined] = await Promise.all([
      recordDecision(client, productId, SHOP, confirm(Y), overMatch(X, "auto")),
      recordDecision(client, productId, SHOP, decline, overMatch(X, "auto")),
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

    await expect(recordDecision(client, productId, SHOP, confirm(X), overMatch(X, "auto"))).resolves.toBe("saved");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: X });
  });

  // A match that changed hands (S-01's F4): a tab shown the automatic match of X posts after another tab made X the
  // user's own. Its form names X, as the user's match does, so only who decided it tells them apart.
  it("refuses a confirmation of X from a tab shown the automatic match of X, once another tab made X the user's", async () => {
    const productId = await matchedProduct(X);
    await expect(recordDecision(client, productId, SHOP, confirm(X), overMatch(X, "auto"))).resolves.toBe("saved");

    await expect(recordDecision(client, productId, SHOP, confirm(X), overMatch(X, "auto"))).resolves.toBe("decided");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: X });
  });

  it("refuses a pick of Y from a tab shown the automatic match of X, once another tab made X the user's", async () => {
    const productId = await matchedProduct(X);
    await expect(recordDecision(client, productId, SHOP, confirm(X), overMatch(X, "auto"))).resolves.toBe("saved");

    await expect(recordDecision(client, productId, SHOP, confirm(Y), overMatch(X, "auto"))).resolves.toBe("decided");

    expect(await decisionOf(productId)).toMatchObject({ state: "matched", decided_by: "user", shop_item_id: X });
  });

  it("refuses a decision in the product's own shop, storing nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The product is picked in Rossmann, so a decision there is one in its own shop.
    const productId = await addProduct();

    await expect(recordDecision(client, productId, "rossmann", decline)).resolves.toBe("failed");

    // The database's own refusal (watchlist_matches_not_own_shop), logged once by the store, and no decision stored.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("watchlist_matches_not_own_shop");
    expect(await whatRemains(productId)).toEqual({ products: [productId], decisions: [] });
  });

  // A removal held open while a save runs: the removal has deleted the product and, through its key, the decision, and
  // holds both until a save waits on it, then commits. The save, which met the decision being deleted, starts its
  // insert again once the removal commits, and the product's key refuses it: gone, never decided.
  it("answers a re-pin over a match gone while the product's removal, held open, deletes it", async () => {
    const productId = await matchedProduct(X);
    const { held, done } = holdRemoval(productId);
    await held;

    const [result] = await Promise.all([
      recordDecision(client, productId, SHOP, confirm(Y), overMatch(X, "auto")),
      done,
    ]);

    expect(result).toBe("gone");
    expect(await whatRemains(productId)).toEqual({ products: [], decisions: [] });
  });

  it("answers a retry's lookup over „not found” gone while the product's removal, held open, deletes it", async () => {
    const productId = await addProduct();
    await expect(recordLookup(client, productId, SHOP, { kind: "not-found" })).resolves.toBe("saved");
    const { held, done } = holdRemoval(productId);
    await held;

    const [result] = await Promise.all([
      recordLookup(client, productId, SHOP, { kind: "accepted", candidate: candidateOf(X) }),
      done,
    ]);

    expect(result).toBe("gone");
    expect(await whatRemains(productId)).toEqual({ products: [], decisions: [] });
  });

  // The negative control: the database alone would let a stale write through, so the cases above prove the narrowing.
  it("lets an update that ignores the decision it replaces overwrite a newer one", async () => {
    const productId = await matchedProduct(X);
    await expect(recordDecision(client, productId, SHOP, confirm(Y), overMatch(X, "auto"))).resolves.toBe("saved");
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
