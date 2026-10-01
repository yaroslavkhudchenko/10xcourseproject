import { describe, expect, it } from "vitest";
import { brandsAgree, judge, matchDifferences, pickMatch, sizesEqual } from "@/lib/services/matching";
import { parseSize } from "@/lib/services/size";
import type { ShopCandidate, Size } from "@/types";

function sizeOf(text: string): Size {
  const size = parseSize(text);
  if (!size) {
    throw new Error(`${text} doesn't parse`);
  }
  return size;
}

// Rossmann's Nivea Soft 300 ml, with the first two of its EANs (rossmann-search-results.json).
const SOFT_EAN = "4005900009319";
const SECOND_EAN = "4005808890637";
const OTHER_EAN = "5900168900370";
const product = { brand: "NIVEA", eans: [SOFT_EAN, SECOND_EAN], size: sizeOf("300 ml") };

/**
 * A Natura candidate with the given SKU, EANs and size text, its size parsed from the text as the adapter does, of
 * NIVEA unless another brand is given.
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
