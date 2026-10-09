import { describe, expect, it } from "vitest";
import {
  brandsAgree,
  judge,
  matchDifferences,
  orderChoice,
  pickMatch,
  sizesEqual,
  startsWithWords,
  type NamedProduct,
} from "@/lib/services/matching";
import { parseSize } from "@/lib/services/size";
import type { CandidateOption, ShopCandidate, Size } from "@/types";

function sizeOf(text: string): Size {
  const size = parseSize(text);
  if (!size) {
    throw new Error(`${text} doesn't parse`);
  }
  return size;
}

// Rossmann's Nivea Soft 300 ml, with the first two of its EANs, its name and its caption (rossmann-search-results.json).
const SOFT_EAN = "4005900009319";
const SECOND_EAN = "4005808890637";
const OTHER_EAN = "5900168900370";
const product: NamedProduct = {
  brand: "NIVEA",
  name: "Soft",
  caption: "krem uniwersalny, nawilżający",
  eans: [SOFT_EAN, SECOND_EAN],
  size: sizeOf("300 ml"),
};

/**
 * A Natura candidate with the given SKU, EANs and size text, its size parsed from the text as the adapter does, of
 * NIVEA unless another brand is given, and named by its SKU, which shares no word with any product here.
 */
function candidate(
  shopItemId: string,
  eans: string[],
  sizeText: string | null,
  brand: string | null = "NIVEA",
): ShopCandidate {
  return {
    shop: "natura",
    shopItemId,
    brand,
    name: `Produkt ${shopItemId}`,
    sizeText,
    size: parseSize(sizeText),
    eans,
    productUrl: null,
    imageUrl: null,
    offer: { price: 16.99, regularPrice: null, lowestPrice30d: null, promoEndsOn: null, available: true },
  };
}

/**
 * A candidate with the given name, in 300 ml, of NIVEA and without an EAN, as Super-Pharm's candidates come, unless
 * other EANs, a size text or a brand are given.
 */
function named(
  shopItemId: string,
  name: string,
  eans: string[] = [],
  sizeText: string | null = "300 ml",
  brand: string | null = "NIVEA",
): ShopCandidate {
  return { ...candidate(shopItemId, eans, sizeText, brand), name };
}

/** The option a choice offers for a candidate, with the verdict of one in the product's size and brand. */
const alike = (option: ShopCandidate, sharesEan = false): CandidateOption => ({
  candidate: option,
  verdict: { sharesEan, size: "equal", brand: "agrees" },
});

/** The ids of the candidates a choice offers, in its order; anything but a choice fails the test. */
function chosenIds(own: NamedProduct, candidates: ShopCandidate[], limit?: number): string[] {
  const pick = pickMatch(own, candidates, limit);
  if (pick.kind !== "choose") {
    throw new Error(`expected choose, got ${pick.kind}`);
  }
  return pick.options.map((option) => option.candidate.shopItemId);
}

describe("sizesEqual", () => {
  it.each([
    { a: "300 ml", b: "300.0000 ml", equal: true },
    { a: "0,3 l", b: "300 ml", equal: true },
    { a: "200 ml", b: "300 ml", equal: false },
    { a: "300 ml", b: "300 g", equal: false },
  ])("says $a and $b are the same size: $equal", ({ a, b, equal }) => {
    expect(sizesEqual(sizeOf(a), sizeOf(b))).toBe(equal);
  });

  it("absorbs float noise, but not a millilitre", () => {
    // (0.1 + 0.2) × 1000 is 300.00000000000006 in floating point.
    expect(sizesEqual({ value: (0.1 + 0.2) * 1000, unit: "ml" }, sizeOf("300 ml"))).toBe(true);
    expect(sizesEqual(sizeOf("301 ml"), sizeOf("300 ml"))).toBe(false);
  });
});

