import { describe, expect, it } from "vitest";
import type { ExpectedDecision, MatchesRead, MatchForm } from "@/lib/services/matches";
import {
  admitDecision,
  watchedProductOf,
  type DecisionAdmission,
  type DecisionRefusal,
} from "@/lib/services/watched-product";
import type { MatchedItem, ShopMatch, WatchlistProduct } from "@/types";

const ITEM_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const CHECKED_AT = "2026-10-09T19:45:12+00:00";

// The user's Nivea Soft 300 ml, picked in Rossmann, its own shop: its matched shops are Natura, Hebe and Super-Pharm.
const product: WatchlistProduct = {
  id: ITEM_ID,
  source: "rossmann",
  sourceItemId: "26900",
  brand: "NIVEA",
  name: "Soft",
  caption: "krem uniwersalny, nawilżający",
  sizeText: "300 ml",
  size: { value: 300, unit: "ml" },
  imageUrl: null,
  addedAt: "2026-10-01T08:00:00+00:00",
  eans: ["4005900009319"],
  productUrl: null,
};

// The same product as if it had been picked in Natura: Natura is then its own shop, and Rossmann a matched shop.
const pickedInNatura: WatchlistProduct = { ...product, source: "natura", sourceItemId: "NV89063" };

/** One of Natura's items, as a confirm form posts it and a match stores it (natura-name-search.json). */
function naturaItem(shopItemId: string, name: string, ml: number, ean: string): MatchedItem {
  return {
    shopItemId,
    brand: "NIVEA",
    name,
    sizeText: `${ml} ml`,
    size: { value: ml, unit: "ml" },
    eans: [ean],
    productUrl: null,
    imageUrl: null,
  };
}

// The item the product is matched to in Natura (X), another item the user may pick instead (Y), and the item another
// tab matched it to meanwhile (Z).
const itemX = naturaItem("NV89063", "NIVEA SOFT krem intensywnie nawilżający 300 ml", 300, "4005900009319");
const itemY = naturaItem("NV81063", "Nivea MEN Fresh Kick 3w1 żel pod prysznic 500 ml", 500, "9005800286563");
const itemZ = naturaItem(
  "JM00370",
  "Yope Naturalny szampon do włosów Super Soft - mleko owsiane 300 ml",
  300,
  "5900168900370",
);

// The product's stored decisions in Natura: a match of X by the matching rule, the same match confirmed by the user,
// the user's match of Z, the user's decline, and a lookup that found nothing.
const inNatura = { watchlistItemId: ITEM_ID, shop: "natura", checkedAt: CHECKED_AT } as const;
const autoMatchOfX: ShopMatch = { ...inNatura, decidedBy: "auto", state: "matched", item: itemX };
const userMatchOfX: ShopMatch = { ...inNatura, decidedBy: "user", state: "matched", item: itemX };
const matchOfZ: ShopMatch = { ...inNatura, decidedBy: "user", state: "matched", item: itemZ };
const declined: ShopMatch = { ...inNatura, decidedBy: "user", state: "unmatched", item: null };
const notFound: ShopMatch = { ...inNatura, decidedBy: "auto", state: "not_found", item: null };

/** The product's stored decisions, as listMatches reads them when every row can be read. */
const read = (...matches: ShopMatch[]): MatchesRead => ({ matches, unreadable: [] });

/** "To ten produkt" for `item` in Natura, as parseMatchForm reads it: a first choice's posts no `replaces`. */
const confirm = (item: MatchedItem, replaces: ExpectedDecision | null = null): MatchForm => ({
  itemId: ITEM_ID,
  shop: "natura",
  decision: { action: "confirm", item },
  replaces,
});

/** "Żaden z nich" in Natura, as parseMatchForm reads it: a first choice's posts no `replaces`. */
const decline = (replaces: ExpectedDecision | null = null): MatchForm => ({
  itemId: ITEM_ID,
  shop: "natura",
  decision: { action: "decline" },
  replaces,
});

/** A re-pin's `replaces` over a match of `item` (`matched:<its id>`), and over the user's decline (`unmatched`). */
const overMatchOf = (item: MatchedItem): ExpectedDecision => ({ state: "matched", shopItemId: item.shopItemId });
const overDecline: ExpectedDecision = { state: "unmatched" };

/** What the guardian says to `form` for `own`, by default the product picked in Rossmann, with these decisions. */
function admit(stored: ShopMatch[], form: MatchForm, own: WatchlistProduct = product): DecisionAdmission {
  return admitDecision(watchedProductOf(own, read(...stored)), form);
}

/** The admission of a decision in Natura: recordDecision's arguments, the form's own `replaces` among them. */
const admittedInNatura = (form: MatchForm): DecisionAdmission => ({
  kind: "admitted",
  change: { itemId: ITEM_ID, shop: "natura", decision: form.decision, replaces: form.replaces },
});

const refusedAs = (reason: DecisionRefusal): DecisionAdmission => ({ kind: "refused", reason });

