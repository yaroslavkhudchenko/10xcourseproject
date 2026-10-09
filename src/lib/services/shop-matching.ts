import type { SupabaseClient } from "@supabase/supabase-js";
import { decideMatchStep, type MatchStep } from "@/lib/services/match-step";
import {
  chooseView,
  decidedView,
  matchedView,
  notFoundView,
  promptView,
  repinView,
  storedView,
  type MatchRepin,
  type MatchView,
} from "@/lib/services/match-view";
import { recordLookup, type MatchesRead } from "@/lib/services/matches";
import {
  foldedWordsOf,
  judge,
  orderChoice,
  pickMatch,
  type MatchPick,
  type NamedProduct,
} from "@/lib/services/matching";
import { matchedShopsOf, SHOP_LABELS, type MatchableShop, type PricedShop } from "@/lib/services/price-comparison";
import { recordPriceChecks } from "@/lib/services/prices";
import { toShopQuery } from "@/lib/services/search-query";
import type { ShopGate } from "@/lib/services/shop-gate";
import { SHOP_ADAPTERS } from "@/lib/services/shops/registry";
import { splitTrailingSize } from "@/lib/services/size";
import type { ListFilter } from "@/lib/services/watchlist-rows";
import { shopUnavailableText } from "@/lib/shop-messages";
import type {
  CandidateOption,
  MatchedItem,
  RepinnableMatch,
  ShopCandidate,
  ShopChoices,
  ShopLookup,
  ShopUnavailable,
  WatchlistProduct,
} from "@/types";

// Looking a watched product up in a matched shop, through that shop's own adapter (SHOP_ADAPTERS), so every search is
// charged to the shop it asks. Within a shop the searches run one after the other. The product page's steps for its
// matched shops run here too (runMatchSteps): the shops at once, each one's searches and writes one after the other.

// How many hits each search asks for: an EAN names one product, while a name search brings look-alikes too.
const EAN_HITS = 5;
const NAME_HITS = 10;
// Only an EAN of 8-14 digits, the form the watchlist stores, goes into a shop URL.
const EAN = /^\d{8,14}$/;
// The most candidates a choice for changing a decision offers: the EAN search's first, then the name search's.
const CHOICES = 6;

/**
 * A watched product, as a shop lookup needs it: what the matching rule compares, its name and caption included, and
 * its size as text, which the search by name asks for.
 */
export interface LookupProduct extends NamedProduct {
  sizeText: string | null;
}

/**
 * Looks a watched product up in a shop with as few requests as possible: by its EAN first, then with one search by its
 * brand, name and size only when the EAN finds nothing. A shop whose search can't find an EAN (searchesByEan) gets the
 * search by name alone. Each search's candidates go to the matching rule (pickMatch), which accepts one that shares an
 * EAN and the size, or, where EANs can't decide, as for every Super-Pharm item, one that passes its name check against
 * the product's name and caption; otherwise the user chooses. When the shop can't be asked, it makes no further request
 * and says why. It never throws.
 */
export async function lookupInShop(shop: MatchableShop, gate: ShopGate, product: LookupProduct): Promise<ShopLookup> {
  const { search: searchShop } = SHOP_ADAPTERS[shop];
  const ean = lookupEan(shop, product);
  if (ean !== null) {
    const search = await searchShop(gate, ean, EAN_HITS);
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
    const search = await searchShop(gate, query, NAME_HITS);
    if (search.kind === "unavailable") {
      return search;
    }
    const found = toLookup(pickMatch(product, search.candidates), "name");
    if (found) {
      return found;
    }
  }

  logNothingFound(shop, ean !== null, query !== null);
  return { kind: "not-found" };
}

/**
 * Looks a watched product up in a shop again, for the user to change its stored decision: by its EAN, then by its
 * brand, name and size, one search after the other, since the EAN search can return another product than the one the
 * user meant. It never accepts a candidate on its own: every candidate is judged and offered, each item once, the EAN
 * search's first, at most six. When the EAN search gets no answer (busy, paused, stopped or failed), it asks nothing
 * more and says why. A name search without an answer leaves the EAN search's candidates incomplete, or, after an EAN
 * search that found none or didn't run, says why too: nothing found is only what every search that ran answered.
 * Without a usable EAN or name, that search is skipped, and without either nothing is asked. A shop whose search can't
 * find an EAN (searchesByEan) gets the name search alone, whose candidates come in the choice's order instead, the best
 * name fit first (orderChoice). It never throws.
 */