describe("brandsAgree", () => {
  it.each([
    { why: "the same brand in another case", a: "NIVEA", b: "nivea" },
    { why: "a sub-brand", a: "NIVEA", b: "NIVEA MEN" },
    { why: "the same brand without its accent, apostrophe and second word", a: "L'Oréal Paris", b: "LOREAL" },
    { why: "Polish letters in another case", a: "Przykład", b: "PRZYKŁAD" },
  ])("agrees on $a and $b: $why", ({ a, b }) => {
    expect(brandsAgree(a, b)).toBe(true);
    expect(brandsAgree(b, a)).toBe(true);
  });

  it.each([
    { why: "another brand", a: "NIVEA", b: "YOPE" },
    { why: "a brand's second word alone", a: "NIVEA MEN", b: "MEN" },
    // The lenient rule's known false alarm: a title in front of a brand reads as another brand.
    { why: "a title in front of the brand", a: "Dr Irena Eris", b: "IRENA ERIS" },
  ])("says $a and $b differ: $why", ({ a, b }) => {
    expect(brandsAgree(a, b)).toBe(false);
    expect(brandsAgree(b, a)).toBe(false);
  });

  it.each([
    { why: "the first is missing", a: null, b: "NIVEA" },
    { why: "the second is missing", a: "NIVEA", b: null },
    { why: "both are missing", a: null, b: null },
    { why: "one is empty", a: "", b: "NIVEA" },
    { why: "one is blank", a: "NIVEA", b: "   " },
    { why: "one has no letter or digit", a: " – ", b: "NIVEA" },
  ])("can't say when $why", ({ a, b }) => {
    expect(brandsAgree(a, b)).toBeNull();
  });
});

describe("startsWithWords", () => {
  it.each([
    { why: "the same words", text: "SORAYA Beauty Sleep krem na noc 50 ml", start: "SORAYA" },
    { why: "the same word in another case", text: "NIVEA SOFT krem intensywnie nawilżający 300 ml", start: "Nivea" },
    {
      why: "the same words in capitals, without the accent",
      text: "L'OREAL PARIS Elseve Szampon",
      start: "L'Oréal Paris",
    },
  ])("says $text starts with $start: $why", ({ text, start }) => {
    expect(startsWithWords(text, start)).toBe(true);
  });

  it.each([
    // Super-Pharm's 105870: its brand's second word isn't the name's.
    {
      why: "only its first word",
      text: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający",
      start: "AA Cosmetics",
    },
    { why: "its letters, not its word", text: "Ziajka krem dla dzieci", start: "Ziaja" },
    { why: "its word further on", text: "Krem NIVEA Soft", start: "NIVEA" },
    { why: "fewer words", text: "Maybelline", start: "Maybelline New York" },
  ])("says $text doesn't start with $start: it has $why", ({ text, start }) => {
    expect(startsWithWords(text, start)).toBe(false);
  });

  it.each(["", "   ", " – "])("says no text starts with %j, which has no word", (start) => {
    expect(startsWithWords("NIVEA Soft", start)).toBe(false);
  });
});

describe("judge", () => {
  it.each([
    { eans: [SOFT_EAN], sizeText: "300 ml", verdict: { sharesEan: true, size: "equal", brand: "agrees" } },
    { eans: [OTHER_EAN, SECOND_EAN], sizeText: "0,3 l", verdict: { sharesEan: true, size: "equal", brand: "agrees" } },
    { eans: [OTHER_EAN], sizeText: "500 ml", verdict: { sharesEan: false, size: "differs", brand: "agrees" } },
    { eans: [], sizeText: "4x57 szt.", verdict: { sharesEan: false, size: "unknown", brand: "agrees" } },
  ])("judges EANs $eans and $sizeText as $verdict", ({ eans, sizeText, verdict }) => {
    expect(judge(product, candidate("NV89063", eans, sizeText))).toEqual(verdict);
  });

  it.each([
    { brand: "NIVEA MEN", verdict: "agrees" },
    { brand: "YOPE", verdict: "differs" },
    { brand: null, verdict: "unknown" },
  ])("judges the brand $brand against NIVEA as $verdict", ({ brand, verdict }) => {
    expect(judge(product, candidate("NV89063", [SOFT_EAN], "300 ml", brand))).toEqual({
      sharesEan: true,
      size: "equal",
      brand: verdict,
    });
  });

  it("can't judge the brand of a product without one, nor a size it doesn't have", () => {
    expect(judge({ ...product, brand: null, size: null }, candidate("NV89063", [SOFT_EAN], "300 ml"))).toEqual({
      sharesEan: true,
      size: "unknown",
      brand: "unknown",
    });
  });
});

