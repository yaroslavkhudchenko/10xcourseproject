import { describe, expect, it } from "vitest";
import {
  chooseView,
  decidedView,
  decisionError,
  decisionNotice,
  matchedView,
  notFoundView,
  optionView,
  promptView,
  repinView,
  sizeLabel,
  storedView,
  type CandidateFlag,
  type MatchItemSummary,
  type MatchProduct,
  type MatchView,
} from "@/lib/services/match-view";
import { parseSize } from "@/lib/services/size";
import type {
  CandidateOption,
  CandidateVerdict,
  MatchedItem,
  RepinnableMatch,
  ShopCandidate,
  ShopChoices,
  ShopMatch,
  ShopUnavailable,
  Size,
} from "@/types";

const ITEM_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
// The product's page, which every link of the views leads to, and the action that opens the choice that changes a
// stored decision in Natura, as the views give them for a product opened from the whole list.
const PAGE = `/watchlist/${ITEM_ID}`;
const REPIN = { kind: "repin", href: `${PAGE}?repin=natura` } as const;
// How the page was opened: from the whole list, or from its "Do sprawdzenia" chip.
const ALL = { filter: "all" } as const;
const CHECK = { filter: "check" } as const;
// Rossmann's Nivea Soft 300 ml, as the page hands it to the builders.
const product: MatchProduct = { id: ITEM_ID, brand: "NIVEA", sizeText: "300 ml", size: parseSize("300 ml") };
// 12:00 UTC is 14:00 in Poland (summer time).
const FETCHED_AT = new Date("2026-09-28T12:00:00.000Z");
// Intl writes Polish prices with a no-break space before "zł".
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * A Natura item with the given size text, its size parsed from the text as the adapter does, of NIVEA unless another
 * brand is given.
 */
