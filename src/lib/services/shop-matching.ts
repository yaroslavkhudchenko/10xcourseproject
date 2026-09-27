import { pickMatch, type MatchPick, type MatchProduct } from "@/lib/services/matching";
import { toShopQuery } from "@/lib/services/search-query";
import type { ShopGate } from "@/lib/services/shop-gate";
import { searchNatura } from "@/lib/services/shops/natura";
import type { ShopLookup } from "@/types";

// How many hits each Natura search asks for: an EAN names one product, while a name search brings look-alikes too.
const EAN_HITS = 5;
const NAME_HITS = 10;
// Only an EAN of 8-14 digits, the form the watchlist stores, goes into a shop URL.
const EAN = /^\d{8,14}$/;

/** A watched product, as a shop lookup needs it. */
export interface LookupProduct extends MatchProduct {
  brand: string | null;
  name: string;
  sizeText: string | null;
}

/**
 * Looks a watched product up in Natura with as few requests as possible: by its EAN first, then with one search by its
 * brand, name and size only when the EAN finds nothing. When Natura can't be asked, it makes no further request and
 * says why. It never throws.
 */
export async function lookupInNatura(gate: ShopGate, product: LookupProduct): Promise<ShopLookup> {
  const ean = product.eans.find((value) => EAN.test(value));
  if (ean !== undefined) {
    const search = await searchNatura(gate, ean, EAN_HITS);
    if (search.kind === "unavailable") {
      return search;
    }
    const found = toLookup(pickMatch(product, search.candidates), "ean");
    if (found) {
      return found;
    }
  }

  const query = toShopQuery([product.brand, product.name, product.sizeText].filter((part) => part !== null).join(" "));
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

  logNothingFound(ean !== undefined, query !== null);
  return { kind: "not-found" };
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

function logNothingFound(searchedByEan: boolean, searchedByName: boolean): void {
  // Which searches ran, never what they asked for: a watched product is its user's own data.
  const entry = { event: "natura-lookup", reason: "nothing found for the EAN or name", searchedByEan, searchedByName };
  // eslint-disable-next-line no-console -- one line per lookup that found nothing; Workers observability collects it.
  console.warn(JSON.stringify(entry));
}
