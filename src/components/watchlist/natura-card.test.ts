import { describe, expect, it } from "vitest";
import { naturaCardOf, naturaUndecided, type NaturaCardAlert } from "@/components/watchlist/natura-card";
import { DECISION_NOTICES } from "@/lib/notices";
import type { NaturaItemSummary, NaturaView } from "@/lib/services/natura-view";

const ITEM_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";

// Natura's Nivea Soft 300 ml, as a match the page couldn't save shows it.
const item: NaturaItemSummary = {
  brand: "NIVEA",
  name: "NIVEA SOFT krem intensywnie nawilżający 300 ml",
  sizeText: "300 ml",
  imageUrl: null,
  productUrl: "https://drogerienatura.pl/produkt/nivea-soft-krem-intensywnie-nawilzajacy-300-ml-4005900009319",
};

/** One of each view the product's page builds for Natura (src/lib/services/natura-view.ts). */
const VIEWS = {
  matched: { kind: "matched", note: "Dopasowano automatycznie: ten sam EAN i rozmiar.", sizeWarning: null },
  unmatched: { kind: "unmatched" },
  "not-found": {
    kind: "not-found",
    text: "Nie znaleziono w Naturze (sprawdzono 28.09, 14:00).",
    href: `/watchlist/${ITEM_ID}?retry=1`,
  },
  choose: { kind: "choose", intro: "Znalezione w Naturze po nazwie.", options: [] },
  unavailable: { kind: "unavailable", message: "Sklep Natura poprosił o przerwę. Spróbuj później." },
  prompt: { kind: "prompt", href: `/watchlist/${ITEM_ID}` },
  decided: { kind: "decided" },
  "read-failed": { kind: "read-failed" },
} satisfies Record<NaturaView["kind"], NaturaView>;

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

describe("naturaCardOf", () => {
  it("gives a match's footer: how it was decided, and no size warning when the sizes agree", () => {
    expect(naturaCardOf({ view: VIEWS.matched, ...quiet })).toEqual({
      kind: "matched",
      note: "Dopasowano automatycznie: ten sam EAN i rozmiar.",
      sizeWarning: null,
      item: null,
      alerts: [],
    });
  });

  it("gives a suspicious match's size warning, and the item of a match the page couldn't save", () => {
    const view: NaturaView = {
      kind: "matched",
      note: "Potwierdzone przez Ciebie.",
      sizeWarning: "Inny rozmiar: 200 ml zamiast 300 ml",
      item,
    };

    expect(naturaCardOf({ view, ...quiet, unsaved: true })).toMatchObject({
      kind: "matched",
      sizeWarning: "Inny rozmiar: 200 ml zamiast 300 ml",
      item,
    });
    // A saved match has its price card, so its footer shows no item.
    expect(naturaCardOf({ view, ...quiet })).toMatchObject({ item: null });
  });

  it("asks to match a product not matched yet, with the link that looks it up", () => {
    expect(naturaCardOf({ view: VIEWS.prompt, ...quiet })).toEqual({
      kind: "prompt",
      text: "Produkt nie jest jeszcze dopasowany w Naturze.",
      link: { label: "Dopasuj w Naturze", href: `/watchlist/${ITEM_ID}` },
      alerts: [],
    });
  });

  it("says the lookup found nothing, with the link that looks the product up again", () => {
    expect(naturaCardOf({ view: VIEWS["not-found"], ...quiet })).toEqual({
      kind: "not-found",
      text: "Nie znaleziono w Naturze (sprawdzono 28.09, 14:00).",
      link: { label: "Szukaj ponownie", href: `/watchlist/${ITEM_ID}?retry=1` },
      alerts: [],
    });
  });

  it.each<{ kind: "unmatched" | "unavailable" | "decided" | "read-failed" | "choose"; text: string }>([
    { kind: "unmatched", text: "Brak w Naturze — Twój wybór." },
    { kind: "unavailable", text: "Sklep Natura poprosił o przerwę. Spróbuj później." },
    { kind: "decided", text: DECISION_NOTICES.decided },
    { kind: "read-failed", text: "Nie udało się wczytać dopasowania Natury." },
    { kind: "choose", text: "Wybierz pasujący produkt poniżej." },
  ])("says what $kind means, with no link and no button to change it", ({ kind, text }) => {
    const card = naturaCardOf({ view: VIEWS[kind], ...quiet });

    expect(card).toEqual({ kind, text, alerts: [] });
    // Re-pinning waits for S-08.
    expect(card).not.toHaveProperty("link");
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
