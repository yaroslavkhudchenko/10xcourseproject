import { describe, expect, it } from "vitest";
import {
  matchCardOf,
  undecided,
  undecidedShopsOf,
  unreadable,
  unreadableShopsOf,
  type MatchCardAlert,
  type MatchedShopView,
} from "@/components/watchlist/match-card";
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

/** A decision's notice and error, and whether the lookup's outcome went unsaved, as a test sets them. */
type Extra = Partial<Pick<MatchedShopView, "notice" | "error" | "unsaved">>;

/** Natura as the page hands it to the island: this view, and no notices unless `extra` adds them. */
const natura = (view: MatchView, extra: Extra = {}): MatchedShopView => ({ shop: "natura", view, ...quiet, ...extra });

/** Hebe in the same place, the other matched shop. */
const hebe = (view: MatchView, extra: Extra = {}): MatchedShopView => ({ shop: "hebe", view, ...quiet, ...extra });

describe("undecided", () => {
  it.each(["prompt", "choose", "unavailable"] as const)("is true for %s, which has no stored decision", (kind) => {
    expect(undecided(VIEWS[kind])).toBe(true);
  });

  it.each(["matched", "unmatched", "not-found", "decided", "read-failed"] as const)("is false for %s", (kind) => {
    expect(undecided(VIEWS[kind])).toBe(false);
  });

  it("is false without a view", () => {
    expect(undecided(null)).toBe(false);
  });
});

describe("unreadable", () => {
  it("is true for a decision that couldn't be read, whose match could name a lower price", () => {
    expect(unreadable(VIEWS["read-failed"])).toBe(true);
  });

  it.each(["matched", "unmatched", "not-found", "choose", "unavailable", "prompt", "decided"] as const)(
    "is false for %s",
    (kind) => {
      expect(unreadable(VIEWS[kind])).toBe(false);
    },
  );

  it("is false without a view", () => {
    expect(unreadable(null)).toBe(false);
  });
});

describe("undecidedShopsOf and unreadableShopsOf: the matched shops the product area names", () => {
  it("lists each shop still to be matched, and each whose decision couldn't be read, in the page's order", () => {
    const matched = [natura(VIEWS.prompt), hebe(VIEWS.unavailable)];

    expect(undecidedShopsOf(matched)).toEqual(["natura", "hebe"]);
    expect(unreadableShopsOf(matched)).toEqual([]);
  });

  it("keeps each shop's own state apart", () => {
    const matched = [natura(VIEWS.matched), hebe(VIEWS["read-failed"])];

    expect(undecidedShopsOf(matched)).toEqual([]);
    expect(unreadableShopsOf(matched)).toEqual(["hebe"]);
    expect(unreadableShopsOf([natura(VIEWS["read-failed"]), hebe(VIEWS.choose)])).toEqual(["natura"]);
    expect(undecidedShopsOf([natura(VIEWS["read-failed"]), hebe(VIEWS.choose)])).toEqual(["hebe"]);
  });

  it("lists none without a matched shop", () => {
    expect(undecidedShopsOf([])).toEqual([]);
    expect(unreadableShopsOf([])).toEqual([]);
  });
});