// The table tests name a post and the decision it meets in two short fields, which Vitest's titles show whole.
interface Move {
  post: string;
  over: string;
  stored: ShopMatch[];
  form: MatchForm;
}

describe("admitDecision: the moves the page's forms post", () => {
  it.each<Move>([
    { post: "a first choice's confirm", over: "no decision", stored: [], form: confirm(itemX) },
    { post: "a first choice's decline", over: "no decision", stored: [], form: decline() },
    { post: "a first choice's confirm", over: "a lookup that found nothing", stored: [notFound], form: confirm(itemX) },
    { post: "a first choice's decline", over: "a lookup that found nothing", stored: [notFound], form: decline() },
    {
      post: "a confirm of Y with matched:X",
      over: "an automatic match of X",
      stored: [autoMatchOfX],
      form: confirm(itemY, overMatchOf(itemX)),
    },
    {
      post: "a confirm of Y with matched:X",
      over: "the user's match of X",
      stored: [userMatchOfX],
      form: confirm(itemY, overMatchOf(itemX)),
    },
    {
      post: "a decline with matched:X",
      over: "an automatic match of X",
      stored: [autoMatchOfX],
      form: decline(overMatchOf(itemX)),
    },
    {
      post: "a decline with matched:X",
      over: "the user's match of X",
      stored: [userMatchOfX],
      form: decline(overMatchOf(itemX)),
    },
    {
      post: "a confirm of Y with unmatched",
      over: "the user's decline",
      stored: [declined],
      form: confirm(itemY, overDecline),
    },
  ])("admits $post over $over, as the change recordDecision stores", ({ stored, form }) => {
    expect(admit(stored, form)).toEqual(admittedInNatura(form));
  });

  it("admits a confirm of X with matched:X over an automatic match of X, which recordDecision makes the user's", () => {
    // The re-pin's choice still offers the item the rule matched on its own, and confirming it stores it as the user's.
    const form = confirm(itemX, overMatchOf(itemX));

    expect(admit([autoMatchOfX], form)).toEqual(admittedInNatura(form));
  });
});

describe("admitDecision: a shop that isn't one of the product's matched shops", () => {
  it.each<{ action: string; own: WatchlistProduct; form: MatchForm }>([
    { action: "confirm", own: product, form: { ...confirm(itemX), shop: "rossmann" } },
    { action: "decline", own: product, form: { ...decline(), shop: "rossmann" } },
    { action: "confirm", own: pickedInNatura, form: confirm(itemX) },
    { action: "decline", own: pickedInNatura, form: decline() },
  ])("refuses a $action in $form.shop, the own shop of a product picked there", ({ own, form }) => {
    expect(admit([], form, own)).toEqual(refusedAs("not-a-matched-shop"));
  });

  it("refuses a post for the own shop over a decision stored there earlier, which no read counts", () => {
    const rossmannDecline: ShopMatch = { ...declined, shop: "rossmann" };

    expect(admit([rossmannDecline], { ...decline(overDecline), shop: "rossmann" })).toEqual(
      refusedAs("not-a-matched-shop"),
    );
  });

  it("admits a post for Rossmann, a matched shop of a product picked in Natura", () => {
    const form: MatchForm = { ...decline(), shop: "rossmann" };

    expect(admit([], form, pickedInNatura)).toEqual({
      kind: "admitted",
      change: { itemId: ITEM_ID, shop: "rossmann", decision: { action: "decline" }, replaces: null },
    });
  });

  it("refuses a post for a priced shop the product was built without, as one switched off", () => {
    const watched = watchedProductOf(product, read(), ["rossmann", "natura", "hebe"]);

    expect(admitDecision(watched, { ...decline(), shop: "super-pharm" })).toEqual(refusedAs("not-a-matched-shop"));
    expect(admitDecision(watched, { ...decline(), shop: "hebe" })).toMatchObject({ kind: "admitted" });
  });
});

describe("admitDecision: a shop whose decision couldn't be read", () => {
  it.each<{ post: string; form: MatchForm }>([
    { post: "a first choice's confirm", form: confirm(itemX) },
    { post: "a first choice's decline", form: decline() },
    { post: "a re-pin's confirm with matched:X", form: confirm(itemY, overMatchOf(itemX)) },
    { post: "a re-pin's confirm with unmatched", form: confirm(itemY, overDecline) },
  ])("refuses $post there, never taking the shop for undecided", ({ form }) => {
    const watched = watchedProductOf(product, { matches: [], unreadable: ["natura"] });

    expect(admitDecision(watched, form)).toEqual(refusedAs("unreadable"));
  });

  it("admits a post in Natura beside Hebe's decision that couldn't be read", () => {
    const watched = watchedProductOf(product, { matches: [], unreadable: ["hebe"] });

    expect(admitDecision(watched, confirm(itemX))).toEqual(admittedInNatura(confirm(itemX)));
  });
});