describe("pickMatch", () => {
  it("accepts the one candidate that shares an EAN and the size, among others", () => {
    const match = candidate("NV89063", [SOFT_EAN], "300 ml");
    const candidates = [candidate("JM00370", [OTHER_EAN], "300 ml"), match, candidate("NV81063", [], "300 ml")];

    expect(pickMatch(product, candidates)).toEqual({ kind: "accepted", candidate: match });
  });

  it("accepts a candidate that shares only the product's secondary EAN", () => {
    const match = candidate("NV89063", [SECOND_EAN], "0,3 l");

    expect(pickMatch(product, [match])).toEqual({ kind: "accepted", candidate: match });
  });

  it.each([
    { why: "a sub-brand", own: product, brand: "NIVEA MEN" },
    { why: "no brand", own: product, brand: null },
    { why: "a brand, for a product without one", own: { ...product, brand: null }, brand: "YOPE" },
  ])("accepts the one candidate that shares an EAN and the size, with $why", ({ own, brand }) => {
    const match = candidate("NV89063", [SOFT_EAN], "300 ml", brand);

    expect(pickMatch(own, [match])).toEqual({ kind: "accepted", candidate: match });
  });

  it("leaves the one candidate that shares an EAN and the size to the user when its brand differs", () => {
    const otherBrand = candidate("JM00370", [SOFT_EAN], "300 ml", "YOPE");

    expect(pickMatch(product, [otherBrand])).toEqual({
      kind: "choose",
      options: [{ candidate: otherBrand, verdict: { sharesEan: true, size: "equal", brand: "differs" } }],
    });
  });

  it("accepts the product's brand when a candidate of another brand shares the EAN and the size too", () => {
    const otherBrand = candidate("JM00370", [SOFT_EAN], "300 ml", "YOPE");
    const match = candidate("NV89063", [SOFT_EAN], "300 ml");

    expect(pickMatch(product, [otherBrand, match])).toEqual({ kind: "accepted", candidate: match });
  });

  it("leaves two qualifying candidates to the user, ahead of the rest", () => {
    const first = candidate("NV89063", [SOFT_EAN], "300 ml");
    const other = candidate("JM00370", [OTHER_EAN], "300 ml");
    const second = candidate("NV89064", [SECOND_EAN], "300 ml");

    expect(pickMatch(product, [first, other, second])).toEqual({
      kind: "choose",
      options: [
        { candidate: first, verdict: { sharesEan: true, size: "equal", brand: "agrees" } },
        { candidate: second, verdict: { sharesEan: true, size: "equal", brand: "agrees" } },
        { candidate: other, verdict: { sharesEan: false, size: "equal", brand: "agrees" } },
      ],
    });
  });

  it.each([
    { when: "a shared EAN comes in another size", size: product.size, sizeText: "200 ml", verdict: "differs" },
    { when: "the candidate has no size", size: product.size, sizeText: null, verdict: "unknown" },
    { when: "the product has no size", size: null, sizeText: "300 ml", verdict: "unknown" },
  ])("asks the user when $when", ({ size, sizeText, verdict }) => {
    const shared = candidate("NV89063", [SOFT_EAN], sizeText);

    expect(pickMatch({ ...product, size }, [shared])).toEqual({
      kind: "choose",
      options: [{ candidate: shared, verdict: { sharesEan: true, size: verdict, brand: "agrees" } }],
    });
  });

  it("has nothing to offer without candidates", () => {
    expect(pickMatch(product, [])).toEqual({ kind: "none" });
  });

  it("offers at most 3 candidates, the qualifying ones first and then the rest in the shop's order", () => {
    const others = ["A1", "A2", "A3", "A4"].map((id) => candidate(id, [OTHER_EAN], "300 ml"));
    const [q1, q2] = ["Q1", "Q2"].map((id) => candidate(id, [SOFT_EAN], "300 ml"));

    const ids = (candidates: ShopCandidate[]) => {
      const pick = pickMatch(product, candidates);
      return pick.kind === "choose" ? pick.options.map((option) => option.candidate.shopItemId) : pick.kind;
    };

    expect(ids(others)).toEqual(["A1", "A2", "A3"]);
    expect(ids([others[0], others[1], q1, others[2], q2])).toEqual(["Q1", "Q2", "A1"]);
  });
});

