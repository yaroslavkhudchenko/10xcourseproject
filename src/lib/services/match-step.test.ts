import { describe, expect, it } from "vitest";
import {
  autoRefreshOf,
  decideMatchStep,
  repinShopOf,
  retryShopOf,
  type MatchStep,
  type MatchStepInput,
} from "@/lib/services/match-step";
import type { MatchesRead } from "@/lib/services/matches";
import { matchedShopsOf, type MatchableShop } from "@/lib/services/price-comparison";
import type { RepinnableMatch, ShopMatch } from "@/types";

const decision = { watchlistItemId: "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb", checkedAt: "2026-09-27T19:45:12+00:00" };
// Natura's three kinds of stored decision for the product.
const matched: ShopMatch = {
  ...decision,
  shop: "natura",
  decidedBy: "auto",
  state: "matched",
  item: {
    shopItemId: "NV89063",
    brand: "NIVEA",
    name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
    sizeText: "300 ml",
    size: { value: 300, unit: "ml" },
    eans: ["4005900009319"],
    productUrl: null,
    imageUrl: null,
  },
};
const unmatched: ShopMatch = { ...decision, shop: "natura", decidedBy: "user", state: "unmatched", item: null };
const notFound: ShopMatch = { ...decision, shop: "natura", decidedBy: "auto", state: "not_found", item: null };
// The same kinds of decision in Hebe.
const hebeMatched: ShopMatch = { ...matched, shop: "hebe" };
const hebeNotFound: ShopMatch = { ...notFound, shop: "hebe" };

/** The product's stored decisions, as listMatches reads them when every row can be read. */
const read = (...matches: ShopMatch[]): MatchesRead => ({ matches, unreadable: [] });

/** How the page was opened: looking Natura up again (`?retry=natura`) or not, and by the user's own navigation or not. */
interface Opened {
  retryShop: MatchableShop | null;
  ownNavigation: boolean;
}

describe("decideMatchStep: a settled decision costs no request", () => {
  it.each<{ stored: ShopMatch } & Opened>([
    { stored: matched, retryShop: null, ownNavigation: true },
    { stored: matched, retryShop: "natura", ownNavigation: true },
    { stored: matched, retryShop: "natura", ownNavigation: false },
    { stored: unmatched, retryShop: null, ownNavigation: true },
    { stored: unmatched, retryShop: "natura", ownNavigation: true },
    { stored: unmatched, retryShop: "natura", ownNavigation: false },
  ])(
    "only shows a stored $stored.state (retry: $retryShop, own navigation: $ownNavigation)",
    ({ stored, ...opened }) => {
      expect(decideMatchStep({ matches: read(stored), shop: "natura", repinShop: null, ...opened })).toEqual({
        kind: "stored",
        match: stored,
      });
    },
  );
});

describe("decideMatchStep: a lookup that found nothing", () => {
  it.each<{ why: string; step: MatchStep } & Opened>([
    {
      why: "shows it when opened without a retry",
      retryShop: null,
      ownNavigation: true,
      step: { kind: "stored", match: notFound },
    },
    {
      why: "shows it when opened from another site without a retry",
      retryShop: null,
      ownNavigation: false,
      step: { kind: "stored", match: notFound },
    },
    {
      why: "looks it up again on the user's retry",
      retryShop: "natura",
      ownNavigation: true,
      step: { kind: "lookup", retry: true },
    },
    {
      why: "only prompts when a retry comes from another site",
      retryShop: "natura",
      ownNavigation: false,
      step: { kind: "prompt" },
    },
  ])("$why", ({ retryShop, ownNavigation, step }) => {
    expect(
      decideMatchStep({ matches: read(notFound), shop: "natura", retryShop, repinShop: null, ownNavigation }),
    ).toEqual(step);
  });
});

