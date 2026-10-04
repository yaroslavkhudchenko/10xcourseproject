import { describe, expect, it } from "vitest";
import {
  naturaCardOf,
  naturaUndecided,
  naturaUnreadable,
  type NaturaCardAlert,
} from "@/components/watchlist/natura-card";
import { DECISION_NOTICES } from "@/lib/notices";
import type { MatchItemSummary, MatchView } from "@/lib/services/match-view";

const ITEM_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
// The product's page, as the views link it for a product opened from the list's "Do sprawdzenia" chip, and its
// address that opens the choice that changes the stored decision in Natura.
const PAGE = `/watchlist/${ITEM_ID}?f=check`;
const REPIN_PAGE = `/watchlist/${ITEM_ID}?f=check&repin=natura`;

// Natura's Nivea Soft 300 ml, as a match's card names it.
const item: MatchItemSummary = {
  brand: "NIVEA",
  name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
  sizeText: "300 ml",
  imageUrl: null,
  productUrl: "https://drogerienatura.pl/produkt/nivea-soft-krem-intensywnie-nawilzajacy-300-ml-4005900009319",
};

/** One of each view the product's page builds for Natura (src/lib/services/match-view.ts). */
const VIEWS = {
  matched: {
    kind: "matched",
    note: "Dopasowano automatycznie: ten sam EAN i rozmiar.",
    warnings: [],
    item,
    unsaved: false,
    action: { kind: "repin", href: REPIN_PAGE },
  },
  unmatched: { kind: "unmatched", action: { kind: "repin", href: REPIN_PAGE } },
  "not-found": {
    kind: "not-found",
    text: "Nie znaleziono w Naturze (sprawdzono 28.09, 14:00).",
    href: `/watchlist/${ITEM_ID}?f=check&retry=natura`,
  },
  choose: { kind: "choose", intro: "Znalezione w Naturze po nazwie.", options: [] },
  unavailable: { kind: "unavailable", message: "Sklep Natura poprosił o przerwę. Spróbuj później." },
  prompt: { kind: "prompt", href: PAGE },
  decided: { kind: "decided", href: PAGE },
  "read-failed": { kind: "read-failed" },
} satisfies Record<MatchView["kind"], MatchView>;

const quiet = { notice: null, error: null, unsaved: false };

describe("naturaUndecided", () => {
  it.each(["prompt", "choose", "unavailable"] as const)("is true for %s, which has no stored decision", (kind) => {
    expect(naturaUndecided(VIEWS[kind])).toBe(true);
  });

  it.each(["matched", "unmatched", "not-found", "decided", "read-failed"] as const)("is false for %s", (kind) => {
    expect(naturaUndecided(VIEWS[kind])).toBe(false);
  });

  it("is false without a view", () => {
    expect(naturaUndecided(null)).toBe(false);
  });
});

describe("naturaUnreadable", () => {
  it("is true for a decision that couldn't be read, whose match could name a lower price", () => {
    expect(naturaUnreadable(VIEWS["read-failed"])).toBe(true);
  });

  it.each(["matched", "unmatched", "not-found", "choose", "unavailable", "prompt", "decided"] as const)(
    "is false for %s",
    (kind) => {
      expect(naturaUnreadable(VIEWS[kind])).toBe(false);
    },
  );

  it("is false without a view", () => {
    expect(naturaUnreadable(null)).toBe(false);
  });
});