describe("pickMatch: the order of a choice", () => {
  // None of these shares an EAN with the product, and none has a name the name check accepts.
  const otherSize = candidate("A1", [OTHER_EAN], "200 ml");
  const otherBrand = candidate("A2", [OTHER_EAN], "300 ml", "YOPE");
  const alikeItem = candidate("A3", [OTHER_EAN], "300 ml");
  const noSize = candidate("A4", [], null);
  const noBrand = candidate("A5", [], "0,3 l", null);
  const subBrand = candidate("A6", [OTHER_EAN], "300 ml", "NIVEA MEN");
  const candidates = [otherSize, otherBrand, alikeItem, noSize, noBrand, subBrand];

  it("puts the candidates in the product's size whose brand doesn't differ first, each group in the shop's order", () => {
    // In the product's size: A5 of a brand that can't be compared, without an EAN, so its name is weighed first; then
    // A3 of its brand and A6 of its sub-brand, whose EANs can decide; then A1 in another size, A2 of another brand and
    // A4 of a size that can't be compared.
    expect(chosenIds(product, candidates, 10)).toEqual(["A5", "A3", "A6", "A1", "A2", "A4"]);
  });

  it("offers at most 3, the likeliest", () => {
    expect(chosenIds(product, candidates)).toEqual(["A5", "A3", "A6"]);
    expect(chosenIds(product, [otherSize, otherBrand, noSize, alikeItem])).toEqual(["A3", "A1", "A2"]);
  });

  it("keeps the qualifying candidates first, then the likeliest, then the others", () => {
    const [q1, q2] = ["Q1", "Q2"].map((id) => candidate(id, [SOFT_EAN], "300 ml"));

    expect(chosenIds(product, [otherSize, alikeItem, q1, subBrand, q2], 10)).toEqual(["Q1", "Q2", "A3", "A6", "A1"]);
    expect(chosenIds(product, [otherSize, alikeItem, q1, subBrand, q2])).toEqual(["Q1", "Q2", "A3"]);
  });

  it("puts an item in the product's size ahead of one that shares the EAN in another size", () => {
    const sharedOtherSize = candidate("S1", [SOFT_EAN], "200 ml");

    expect(chosenIds(product, [sharedOtherSize, alikeItem])).toEqual(["A3", "S1"]);
  });
});