describe("decideMatchStep: no decision yet", () => {
  it.each<{ why: string; step: MatchStep } & Opened>([
    {
      why: "looks it up on the user's own navigation",
      retryShop: null,
      ownNavigation: true,
      step: { kind: "lookup", retry: false },
    },
    {
      why: "treats a retry link as the first lookup",
      retryShop: "natura",
      ownNavigation: true,
      step: { kind: "lookup", retry: false },
    },
    {
      why: "only prompts when opened from another site",
      retryShop: null,
      ownNavigation: false,
      step: { kind: "prompt" },
    },
  ])("$why", ({ retryShop, ownNavigation, step }) => {
    expect(decideMatchStep({ matches: read(), shop: "natura", retryShop, repinShop: null, ownNavigation })).toEqual(
      step,
    );
  });

  it("ignores another shop's decision", () => {
    const naturaStep = (matches: ShopMatch[]) =>
      decideMatchStep({
        matches: read(...matches),
        shop: "natura",
        retryShop: "natura",
        repinShop: null,
        ownNavigation: true,
      });

    expect(naturaStep([hebeMatched])).toEqual({ kind: "lookup", retry: false });
    expect(naturaStep([hebeNotFound])).toEqual({ kind: "lookup", retry: false });
    expect(naturaStep([hebeMatched, unmatched])).toEqual({ kind: "stored", match: unmatched });
  });

  it("decides Rossmann's step like any matched shop's, for a product picked in Natura", () => {
    // The product's own Natura decision, which the page never runs a step for, says nothing about Rossmann.
    const rossmannStep = (ownNavigation: boolean, matches: ShopMatch[]) =>
      decideMatchStep({ matches: read(...matches), shop: "rossmann", retryShop: null, repinShop: null, ownNavigation });

    expect(rossmannStep(true, [matched])).toEqual({ kind: "lookup", retry: false });
    expect(rossmannStep(false, [matched])).toEqual({ kind: "prompt" });
    expect(rossmannStep(true, [{ ...notFound, shop: "rossmann" }])).toEqual({
      kind: "stored",
      match: { ...notFound, shop: "rossmann" },
    });
  });
});

describe("decideMatchStep: decisions that couldn't be read", () => {
  it.each<Opened>([
    { retryShop: null, ownNavigation: true },
    { retryShop: "natura", ownNavigation: true },
    { retryShop: null, ownNavigation: false },
  ])("looks nothing up (retry: $retryShop, own navigation: $ownNavigation)", (opened) => {
    expect(decideMatchStep({ matches: null, shop: "natura", repinShop: null, ...opened })).toEqual({
      kind: "read-failed",
    });
  });

  it("looks nothing up in a shop whose decision came back odd, and keeps another shop's decision", () => {
    // Hebe's row came back odd; Natura's was read.
    const matches: MatchesRead = { matches: [matched], unreadable: ["hebe"] };
    const stepIn = (shop: MatchableShop) =>
      decideMatchStep({ matches, shop, retryShop: null, repinShop: null, ownNavigation: true });

    expect(stepIn("natura")).toEqual({ kind: "stored", match: matched });
    expect(stepIn("hebe")).toEqual({ kind: "read-failed" });
  });
});

