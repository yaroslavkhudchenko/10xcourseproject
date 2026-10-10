import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { declinedRow, matchRow, naturaProductRow, notFoundRow, productRow } from "@/lib/services/testing/stored-rows";
import { stubSupabase, type StubCall, type StubRelation } from "@/lib/services/testing/stub-supabase";
import { APP, contextOf, formPost, type FormFields } from "@/lib/services/testing/route-context";
import { POST as postDecision } from "@/pages/api/watchlist/matches";

// risk: #6, #1 and #4 (context/foundation/test-plan.md): a decision is stored over a newer one, along a move no page
// offers or in the product's own shop, or another user's product answers unlike an id no one has.
// facet: the decision route, called through its exported handler over the stand-in database, which serves the user's
// product and its stored decisions and records every query, so each test sees where the route sends the user back to
// and whether it wrote a decision. The stand-in's insert never conflicts, so a decision the route stores comes back
// saved: the compare-and-swap over a stored decision, and the race between the route's read and its write, stay pinned
// by matches.test.ts and matches.db.test.ts.
// expected values: the code each case comes back with, as the decision-route-guardian plan's table states it and the
// product's page reads it back (decisionBackTo): a shop outside the product's matched shops, its own included, or a
// move no page's form offers (MatchChoice.astro) is invalid data, shown on no card for the own shop (the owner's call,
// 2026-10-09); a form shown with another decision than the stored one finds the decision already stored, as does a
// confirmation posted again after the first made the match the user's (the owner's call, 2026-10-10); a decision that
// couldn't be read is a failure, never none; and another user's product answers exactly like an id no one has
// (scripts/check-two-users.mjs). Never read off the route.

const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
// An id no product on the user's list has: RLS reads another user's product the same way.
const NOBODYS_ID = "c0ffee00-0000-4000-8000-000000000001";

// Natura's items as a confirm form posts them (MatchChoice.astro): Nivea Soft 300 ml, the item the product is matched
// to (X), as its adapter maps the recorded EAN hit (natura-ean-hit.json), and another the user may pick instead (Y),
// which comes without links.
const SOFT = {
  shopItemId: "NV89063",
  name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
  brand: "NIVEA",
  sizeText: "300 ml",
  eans: ["4005900009319"],
  productUrl: "https://drogerienatura.pl/produkt/nivea-soft-krem-intensywnie-nawilzajacy-300-ml-4005900009319",
  imageUrl:
    "https://media.drogerienatura.pl/catalog/product/4/0/4005900009319_T1_a685.jpg?store=default&image-type=image",
};
const MEN = {
  shopItemId: "NV81063",
  name: "Nivea MEN Fresh Kick 3w1 żel pod prysznic 500 ml",
  brand: "NIVEA",
  sizeText: "500 ml",
  eans: ["9005800286563"],
  productUrl: "",
  imageUrl: "",
};
// Rossmann's Nivea Soft 300 ml, as a confirm form posts a Rossmann item.
const ROSSMANN_SOFT = { ...SOFT, shopItemId: "26900", name: "Soft", productUrl: "", imageUrl: "" };

// The product's stored decisions in Natura: the user's match of X, the same match by the matching rule, the user's
// match of Z, which another tab stored, the user's decline, a lookup that found nothing, and a match without its item,
// which can't be read.
const userMatchOfX = matchRow(PRODUCT_ID, "natura", SOFT.shopItemId);
const autoMatchOfX = { ...userMatchOfX, decided_by: "auto" };
const matchOfZ = matchRow(PRODUCT_ID, "natura", "JM00370");
const declined = declinedRow(PRODUCT_ID, "natura");
const notFound = notFoundRow(PRODUCT_ID, "natura");
const unreadable = { ...userMatchOfX, shop_item_id: null };

const TIMEOUT: StubRelation = { error: { code: "57014", message: "canceling statement due to statement timeout" } };

/** The user's product, Rossmann's Nivea Soft, picked there: its matched shops are Natura, Hebe and Super-Pharm. */
const ROSSMANN_PRODUCT = [productRow(PRODUCT_ID, "26900")];
/** The same product picked in Natura: its matched shops are Rossmann, Hebe and Super-Pharm. */
const NATURA_PRODUCT = [naturaProductRow(PRODUCT_ID, "NV89063")];

/**
 * The fields every decision form of the product's page posts for Natura (MatchChoice.astro): the product, the shop, the
 * list's filter, a re-pin's `replaces`, which a first choice's forms leave out, and the action. The user came from
 * "Do sprawdzenia" (`f=check`).
 */