describe("pickMatch: by name, where EANs can't decide", () => {
  // Super-Pharm's Nivea Soft 300 ml (super-pharm-name-search-one.json): every word of its name is the product's, but
  // for its brand and the packaging.
  const soft = named("10132", "Nivea Soft Krem nawilżający (Pudełko)");

  it("accepts an item without an EAN whose name holds only the product's words, though it shares no EAN", () => {
    const handCream = named("96276", "Nivea Krem do rąk Intensywne Nawilżenie", [], "100 ml");

    expect(pickMatch(product, [handCream, soft])).toEqual({ kind: "accepted", candidate: soft });
  });

  it("accepts the candidate that qualifies by EAN, not one that passes the name check", () => {
    const byEan = candidate("NV89063", [SOFT_EAN], "300 ml");

    expect(pickMatch(product, [soft, byEan])).toEqual({ kind: "accepted", candidate: byEan });
  });

  it("leaves two candidates that qualify by EAN to the user, though a third passes the name check", () => {
    const [first, second] = ["NV89063", "NV89064"].map((id) => candidate(id, [SOFT_EAN], "300 ml"));

    // The name check never settles two items that share an EAN, nor steps in beside them.
    expect(pickMatch(product, [soft, first, second])).toEqual({
      kind: "choose",
      options: [alike(first, true), alike(second, true), alike(soft)],
    });
  });

  it("weighs an item's name only where EANs can't decide: never while the product and the item both have EANs", () => {
    const withEan = named("NV89099", "Nivea Soft Krem nawilżający", [OTHER_EAN]);

    expect(pickMatch(product, [withEan])).toEqual({ kind: "choose", options: [alike(withEan)] });
    // The same item for the product without an EAN, as one added from a shop whose index holds none would be.
    expect(pickMatch({ ...product, eans: [] }, [withEan])).toEqual({ kind: "accepted", candidate: withEan });
  });

  it.each([
    { why: "in another size", item: named("A1", "Nivea Soft Krem nawilżający", [], "200 ml") },
    { why: "of a size that can't be compared", item: named("A2", "Nivea Soft Krem nawilżający", [], null) },
    { why: "of another brand", item: named("A3", "Yope Soft Krem nawilżający", [], "300 ml", "YOPE") },
  ])("never accepts by name an item $why", ({ item }) => {
    expect(pickMatch({ ...product, eans: [] }, [item]).kind).toBe("choose");
  });

  // A sun balm whose strength is a number in its caption.
  const spf30: NamedProduct = {
    brand: "NIVEA",
    name: "Sun Protect & Moisture",
    caption: "balsam do opalania, nawilżający, SPF 30",
    eans: [],
    size: sizeOf("200 ml"),
  };

  it.each([
    { name: "Nivea Sun Protect & Moisture Balsam do opalania SPF 30, 200 ml", accepted: true },
    // Numbers stay words: another strength is another product.
    { name: "Nivea Sun Protect & Moisture Balsam do opalania SPF 50", accepted: false },
    { name: "Nivea Sun Kids Protect & Moisture Balsam do opalania SPF 30", accepted: false },
  ])("accepts $name for the SPF 30 balm: $accepted", ({ name, accepted }) => {
    const item = named("S1", name, [], "200 ml");

    expect(pickMatch(spf30, [item]).kind).toBe(accepted ? "accepted" : "choose");
  });

  it("never accepts a name that shares only one word with the product's, though it has no other", () => {
    const item = named("58823", "Nivea Soft (Pudełko)");

    expect(pickMatch(product, [item])).toEqual({ kind: "choose", options: [alike(item)] });
  });

  // Rossmann's Sky High mascaras (rossmann-search-maybelline-lash-sensational.json), which differ only in their
  // captions, where Rossmann keeps the shade and writes "tusz do rzęs", and Super-Pharm's names for them.
  const skyHigh = (caption: string, ean: string): NamedProduct => ({
    brand: "Maybelline New York",
    name: "Lash Sensational Sky High",
    caption,
    eans: [ean],
    size: sizeOf("7,2 ml"),
  });
  const brown = skyHigh("tusz do rzęs, Brown", "30147317");
  const cosmicBlack = skyHigh("tusz do rzęs, wydłużający, Cosmic Black", "30152830");
  const blackMascara = skyHigh("tusz do rzęs, wydłużający, Black", "30166967");
  const mascara = (shopItemId: string, name: string) => named(shopItemId, name, [], "7.2 ml", "Maybelline");
  const black = mascara("67655", "Maybelline Lash Sensational Sky High Tusz do rzęs Black");
  const cosmic = mascara("84422", "Maybelline Mascara Lash Sensational Sky High Cosmic Black");
  // An antiperspirant, which Super-Pharm calls "Deo".
  const dermaControl: NamedProduct = {
    brand: "NIVEA",
    name: "Derma Control Clinical",
    caption: "antyperspirant w sprayu, dla kobiet, Ultra Soft",
    eans: ["5900017107400"],
    size: sizeOf("150 ml"),
  };

  it.each([
    { words: "the packaging, „(Pudełko)”", own: product, item: soft },
    { words: "„Mascara”", own: brown, item: mascara("99681", "Maybelline Mascara Lash Sensational Sky High Brown") },
    { words: "„Maskara”", own: brown, item: mascara("99681", "Maybelline Maskara Lash Sensational Sky High Brown") },
    {
      words: "„Tusz do rzęs”",
      own: brown,
      item: mascara("99681", "Maybelline Lash Sensational Sky High Tusz do rzęs Brown"),
    },
    {
      words: "„Deo”",
      own: dermaControl,
      item: named("148290", "Nivea Deo Derma Control Clinical Ultra Soft", [], "150 ml"),
    },
    {
      words: "the product's brand's „New York”",
      own: brown,
      item: mascara("99681", "Maybelline New York Lash Sensational Sky High Brown"),
    },
    {
      words: "the item's own brand's „Men”",
      own: product,
      item: named("47977", "Nivea Men Soft Krem nawilżający", [], "300 ml", "NIVEA MEN"),
    },
  ])("sets $words aside", ({ own, item }) => {
    expect(pickMatch(own, [item])).toEqual({ kind: "accepted", candidate: item });
  });

  it("reads the product's caption beside its name, where Rossmann keeps the shade", () => {
    const item = mascara("99681", "Maybelline Mascara Lash Sensational Sky High Brown");

    expect(pickMatch(brown, [item])).toEqual({ kind: "accepted", candidate: item });
    // Without the caption, "Brown" is a word the product lacks.
    expect(pickMatch({ ...brown, caption: null }, [item]).kind).toBe("choose");
  });

  it("accepts the passing item whose words include every other passing item's: Cosmic Black over Black", () => {
    expect(pickMatch(cosmicBlack, [black, cosmic])).toEqual({ kind: "accepted", candidate: cosmic });
  });

  it("accepts Black for the Black mascara, whose words lack the other's „Cosmic”", () => {
    expect(pickMatch(blackMascara, [black, cosmic])).toEqual({ kind: "accepted", candidate: black });
  });

  it("never accepts a plainer sibling for an answer without the product: Black is no Cosmic Black", () => {
    // Every word of its name is the Cosmic Black mascara's, but it lacks „Cosmic”, which the caption marks.
    expect(pickMatch(cosmicBlack, [black])).toEqual({ kind: "choose", options: [alike(black)] });
  });

  it("never accepts an item that has none of the words of the product's own name, only its caption's", () => {
    const spray = named("D1", "Nivea Antyperspirant w sprayu", [], "150 ml");

    expect(pickMatch(dermaControl, [spray])).toEqual({ kind: "choose", options: [alike(spray)] });
  });

  // A day cream whose strength the caption writes with a digit.
  const dailyUv: NamedProduct = {
    brand: "NIVEA",
    name: "Soft Daily UV",
    caption: "krem uniwersalny, nawilżający, SPF15",
    eans: [],
    size: sizeOf("100 ml"),
  };

  it.each([
    { name: "Nivea Soft Daily UV Krem nawilżający SPF15", accepted: true },
    // Every word is the product's, but „SPF15” is missing.
    { name: "Nivea Soft Krem nawilżający (Pudełko)", accepted: false },
    { name: "Nivea Soft Daily UV Krem", accepted: false },
  ])("accepts $name for the SPF15 cream only with each word its caption marks: $accepted", ({ name, accepted }) => {
    const item = named("U1", name, [], "100 ml");

    expect(pickMatch(dailyUv, [item]).kind).toBe(accepted ? "accepted" : "choose");
  });

  it.each([
    {
      why: "the same words, as one item listed twice",
      own: blackMascara,
      items: [black, mascara("67656", "Maybelline Mascara Lash Sensational Sky High Black")],
      chosen: ["67655", "67656"],
    },
    {
      why: "each a word the other lacks, though one has more",
      own: product,
      items: [named("NV1", "Nivea Soft nawilżający"), named("NV2", "Nivea Soft Krem uniwersalny")],
      chosen: ["NV2", "NV1"],
    },
  ])("leaves two passing items to the user when neither covers the other: $why", ({ own, items, chosen }) => {
    // The one with more shared words first.
    expect(chosenIds(own, items)).toEqual(chosen);
  });
});