describe("decideMatchStep: the choice that changes a stored decision (?repin=natura)", () => {
  it.each<{ stored: ShopMatch; retryShop: MatchableShop | null }>([
    { stored: matched, retryShop: null },
    { stored: matched, retryShop: "natura" },
    { stored: unmatched, retryShop: null },
    { stored: unmatched, retryShop: "natura" },
  ])(
    "opens it for a stored $stored.state on the user's own navigation (retry: $retryShop)",
    ({ stored, retryShop }) => {
      expect(
        decideMatchStep({ matches: read(stored), shop: "natura", retryShop, repinShop: "natura", ownNavigation: true }),
      ).toEqual({ kind: "repin", match: stored });
    },
  );

  it.each([matched, unmatched])(
    "only shows a stored $state, whose card links to the choice, when ?repin=natura comes from another site",
    (stored) => {
      expect(
        decideMatchStep({
          matches: read(stored),
          shop: "natura",
          retryShop: null,
          repinShop: "natura",
          ownNavigation: false,
        }),
      ).toEqual({ kind: "stored", match: stored });
    },
  );

  it.each<{ why: string; step: MatchStep } & Opened>([
    {
      why: "shows a lookup that found nothing, which has no such choice",
      retryShop: null,
      ownNavigation: true,
      step: { kind: "stored", match: notFound },
    },
    {
      why: "looks a lookup that found nothing up again on the user's retry beside it",
      retryShop: "natura",
      ownNavigation: true,
      step: { kind: "lookup", retry: true },
    },
    {
      why: "only prompts for a retry beside it from another site",
      retryShop: "natura",
      ownNavigation: false,
      step: { kind: "prompt" },
    },
  ])("$why", ({ retryShop, ownNavigation, step }) => {
    expect(
      decideMatchStep({ matches: read(notFound), shop: "natura", retryShop, repinShop: "natura", ownNavigation }),
    ).toEqual(step);
  });

  it("treats ?repin=natura without a decision as the first lookup, which a link from another site only prompts", () => {
    const opened: Omit<MatchStepInput, "ownNavigation"> = {
      matches: read(),
      shop: "natura",
      retryShop: null,
      repinShop: "natura",
    };

    expect(decideMatchStep({ ...opened, ownNavigation: true })).toEqual({ kind: "lookup", retry: false });
    expect(decideMatchStep({ ...opened, ownNavigation: false })).toEqual({ kind: "prompt" });
  });

  it.each([true, false])("looks nothing up when the decisions couldn't be read (own navigation: %s)", (own) => {
    expect(
      decideMatchStep({ matches: null, shop: "natura", retryShop: null, repinShop: "natura", ownNavigation: own }),
    ).toEqual({ kind: "read-failed" });
  });
});

describe("decideMatchStep: a re-pin or a retry names one shop", () => {
  /** Each shop's step for the product's decisions, on the user's own navigation of a page opened as given. */
  const stepsFor = (matches: MatchesRead, opened: Pick<MatchStepInput, "retryShop" | "repinShop">) =>
    (["natura", "hebe"] as const).map((shop) => decideMatchStep({ matches, shop, ...opened, ownNavigation: true }));

  it("re-pins only Hebe on ?repin=hebe, and only shows Natura's stored match", () => {
    expect(stepsFor(read(matched, hebeMatched), { retryShop: null, repinShop: "hebe" })).toEqual([
      { kind: "stored", match: matched },
      { kind: "repin", match: hebeMatched },
    ]);
  });

  it("retries only Natura on ?retry=natura, and only shows Hebe's stored not found", () => {
    expect(stepsFor(read(notFound, hebeNotFound), { retryShop: "natura", repinShop: null })).toEqual([
      { kind: "lookup", retry: true },
      { kind: "stored", match: hebeNotFound },
    ]);
  });

  it.each<{
    view: string;
    matches: MatchesRead;
    opened: Pick<MatchStepInput, "retryShop" | "repinShop">;
    natura: MatchStep;
  }>([
    {
      view: "?repin=natura",
      matches: read(matched),
      opened: { retryShop: null, repinShop: "natura" },
      natura: { kind: "repin", match: matched },
    },
    {
      view: "?retry=natura",
      matches: read(notFound),
      opened: { retryShop: "natura", repinShop: null },
      natura: { kind: "lookup", retry: true },
    },
  ])("asks only Natura on $view: Hebe, with no decision yet, only gets its button", ({ matches, opened, natura }) => {
    expect(stepsFor(matches, opened)).toEqual([natura, { kind: "prompt" }]);
  });

  it("looks a shop with no decision up on a plain view, beside another shop's stored decision", () => {
    expect(stepsFor(read(matched), { retryShop: null, repinShop: null })).toEqual([
      { kind: "stored", match: matched },
      { kind: "lookup", retry: false },
    ]);
  });
});

