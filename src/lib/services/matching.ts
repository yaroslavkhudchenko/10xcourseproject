import type { CandidateOption, CandidateVerdict, ShopCandidate, Size } from "@/types";

// The matching rule (FR-006), without I/O. A shop's candidate is accepted without asking in one of two ways:
// - By EAN: it's the only candidate that shares one of the product's EANs and has the same size, and its brand doesn't
//   contradict the product's. Two such candidates are ambiguous.
// - By name, only when no candidate qualifies by EAN, and only where EANs can't decide: a candidate in the product's
//   size whose brand doesn't contradict it, when it or the product has no EAN, as no Super-Pharm item has (research
//   note §2.3). Its name passes when each of its words is in the product's name or caption, where Rossmann keeps the
//   shade or the scent, and at least two are. The passing candidate whose words include every other passing one's,
//   and more, is accepted, so "Cosmic Black" wins over "Black" for a Cosmic Black mascara, and so is a lone one.
// Everything else is the user's choice: no shop's EANs are trusted on their own (research note §2.2: one EAN can come
// with another size), and a name with a word the product lacks may be another shade, scent or strength.
//
// A text's words: its sizes ("300 ml", "4,8 g") go, the rest is folded as brands are and split at anything but letters
// and digits, and three short lists are set aside: small words, words for a kind of product that shops write
// differently, and packaging (SMALL_WORDS, KIND_WORDS, PACKAGING_WORDS). The words of both brands are set aside on both
// sides. Numbers stay words, so "SPF 30" and "SPF 50" differ, as do two shades a number tells apart ("06 Burgundy").
//
// Brands are compared leniently (brandsAgree), and a brand missing on either side says nothing, so only a brand that
// definitely differs stops an automatic match. The same comparisons tell what differs about a saved match (FR-007,
// matchDifferences).

/** The watched product, as far as the rule's comparisons look at it. */
export interface MatchProduct {
  brand: string | null;
  eans: string[];
  size: Size | null;
}

/** The watched product as the whole rule reads it: with its name and caption, whose words the name check compares. */
export interface NamedProduct extends MatchProduct {
  name: string;
  caption: string | null;
}

/** What the rule makes of one shop's candidates: the match, options for the user, or nothing to choose from. */
export type MatchPick =
  { kind: "accepted"; candidate: ShopCandidate } | { kind: "choose"; options: CandidateOption[] } | { kind: "none" };

// The words the name check sets aside, as words read them: in lower case, without accents, with "ł" kept.
// Small words, which say nothing of a product.
const SMALL_WORDS = new Set(["do", "z", "ze", "i", "w", "we", "na", "dla", "od", "o", "oraz", "a"]);
// Words for a kind of product that shops write differently: Rossmann's "tusz do rzęs" is Super-Pharm's "Mascara" or
// "Maskara", and Super-Pharm's "Deo" is Rossmann's "antyperspirant".
const KIND_WORDS = new Set(["mascara", "maskara", "tusz", "rzes", "deo"]);
// Packaging, which Super-Pharm adds to a name, as in "Nivea Soft Krem nawilżający (Pudełko)".
const PACKAGING_WORDS = new Set(["pudełko"]);
// A size in a text: an amount, then its unit, as in "300 ml", "4,8 g", "0,5 l" or "10 szt.", never part of a word, so
// after the text's start or a character that's kept (`$1`). It has no lookbehind, which Safari before 16.4 can't
// parse: the islands load this module too.
const SIZE = /(^|[^\p{L}\p{N}])\d+(?:[.,]\d+)?\s*(?:ml|g|l|kg|mg|szt)(?![\p{L}\p{N}])/giu;
// The fewest words a passing name shares with the product's: one, such as "soft", says too little.
const SHARED_WORDS = 2;

/**
 * True for the same amount in the same unit. The 0.1 % tolerance absorbs float noise, such as (0.1 + 0.2) × 1000 =
 * 300.00000000000006, and no difference a shop would sell as another size.
 */