// Natura's and Super-Pharm's answers to „nivea soft”, recorded on 2026-10-06 at 10:37 UTC for add-from-other-shops (its
// recordings natura-search-nivea-soft.json and super-pharm-search-nivea-soft.json), as each shop's adapter reads them:
// every candidate, in the shop's order, with the fields the rule reads. Natura's carry one EAN each and Super-Pharm's
// none, and four of Super-Pharm's have no size: a lip balm without one, two multipacks and a set.
const naturaItem = (shopItemId: string, name: string, sizeText: string, ean: string): ShopCandidate => ({
  ...named(shopItemId, name, [ean], sizeText),
  shop: "natura",
});
const superPharmItem = (shopItemId: string, name: string, sizeText: string | null): ShopCandidate => ({
  ...named(shopItemId, name, [], sizeText, "Nivea"),
  shop: "super-pharm",
});
const NATURA_NIVEA_SOFT = [
  naturaItem("NV89063", "NIVEA SOFT krem intensywnie nawilżający 300 ml", "300 ml", "4005900009319"),
  naturaItem("NV890500", "NIVEA SOFT krem intensywnie nawilżający 200 ml", "200 ml", "4005900008299"),
  naturaItem("NV80758", "Nivea Creme Soft żel pod prysznic 500ml", "500 ml", "9005800282503"),
  naturaItem("NV89059", "NIVEA SOFT krem intensywnie nawilżający 100 ml", "100 ml", "4005900009074"),
  naturaItem("NV19891", "Nivea Soft krem do ciała i rąk nawilżający 50 ml", "50 ml", "42419891"),
  naturaItem("NV84067", "Nivea Creme Soft żel pod prysznic opakowanie uzupełniające 500 ml", "500 ml", "4006000184067"),
  naturaItem("NV18540", "Nivea Creme Soft Kremowy ŻEL POD Prysznic 750 ml", "750 ml", "9005800218540"),
  naturaItem("NV74420", "NIVEA BABY Soft & Cream chusteczki 4 x 57 sztuk", "228 szt", "9005800374420"),
  naturaItem("NV80643", "Nivea Soft krem nawilżający do ciała rąk i twarzy 500 ml", "500 ml", "9005800380643"),
];
const SUPER_PHARM_NIVEA_SOFT = [
  superPharmItem("10132", "Nivea Soft Krem nawilżający (Pudełko)", "300 ml"),
  superPharmItem("145460", "Nivea Soft Krem Intensywnie nawilżający SPF15, 200ml", "200 ml"),
  superPharmItem("145461", "Nivea Soft Krem Intensywnie nawilżający SPF15, 100ml", "100 ml"),
  superPharmItem("10139", "Nivea Lip Care Soft Rose", null),
  superPharmItem("122310", "Nivea Baby Chusteczki biodegradowalne Soft & Cream 4x57 szt.", null),
  superPharmItem("122353", "Nivea Baby Chusteczki biodegradowalne Soft&Cream 2x57 szt.", null),
  superPharmItem("20461", "Nivea Żel pod prysznic Creme Soft", "500 ml"),
  superPharmItem("20377", "Nivea Żel pod prysznic Creme Soft", "750 ml"),
  superPharmItem("186276", "Nivea Żel pod prysznic Creme Soft Refill, 500 ml", "500 ml"),
  superPharmItem("163025", "Nivea Zestaw Timeless: Deo AP 50 ml + Krem Soft 100 ml + SG 250 ml", null),
];

