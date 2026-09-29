import { describe, expect, it } from "vitest";
import {
  chooseView,
  matchedView,
  notFoundView,
  optionView,
  promptView,
  sizeLabel,
  storedView,
  type CandidateFlag,
  type NaturaProduct,
} from "@/lib/services/natura-view";
import { parseSize } from "@/lib/services/size";
import type { CandidateOption, CandidateVerdict, MatchedItem, ShopCandidate, ShopMatch, Size } from "@/types";

const ITEM_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
// Rossmann's Nivea Soft 300 ml, as the page hands it to the builders.
const product: NaturaProduct = { id: ITEM_ID, sizeText: "300 ml", size: parseSize("300 ml") };
// 12:00 UTC is 14:00 in Poland (summer time).
const FETCHED_AT = new Date("2026-09-28T12:00:00.000Z");
// Intl writes Polish prices with a no-break space before "zł".
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** A Natura item with the given size text, its size parsed from the text as the adapter does. */
function item(sizeText: string | null): MatchedItem {
  return {
    shopItemId: "NV89063",
    brand: "NIVEA",
    name: "NIVEA SOFT krem intensywnie nawilżający",
    sizeText,
    size: parseSize(sizeText),
    eans: ["4005900009319"],
    productUrl: "https://www.drogerienatura.pl/nivea-soft",
    imageUrl: null,
  };
}

/** A candidate with the given size text and price, or none when the shop sent no price that can be stored. */
function candidate(sizeText: string | null, price: number | null = 16.99): ShopCandidate {
  return {
    ...item(sizeText),
    shop: "natura",
    offer:
      price === null ? null : { price, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available: true },
  };
}

const option = (verdict: CandidateVerdict, sizeText: string | null = "300 ml"): CandidateOption => ({
  candidate: candidate(sizeText),
  verdict,
});

// The product's decision in Natura, stored at 21:45 in Poland on 27 September.
const decision = { watchlistItemId: ITEM_ID, shop: "natura", checkedAt: "2026-09-27T19:45:12+00:00" } as const;

describe("storedView", () => {
  it.each<{ decidedBy: "auto" | "user"; note: string }>([
    { decidedBy: "auto", note: "Dopasowano automatycznie: ten sam EAN i rozmiar." },
    { decidedBy: "user", note: "Potwierdzone przez Ciebie." },
  ])(
    "shows a match decided by $decidedBy with how it was decided, and nothing about its item",
    ({ decidedBy, note }) => {
      const match: ShopMatch = { ...decision, decidedBy, state: "matched", item: item("300 ml") };

      // The match's price and its page are in its price row, so the section carries no summary and no link.
      expect(storedView(match, product)).toEqual({ kind: "matched", note, sizeWarning: null });
    },
  );

  it("shows a shop the user declined as their choice", () => {
    const match: ShopMatch = { ...decision, decidedBy: "user", state: "unmatched", item: null };

    expect(storedView(match, product)).toEqual({ kind: "unmatched" });
  });

  it("shows a lookup that found nothing with when it ran, on the Polish clock, and a link to retry it", () => {
    const match: ShopMatch = { ...decision, decidedBy: "auto", state: "not_found", item: null };

    expect(storedView(match, product)).toEqual({
      kind: "not-found",
      text: "Nie znaleziono w Naturze (sprawdzono 27.09, 21:45).",
      href: `/watchlist/${ITEM_ID}?retry=1`,
    });
  });
});

describe("notFoundView", () => {
  it("shows the time it's given, on the Polish clock", () => {
    expect(notFoundView(FETCHED_AT, product)).toEqual({
      kind: "not-found",
      text: "Nie znaleziono w Naturze (sprawdzono 28.09, 14:00).",
      href: `/watchlist/${ITEM_ID}?retry=1`,
    });
  });
});

describe("matchedView: the size warning", () => {
  it("names both sizes when they differ", () => {
    expect(matchedView(item("200 ml"), "user", product)).toEqual({
      kind: "matched",
      note: "Potwierdzone przez Ciebie.",
      sizeWarning: "Inny rozmiar: 200 ml zamiast 300 ml",
    });
  });

  it.each<{ why: string; own: NaturaProduct; itemSize: string | null }>([
    { why: "the same size is written another way", own: product, itemSize: "0,3 l" },
    { why: "the item's size is unknown", own: product, itemSize: null },
    { why: "the item's size text doesn't parse", own: product, itemSize: "4x57 szt." },
    { why: "the product's size is unknown", own: { ...product, sizeText: null, size: null }, itemSize: "200 ml" },
  ])("warns of nothing when $why", ({ own, itemSize }) => {
    expect(matchedView(item(itemSize), "auto", own)).toMatchObject({ kind: "matched", sizeWarning: null });
  });
});