export function sizesEqual(a: Size, b: Size): boolean {
  return a.unit === b.unit && Math.abs(a.value - b.value) <= 0.001 * Math.max(a.value, b.value);
}

/**
 * A text as the rule compares it: decomposed (NFKD) without its combining marks, so "é" reads as "e"; and in lower
 * case by Polish rules, so "Ł", which doesn't decompose, reads as "ł".
 */
function folded(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("pl-PL");
}

/**
 * A brand as the rule compares it: folded, and only its letters and digits, so "L'Oréal Paris" reads as
 * "lorealparis". Null for a brand that's missing or has nothing left.
 */
function brandKey(brand: string | null): string | null {
  if (brand === null) {
    return null;
  }
  const key = folded(brand).replace(/[^\p{L}\p{N}]/gu, "");
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

/** True when the item carries one of the product's EANs. */
export function sharesAnEan(own: Pick<MatchProduct, "eans">, item: Pick<MatchProduct, "eans">): boolean {
  return own.eans.some((ean) => item.eans.includes(ean));
}

/**
 * How a candidate compares with the product. A size or a brand missing on either side can't be compared, so it's
 * `unknown`.
 */
export function judge(product: MatchProduct, candidate: ShopCandidate): CandidateVerdict {
  const sharesEan = sharesAnEan(product, candidate);
  const agree = brandsAgree(product.brand, candidate.brand);
  const brand = agree === null ? "unknown" : agree ? "agrees" : "differs";
  if (product.size === null || candidate.size === null) {
    return { sharesEan, size: "unknown", brand };
  }
  return { sharesEan, size: sizesEqual(product.size, candidate.size) ? "equal" : "differs", brand };
}

/**
 * Accepts the only candidate that qualifies by EAN: a shared EAN and the size, unless its brand differs. When none
 * does, it accepts the candidate that passes the name check ahead of every other, as the header says. Otherwise the
 * user chooses from up to `limit` candidates, in the choice's order (orderChoice). The name check never settles two
 * candidates that qualify by EAN, so a match it accepts shares no EAN with the product, which is how the match's card
 * tells it from one accepted by EAN (match-view.ts).
 */
export function pickMatch(product: NamedProduct, candidates: ShopCandidate[], limit = 3): MatchPick {
  if (candidates.length === 0) {
    return { kind: "none" };
  }
  const weighed = weigh(product, candidates);
  const qualifying = weighed.filter((option) => qualifies(option.verdict));
  if (qualifying.length === 1) {
    return { kind: "accepted", candidate: qualifying[0].candidate };
  }
  const byName = qualifying.length === 0 ? acceptedByName(weighed) : null;
  if (byName !== null) {
    return { kind: "accepted", candidate: byName };
  }
  return { kind: "choose", options: inChoiceOrder(weighed).slice(0, limit) };
}

/**
 * The candidates, each judged, in the order a choice offers them: those that qualify by EAN (two of them are
 * ambiguous); then those the name check may judge, the best name fit first: more words shared with the product, then
 * fewer words the product lacks; then the others in the product's size whose brand doesn't differ, then the rest. Each
 * group, and each equal fit, keeps the shop's order. A shop whose index holds no EAN has no candidate that qualifies, so
 * its best name fits lead its choice, and the right shade or scent among them.
 */
export function orderChoice(product: NamedProduct, candidates: ShopCandidate[]): CandidateOption[] {
  return inChoiceOrder(weigh(product, candidates));
}

/** A candidate the rule may accept on its own: a shared EAN and the same size, with no brand that contradicts them. */
function qualifies(verdict: CandidateVerdict): boolean {
  return verdict.sharesEan && verdict.size === "equal" && verdict.brand !== "differs";
}

/**
 * A candidate in the product's size whose brand doesn't contradict it. One that doesn't qualify then lacks only a
 * shared EAN, as every candidate of a shop whose index holds no EAN does: the likeliest of the rest.
 */
function looksAlike(verdict: CandidateVerdict): boolean {
  return verdict.size === "equal" && verdict.brand !== "differs";
}

/** How a candidate's name fits the product's name and caption: the words they share, and how many it has besides. */
interface NameFit {
  shared: Set<string>;
  extra: number;
}

/** A candidate as the rule weighs it: how it compares with the product, and how its name fits. */
interface Weighed extends CandidateOption {
  /**
   * How its name fits, for a candidate the name check may judge: one that looks alike where EANs can't decide, since
   * it or the product has none. Null for any other.
   */
  fit: NameFit | null;
}

/** The candidates judged, each with its name's fit when the name check may judge it. */
function weigh(product: NamedProduct, candidates: ShopCandidate[]): Weighed[] {
  const own = [...wordsOf(product.name), ...wordsOf(product.caption)];
  return candidates.map((candidate) => {
    const verdict = judge(product, candidate);
    const eanless = candidate.eans.length === 0 || product.eans.length === 0;
    return { candidate, verdict, fit: looksAlike(verdict) && eanless ? nameFit(product, own, candidate) : null };
  });
}

/** How the candidate's name fits the product's words (`own`), with the words of both brands set aside on both sides. */
function nameFit(product: NamedProduct, own: string[], candidate: ShopCandidate): NameFit {
  const brands = new Set([...wordsOf(product.brand), ...wordsOf(candidate.brand)]);
  const ownWords = new Set(own.filter((word) => !brands.has(word)));
  const theirs = new Set(wordsOf(candidate.name).filter((word) => !brands.has(word)));
  const shared = new Set([...theirs].filter((word) => ownWords.has(word)));
  return { shared, extra: theirs.size - shared.size };
}

/**
 * A text's words as the name check compares them, as the header says: without its sizes, folded, split at anything but
 * letters and digits, and without the words the lists set aside. None for a missing text.
 */
function wordsOf(text: string | null): string[] {
  if (text === null) {
    return [];
  }
  return folded(text.replace(SIZE, "$1 "))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "" && !SMALL_WORDS.has(word) && !KIND_WORDS.has(word) && !PACKAGING_WORDS.has(word));
}