/**
 * A recorded candidate as the product "Dodaj" adds from its shop: without a caption, which only Rossmann writes apart
 * from the name.
 */
function addedFrom(items: ShopCandidate[], shopItemId: string): NamedProduct {
  const item = items.find((each) => each.shopItemId === shopItemId);
  if (item === undefined) {
    throw new Error(`no recorded item ${shopItemId}`);
  }
  return { brand: item.brand, name: item.name, caption: null, eans: item.eans, size: item.size };
}

// The owner's call of 2026-10-08: a product without a caption has no marked words, so every word of its name is one
// that tells it apart. Each product below is an item of one of the recorded answers, judged against the other's.
describe("pickMatch: by name, for a product without a caption", () => {
  it.each([
    {
      product: "Natura's refill NV84067",
      own: addedFrom(NATURA_NIVEA_SOFT, "NV84067"),
      items: SUPER_PHARM_NIVEA_SOFT,
      sibling: "the bottle 20461",
      lacks: "„opakowanie uzupełniające”",
      // Super-Pharm's refill, 186276, second: its „Refill” is a word the product's name lacks.
      chosen: ["20461", "186276", "10132"],
    },
    {
      product: "Super-Pharm's refill 186276",
      own: addedFrom(SUPER_PHARM_NIVEA_SOFT, "186276"),
      items: NATURA_NIVEA_SOFT,
      sibling: "the bottle NV80758",
      lacks: "„Refill”",
      // Natura's refill, NV84067, second: its „opakowanie uzupełniające” are words the product's name lacks.
      chosen: ["NV80758", "NV84067", "NV80643"],
    },
    {
      product: "Super-Pharm's SPF15 cream in 200 ml 145460",
      own: addedFrom(SUPER_PHARM_NIVEA_SOFT, "145460"),
      items: NATURA_NIVEA_SOFT,
      sibling: "the plain cream NV890500",
      lacks: "„SPF15”",
      // Natura's answer holds no SPF15 cream.
      chosen: ["NV890500", "NV89063", "NV80758"],
    },
    {
      product: "Super-Pharm's SPF15 cream in 100 ml 145461",
      own: addedFrom(SUPER_PHARM_NIVEA_SOFT, "145461"),
      items: NATURA_NIVEA_SOFT,
      sibling: "the plain cream NV89059",
      lacks: "„SPF15”",
      chosen: ["NV89059", "NV89063", "NV890500"],
    },
  ])(
    "leaves $product to the user, $sibling first, though every word of its name is the product's: it lacks $lacks",
    ({ own, items, chosen }) => {
      // The name check accepted the plainer sibling on its own before the owner's call.
      expect(chosenIds(own, items)).toEqual(chosen);
    },
  );

  it.each([
    {
      product: "Natura's Nivea Soft in 300 ml NV89063",
      own: addedFrom(NATURA_NIVEA_SOFT, "NV89063"),
      lacks: "„intensywnie”",
      chosen: ["10132", "145460", "145461"],
    },
    {
      product: "Natura's Creme Soft shower gel in 750 ml NV18540",
      own: addedFrom(NATURA_NIVEA_SOFT, "NV18540"),
      lacks: "„Kremowy”",
      chosen: ["20377", "10132", "145460"],
    },
  ])(
    "leaves $product to the user with the right item first, since that item's name lacks $lacks: the rule's cost",
    ({ own, chosen }) => {
      expect(chosenIds(own, SUPER_PHARM_NIVEA_SOFT)).toEqual(chosen);
    },
  );

  it.each([
    {
      product: "Super-Pharm's shower gel in 500 ml 20461",
      own: addedFrom(SUPER_PHARM_NIVEA_SOFT, "20461"),
      items: NATURA_NIVEA_SOFT,
      accepted: "NV80758",
    },
    {
      product: "Natura's shower gel in 500 ml NV80758",
      own: addedFrom(NATURA_NIVEA_SOFT, "NV80758"),
      items: SUPER_PHARM_NIVEA_SOFT,
      accepted: "20461",
    },
  ])("accepts $accepted for $product: every word of the name, and no other", ({ own, items, accepted }) => {
    // The other items of its size each have a word it lacks: Natura's refill and body cream, Super-Pharm's refill.
    expect(pickMatch(own, items)).toMatchObject({ kind: "accepted", candidate: { shopItemId: accepted } });
  });

  it.each([
    { caption: null, kind: "choose" },
    { caption: "", kind: "choose" },
    { caption: "   ", kind: "choose" },
    { caption: " – ", kind: "choose" },
    // A caption with words keeps the rule of a caption, whose marked words are only those it capitalises or writes with
    // a digit: here none, so one word of the name is enough, and the bottle passes as it did before the owner's call.
    { caption: "żel pod prysznic", kind: "accepted" },
  ])("marks every word of the refill's name only without a caption: $caption gives $kind", ({ caption, kind }) => {
    const own = { ...addedFrom(NATURA_NIVEA_SOFT, "NV84067"), caption };

    expect(pickMatch(own, SUPER_PHARM_NIVEA_SOFT)).toMatchObject(
      kind === "accepted" ? { kind, candidate: { shopItemId: "20461" } } : { kind },
    );
  });
});