function decisionFields(action: "confirm" | "decline", replaces?: string): FormFields {
  return { itemId: PRODUCT_ID, shop: "natura", f: "check", ...(replaces === undefined ? {} : { replaces }), action };
}

/** "To ten produkt" for one of Natura's items, with a re-pin's `replaces`, if any. */
const confirm = (item: typeof SOFT, replaces?: string): FormFields => ({
  ...decisionFields("confirm", replaces),
  ...item,
});

/** "Żaden z nich", with a re-pin's `replaces`, if any. */
const decline = (replaces?: string): FormFields => decisionFields("decline", replaces);

/** A decision posted as a form from the app's own page. */
const decisionRequest = (fields: FormFields): Request => formPost("/api/watchlist/matches", fields);

/** The stand-in database: the user's `product` row, Rossmann's Nivea Soft unless said otherwise, and its decisions. */
function world(decisions: StubRelation, product: StubRelation = ROSSMANN_PRODUCT) {
  return stubSupabase({ relations: { watchlist_items: product, watchlist_matches: decisions } });
}

/** Where the route sends the user back to after `request`. */
async function locationAfter(request: Request, supabase: SupabaseClient | null): Promise<string | null> {
  const response = await postDecision(contextOf(request, supabase));
  return response.headers.get("Location");
}

/** The writes the route made to the user's decisions: every insert or update on watchlist_matches, with its values. */
function decisionWrites(queries: StubCall[][]): StubCall[] {
  return queries.flatMap(([[kind, relation], ...calls]) =>
    kind === "from" && relation === "watchlist_matches"
      ? calls.filter(([method]) => method === "insert" || method === "update")
      : [],
  );
}