describe("optionView: the flags", () => {
  it.each<{ why: string; verdict: CandidateVerdict; sizeText: string | null; flags: CandidateFlag[] }>([
    {
      why: "the same EAN in the same size",
      verdict: { sharesEan: true, size: "equal" },
      sizeText: "300 ml",
      flags: [{ text: "Ten sam EAN", warning: false }],
    },
    {
      why: "the same EAN in another size",
      verdict: { sharesEan: true, size: "differs" },
      sizeText: "200 ml",
      flags: [
        { text: "Ten sam EAN", warning: false },
        { text: "Inny rozmiar: 200 ml zamiast 300 ml", warning: true },
      ],
    },
    {
      why: "another EAN and a size that can't be compared",
      verdict: { sharesEan: false, size: "unknown" },
      sizeText: "4x57 szt.",
      flags: [{ text: "Rozmiar nieznany", warning: true }],
    },
    {
      why: "another EAN in the same size",
      verdict: { sharesEan: false, size: "equal" },
      sizeText: "300 ml",
      flags: [],
    },
  ])("flags a candidate with $why", ({ verdict, sizeText, flags }) => {
    expect(optionView(option(verdict, sizeText), FETCHED_AT, product).flags).toEqual(flags);
  });
});

describe("optionView: the price", () => {
  const verdict: CandidateVerdict = { sharesEan: true, size: "equal" };

  it("shows the candidate's price as Natura's online price, with when it was fetched", () => {
    const view = optionView(option(verdict), FETCHED_AT, product);

    expect(view.price).toBe(`16,99${NO_BREAK_SPACE}zł · cena online w drogerienatura.pl, pobrano 14:00`);
    expect(view.candidate).toEqual(candidate("300 ml"));
  });

  it("says there's no online price when the shop sent none, never a blank or a zero", () => {
    const view = optionView({ candidate: candidate("300 ml", null), verdict }, FETCHED_AT, product);

    expect(view.price).toBe("Brak ceny online w drogerienatura.pl, pobrano 14:00");
  });
});

describe("chooseView", () => {
  const options = [option({ sharesEan: true, size: "equal" }), option({ sharesEan: false, size: "differs" }, "200 ml")];

  it.each<{ via: "ean" | "name"; intro: string }>([
    { via: "ean", intro: "Znalezione w Naturze po kodzie EAN. Wybierz ten sam produkt albo „Żaden z nich”." },
    { via: "name", intro: "Znalezione w Naturze po nazwie. Wybierz ten sam produkt albo „Żaden z nich”." },
  ])("says the candidates were found by $via, and keeps the lookup's order", ({ via, intro }) => {
    expect(chooseView(options, via, FETCHED_AT, product)).toEqual({
      kind: "choose",
      intro,
      options: options.map((each) => optionView(each, FETCHED_AT, product)),
    });
  });
});

describe("promptView", () => {
  it("links to the product's page, keeping a retry", () => {
    expect(promptView(product, false)).toEqual({ kind: "prompt", href: `/watchlist/${ITEM_ID}` });
    expect(promptView(product, true)).toEqual({ kind: "prompt", href: `/watchlist/${ITEM_ID}?retry=1` });
  });
});

describe("sizeLabel", () => {
  it.each<{ why: string; sizeText: string | null; size: Size | null; label: string }>([
    { why: "the shop's own text", sizeText: "0,3 l", size: { value: 300, unit: "ml" }, label: "0,3 l" },
    { why: "a parsed size in grams", sizeText: null, size: { value: 4.8, unit: "g" }, label: "4,8 g" },
    { why: "a parsed size in pieces", sizeText: null, size: { value: 10, unit: "pcs" }, label: "10 szt." },
    { why: "no size at all", sizeText: null, size: null, label: "rozmiar nieznany" },
  ])("writes $why as $label", ({ sizeText, size, label }) => {
    expect(sizeLabel(sizeText, size)).toBe(label);
  });
});