describe("orderChoice: the choice's order by name fit", () => {
  // None of these passes the name check; each one without an EAN has a word the product lacks, or shares but one.
  const qualifying = candidate("Q1", [SOFT_EAN], "300 ml");
  const otherEan = candidate("O1", [OTHER_EAN], "300 ml");
  const otherSize = named("R1", "Nivea Soft Krem nawilżający", [], "200 ml");
  const twoWithTwoMore = named("N1", "Nivea Soft Krem SPF 15");
  const oneWord = named("N2", "Nivea Krem Mini");
  const threeWithOneMore = named("N3", "Nivea Soft Krem nawilżający Duo");
  const alsoTwoWithTwoMore = named("N4", "Nivea Soft Krem Vege Bio");
  const twoWithOneMore = named("N5", "Nivea Soft Krem Vege");
  // In the shop's order.
  const found = [
    otherEan,
    otherSize,
    twoWithTwoMore,
    oneWord,
    qualifying,
    threeWithOneMore,
    alsoTwoWithTwoMore,
    twoWithOneMore,
  ];

  it("orders every candidate: by EAN, then by name fit, then the other look-alikes, then the rest", () => {
    const ids = orderChoice(product, found).map((option) => option.candidate.shopItemId);

    // More shared words first, then fewer words the product lacks (N5 ahead of N1 and N4), then the shop's order (N1
    // ahead of N4, which fit as well).
    expect(ids).toEqual(["Q1", "N3", "N5", "N1", "N4", "N2", "O1", "R1"]);
  });

  it("gives each candidate its verdict, as a choice offers it", () => {
    expect(orderChoice(product, [otherSize, qualifying])).toEqual([
      alike(qualifying, true),
      { candidate: otherSize, verdict: { sharesEan: false, size: "differs", brand: "agrees" } },
    ]);
  });

  it("is the order pickMatch offers its choice in, cut to the limit", () => {
    const withoutQualifying = found.filter((item) => item !== qualifying);

    expect(chosenIds(product, withoutQualifying)).toEqual(["N3", "N5", "N1"]);
    expect(chosenIds(product, withoutQualifying, 10)).toEqual(
      orderChoice(product, withoutQualifying).map((option) => option.candidate.shopItemId),
    );
  });
});

describe("matchDifferences", () => {
  /** A matched item of the given brand and size text, its size parsed from the text as the adapter does. */
  const itemOf = (brand: string | null, sizeText: string | null) => ({ brand, size: parseSize(sizeText) });

  it.each([
    { brand: "NIVEA", sizeText: "300 ml", differences: { size: false, brand: false } },
    { brand: "Nivea Men", sizeText: "0,3 l", differences: { size: false, brand: false } },
    { brand: "NIVEA", sizeText: "200 ml", differences: { size: true, brand: false } },
    { brand: "YOPE", sizeText: "300 ml", differences: { size: false, brand: true } },
    { brand: "YOPE", sizeText: "200 ml", differences: { size: true, brand: true } },
  ])("compares NIVEA 300 ml with $brand $sizeText as $differences", ({ brand, sizeText, differences }) => {
    expect(matchDifferences(product, itemOf(brand, sizeText))).toEqual(differences);
  });

  it.each([
    { why: "the item's brand and size are unknown", own: product, item: itemOf(null, null) },
    { why: "the item's brand is blank and its size can't be read", own: product, item: itemOf("  ", "4x57 szt.") },
    { why: "nothing is known of the product", own: { brand: null, size: null }, item: itemOf("YOPE", "200 ml") },
  ])("reports no difference when $why", ({ own, item }) => {
    expect(matchDifferences(own, item)).toEqual({ size: false, brand: false });
  });
});