describe("naturaCardOf", () => {
  it("gives a saved match's footer: its item, how it was decided, Zmień, and no warning when nothing differs", () => {
    expect(naturaCardOf({ view: VIEWS.matched, ...quiet })).toEqual({
      kind: "matched",
      note: "Dopasowano automatycznie: ten sam EAN i rozmiar.",
      warnings: [],
      item,
      unsaved: false,
      action: { link: { label: "Zmień", href: REPIN_PAGE }, hint: null },
      alerts: [],
    });
  });

  it("gives a saved suspicious match its item and each of its warnings, in the view's order", () => {
    const warnings = ["Inny rozmiar: 200 ml zamiast 300 ml", "Inna marka: YOPE zamiast NIVEA"];
    const view: MatchView = { ...VIEWS.matched, note: "Potwierdzone przez Ciebie.", warnings };

    expect(naturaCardOf({ view, ...quiet })).toEqual({
      kind: "matched",
      note: "Potwierdzone przez Ciebie.",
      warnings,
      item,
      unsaved: false,
      action: { link: { label: "Zmień", href: REPIN_PAGE }, hint: null },
      alerts: [],
    });
  });

  it("says a match the page couldn't save is unsaved, so the card shows its item's photo and page, and no action", () => {
    const view: MatchView = { ...VIEWS.matched, unsaved: true, action: null };

    expect(naturaCardOf({ view, ...quiet, unsaved: true })).toMatchObject({
      kind: "matched",
      item,
      unsaved: true,
      action: null,
    });
  });

  it("offers Dopasuj ponownie on the user's decline, a ghost card", () => {
    expect(naturaCardOf({ view: VIEWS.unmatched, ...quiet })).toEqual({
      kind: "unmatched",
      text: "Brak w Naturze — Twój wybór.",
      action: { link: { label: "Dopasuj ponownie", href: REPIN_PAGE }, hint: null },
      alerts: [],
    });
  });

  it.each<{ view: MatchView; hint: string }>([
    {
      view: { ...VIEWS.matched, action: { kind: "cancel", href: PAGE } },
      hint: "Wybierz poniżej inny produkt albo „Żaden z nich”.",
    },
    {
      view: { kind: "unmatched", action: { kind: "cancel", href: PAGE } },
      hint: "Wybierz poniżej produkt z Natury albo „Anuluj”.",
    },
  ])("points a $view.kind's card to its open choice below, with Anuluj", ({ view, hint }) => {
    expect(naturaCardOf({ view, ...quiet })).toMatchObject({ action: { link: { label: "Anuluj", href: PAGE }, hint } });
  });

  it("says another tab stored a decision meanwhile, with the link that shows it", () => {
    expect(naturaCardOf({ view: VIEWS.decided, ...quiet })).toEqual({
      kind: "decided",
      text: DECISION_NOTICES.decided,
      link: { label: "Pokaż zapisaną decyzję", href: PAGE },
      alerts: [],
    });
  });

  it("asks to match a product not matched yet, with the link that looks it up", () => {
    expect(naturaCardOf({ view: VIEWS.prompt, ...quiet })).toEqual({
      kind: "prompt",
      text: "Produkt nie jest jeszcze dopasowany w Naturze.",
      link: { label: "Dopasuj w Naturze", href: PAGE },
      alerts: [],
    });
  });

  it("says the lookup found nothing, with the link that looks the product up again", () => {
    expect(naturaCardOf({ view: VIEWS["not-found"], ...quiet })).toEqual({
      kind: "not-found",
      text: "Nie znaleziono w Naturze (sprawdzono 28.09, 14:00).",
      link: { label: "Szukaj ponownie", href: `/watchlist/${ITEM_ID}?f=check&retry=natura` },
      alerts: [],
    });
  });

  it.each<{ kind: "unavailable" | "read-failed" | "choose"; text: string }>([
    { kind: "unavailable", text: "Sklep Natura poprosił o przerwę. Spróbuj później." },
    { kind: "read-failed", text: "Nie udało się wczytać dopasowania Natury." },
    { kind: "choose", text: "Wybierz pasujący produkt poniżej." },
  ])("says what $kind means, with no link and no action", ({ kind, text }) => {
    const card = naturaCardOf({ view: VIEWS[kind], ...quiet });

    expect(card).toEqual({ kind, text, alerts: [] });
    expect(card).not.toHaveProperty("link");
    expect(card).not.toHaveProperty("action");
  });

  it("brings a saved decision's notice and a decision's error along as alerts", () => {
    const alerts: NaturaCardAlert[] = [
      { tone: "success", text: "Zapisano dopasowanie." },
      { tone: "destructive", text: "Nie udało się zapisać wyboru. Spróbuj ponownie." },
    ];

    expect(
      naturaCardOf({
        view: VIEWS.matched,
        notice: "Zapisano dopasowanie.",
        error: "Nie udało się zapisać wyboru. Spróbuj ponownie.",
        unsaved: false,
      }).alerts,
    ).toEqual(alerts);
  });

  it("warns when the lookup's outcome couldn't be stored, as the Natura section did", () => {
    expect(naturaCardOf({ view: VIEWS["not-found"], ...quiet, unsaved: true }).alerts).toEqual([
      {
        tone: "warning",
        text: "Nie udało się zapisać wyniku. Przy następnym otwarciu produktu Natura zostanie sprawdzona ponownie.",
      },
    ]);
  });
});