function item(sizeText: string | null, brand: string | null = "NIVEA"): MatchedItem {
  return {
    shopItemId: "NV89063",
    brand,
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

/** The summary a matched view carries of the item with the given size text and brand: what its card shows of it. */
const summary = (sizeText: string | null, brand: string | null = "NIVEA"): MatchItemSummary => ({
  brand,
  name: "NIVEA SOFT krem intensywnie nawilżający",
  sizeText,
  imageUrl: null,
  productUrl: "https://www.drogerienatura.pl/nivea-soft",
});

// The product's decision in Natura, stored at 21:45 in Poland on 27 September.
const decision = { watchlistItemId: ITEM_ID, shop: "natura", checkedAt: "2026-09-27T19:45:12+00:00" } as const;

describe("storedView", () => {
  it.each<{ decidedBy: "auto" | "user"; note: string }>([
    { decidedBy: "auto", note: "Dopasowano automatycznie: ten sam EAN i rozmiar." },
    { decidedBy: "user", note: "Potwierdzone przez Ciebie." },
  ])("shows a match decided by $decidedBy with how it was decided, and names its item", ({ decidedBy, note }) => {
    const match: ShopMatch = { ...decision, decidedBy, state: "matched", item: item("300 ml") };

    // The match's price and its page are in its price row, so its card names the item without its photo or page.
    expect(storedView("natura", match, product, ALL)).toEqual({
      kind: "matched",
      note,
      warnings: [],
      item: summary("300 ml"),
      unsaved: false,
      action: REPIN,
    });
  });

  it("shows a stored match's warnings, its size's and then its brand's", () => {
    const match: ShopMatch = { ...decision, decidedBy: "user", state: "matched", item: item("200 ml", "YOPE") };

    expect(storedView("natura", match, product, ALL)).toMatchObject({
      kind: "matched",
      warnings: ["Inny rozmiar: 200 ml zamiast 300 ml", "Inna marka: YOPE zamiast NIVEA"],
      item: summary("200 ml", "YOPE"),
    });
  });

  it("shows a shop the user declined as their choice, with the action that opens the choice again", () => {
    const match: ShopMatch = { ...decision, decidedBy: "user", state: "unmatched", item: null };

    expect(storedView("natura", match, product, ALL)).toEqual({ kind: "unmatched", action: REPIN });
  });

  it("shows a lookup that found nothing with when it ran, on the Polish clock, and a link to retry it", () => {
    const match: ShopMatch = { ...decision, decidedBy: "auto", state: "not_found", item: null };

    expect(storedView("natura", match, product, ALL)).toEqual({
      kind: "not-found",
      text: "Nie znaleziono w Naturze (sprawdzono 27.09, 21:45).",
      href: `${PAGE}?retry=natura`,
    });
  });

  it.each<{ state: string; match: ShopMatch }>([
    { state: "matched", match: { ...decision, decidedBy: "auto", state: "matched", item: item("300 ml") } },
    { state: "unmatched", match: { ...decision, decidedBy: "user", state: "unmatched", item: null } },
  ])("closes a stored $state's open choice with its action, the plain page", ({ match }) => {
    expect(storedView("natura", match, product, { ...ALL, repinning: true })).toMatchObject({
      action: { kind: "cancel", href: PAGE },
    });
  });

  it("keeps a retry's link for a lookup that found nothing, which has no choice to open", () => {
    const match: ShopMatch = { ...decision, decidedBy: "auto", state: "not_found", item: null };

    expect(storedView("natura", match, product, { ...ALL, repinning: true })).toMatchObject({
      kind: "not-found",
      href: `${PAGE}?retry=natura`,
    });
  });
});

describe("notFoundView", () => {
  it("shows the time it's given, on the Polish clock", () => {
    expect(notFoundView("natura", FETCHED_AT, product, "all")).toEqual({
      kind: "not-found",
      text: "Nie znaleziono w Naturze (sprawdzono 28.09, 14:00).",
      href: `${PAGE}?retry=natura`,
    });
  });
});

describe("matchedView: the warnings", () => {
  it("names both sizes when they differ", () => {
    expect(matchedView("natura", item("200 ml"), "user", product, ALL)).toMatchObject({
      kind: "matched",
      note: "Potwierdzone przez Ciebie.",
      warnings: ["Inny rozmiar: 200 ml zamiast 300 ml"],
    });
  });

  it("names both brands when they differ", () => {
    expect(matchedView("natura", item("300 ml", "YOPE"), "auto", product, ALL)).toMatchObject({
      kind: "matched",
      warnings: ["Inna marka: YOPE zamiast NIVEA"],
    });
  });

  it("gives the size's warning, then the brand's, when both differ", () => {
    expect(matchedView("natura", item("200 ml", "YOPE"), "user", product, ALL)).toMatchObject({
      warnings: ["Inny rozmiar: 200 ml zamiast 300 ml", "Inna marka: YOPE zamiast NIVEA"],
    });
  });

  it.each<{ why: string; own: MatchProduct; itemSize: string | null; itemBrand?: string | null }>([
    { why: "the same size is written another way", own: product, itemSize: "0,3 l" },
    { why: "the item's size is unknown", own: product, itemSize: null },
    { why: "the item's size text doesn't parse", own: product, itemSize: "4x57 szt." },
    { why: "the product's size is unknown", own: { ...product, sizeText: null, size: null }, itemSize: "200 ml" },
    { why: "the item is of a sub-brand", own: product, itemSize: "300 ml", itemBrand: "NIVEA MEN" },
    { why: "the item's brand is unknown", own: product, itemSize: "300 ml", itemBrand: null },
    { why: "the product's brand is unknown", own: { ...product, brand: null }, itemSize: "300 ml", itemBrand: "YOPE" },
  ])("warns of nothing when $why", ({ own, itemSize, itemBrand = "NIVEA" }) => {
    expect(matchedView("natura", item(itemSize, itemBrand), "auto", own, ALL)).toMatchObject({
      kind: "matched",
      warnings: [],
    });
  });
});

describe("matchedView: the item", () => {
  it("carries a saved match's item and its warnings, for its card to name, and nothing else of the candidate", () => {
    // The candidate, as the page hands over one it has just saved, with its offer and its EANs.
    expect(matchedView("natura", { ...candidate("200 ml"), brand: "YOPE" }, "user", product, ALL)).toEqual({
      kind: "matched",
      note: "Potwierdzone przez Ciebie.",
      warnings: ["Inny rozmiar: 200 ml zamiast 300 ml", "Inna marka: YOPE zamiast NIVEA"],
      item: summary("200 ml", "YOPE"),
      unsaved: false,
      action: REPIN,
    });
    expect(matchedView("natura", candidate("300 ml"), "auto", product, { ...ALL, unsaved: false })).toMatchObject({
      item: summary("300 ml"),
      unsaved: false,
    });
  });

  it("marks a match the page couldn't save as unsaved, so its card shows the item's photo and page, and no action", () => {
    expect(matchedView("natura", candidate("300 ml"), "auto", product, { ...ALL, unsaved: true })).toEqual({
      kind: "matched",
      note: "Dopasowano automatycznie: ten sam EAN i rozmiar.",
      warnings: [],
      item: summary("300 ml"),
      unsaved: true,
      action: null,
    });
  });
});

describe("the views' links keep the list's filter", () => {
  const matchedDecision: ShopMatch = { ...decision, decidedBy: "auto", state: "matched", item: item("300 ml") };
  const declinedDecision: RepinnableMatch = { ...decision, decidedBy: "user", state: "unmatched", item: null };
  const notFoundDecision: ShopMatch = { ...decision, decidedBy: "auto", state: "not_found", item: null };

  it.each<{ view: string; built: MatchView; href: string }>([
    {
      view: "Zmień on a match just saved",
      built: matchedView("natura", candidate("300 ml"), "auto", product, CHECK),
      href: `${PAGE}?f=check&repin=natura`,
    },
    {
      view: "Zmień on a stored match",
      built: storedView("natura", matchedDecision, product, CHECK),
      href: `${PAGE}?f=check&repin=natura`,
    },
    {
      view: "Anuluj on a stored match",
      built: storedView("natura", matchedDecision, product, { ...CHECK, repinning: true }),
      href: `${PAGE}?f=check`,
    },
    {
      view: "Dopasuj ponownie on a decline",
      built: storedView("natura", declinedDecision, product, CHECK),
      href: `${PAGE}?f=check&repin=natura`,
    },
    {
      view: "Anuluj on a decline",
      built: storedView("natura", declinedDecision, product, { ...CHECK, repinning: true }),
      href: `${PAGE}?f=check`,
    },
  ])("keeps it in $view", ({ built, href }) => {
    expect(built).toMatchObject({ action: { href } });
  });

  it.each<{ view: string; built: MatchView; href: string }>([
    {
      view: "the retry of a stored lookup",
      built: storedView("natura", notFoundDecision, product, CHECK),
      href: `${PAGE}?f=check&retry=natura`,
    },
    {
      view: "the retry of a fresh lookup",
      built: notFoundView("natura", FETCHED_AT, product, "check"),
      href: `${PAGE}?f=check&retry=natura`,
    },
    { view: "the lookup's button", built: promptView("natura", product, false, "check"), href: `${PAGE}?f=check` },
    {
      view: "a retry's lookup button",
      built: promptView("natura", product, true, "check"),
      href: `${PAGE}?f=check&retry=natura`,
    },
    { view: "the link to a decision stored meanwhile", built: decidedView(product, "check"), href: `${PAGE}?f=check` },
  ])("keeps it in $view", ({ built, href }) => {
    expect(built).toMatchObject({ href });
  });

  it("keeps it in the choice's Anuluj", () => {
    expect(repinView("natura", { kind: "not-found" }, declinedDecision, FETCHED_AT, product, "check").cancelHref).toBe(
      `${PAGE}?f=check`,
    );
  });
});

describe("optionView: the flags", () => {
  it.each<{ why: string; verdict: CandidateVerdict; sizeText: string | null; flags: CandidateFlag[] }>([
    {
      why: "the same EAN in the same size",
      verdict: { sharesEan: true, size: "equal", brand: "agrees" },
      sizeText: "300 ml",
      flags: [{ text: "Ten sam EAN", warning: false }],
    },
    {
      why: "the same EAN in another size",
      verdict: { sharesEan: true, size: "differs", brand: "agrees" },
      sizeText: "200 ml",
      flags: [
        { text: "Ten sam EAN", warning: false },
        { text: "Inny rozmiar: 200 ml zamiast 300 ml", warning: true },
      ],
    },
    {
      why: "another EAN and a size that can't be compared",
      verdict: { sharesEan: false, size: "unknown", brand: "agrees" },
      sizeText: "4x57 szt.",
      flags: [{ text: "Rozmiar nieznany", warning: true }],
    },
    {
      why: "another EAN in the same size",
      verdict: { sharesEan: false, size: "equal", brand: "agrees" },
      sizeText: "300 ml",
      flags: [],
    },
    {
      why: "the same EAN in the same size, and a brand that can't be compared",
      verdict: { sharesEan: true, size: "equal", brand: "unknown" },
      sizeText: "300 ml",
      flags: [{ text: "Ten sam EAN", warning: false }],
    },
  ])("flags a candidate with $why", ({ verdict, sizeText, flags }) => {
    expect(optionView("natura", option(verdict, sizeText), FETCHED_AT, product).flags).toEqual(flags);
  });

  it("flags a candidate of another brand after its size, naming both brands", () => {
    const verdict: CandidateVerdict = { sharesEan: true, size: "differs", brand: "differs" };
    const otherBrand: CandidateOption = { candidate: { ...candidate("200 ml"), brand: "YOPE" }, verdict };

    expect(optionView("natura", otherBrand, FETCHED_AT, product).flags).toEqual([
      { text: "Ten sam EAN", warning: false },
      { text: "Inny rozmiar: 200 ml zamiast 300 ml", warning: true },
      { text: "Inna marka: YOPE zamiast NIVEA", warning: true },
    ]);
  });
});

describe("optionView: the price", () => {
  const verdict: CandidateVerdict = { sharesEan: true, size: "equal", brand: "agrees" };

  it("shows the candidate's price as Natura's online price, with when it was fetched", () => {
    const view = optionView("natura", option(verdict), FETCHED_AT, product);

    expect(view.price).toBe(`16,99${NO_BREAK_SPACE}zł · cena online w drogerienatura.pl, pobrano 14:00`);
    expect(view.candidate).toEqual(candidate("300 ml"));
  });

  it("says there's no online price when the shop sent none, never a blank or a zero", () => {
    const view = optionView("natura", { candidate: candidate("300 ml", null), verdict }, FETCHED_AT, product);

    expect(view.price).toBe("Brak ceny online w drogerienatura.pl, pobrano 14:00");
  });
});

describe("chooseView", () => {
  const options = [
    option({ sharesEan: true, size: "equal", brand: "agrees" }),
    option({ sharesEan: false, size: "differs", brand: "agrees" }, "200 ml"),
  ];

  it.each<{ via: "ean" | "name"; intro: string }>([
    { via: "ean", intro: "Znalezione w Naturze po kodzie EAN. Wybierz ten sam produkt albo „Żaden z nich”." },
    { via: "name", intro: "Znalezione w Naturze po nazwie. Wybierz ten sam produkt albo „Żaden z nich”." },
  ])("says the candidates were found by $via, and keeps the lookup's order", ({ via, intro }) => {
    expect(chooseView("natura", options, via, FETCHED_AT, product)).toEqual({
      kind: "choose",
      intro,
      options: options.map((each) => optionView("natura", each, FETCHED_AT, product)),
    });
  });
});

describe("repinView", () => {
  // The stored match, NV89063, and the decline; the choice's searches found the match's item and one in another size.
  const matchedDecision: RepinnableMatch = { ...decision, decidedBy: "auto", state: "matched", item: item("300 ml") };
  const declinedDecision: RepinnableMatch = { ...decision, decidedBy: "user", state: "unmatched", item: null };
  const matchedItem = option({ sharesEan: true, size: "equal", brand: "agrees" });
  const otherSize: CandidateOption = {
    candidate: { ...candidate("200 ml"), shopItemId: "NV89064" },
    verdict: { sharesEan: true, size: "differs", brand: "agrees" },
  };
  const found = (via: "ean" | "name" | "both", incomplete: ShopUnavailable | null = null): ShopChoices => ({
    kind: "choices",
    options: [matchedItem, otherSize],
    via,
    incomplete,
  });

  it("offers an automatic match's choice with its item marked and offered, Żaden z nich, and the match it replaces", () => {
    // Confirming the item the rule matched on its own makes the match the user's.
    expect(repinView("natura", found("both"), matchedDecision, FETCHED_AT, product, "all")).toEqual({
      kind: "repin",
      intro: "Znalezione w Naturze po kodzie EAN i po nazwie. Wybierz ten sam produkt albo „Żaden z nich”.",
      options: [
        { ...optionView("natura", matchedItem, FETCHED_AT, product), current: true, confirm: true },
        { ...optionView("natura", otherSize, FETCHED_AT, product), current: false, confirm: true },
      ],
      message: null,
      decline: true,
      replaces: "matched:NV89063",
      cancelHref: PAGE,
    });
  });

  it("marks the item of a match the user confirmed without offering it again, and offers every other candidate", () => {
    const confirmed: RepinnableMatch = { ...decision, decidedBy: "user", state: "matched", item: item("300 ml") };

    expect(repinView("natura", found("both"), confirmed, FETCHED_AT, product, "all").options).toEqual([
      { ...optionView("natura", matchedItem, FETCHED_AT, product), current: true, confirm: false },
      { ...optionView("natura", otherSize, FETCHED_AT, product), current: false, confirm: true },
    ]);
  });

  it("offers a decline's choice with nothing marked, every candidate offered, and no Żaden z nich, only Anuluj", () => {
    expect(repinView("natura", found("both"), declinedDecision, FETCHED_AT, product, "all")).toEqual({
      kind: "repin",
      intro: "Znalezione w Naturze po kodzie EAN i po nazwie. Wybierz ten sam produkt albo „Anuluj”.",
      options: [
        { ...optionView("natura", matchedItem, FETCHED_AT, product), current: false, confirm: true },
        { ...optionView("natura", otherSize, FETCHED_AT, product), current: false, confirm: true },
      ],
      message: null,
      decline: false,
      replaces: "unmatched",
      cancelHref: PAGE,
    });
  });

  it.each<{ via: "ean" | "name"; intro: string }>([
    { via: "ean", intro: "Znalezione w Naturze po kodzie EAN. Wybierz ten sam produkt albo „Żaden z nich”." },
    { via: "name", intro: "Znalezione w Naturze po nazwie. Wybierz ten sam produkt albo „Żaden z nich”." },
  ])("says the candidates were found by $via alone", ({ via, intro }) => {
    expect(repinView("natura", found(via), matchedDecision, FETCHED_AT, product, "all").intro).toBe(intro);
  });

  it("says the choice may be incomplete when the name search got no answer", () => {
    const busy: ShopUnavailable = { kind: "unavailable", reason: "busy" };

    expect(repinView("natura", found("ean", busy), matchedDecision, FETCHED_AT, product, "all")).toMatchObject({
      options: [{ current: true }, { current: false }],
      message: {
        text:
          "Wyszukiwanie po nazwie się nie udało, więc lista może być niepełna. Wyszukiwarka sklepu Natura jest teraz " +
          "zajęta. Spróbuj za minutę.",
        warning: true,
      },
      decline: true,
    });
  });

  it.each<{ why: string; choices: ShopChoices; message: { text: string; warning: boolean } }>([
    {
      why: "nothing was found",
      choices: { kind: "not-found" },
      message: { text: "Nie znaleziono w Naturze żadnego produktu.", warning: false },
    },
    {
      why: "Natura gave no answer",
      choices: { kind: "unavailable", reason: "stopped" },
      message: {
        text:
          "Wyszukiwanie w sklepie Natura jest wyłączone, bo sklep zablokował zapytania. Właściciel musi je ponownie " +
          "włączyć.",
        warning: true,
      },
    },
  ])("says $why, with no candidate, and still lets a match be declined", ({ choices, message }) => {
    expect(repinView("natura", choices, matchedDecision, FETCHED_AT, product, "all")).toEqual({
      kind: "repin",
      intro: null,
      options: [],
      message,
      decline: true,
      replaces: "matched:NV89063",
      cancelHref: PAGE,
    });
  });
});

describe("promptView", () => {
  it("links to the product's page, keeping a retry of its shop", () => {
    expect(promptView("natura", product, false, "all")).toEqual({ kind: "prompt", href: PAGE });
    expect(promptView("natura", product, true, "all")).toEqual({ kind: "prompt", href: `${PAGE}?retry=natura` });
  });
});

describe("decidedView", () => {
  it("links to the product's page, which shows the decision another tab stored", () => {
    expect(decidedView(product, "all")).toEqual({ kind: "decided", href: PAGE });
  });
});

describe("decisionNotice", () => {
  it.each<{ query: string; notice: string }>([
    { query: "shop=natura&matched=1", notice: "Zapisano dopasowanie." },
    { query: "shop=natura&declined=1", notice: "Zapisano: brak w Naturze." },
    { query: "shop=natura&decided=1", notice: "Ten produkt ma już zapisaną decyzję." },
  ])("gives the page's notice for ?$query, with the shop it was for", ({ query, notice }) => {
    expect(decisionNotice(new URLSearchParams(query))).toEqual({ shop: "natura", text: notice });
  });

  it("gives a match's notice first, then a decline's, when several come at once", () => {
    expect(decisionNotice(new URLSearchParams("shop=natura&decided=1&declined=1&matched=1"))?.text).toBe(
      "Zapisano dopasowanie.",
    );
    expect(decisionNotice(new URLSearchParams("shop=natura&decided=1&declined=1"))?.text).toBe(
      "Zapisano: brak w Naturze.",
    );
  });

  it("gives none without a decision's code, whatever else the address holds", () => {
    expect(decisionNotice(new URLSearchParams())).toBeNull();
    expect(decisionNotice(new URLSearchParams("shop=natura&error=failed&prices=done&retry=natura"))).toBeNull();
  });

  it("gives Hebe's notice, now that Hebe is a matched shop", () => {
    expect(decisionNotice(new URLSearchParams("shop=hebe&declined=1"))).toEqual({
      shop: "hebe",
      text: "Zapisano: brak w Hebe.",
    });
    expect(decisionNotice(new URLSearchParams("shop=hebe&matched=1"))).toEqual({
      shop: "hebe",
      text: "Zapisano dopasowanie.",
    });
  });

  it.each([
    "declined=1",
    "shop=&declined=1",
    "shop=rossmann&declined=1",
    "shop=super-pharm&declined=1",
    "shop=NATURA&matched=1",
    "shop=1&decided=1",
  ])("gives none for ?%s, whose code names no matched shop", (query) => {
    expect(decisionNotice(new URLSearchParams(query))).toBeNull();
  });
});

describe("decisionError", () => {
  it.each<{ query: string; text: string }>([
    { query: "shop=natura&error=failed", text: "Nie udało się zapisać wyboru. Spróbuj ponownie." },
    { query: "shop=natura&error=invalid", text: "Nie udało się zapisać wyboru: nieprawidłowe dane." },
    {
      query: "f=check&shop=natura&error=gone",
      text: "Nie udało się zapisać wyboru: tego produktu nie ma na Twojej liście.",
    },
  ])("gives the page's error for ?$query, with the shop whose card says it", ({ query, text }) => {
    expect(decisionError(new URLSearchParams(query))).toEqual({ shop: "natura", text });
  });

  it("gives Hebe's error for its card, now that Hebe is a matched shop", () => {
    expect(decisionError(new URLSearchParams("shop=hebe&error=failed"))).toEqual({
      shop: "hebe",
      text: "Nie udało się zapisać wyboru. Spróbuj ponownie.",
    });
  });

  it.each([
    "",
    "shop=natura&matched=1",
    "shop=natura&error=",
    "shop=natura&error=Twoje+konto+wygasło",
    "error=failed",
    "shop=rossmann&error=failed",
    "shop=super-pharm&error=failed",
  ])("gives none for ?%s: no error the app sent, or no matched shop to show it", (query) => {
    expect(decisionError(new URLSearchParams(query))).toBeNull();
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