// Super-Pharm's index holds no EAN, so its lookups search it by name alone, but the step treats it as any shop: with no
// decision there, the user's own navigation looks it up, as it does Natura and Hebe.
describe("decideMatchStep: Super-Pharm, looked up on view like any shop", () => {
  // Super-Pharm's kinds of stored decision: an automatic match by name, whose item carries no EAN, the user's pick, the
  // user's decline and a lookup that found nothing.
  const spAutoMatched: RepinnableMatch = {
    ...decision,
    shop: "super-pharm",
    decidedBy: "auto",
    state: "matched",
    item: {
      shopItemId: "10132",
      brand: "Nivea",
      name: "Nivea Soft Krem nawilżający (Pudełko)",
      sizeText: "300 ml",
      size: { value: 300, unit: "ml" },
      eans: [],
      productUrl: null,
      imageUrl: null,
    },
  };
  const spMatched: RepinnableMatch = { ...matched, shop: "super-pharm", decidedBy: "user" };
  const spUnmatched: RepinnableMatch = {
    ...decision,
    shop: "super-pharm",
    decidedBy: "user",
    state: "unmatched",
    item: null,
  };
  const spNotFound: ShopMatch = { ...notFound, shop: "super-pharm" };

  /** Super-Pharm's step for the product's decisions, on a page opened as given. */
  const spStep = (matches: MatchesRead | null, opened: Omit<MatchStepInput, "matches" | "shop">) =>
    decideMatchStep({ matches, shop: "super-pharm", ...opened });

  /** Each shop's step, Super-Pharm's last, on the user's own navigation of a page opened as given. */
  const stepsFor = (matches: MatchesRead, opened: Pick<MatchStepInput, "retryShop" | "repinShop">) =>
    (["natura", "hebe", "super-pharm"] as const).map((shop) =>
      decideMatchStep({ matches, shop, ...opened, ownNavigation: true }),
    );

  it.each<{ view: string; opened: Pick<MatchStepInput, "retryShop" | "repinShop"> }>([
    { view: "a plain view", opened: { retryShop: null, repinShop: null } },
    // With no decision, there's nothing to re-pin or retry: the page looks the product up, as Natura's does.
    { view: "?repin=super-pharm", opened: { retryShop: null, repinShop: "super-pharm" } },
    { view: "?retry=super-pharm", opened: { retryShop: "super-pharm", repinShop: null } },
  ])(
    "looks it up with no decision on $view on the user's own navigation, and only prompts for a link from another site",
    ({ opened }) => {
      expect(spStep(read(), { ...opened, ownNavigation: true })).toEqual({ kind: "lookup", retry: false });
      expect(spStep(read(), { ...opened, ownNavigation: false })).toEqual({ kind: "prompt" });
    },
  );

  it("looks every shop with no decision up on a plain view, Super-Pharm with the others", () => {
    expect(stepsFor(read(), { retryShop: null, repinShop: null })).toEqual([
      { kind: "lookup", retry: false },
      { kind: "lookup", retry: false },
      { kind: "lookup", retry: false },
    ]);
  });

  it("looks Super-Pharm alone up on a plain view beside the other shops' stored decisions", () => {
    expect(stepsFor(read(matched, hebeNotFound), { retryShop: null, repinShop: null })).toEqual([
      { kind: "stored", match: matched },
      { kind: "stored", match: hebeNotFound },
      { kind: "lookup", retry: false },
    ]);
  });

  it("asks only Super-Pharm when a retry names it: the other shops with no decision only get their buttons", () => {
    expect(stepsFor(read(), { retryShop: "super-pharm", repinShop: null })).toEqual([
      { kind: "prompt" },
      { kind: "prompt" },
      { kind: "lookup", retry: false },
    ]);
    expect(stepsFor(read(matched, hebeNotFound), { retryShop: "super-pharm", repinShop: null })).toEqual([
      { kind: "stored", match: matched },
      { kind: "stored", match: hebeNotFound },
      { kind: "lookup", retry: false },
    ]);
  });

  it.each<{ view: string; matches: MatchesRead; opened: Pick<MatchStepInput, "retryShop" | "repinShop"> }>([
    { view: "?repin=natura", matches: read(matched), opened: { retryShop: null, repinShop: "natura" } },
    { view: "?retry=natura", matches: read(notFound), opened: { retryShop: "natura", repinShop: null } },
    // A page that names another shop as well asks only that one, as for any shop with no decision.
    {
      view: "?repin=natura&retry=super-pharm",
      matches: read(matched),
      opened: { retryShop: "super-pharm", repinShop: "natura" },
    },
  ])("only prompts for Super-Pharm with no decision on $view", ({ matches, opened }) => {
    expect(stepsFor(matches, opened)[2]).toEqual({ kind: "prompt" });
  });

  it.each<{ stored: ShopMatch; opened: Pick<MatchStepInput, "retryShop" | "repinShop">; step: MatchStep }>([
    // Reopening a product whose match the name check accepted asks Super-Pharm nothing.
    {
      stored: spAutoMatched,
      opened: { retryShop: null, repinShop: null },
      step: { kind: "stored", match: spAutoMatched },
    },
    {
      stored: spAutoMatched,
      opened: { retryShop: null, repinShop: "super-pharm" },
      step: { kind: "repin", match: spAutoMatched },
    },
    { stored: spMatched, opened: { retryShop: null, repinShop: null }, step: { kind: "stored", match: spMatched } },
    {
      stored: spMatched,
      opened: { retryShop: "super-pharm", repinShop: null },
      step: { kind: "stored", match: spMatched },
    },
    {
      stored: spMatched,
      opened: { retryShop: null, repinShop: "super-pharm" },
      step: { kind: "repin", match: spMatched },
    },
    {
      stored: spUnmatched,
      opened: { retryShop: null, repinShop: "super-pharm" },
      step: { kind: "repin", match: spUnmatched },
    },
    { stored: spNotFound, opened: { retryShop: null, repinShop: null }, step: { kind: "stored", match: spNotFound } },
    {
      stored: spNotFound,
      opened: { retryShop: "super-pharm", repinShop: null },
      step: { kind: "lookup", retry: true },
    },
  ])(
    "treats a stored $stored.state by $stored.decidedBy as any shop does (retry: $opened.retryShop, re-pin: $opened.repinShop)",
    ({ stored, opened, step }) => {
      expect(spStep(read(stored), { ...opened, ownNavigation: true })).toEqual(step);
    },
  );

  it.each<MatchableShop | null>([null, "super-pharm"])(
    "looks nothing up when its decision couldn't be read (retry: %s)",
    (retryShop) => {
      const opened = { retryShop, repinShop: null, ownNavigation: true };

      expect(spStep(null, opened)).toEqual({ kind: "read-failed" });
      expect(spStep({ matches: [], unreadable: ["super-pharm"] }, opened)).toEqual({ kind: "read-failed" });
    },
  );
});

