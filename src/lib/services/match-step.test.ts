import { describe, expect, it } from "vitest";
import { decideMatchStep, type MatchStep } from "@/lib/services/match-step";
import type { ShopMatch } from "@/types";

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

/** How the page was opened: with `?retry=1` or without, and by the user's own navigation or from elsewhere. */
interface Opened {
  retrying: boolean;
  ownNavigation: boolean;
}

describe("decideMatchStep: a settled decision costs no request", () => {
  it.each<{ stored: ShopMatch } & Opened>([
    { stored: matched, retrying: false, ownNavigation: true },
    { stored: matched, retrying: true, ownNavigation: true },
    { stored: matched, retrying: true, ownNavigation: false },
    { stored: unmatched, retrying: false, ownNavigation: true },
    { stored: unmatched, retrying: true, ownNavigation: true },
    { stored: unmatched, retrying: true, ownNavigation: false },
  ])(
    "only shows a stored $stored.state (retry: $retrying, own navigation: $ownNavigation)",
    ({ stored, ...opened }) => {
      expect(decideMatchStep({ matches: [stored], shop: "natura", ...opened })).toEqual({
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
      retrying: false,
      ownNavigation: true,
      step: { kind: "stored", match: notFound },
    },
    {
      why: "shows it when opened from another site without a retry",
      retrying: false,
      ownNavigation: false,
      step: { kind: "stored", match: notFound },
    },
    {
      why: "looks it up again on the user's retry",
      retrying: true,
      ownNavigation: true,
      step: { kind: "lookup", retry: true },
    },
    {
      why: "only prompts when a retry comes from another site",
      retrying: true,
      ownNavigation: false,
      step: { kind: "prompt" },
    },
  ])("$why", ({ retrying, ownNavigation, step }) => {
    expect(decideMatchStep({ matches: [notFound], shop: "natura", retrying, ownNavigation })).toEqual(step);
  });
});

describe("decideMatchStep: no decision yet", () => {
  it.each<{ why: string; step: MatchStep } & Opened>([
    {
      why: "looks it up on the user's own navigation",
      retrying: false,
      ownNavigation: true,
      step: { kind: "lookup", retry: false },
    },
    {
      why: "treats a retry link as the first lookup",
      retrying: true,
      ownNavigation: true,
      step: { kind: "lookup", retry: false },
    },
    {
      why: "only prompts when opened from another site",
      retrying: false,
      ownNavigation: false,
      step: { kind: "prompt" },
    },
  ])("$why", ({ retrying, ownNavigation, step }) => {
    expect(decideMatchStep({ matches: [], shop: "natura", retrying, ownNavigation })).toEqual(step);
  });

  it("ignores another shop's decision", () => {
    const hebeMatched: ShopMatch = { ...matched, shop: "hebe" };
    const hebeNotFound: ShopMatch = { ...notFound, shop: "hebe" };
    const naturaStep = (matches: ShopMatch[]) =>
      decideMatchStep({ matches, shop: "natura", retrying: true, ownNavigation: true });

    expect(naturaStep([hebeMatched])).toEqual({ kind: "lookup", retry: false });
    expect(naturaStep([hebeNotFound])).toEqual({ kind: "lookup", retry: false });
    expect(naturaStep([hebeMatched, unmatched])).toEqual({ kind: "stored", match: unmatched });
  });
});

describe("decideMatchStep: decisions that couldn't be read", () => {
  it.each<Opened>([
    { retrying: false, ownNavigation: true },
    { retrying: true, ownNavigation: true },
    { retrying: false, ownNavigation: false },
  ])("looks nothing up (retry: $retrying, own navigation: $ownNavigation)", (opened) => {
    expect(decideMatchStep({ matches: null, shop: "natura", ...opened })).toEqual({ kind: "read-failed" });
  });
});