describe("matchCardOf", () => {
  it("gives a saved match's footer: its item, how it was decided, Zmień, and no warning when nothing differs", () => {
    expect(matchCardOf(natura(VIEWS.matched))).toEqual({
      shop: "natura",
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

    expect(matchCardOf(natura(view))).toEqual({
      shop: "natura",
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

    expect(matchCardOf(natura(view, { unsaved: true }))).toMatchObject({
      shop: "natura",
      kind: "matched",
      item,
      unsaved: true,
      action: null,
    });
  });

  it("offers Dopasuj ponownie on the user's decline, a ghost card", () => {
    expect(matchCardOf(natura(VIEWS.unmatched))).toEqual({
      shop: "natura",
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
    expect(matchCardOf(natura(view))).toMatchObject({ action: { link: { label: "Anuluj", href: PAGE }, hint } });
  });

  it("says another tab stored a decision meanwhile, with the link that shows it", () => {
    expect(matchCardOf(natura(VIEWS.decided))).toEqual({
      shop: "natura",
      kind: "decided",
      text: DECISION_NOTICES.decided,
      link: { label: "Pokaż zapisaną decyzję", href: PAGE },
      alerts: [],
    });
  });

  it("asks to match a product not matched yet, with the link that looks it up", () => {
    expect(matchCardOf(natura(VIEWS.prompt))).toEqual({
      shop: "natura",
      kind: "prompt",
      text: "Produkt nie jest jeszcze dopasowany w Naturze.",
      link: { label: "Dopasuj w Naturze", href: PAGE },
      alerts: [],
    });
  });

  it("says the lookup found nothing, with the link that looks the product up again", () => {
    expect(matchCardOf(natura(VIEWS["not-found"]))).toEqual({
      shop: "natura",
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
    const card = matchCardOf(natura(VIEWS[kind]));

    expect(card).toEqual({ shop: "natura", kind, text, alerts: [] });
    expect(card).not.toHaveProperty("link");
    expect(card).not.toHaveProperty("action");
  });

  it("brings a saved decision's notice and a decision's error along as alerts", () => {
    const alerts: MatchCardAlert[] = [
      { tone: "success", text: "Zapisano dopasowanie." },
      { tone: "destructive", text: "Nie udało się zapisać wyboru. Spróbuj ponownie." },
    ];

    expect(
      matchCardOf(
        natura(VIEWS.matched, {
          notice: "Zapisano dopasowanie.",
          error: "Nie udało się zapisać wyboru. Spróbuj ponownie.",
        }),
      ).alerts,
    ).toEqual(alerts);
  });

  it("warns when the lookup's outcome couldn't be stored, naming the shop that's looked up again", () => {
    expect(matchCardOf(natura(VIEWS["not-found"], { unsaved: true })).alerts).toEqual([
      {
        tone: "warning",
        text: "Nie udało się zapisać wyniku. Przy następnym otwarciu produktu sklep Natura zostanie sprawdzony ponownie.",
      },
    ]);
  });
});

describe("matchCardOf for another matched shop: every text from the shop's label", () => {
  it("names Hebe's decline, its prompt and a decision of Hebe's that couldn't be read", () => {
    expect(matchCardOf(hebe(VIEWS.unmatched))).toMatchObject({
      shop: "hebe",
      kind: "unmatched",
      text: "Brak w Hebe — Twój wybór.",
    });
    expect(matchCardOf(hebe(VIEWS.prompt))).toEqual({
      shop: "hebe",
      kind: "prompt",
      text: "Produkt nie jest jeszcze dopasowany w Hebe.",
      link: { label: "Dopasuj w Hebe", href: PAGE },
      alerts: [],
    });
    expect(matchCardOf(hebe(VIEWS["read-failed"]))).toEqual({
      shop: "hebe",
      kind: "read-failed",
      text: "Nie udało się wczytać dopasowania Hebe.",
      alerts: [],
    });
  });

  it("points Hebe's open choice after a decline to Hebe's products", () => {
    const view: MatchView = { kind: "unmatched", action: { kind: "cancel", href: PAGE } };

    expect(matchCardOf(hebe(view))).toMatchObject({
      action: { link: { label: "Anuluj", href: PAGE }, hint: "Wybierz poniżej produkt z Hebe albo „Anuluj”." },
    });
  });

  it("says Hebe is looked up again when its lookup's outcome couldn't be stored", () => {
    expect(matchCardOf(hebe(VIEWS["not-found"], { unsaved: true })).alerts).toEqual([
      {
        tone: "warning",
        text: "Nie udało się zapisać wyniku. Przy następnym otwarciu produktu sklep Hebe zostanie sprawdzony ponownie.",
      },
    ]);
  });
});

describe("matchCardOf for Super-Pharm, looked up on view like the other shops", () => {
  // Super-Pharm's lookup on the user's own navigation, whose outcome couldn't be stored: a match its name check
  // accepted, which then has no price row, or nothing found.
  const byName: MatchView = {
    kind: "matched",
    note: "Dopasowano automatycznie po nazwie.",
    warnings: [],
    item: {
      brand: "Nivea",
      name: "Nivea Soft Krem nawilżający (Pudełko)",
      sizeText: "300 ml",
      imageUrl: null,
      productUrl: "https://www.superpharm.pl/nivea-soft-krem-nawilzajacy-pudelko-39477",
    },
    unsaved: true,
    action: null,
  };
  const notFound: MatchView = {
    kind: "not-found",
    text: "Nie znaleziono w Super-Pharmie (sprawdzono 28.09, 14:00).",
    href: `/watchlist/${ITEM_ID}?f=check&retry=super-pharm`,
  };

  it.each([byName, notFound])(
    "says the next visit looks Super-Pharm up again when its lookup's outcome couldn't be stored ($kind)",
    (view) => {
      expect(matchCardOf({ shop: "super-pharm", view, ...quiet, unsaved: true }).alerts).toEqual([
        {
          tone: "warning",
          text: "Nie udało się zapisać wyniku. Przy następnym otwarciu produktu sklep Super-Pharm zostanie sprawdzony ponownie.",
        },
      ]);
    },
  );
});