describe("repinShopOf and retryShopOf: the shop a page was opened for", () => {
  it.each<{ query: string; repin: MatchableShop | null; retry: MatchableShop | null }>([
    { query: "repin=natura", repin: "natura", retry: null },
    { query: "retry=natura", repin: null, retry: "natura" },
    { query: "f=check&repin=natura&retry=natura", repin: "natura", retry: "natura" },
    { query: "repin=hebe", repin: "hebe", retry: null },
    { query: "retry=hebe", repin: null, retry: "hebe" },
    { query: "repin=hebe&retry=natura", repin: "hebe", retry: "natura" },
    // Super-Pharm is a matched shop: "Szukaj ponownie" opens ?retry=super-pharm, and "Zmień" ?repin=super-pharm.
    { query: "repin=super-pharm", repin: "super-pharm", retry: null },
    { query: "f=check&retry=super-pharm", repin: null, retry: "super-pharm" },
    // Rossmann is a matched shop of every product picked in another shop.
    { query: "repin=rossmann&retry=rossmann", repin: "rossmann", retry: "rossmann" },
  ])("reads ?$query", ({ query, repin, retry }) => {
    const params = new URLSearchParams(query);

    expect(repinShopOf(params)).toBe(repin);
    expect(retryShopOf(params)).toBe(retry);
  });

  it.each(["", "repin=1&retry=1", "repin=&retry=", "repin=dm&retry=dm", "repin=NATURA&retry=Hebe"])(
    "ignores ?%s, which names no priced shop, the old ?repin=1 and ?retry=1 included",
    (query) => {
      const params = new URLSearchParams(query);

      expect(repinShopOf(params)).toBeNull();
      expect(retryShopOf(params)).toBeNull();
    },
  );

  it.each<{ source: MatchableShop; query: string; repin: MatchableShop | null; retry: MatchableShop | null }>([
    // A product's own shop opens the plain page, like a shop outside the list.
    { source: "rossmann", query: "repin=rossmann&retry=rossmann", repin: null, retry: null },
    { source: "natura", query: "repin=natura&retry=natura", repin: null, retry: null },
    { source: "super-pharm", query: "repin=super-pharm&retry=hebe", repin: null, retry: "hebe" },
    // Its matched shops are read, Rossmann among them for a product picked elsewhere.
    { source: "natura", query: "repin=rossmann&retry=super-pharm", repin: "rossmann", retry: "super-pharm" },
    { source: "rossmann", query: "repin=natura", repin: "natura", retry: null },
  ])(
    "reads ?$query on the page of a product picked in $source, given its matched shops",
    ({ source, query, repin, retry }) => {
      const params = new URLSearchParams(query);
      const shops = matchedShopsOf(source);

      expect(repinShopOf(params, shops)).toBe(repin);
      expect(retryShopOf(params, shops)).toBe(retry);
    },
  );
});