/** True for a name that passes the name check: none of its words is missing from the product's, and two are shared. */
function passes(fit: NameFit): boolean {
  return fit.extra === 0 && fit.shared.size >= SHARED_WORDS;
}

/**
 * The candidate the name check accepts: the one passing candidate whose shared words include every other passing
 * candidate's and outnumber them, or the only one that passes. Null when none passes, or when no passing candidate is
 * ahead of every other, as two with the same words or two that neither covers aren't.
 */
function acceptedByName(weighed: Weighed[]): ShopCandidate | null {
  const passing = weighed.flatMap(({ candidate, fit }) => (fit !== null && passes(fit) ? [{ candidate, fit }] : []));
  const ahead = passing.find((option) =>
    passing.every((other) => other === option || covers(option.fit.shared, other.fit.shared)),
  );
  return ahead?.candidate ?? null;
}

/** True when `words` include every one of `others`, and more. */
function covers(words: Set<string>, others: Set<string>): boolean {
  return words.size > others.size && [...others].every((word) => words.has(word));
}

/** The weighed candidates in the choice's order (orderChoice), each as an option for the user. */
function inChoiceOrder(weighed: Weighed[]): CandidateOption[] {
  const qualifying = weighed.filter((option) => qualifies(option.verdict));
  const byFit = weighed
    .filter((option): option is Weighed & { fit: NameFit } => option.fit !== null)
    .sort((a, b) => b.fit.shared.size - a.fit.shared.size || a.fit.extra - b.fit.extra);
  const alike = weighed.filter(
    (option) => option.fit === null && looksAlike(option.verdict) && !qualifies(option.verdict),
  );
  const rest = weighed.filter((option) => !looksAlike(option.verdict));
  return [...qualifying, ...byFit, ...alike, ...rest].map(({ candidate, verdict }) => ({ candidate, verdict }));
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
