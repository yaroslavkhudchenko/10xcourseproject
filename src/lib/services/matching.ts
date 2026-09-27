import type { CandidateOption, CandidateVerdict, ShopCandidate, Size } from "@/types";

// The matching rule (FR-006), without I/O: a shop's candidate is the watched product when it shares one of the
// product's EANs and has the same size. Exactly one such candidate is accepted without asking; everything else is the
// user's choice, because no shop's EANs are trusted on their own (research note §7: Hebe's were wrong).

/** The watched product, as far as the rule looks at it. */
export interface MatchProduct {
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

/** How a candidate compares with the product. A size missing on either side can't be compared, so it's `unknown`. */
export function judge(product: MatchProduct, candidate: ShopCandidate): CandidateVerdict {
  const sharesEan = product.eans.some((ean) => candidate.eans.includes(ean));
  if (product.size === null || candidate.size === null) {
    return { sharesEan, size: "unknown" };
  }
  return { sharesEan, size: sizesEqual(product.size, candidate.size) ? "equal" : "differs" };
}

/**
 * Accepts the only candidate that shares an EAN and the size. Otherwise the user chooses from up to `limit`
 * candidates: the ones that qualify first (two of them are ambiguous), then the rest in the shop's order.
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

function qualifies(verdict: CandidateVerdict): boolean {
  return verdict.sharesEan && verdict.size === "equal";
}
