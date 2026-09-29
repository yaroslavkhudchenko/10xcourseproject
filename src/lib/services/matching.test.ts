import { describe, expect, it } from "vitest";
import { judge, pickMatch, sizesEqual } from "@/lib/services/matching";
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
const product = { eans: [SOFT_EAN, SECOND_EAN], size: sizeOf("300 ml") };

/** A Natura candidate with the given SKU, EANs and size text, its size parsed from the text as the adapter does. */
function candidate(shopItemId: string, eans: string[], sizeText: string | null): ShopCandidate {
  return {
    shop: "natura",
    shopItemId,
    brand: "NIVEA",
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

describe("judge", () => {
  it.each([
    { eans: [SOFT_EAN], sizeText: "300 ml", verdict: { sharesEan: true, size: "equal" } },
    { eans: [OTHER_EAN, SECOND_EAN], sizeText: "0,3 l", verdict: { sharesEan: true, size: "equal" } },
    { eans: [OTHER_EAN], sizeText: "500 ml", verdict: { sharesEan: false, size: "differs" } },
    { eans: [], sizeText: "4x57 szt.", verdict: { sharesEan: false, size: "unknown" } },
  ])("judges EANs $eans and $sizeText as $verdict", ({ eans, sizeText, verdict }) => {
    expect(judge(product, candidate("NV89063", eans, sizeText))).toEqual(verdict);
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

  it("leaves two qualifying candidates to the user, ahead of the rest", () => {
    const first = candidate("NV89063", [SOFT_EAN], "300 ml");
    const other = candidate("JM00370", [OTHER_EAN], "300 ml");
    const second = candidate("NV89064", [SECOND_EAN], "300 ml");

    expect(pickMatch(product, [first, other, second])).toEqual({
      kind: "choose",
      options: [
        { candidate: first, verdict: { sharesEan: true, size: "equal" } },
        { candidate: second, verdict: { sharesEan: true, size: "equal" } },
        { candidate: other, verdict: { sharesEan: false, size: "equal" } },
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
      options: [{ candidate: shared, verdict: { sharesEan: true, size: verdict } }],
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
