import type { CandidateOption, CandidateVerdict, ShopCandidate, Size } from "@/types";

// The matching rule (FR-006), without I/O: a shop's candidate is the watched product when it shares one of the
// product's EANs and has the same size, and its brand doesn't contradict the product's. Exactly one such candidate is
// accepted without asking; everything else is the user's choice, because no shop's EANs are trusted on their own
// (research note §2.2: one EAN can come with another size). Brands are compared leniently (brandsAgree), and a brand
// missing on either side says nothing, so only a brand that definitely differs stops an automatic match. The same
// comparisons tell what differs about a saved match (FR-007, matchDifferences).

/** The watched product, as far as the rule looks at it. */
export interface MatchProduct {
  brand: string | null;
  eans: string[];
  size: Size | null;
}

/** What the rule makes of one shop's candidates: the match, options for the user, or nothing to choose from. */
export type MatchPick =
  { kind: "accepted"; candidate: ShopCandidate } | { kind: "choose"; options: CandidateOption[] } | { kind: "none" };

/**
 * True for the same amount in the same unit. The 0.1 % tolerance absorbs float noise, such as (0.1 + 0.2) × 1000 =
 * 300.00000000000006, and no difference a shop would sell as another size.
 */
export function sizesEqual(a: Size, b: Size): boolean {
  return a.unit === b.unit && Math.abs(a.value - b.value) <= 0.001 * Math.max(a.value, b.value);
}

/**
 * A brand as the rule compares it: decomposed (NFKD) without its combining marks, so "é" reads as "e"; in lower case by
 * Polish rules, so "Ł", which doesn't decompose, reads as "ł"; and only its letters and digits, so "L'Oréal Paris"
 * reads as "lorealparis". Null for a brand that's missing or has nothing left.
 */
function brandKey(brand: string | null): string | null {
  if (brand === null) {
    return null;
  }
  const key = brand
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pl-PL")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return key === "" ? null : key;
}

/**
 * Whether two brands agree, by the lenient rule: once both are normalised (brandKey), one starts with the other, so
 * "NIVEA" agrees with "nivea" and with its sub-brand "NIVEA MEN". Null when either is missing or blank, which says
 * nothing either way. A word in front of a brand reads as another brand: "Dr Irena Eris" differs from "IRENA ERIS".
 */
export function brandsAgree(a: string | null, b: string | null): boolean | null {
  const left = brandKey(a);
  const right = brandKey(b);
  if (left === null || right === null) {
    return null;
  }
  return left.startsWith(right) || right.startsWith(left);
}

/**
 * How a candidate compares with the product. A size or a brand missing on either side can't be compared, so it's
 * `unknown`.
 */
export function judge(product: MatchProduct, candidate: ShopCandidate): CandidateVerdict {
  const sharesEan = product.eans.some((ean) => candidate.eans.includes(ean));
  const agree = brandsAgree(product.brand, candidate.brand);
  const brand = agree === null ? "unknown" : agree ? "agrees" : "differs";
  if (product.size === null || candidate.size === null) {
    return { sharesEan, size: "unknown", brand };
  }
  return { sharesEan, size: sizesEqual(product.size, candidate.size) ? "equal" : "differs", brand };
}

/**
 * Accepts the only candidate that shares an EAN and the size, unless its brand differs. Otherwise the user chooses from
 * up to `limit` candidates: the ones that qualify first (two of them are ambiguous), then the rest in the shop's order.
 */
export function pickMatch(product: MatchProduct, candidates: ShopCandidate[], limit = 3): MatchPick {
  if (candidates.length === 0) {
    return { kind: "none" };
  }
  const judged = candidates.map((candidate) => ({ candidate, verdict: judge(product, candidate) }));
  const qualifying = judged.filter((option) => qualifies(option.verdict));
  if (qualifying.length === 1) {
    return { kind: "accepted", candidate: qualifying[0].candidate };
  }
  const others = judged.filter((option) => !qualifies(option.verdict));
  return { kind: "choose", options: [...qualifying, ...others].slice(0, limit) };
}

/** A candidate the rule may accept on its own: a shared EAN and the same size, with no brand that contradicts them. */
function qualifies(verdict: CandidateVerdict): boolean {
  return verdict.sharesEan && verdict.size === "equal" && verdict.brand !== "differs";
}

/**
 * What definitely differs between the watched product and a matched item, for the warnings a saved match shows: the
 * size when both are known and differ, and the brand when both are known and don't agree (brandsAgree). Nothing that
 * is unknown counts, so a match is suspicious only on a definite mismatch.
 */
export function matchDifferences(
  own: Pick<MatchProduct, "brand" | "size">,
  item: Pick<MatchProduct, "brand" | "size">,
): { size: boolean; brand: boolean } {
  return {
    size: own.size !== null && item.size !== null && !sizesEqual(own.size, item.size),
    brand: brandsAgree(own.brand, item.brand) === false,
  };
}
