import { judge, pickMatch, type MatchPick, type MatchProduct } from "@/lib/services/matching";
import { toShopQuery } from "@/lib/services/search-query";
import type { ShopGate } from "@/lib/services/shop-gate";
import { searchNatura } from "@/lib/services/shops/natura";
import type { CandidateOption, NaturaChoices, ShopCandidate, ShopLookup, ShopUnavailable } from "@/types";

// How many hits each Natura search asks for: an EAN names one product, while a name search brings look-alikes too.
const EAN_HITS = 5;
const NAME_HITS = 10;
// Only an EAN of 8-14 digits, the form the watchlist stores, goes into a shop URL.
const EAN = /^\d{8,14}$/;
// The most candidates a choice for changing a decision offers: the EAN search's first, then the name search's.
const CHOICES = 6;

/** A watched product, as a shop lookup needs it. */
export interface LookupProduct extends MatchProduct {
  name: string;
  sizeText: string | null;
}

/**
 * Looks a watched product up in Natura with as few requests as possible: by its EAN first, then with one search by its
 * brand, name and size only when the EAN finds nothing. When Natura can't be asked, it makes no further request and
 * says why. It never throws.
 */
export async function lookupInNatura(gate: ShopGate, product: LookupProduct): Promise<ShopLookup> {
  const ean = lookupEan(product);
  if (ean !== null) {
    const search = await searchNatura(gate, ean, EAN_HITS);
    if (search.kind === "unavailable") {
      return search;
    }
    const found = toLookup(pickMatch(product, search.candidates), "ean");
    if (found) {
      return found;
    }
  }

  const query = nameQuery(product);
  if (query !== null) {
    const search = await searchNatura(gate, query, NAME_HITS);
    if (search.kind === "unavailable") {
      return search;
    }
    const found = toLookup(pickMatch(product, search.candidates), "name");
    if (found) {
      return found;
    }
  }

  logNothingFound(ean !== null, query !== null);
  return { kind: "not-found" };
}

/**
 * Looks a watched product up in Natura again, for the user to change its stored decision: by its EAN, then by its
 * brand, name and size, one search after the other, since the EAN search can return another product than the one the
 * user meant. It never accepts a candidate on its own: every candidate is judged and offered, each item once, the EAN
 * search's first, at most six. When the EAN search gets no answer (busy, paused, stopped or failed), it asks nothing
 * more and says why. A name search without an answer leaves the EAN search's candidates incomplete, or, after an EAN
 * search that found none or didn't run, says why too: nothing found is only what every search that ran answered.
 * Without a usable EAN or name, that search is skipped, and without either nothing is asked. It never throws.
 */
export async function lookupChoicesInNatura(gate: ShopGate, product: LookupProduct): Promise<NaturaChoices> {
  const ean = lookupEan(product);
  let byEan: ShopCandidate[] = [];
  if (ean !== null) {
    const search = await searchNatura(gate, ean, EAN_HITS);
    if (search.kind === "unavailable") {
      // A name search could only spend the cap again, or reach a shop that has just refused.
      return search;
    }
    byEan = search.candidates;
  }

  const query = nameQuery(product);
  let byName: ShopCandidate[] = [];
  let incomplete: ShopUnavailable | null = null;
  if (query !== null) {
    const search = await searchNatura(gate, query, NAME_HITS);
    if (search.kind === "unavailable") {
      // Without the EAN search's candidates there's nothing to offer, and a search without an answer never reads as
      // nothing found.
      if (byEan.length === 0) {
        return search;
      }
      incomplete = search;
    } else {
      byName = search.candidates;
    }
  }

  const options = onceEach([...byEan, ...byName])
    .slice(0, CHOICES)
    .map((candidate): CandidateOption => ({ candidate, verdict: judge(product, candidate) }));
  if (options.length === 0) {
    logNothingFound(ean !== null, query !== null);
    return { kind: "not-found" };
  }
  return { kind: "choices", options, via: foundBy(byEan.length > 0, byName.length > 0), incomplete };
}

/** The product's first EAN that may go into a shop URL, or null without one. */
function lookupEan(product: LookupProduct): string | null {
  return product.eans.find((value) => EAN.test(value)) ?? null;
}

/** What a search by name asks for: the product's brand, name and size as shop search text, or null when it can't. */
function nameQuery(product: LookupProduct): string | null {
  return toShopQuery([product.brand, product.name, product.sizeText].filter((part) => part !== null).join(" "));
}

/** The lookup's answer for one search's pick, or null when that search found nothing. */
function toLookup(pick: MatchPick, via: "ean" | "name"): ShopLookup | null {
  switch (pick.kind) {
    case "accepted":
      return { kind: "accepted", candidate: pick.candidate };
    case "choose":
      return { kind: "choose", options: pick.options, via };
    case "none":
      return null;
  }
}

/** The candidates with each item once, by its id, where it first appears. */
function onceEach(candidates: ShopCandidate[]): ShopCandidate[] {
  const seen = new Set<string>();
  return candidates.filter(({ shopItemId }) => {
    if (seen.has(shopItemId)) {
      return false;
    }
    seen.add(shopItemId);
    return true;
  });
}

/** Which searches found a choice's candidates, at least one of them. */
function foundBy(byEan: boolean, byName: boolean): "ean" | "name" | "both" {
  if (byEan && byName) {
    return "both";
  }
  return byEan ? "ean" : "name";
}

function logNothingFound(searchedByEan: boolean, searchedByName: boolean): void {
  // Which searches ran, never what they asked for: a watched product is its user's own data.
  const entry = { event: "natura-lookup", reason: "nothing found for the EAN or name", searchedByEan, searchedByName };
  // eslint-disable-next-line no-console -- one line per lookup that found nothing; Workers observability collects it.
  console.warn(JSON.stringify(entry));
}