describe("autoRefreshOf: whether opening the page refetches its prices on its own", () => {
  /** The page's step for the stored match, opened with `?repin=natura` or without, by the user's own navigation or not. */
  const stepFor = (repinning: boolean, ownNavigation: boolean) =>
    decideMatchStep({
      matches: read(matched),
      shop: "natura",
      retryShop: null,
      repinShop: repinning ? "natura" : null,
      ownNavigation,
    });

  it("refetches on the user's own navigation beside a stored decision", () => {
    expect(autoRefreshOf([stepFor(false, true)], true)).toBe(true);
  });

  it("refetches nothing while a re-pin's choice is open, which has already cost Natura its two searches", () => {
    expect(stepFor(true, true).kind).toBe("repin");
    expect(autoRefreshOf([stepFor(true, true)], true)).toBe(false);
  });

  it.each([false, true])(
    "refetches nothing on a navigation that isn't the user's own (?repin=natura: %s)",
    (repinning) => {
      expect(autoRefreshOf([stepFor(repinning, false)], false)).toBe(false);
    },
  );

  it.each([true, false])("follows the navigation alone without a step (own navigation: %s)", (own) => {
    expect(autoRefreshOf([], own)).toBe(own);
  });

  it("refetches nothing while any shop's re-pin choice is open, and does beside every other step", () => {
    const repin: MatchStep = { kind: "repin", match: hebeMatched };
    const others: MatchStep[] = [{ kind: "stored", match: matched }, { kind: "prompt" }, { kind: "read-failed" }];

    expect(autoRefreshOf([...others, repin], true)).toBe(false);
    expect(autoRefreshOf(others, true)).toBe(true);
  });
});