export async function lookupChoicesInShop(
  shop: MatchableShop,
  gate: ShopGate,
  product: LookupProduct,
): Promise<ShopChoices> {
  const { search: searchShop, searchesByEan } = SHOP_ADAPTERS[shop];
  const ean = lookupEan(shop, product);
  let byEan: ShopCandidate[] = [];
  if (ean !== null) {
    const search = await searchShop(gate, ean, EAN_HITS);
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
    const search = await searchShop(gate, query, NAME_HITS);
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

  const found = onceEach([...byEan, ...byName]);
  // A shop whose search can't find an EAN has only its name search's candidates, and its own order can put the right
  // shade or scent below others of the product's size and brand, as Super-Pharm's recorded answers do: they're offered
  // in the choice's order instead, the best name fit first.
  const options = searchesByEan
    ? found.slice(0, CHOICES).map((candidate): CandidateOption => ({ candidate, verdict: judge(product, candidate) }))
    : orderChoice(product, found).slice(0, CHOICES);
  if (options.length === 0) {
    logNothingFound(shop, ean !== null, query !== null);
    return { kind: "not-found" };
  }
  return { kind: "choices", options, via: foundBy(byEan.length > 0, byName.length > 0), incomplete };
}

/**
 * The product's first EAN that may go into a shop URL, or null without one. A shop whose search can't find an EAN
 * (searchesByEan) gets none either, so its lookups go straight to the search by name: an EAN search there would spend
 * a request to learn nothing.
 */
function lookupEan(shop: MatchableShop, product: LookupProduct): string | null {
  if (!SHOP_ADAPTERS[shop].searchesByEan) {
    return null;
  }
  return product.eans.find((value) => EAN.test(value)) ?? null;
}

/**
 * What a search by name asks for: the product's brand, name and size text as shop search text (toShopQuery), each word
 * once, or null when it can't be one. A name in Natura, Hebe or Super-Pharm often holds the brand and the size already,
 * as "NIVEA SOFT krem intensywnie nawilżający 300 ml" does, so the brand goes first only when the name doesn't start
 * with it, and the size text last, in place of the size the name ends with when that's the same: read as size text
 * (splitTrailingSize), so "500ml" is "500 ml". Their words are compared folded, as the name check folds them
 * (foldedWordsOf), so "Nivea" is "NIVEA" and "7,2 ml" is "7.2 ml". Over 80 characters, the name is cut at a word, and
 * the brand and the size stay whole. A Rossmann product's name holds neither, so its query is its brand, name and size
 * text. The query keeps the words of the product's own shop, so a shop that writes the product otherwise may find
 * nothing, which the lookup stores as not found: a known limit (the owner's call of 2026-10-08). Super-Pharm's "Mascara
 * … 7.2 ml" finds nothing at Rossmann, which writes "tusz do rzęs" and "7,2 ml".
 */
export function nameQuery({
  brand,
  name,
  sizeText,
}: Pick<LookupProduct, "brand" | "name" | "sizeText">): string | null {
  const ending = splitTrailingSize(name);
  // The name without the size it ends with, when that's the product's: the size text goes last in its place.
  const text = ending !== null && sizeText !== null && sameWords(ending.sizeText, sizeText) ? ending.before : name;
  const before = brand !== null && startsWithWords(name, brand) ? null : brand;
  return toShopQuery(text, { before, after: sizeText });
}

/** True when a text's first words, folded as the name check folds them, are all of `start`'s words: one at least. */
function startsWithWords(text: string, start: string): boolean {
  const words = foldedWordsOf(text);
  const first = foldedWordsOf(start);
  return first.length > 0 && first.every((word, index) => words[index] === word);
}

/** True when two texts have the same words, folded as the name check folds them: one at least. */
function sameWords(a: string, b: string): boolean {
  const left = foldedWordsOf(a);
  const right = foldedWordsOf(b);
  return left.length > 0 && left.length === right.length && left.every((word, index) => right[index] === word);
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

function logNothingFound(shop: MatchableShop, searchedByEan: boolean, searchedByName: boolean): void {
  // Which shop and which searches ran, never what they asked for: a watched product is its user's own data.
  const entry = {
    event: "shop-lookup",
    shop,
    reason: "nothing found for the EAN or name",
    searchedByEan,
    searchedByName,
  };
  // eslint-disable-next-line no-console -- one line per lookup that found nothing; Workers observability collects it.
  console.warn(JSON.stringify(entry));
}

/** What the product's page runs its matched shops' steps on (runMatchSteps). */
export interface MatchStepsInput {
  /** The user's own client, which stores each shop's automatic outcome and the price an automatic match came with. */
  supabase: SupabaseClient;
  /** The gate every search goes through, charged to the shop it asks. */
  gate: ShopGate;
  /** The watched product the page shows. */
  product: WatchlistProduct;
  /** The product's stored decisions, as listMatches read them: null when they couldn't be read at all. */
  matches: MatchesRead | null;
  /** The shop the page was opened to look up again (`?retry=<shop>`, from "Szukaj ponownie"), if any. */
  retryShop: MatchableShop | null;
  /** The shop whose decision the page was opened to change (`?repin=<shop>`, "Zmień" or "Dopasuj ponownie"), if any. */
  repinShop: MatchableShop | null;
  /** The request is the user's own navigation, as `isOwnNavigation` tells. */
  ownNavigation: boolean;
  /** The filter the list is shown with, which every view's links keep. */
  filter: ListFilter;
  /**
   * The shops to run, in the pages' order: the product's matched shops, every priced shop but its own (matchedShopsOf),
   * unless a test names others.
   */
  shops?: readonly PricedShop[];
}

/**
 * What one shop's step came to on the product's page: the step decideMatchStep chose, the view the shop's card shows,
 * the choice the user opened to change its stored decision (`repin`), whether the lookup's own outcome couldn't be
 * stored, so the next visit looks the product up again (`unsaved`), the shop's matched item, stored or just stored,
 * whose prices the page shows (`item`), and whether a retry stored its outcome, so the page goes back to its plain
 * address (`retried`).
 */
export interface MatchStepResult {
  shop: PricedShop;
  step: MatchStep;
  view: MatchView;
  repin: MatchRepin | null;
  unsaved: boolean;
  item: MatchedItem | null;
  retried: boolean;
}

/** A step's result without its shop and its step: what each kind of step comes to. */
type StepOutcome = Omit<MatchStepResult, "shop" | "step">;

/** What every shop's step reads: the input without the list of shops. */
type StepInput = Omit<MatchStepsInput, "shops">;

/** A step that only shows its view: no choice open, nothing unsaved, no item and no retry. */
const SHOWN_ONLY = { repin: null, unsaved: false, item: null, retried: false } as const;

/** The shop gave no answer: the reading of a search, a write or a first price that threw. */
const FAILED: ShopUnavailable = { kind: "unavailable", reason: "failed" };

/**
 * Runs the product page's step for each of `shops`, the product's matched shops (matchedShopsOf) unless a test names
 * others, in their order, so its own shop, whose own item it's priced by, is never looked up: decides it from the
 * shop's stored decision and how the page was opened (decideMatchStep), then shows the stored decision, offers only the
 * button, opens the choice that changes the decision with the shop's two searches, or looks the product up and stores
 * what the matching rule settled on its own, with the price an automatic match came with as its first stored price.
 * The shops run at once, and each shop's searches and writes one after the other, so no two of a shop's requests
 * overlap. Each shop settles on its own: one whose lookup, recording or first price throws is logged and shown as
 * unavailable, and the other shops come back as usual. It never throws.
 */
export function runMatchSteps({ shops, ...input }: MatchStepsInput): Promise<MatchStepResult[]> {
  const run = shops ?? matchedShopsOf(input.product.source);
  return Promise.all(run.map((shop) => runStep(shop, input)));
}

/** One shop's step (runMatchSteps), settled on its own: a step that throws shows the shop as unavailable. */
async function runStep(shop: PricedShop, input: StepInput): Promise<MatchStepResult> {
  const { matches, retryShop, repinShop, ownNavigation } = input;
  const step = decideMatchStep({ matches, shop, retryShop, repinShop, ownNavigation });
  try {
    return { shop, step, ...(await outcomeOf(shop, step, input)) };
  } catch (error) {
    logStepFailure(shop, error);
    // Nothing that threw is shown as stored: the next visit reads the decisions again.
    return { shop, step, ...SHOWN_ONLY, view: unavailableView(shop, FAILED) };
  }
}

/** What a shop's step comes to, by its kind. */
async function outcomeOf(shop: MatchableShop, step: MatchStep, input: StepInput): Promise<StepOutcome> {
  const { product, filter } = input;
  switch (step.kind) {
    case "read-failed":
      // Without the stored decision, a lookup could ask again about what the user has already settled.
      return { ...SHOWN_ONLY, view: { kind: "read-failed" } };
    case "stored":
      // The stored decision's card, with its match's price row.
      return { ...SHOWN_ONLY, view: storedView(shop, step.match, product, { filter }), item: step.match.item };
    case "repin":
      return repinOutcome(shop, step.match, input);
    case "prompt":
      // A link on another site, a prefetch, or a page opened to re-pin or retry another shop only gets the button.
      return { ...SHOWN_ONLY, view: promptView(shop, product, input.retryShop === shop, filter) };
    case "lookup":
      return lookupOutcome(shop, step.retry, input);
  }
}

/**
 * The choice the user's own navigation opened to change the shop's stored decision (`current`): the shop's two
 * searches, one after the other, while the card keeps showing the decision, with "Anuluj", and its match's price row.
 * Nothing is stored here; the user's pick goes through the form. Searches that throw read as the shop not answering, so
 * the choice says so and the stored decision's card stays.
 */
async function repinOutcome(
  shop: MatchableShop,
  current: RepinnableMatch,
  { gate, product, filter }: StepInput,
): Promise<StepOutcome> {
  const view = storedView(shop, current, product, { filter, repinning: true });
  const choices = await lookupChoicesInShop(shop, gate, product).catch((error: unknown): ShopChoices => {
    logStepFailure(shop, error);
    return FAILED;
  });
  const repin = repinView(shop, choices, current, new Date(), product, filter);
  return { ...SHOWN_ONLY, view, repin, item: current.item };
}

/**
 * The lookup the user's own navigation runs for a shop without a decision, or over a stored "not found" it retries.
 * What the rule settles on its own, a match or nothing found, is stored during the render, and an automatic match's
 * price as its first stored price, so the island needn't ask the shop again; the user's picks go through the form.
 */
async function lookupOutcome(
  shop: MatchableShop,
  retry: boolean,
  { supabase, gate, product, filter }: StepInput,
): Promise<StepOutcome> {
  const lookup = await lookupInShop(shop, gate, product);
  const fetchedAt = new Date();
  switch (lookup.kind) {
    case "accepted":
    case "not-found": {
      const result = await recordLookup(supabase, product.id, shop, lookup);
      let item: MatchedItem | null = null;
      if (lookup.kind === "accepted" && result === "saved") {
        item = lookup.candidate;
        const { shopItemId, offer } = lookup.candidate;
        if (offer !== null) {
          // A failed insert is logged, and the island then asks.
          await recordPriceChecks(supabase, [{ key: { shop, shopItemId }, check: { kind: "price", offer } }]);
        }
      }
      // An outcome that wasn't stored is looked up again on the next visit.
      const unsaved = result === "failed" || result === "gone";
      // The plain address shows the stored outcome, so a `?retry=<shop>` left in the address bar can't repeat it.
      const retried = retry && result === "saved";
      const settled = { repin: null, unsaved, item, retried };
      if (result === "decided") {
        // Another tab stored a decision meanwhile; it stands.
        return { ...settled, view: decidedView(product, filter) };
      }
      if (lookup.kind === "accepted") {
        // A match that wasn't saved has no price row, so its card shows its item.
        return { ...settled, view: matchedView(shop, lookup.candidate, "auto", product, { filter, unsaved }) };
      }
      return { ...settled, view: notFoundView(shop, fetchedAt, product, filter) };
    }
    case "choose":
      return { ...SHOWN_ONLY, view: chooseView(shop, lookup.options, lookup.via, fetchedAt, product) };
    case "unavailable":
      // Nothing is stored: the shop can be asked again later.
      return { ...SHOWN_ONLY, view: unavailableView(shop, lookup) };
  }
}

/** The card of a shop that gave no answer, in the words every page uses. */
function unavailableView(shop: MatchableShop, { reason, until }: ShopUnavailable): MatchView {
  return { kind: "unavailable", message: shopUnavailableText(SHOP_LABELS[shop].name, reason, until) };
}

/**
 * Logs a shop's step that threw, by the shop and the error's kind alone: its message could quote a search, with the
 * product's EAN or name, which are the user's own data.
 */
function logStepFailure(shop: MatchableShop, error: unknown): void {
  const entry = {
    event: "shop-lookup",
    shop,
    reason: "step failed",
    error: error instanceof Error ? error.name : typeof error,
  };
  // eslint-disable-next-line no-console -- one line per shop step that threw; Workers observability collects it.
  console.warn(JSON.stringify(entry));
}