/** Each query the route made, in order, as its relation and what it did there, such as `watchlist_items select`. */
function queryKinds(queries: StubCall[][]): string[] {
  return queries.map(([[, relation], [operation]]) => `${String(relation)} ${operation}`);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/watchlist/matches answers a post it can't read before reading anything", () => {
  it("sends a body that isn't a form back to the list, whose filter it can't read", async () => {
    const { client, queries } = world([]);
    const request = new Request(`${APP}/api/watchlist/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: APP, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify(decline()),
    });

    expect(await locationAfter(request, client)).toBe("/watchlist");
    expect(queries).toEqual([]);
  });

  it("sends a post back to its product's page with error=config without a database", async () => {
    expect(await locationAfter(decisionRequest(decline()), null)).toBe(
      `/watchlist/${PRODUCT_ID}?f=check&shop=natura&error=config`,
    );
  });

  it.each<{ why: string; fields: FormFields; location: string }>([
    {
      why: "an action no form posts",
      fields: { ...decline(), action: "repin" },
      location: `/watchlist/${PRODUCT_ID}?f=check&shop=natura&error=invalid`,
    },
    {
      why: "a shop item id with a path in it",
      fields: { ...confirm(SOFT), shopItemId: "NV89063/../koszyk" },
      location: `/watchlist/${PRODUCT_ID}?f=check&shop=natura&error=invalid`,
    },
    // No card shows a shop the app doesn't know, and without a product's id the post goes back to the list.
    {
      why: "a shop the app doesn't know",
      fields: { ...decline(), shop: "dm" },
      location: `/watchlist/${PRODUCT_ID}?f=check&error=invalid`,
    },
    {
      why: "a product id that isn't a UUID",
      fields: { ...decline(), itemId: "26900" },
      location: "/watchlist?f=check",
    },
  ])("refuses a form with $why as invalid, reading nothing", async ({ fields, location }) => {
    const { client, queries } = world([]);

    expect(await locationAfter(decisionRequest(fields), client)).toBe(location);
    expect(queries).toEqual([]);
  });
});

describe("/api/watchlist/matches reads the product and its decisions before any write", () => {
  it("answers a product the read can't see, another user's included, as gone, writing and logging nothing", async () => {
    // A re-pin's decline, as the two-user check posts it for another user's product and for an id no one has.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, queries } = world([userMatchOfX]);
    const fields = { ...decline(`matched:${SOFT.shopItemId}`), itemId: NOBODYS_ID, f: "all" };

    expect(await locationAfter(decisionRequest(fields), client)).toBe(
      `/watchlist/${NOBODYS_ID}?shop=natura&error=gone`,
    );
    expect(decisionWrites(queries)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<{ why: string; decisions: StubRelation; product?: StubRelation }>([
    { why: "the product can't be read", decisions: [], product: TIMEOUT },
    { why: "its decisions can't be read at all", decisions: TIMEOUT },
  ])("answers error=failed, writing nothing, when $why", async ({ decisions, product }) => {
    const { client, queries } = world(decisions, product);

    expect(await locationAfter(decisionRequest(confirm(SOFT)), client)).toBe(
      `/watchlist/${PRODUCT_ID}?f=check&shop=natura&error=failed`,
    );
    expect(decisionWrites(queries)).toEqual([]);
  });

  it("answers gone, writing nothing, when the product isn't on the list, even when its decisions can't be read", async () => {
    // The product's read decides first, as on its page: without the product, its decisions don't count.
    const { client, queries } = world(TIMEOUT, []);

    expect(await locationAfter(decisionRequest(confirm(SOFT)), client)).toBe(
      `/watchlist/${PRODUCT_ID}?f=check&shop=natura&error=gone`,
    );
    expect(decisionWrites(queries)).toEqual([]);
  });

  it.each<{ action: string; shop: string; product: StubRelation; fields: FormFields }>([
    { action: "decline", shop: "rossmann", product: ROSSMANN_PRODUCT, fields: { ...decline(), shop: "rossmann" } },
    { action: "confirm", shop: "natura", product: NATURA_PRODUCT, fields: confirm(MEN) },
  ])(
    "answers error=failed to a $action in $shop, the product's own shop, when its decisions can't be read at all, writing nothing",
    async ({ shop, product, fields }) => {
      // Decisions that couldn't be read at all are a failure to try again, answered before the guardian, which would
      // call a post for the product's own shop invalid.
      const { client, queries } = world(TIMEOUT, product);

      expect(await locationAfter(decisionRequest(fields), client)).toBe(
        `/watchlist/${PRODUCT_ID}?f=check&shop=${shop}&error=failed`,
      );
      expect(decisionWrites(queries)).toEqual([]);
    },
  );

  it("reads the product and its decisions before it writes the decision", async () => {
    const { client, queries } = world([]);

    await locationAfter(decisionRequest(confirm(SOFT)), client);

    expect(queryKinds(queries)).toEqual([
      "watchlist_items select",
      "watchlist_matches select",
      "watchlist_matches insert",
    ]);
  });
});

// The table tests name a post, the decision it meets and the code it comes back with in short fields, which Vitest's
// titles show whole.
interface Move {
  post: string;
  over: string;
  stored: Record<string, unknown>[];
  fields: FormFields;
  code: string;
}

describe("/api/watchlist/matches stores nothing the guardian refuses", () => {
  it.each<{
    action: string;
    shop: string;
    product: StubRelation;
    stored: Record<string, unknown>[];
    fields: FormFields;
  }>([
    {
      action: "decline",
      shop: "rossmann",
      product: ROSSMANN_PRODUCT,
      stored: [],
      fields: { ...decline(), shop: "rossmann" },
    },
    {
      action: "confirm",
      shop: "rossmann",
      product: ROSSMANN_PRODUCT,
      stored: [],
      fields: { ...confirm(ROSSMANN_SOFT), shop: "rossmann" },
    },
    { action: "confirm", shop: "natura", product: NATURA_PRODUCT, stored: [], fields: confirm(MEN) },
    // A re-pin's, over a match stored there earlier, which no read counts.
    {
      action: "decline",
      shop: "natura",
      product: NATURA_PRODUCT,
      stored: [matchRow(PRODUCT_ID, "natura", MEN.shopItemId)],
      fields: decline(`matched:${MEN.shopItemId}`),
    },
  ])(
    "answers error=invalid to a $action in $shop, the product's own shop, storing nothing",
    async ({ shop, product, stored, fields }) => {
      const { client, queries } = world(stored, product);

      expect(await locationAfter(decisionRequest(fields), client)).toBe(
        `/watchlist/${PRODUCT_ID}?f=check&shop=${shop}&error=invalid`,
      );
      expect(decisionWrites(queries)).toEqual([]);
    },
  );

  it.each<Move>([
    // The move no page's form offers.
    {
      post: "a decline with unmatched",
      over: "the user's decline",
      stored: [declined],
      fields: decline("unmatched"),
      code: "error=invalid",
    },
    // A re-pin's „To ten produkt” on an automatic match's own item, posted again from a second tab, or by a second tap
    // without JavaScript, after the first post made the match the user's.
    {
      post: "a confirm of X with matched:X",
      over: "the user's own match of X",
      stored: [userMatchOfX],
      fields: confirm(SOFT, `matched:${SOFT.shopItemId}`),
      code: "decided=1",
    },
    // A first choice's form, posted after a decision was stored meanwhile, and a re-pin's, after another tab changed
    // the decision it replaces: the stored decision stands.
    {
      post: "a first choice's confirm",
      over: "a match stored meanwhile",
      stored: [autoMatchOfX],
      fields: confirm(MEN),
      code: "decided=1",
    },
    {
      post: "a decline with matched:X",
      over: "a match of Z from another tab",
      stored: [matchOfZ],
      fields: decline(`matched:${SOFT.shopItemId}`),
      code: "decided=1",
    },
    // Never taken for no decision.
    {
      post: "a first choice's confirm",
      over: "a decision that can't be read",
      stored: [unreadable],
      fields: confirm(SOFT),
      code: "error=failed",
    },
  ])("answers $code to $post over $over, storing nothing", async ({ stored, fields, code }) => {
    const { client, queries } = world(stored);

    expect(await locationAfter(decisionRequest(fields), client)).toBe(
      `/watchlist/${PRODUCT_ID}?f=check&shop=natura&${code}`,
    );
    expect(decisionWrites(queries)).toEqual([]);
  });
});

describe("/api/watchlist/matches stores every decision the page's forms post", () => {
  it.each<Move & { stores: Record<string, unknown> }>([
    {
      post: "a first choice's confirm",
      over: "no decision",
      stored: [],
      fields: confirm(SOFT),
      code: "matched=1",
      stores: { state: "matched", decided_by: "user", shop_item_id: SOFT.shopItemId },
    },
    {
      post: "a first choice's decline",
      over: "a lookup that found nothing",
      stored: [notFound],
      fields: decline(),
      code: "declined=1",
      stores: { state: "unmatched", decided_by: "user", shop_item_id: null },
    },
    {
      post: "a confirm of Y with matched:X",
      over: "the user's match of X",
      stored: [userMatchOfX],
      fields: confirm(MEN, `matched:${SOFT.shopItemId}`),
      code: "matched=1",
      stores: { state: "matched", decided_by: "user", shop_item_id: MEN.shopItemId },
    },
    {
      post: "a decline with matched:X",
      over: "an automatic match of X",
      stored: [autoMatchOfX],
      fields: decline(`matched:${SOFT.shopItemId}`),
      code: "declined=1",
      stores: { state: "unmatched", decided_by: "user", shop_item_id: null },
    },
    // The re-pin's choice still offers the item the rule matched on its own, and confirming it makes the match the
    // user's.
    {
      post: "a confirm of X with matched:X",
      over: "an automatic match of X",
      stored: [autoMatchOfX],
      fields: confirm(SOFT, `matched:${SOFT.shopItemId}`),
      code: "matched=1",
      stores: { state: "matched", decided_by: "user", shop_item_id: SOFT.shopItemId },
    },
    {
      post: "a confirm of Y with unmatched",
      over: "the user's decline",
      stored: [declined],
      fields: confirm(MEN, "unmatched"),
      code: "matched=1",
      stores: { state: "matched", decided_by: "user", shop_item_id: MEN.shopItemId },
    },
  ])("stores $post over $over, answering $code", async ({ stored, fields, code, stores }) => {
    const { client, queries } = world(stored);

    expect(await locationAfter(decisionRequest(fields), client)).toBe(
      `/watchlist/${PRODUCT_ID}?f=check&shop=natura&${code}`,
    );
    expect(decisionWrites(queries)).toEqual([
      ["insert", expect.objectContaining({ watchlist_item_id: PRODUCT_ID, shop_id: "natura", ...stores })],
    ]);
  });

  it("stores a decline in Rossmann, a matched shop of a product picked in Natura, answering declined=1", async () => {
    const { client, queries } = world([], NATURA_PRODUCT);

    expect(await locationAfter(decisionRequest({ ...decline(), shop: "rossmann" }), client)).toBe(
      `/watchlist/${PRODUCT_ID}?f=check&shop=rossmann&declined=1`,
    );
    expect(decisionWrites(queries)).toEqual([
      [
        "insert",
        expect.objectContaining({
          watchlist_item_id: PRODUCT_ID,
          shop_id: "rossmann",
          state: "unmatched",
          decided_by: "user",
          shop_item_id: null,
        }),
      ],
    ]);
  });
});