describe("admitDecision: a form shown with another decision than the stored one", () => {
  it.each<Move>([
    // A first choice's forms, posted after a decision was stored meanwhile.
    { post: "a confirm without replaces", over: "an automatic match", stored: [autoMatchOfX], form: confirm(itemY) },
    { post: "a decline without replaces", over: "the user's match", stored: [userMatchOfX], form: decline() },
    { post: "a confirm without replaces", over: "the user's decline", stored: [declined], form: confirm(itemY) },
    { post: "a decline without replaces", over: "the user's decline", stored: [declined], form: decline() },
    // A re-pin's forms, posted after the decision they replace changed.
    {
      post: "a confirm with matched:X",
      over: "a match of Z",
      stored: [matchOfZ],
      form: confirm(itemY, overMatchOf(itemX)),
    },
    { post: "a decline with matched:X", over: "a match of Z", stored: [matchOfZ], form: decline(overMatchOf(itemX)) },
    {
      post: "a confirm with matched:X",
      over: "the user's decline",
      stored: [declined],
      form: confirm(itemY, overMatchOf(itemX)),
    },
    {
      post: "a confirm with unmatched",
      over: "an automatic match",
      stored: [autoMatchOfX],
      form: confirm(itemY, overDecline),
    },
    { post: "a decline with unmatched", over: "the user's match", stored: [userMatchOfX], form: decline(overDecline) },
    // A re-pin's forms where no decision is stored, or only a lookup that found nothing.
    { post: "a confirm with matched:X", over: "no decision", stored: [], form: confirm(itemX, overMatchOf(itemX)) },
    { post: "a decline with unmatched", over: "no decision", stored: [], form: decline(overDecline) },
    {
      post: "a decline with matched:X",
      over: "a lookup that found nothing",
      stored: [notFound],
      form: decline(overMatchOf(itemX)),
    },
    {
      post: "a confirm with unmatched",
      over: "a lookup that found nothing",
      stored: [notFound],
      form: confirm(itemX, overDecline),
    },
  ])("refuses $post over $over, which would replace a decision that isn't stored", ({ stored, form }) => {
    expect(admit(stored, form)).toEqual(refusedAs("outdated-form"));
  });
});

describe("admitDecision: the move no page offers", () => {
  it("refuses a decline with unmatched over the user's decline", () => {
    expect(admit([declined], decline(overDecline))).toEqual(refusedAs("illegal-move"));
  });
});

describe("admitDecision: a confirmation posted again", () => {
  // The re-pin's choice over an automatic match of X offers „To ten produkt” on X (repinView). A second tab, or a
  // second tap without JavaScript, posts that form again after the first post made the match the user's.
  it("refuses a confirm of X with matched:X over the user's own match of X as an outdated form", () => {
    expect(admit([userMatchOfX], confirm(itemX, overMatchOf(itemX)))).toEqual(refusedAs("outdated-form"));
  });
});

describe("watchedProductOf", () => {
  const undecided = { kind: "undecided" } as const;

  it("gives each matched shop its standing: decided with the stored decision, undecided without a row", () => {
    const hebeNotFound: ShopMatch = { ...notFound, shop: "hebe" };

    expect(watchedProductOf(product, read(autoMatchOfX, hebeNotFound))).toEqual({
      itemId: ITEM_ID,
      ownShop: "rossmann",
      standings: {
        natura: { kind: "decided", decision: autoMatchOfX },
        hebe: { kind: "decided", decision: hebeNotFound },
        "super-pharm": undecided,
      },
    });
  });

  it("gives a decision stored in the product's own shop no standing", () => {
    const rossmannDecline: ShopMatch = { ...declined, shop: "rossmann" };

    expect(watchedProductOf(product, read(rossmannDecline))).toEqual({
      itemId: ITEM_ID,
      ownShop: "rossmann",
      standings: { natura: undecided, hebe: undecided, "super-pharm": undecided },
    });
    // Picked in Natura, the same product has no standing in Natura and one in Rossmann.
    expect(watchedProductOf(pickedInNatura, read(autoMatchOfX)).standings).toEqual({
      rossmann: undecided,
      hebe: undecided,
      "super-pharm": undecided,
    });
  });

  it("reads a shop the read lists as unreadable as unreadable, never as undecided", () => {
    expect(watchedProductOf(product, { matches: [autoMatchOfX], unreadable: ["hebe"] }).standings).toEqual({
      natura: { kind: "decided", decision: autoMatchOfX },
      hebe: { kind: "unreadable" },
      "super-pharm": undecided,
    });
  });

  it("gives no standing in a shop outside the priced shops it's built with, whatever is stored there", () => {
    const superPharmDecline: ShopMatch = { ...declined, shop: "super-pharm" };

    expect(watchedProductOf(product, read(superPharmDecline), ["rossmann", "natura", "hebe"]).standings).toEqual({
      natura: undecided,
      hebe: undecided,
    });
  });
});
