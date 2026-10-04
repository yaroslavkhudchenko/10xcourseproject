import { DECISION_NOTICES } from "@/lib/notices";
import type { MatchAction, MatchItemSummary, MatchView } from "@/lib/services/match-view";
import { SHOP_LABELS, type MatchableShop, type MatchedShop, type ShopLabel } from "@/lib/services/price-comparison";

// A matched shop's card on the product's page, without React: what it says for each view the page builds of the shop
// (src/lib/services/match-view.ts), with the notices of a decision just made, every text naming the shop by its label.
// The price island renders it, so this module imports nothing server-only; the views come in as data, their links
// included, which keep the list's filter.

/**
 * Whether a matched shop is still to be matched: nothing is stored, and the page offers the lookup (`prompt`), a
 * choice of candidates (`choose`), or says the shop couldn't be asked just now (`unavailable`). A decision stored or
 * just made, a lookup that found nothing, and a decision that couldn't be read all count as decided, and so does no
 * view at all. A stored decision whose choice the user opened to change it is still decided until they pick.
 */
export function undecided(view: MatchView | null): boolean {
  return view?.kind === "prompt" || view?.kind === "choose" || view?.kind === "unavailable";
}

/**
 * Whether a matched shop's stored decision couldn't be read (`read-failed`). A match it hides could name a lower price,
 * so the product's prices then count as unread: the product area names no shop, and the list beside it says so, as the
 * list's own row does (listRowOf). No view at all is no such decision.
 */
export function unreadable(view: MatchView | null): boolean {
  return view?.kind === "read-failed";
}

/**
 * A matched shop as the product's page hands it to its island: the shop, the view the page built of it, the notice of
 * a decision just saved there (`?matched`, `?declined` or `?decided`), why a decision wasn't (`?error=`), both as text,
 * and whether the lookup's own outcome couldn't be stored, so the next visit looks the product up again. The page hands
 * over the matched shops in their order (MATCHED_SHOPS); a test may name a shop that isn't switched on yet.
 */
export interface MatchedShopView<Shop extends MatchableShop = MatchedShop> {
  shop: Shop;
  view: MatchView;
  notice: string | null;
  error: string | null;
  unsaved: boolean;
}

/** The shops still to be matched (undecided), in their order: the hero and the track's hint name them. */
export function undecidedShopsOf<Shop extends MatchableShop>(matched: readonly MatchedShopView<Shop>[]): Shop[] {
  return matched.filter(({ view }) => undecided(view)).map(({ shop }) => shop);
}

/**
 * The shops whose stored decision couldn't be read (unreadable), in their order: while there's one, no shop is named
 * cheapest, on the product's page or on its row on the list.
 */
export function unreadableShopsOf<Shop extends MatchableShop>(matched: readonly MatchedShopView<Shop>[]): Shop[] {
  return matched.filter(({ view }) => unreadable(view)).map(({ shop }) => shop);
}

/** A link the card shows: its words and where it leads. */
export interface MatchCardLink {
  label: string;
  href: string;
}

/**
 * A stored decision's way to change it: "Zmień" on a match and "Dopasuj ponownie" on the user's decline, which open
 * the choice of the shop's candidates below the cards, or, while the choice is open, "Anuluj", with the line that
 * points the user to the choice (`hint`).
 */
export interface MatchCardAction {
  link: MatchCardLink;
  hint: string | null;
}

/** An alert the card shows: a decision just saved, a decision that wasn't, or a lookup's outcome that wasn't stored. */
export interface MatchCardAlert {
  tone: "success" | "destructive" | "warning";
  text: string;
}

/**
 * What a matched shop's card shows, by the view's kind: a match's footer below its price, naming its item, with how it
 * was decided, its action and a warning for each thing that differs from the product, its size or its brand, and,
 * while the match isn't saved (`unsaved`), the item's photo and page in the price's place, without an action; the line
 * and the action of the user's decline, a ghost card; the line and the link of a product not matched yet, of a lookup
 * that found nothing, or of a decision another tab stored meanwhile; or the line of every other kind. A choice of
 * candidates points to the section below the cards, which holds its forms. Every card names its shop.
 */
export type MatchCard<Shop extends MatchableShop = MatchedShop> = { shop: Shop; alerts: MatchCardAlert[] } & (
  | {
      kind: "matched";
      note: string;
      warnings: string[];
      item: MatchItemSummary;
      unsaved: boolean;
      action: MatchCardAction | null;
    }
  | { kind: "unmatched"; text: string; action: MatchCardAction }
  | { kind: "prompt" | "not-found" | "decided"; text: string; link: MatchCardLink }
  | { kind: "unavailable" | "read-failed" | "choose"; text: string }
);

/**
 * What a shop's card says when the lookup's own outcome couldn't be stored, so the next visit asks the shop again: it
 * names the shop as "sklep Natura", which reads right for any shop.
 */
function unsavedText({ name }: ShopLabel): string {
  return `Nie udało się zapisać wyniku. Przy następnym otwarciu produktu sklep ${name} zostanie sprawdzony ponownie.`;
}

// What a stored decision's action says: the link that opens its choice, and, while the choice is open, the line that
// points to it, beside "Anuluj".
const REPIN_LABELS = { matched: "Zmień", unmatched: "Dopasuj ponownie" } as const;

/** The line that points to a stored decision's open choice: another candidate from a match, any from a decline. */
function repinHint(shop: MatchableShop, decision: "matched" | "unmatched"): string {
  return decision === "matched"
    ? "Wybierz poniżej inny produkt albo „Żaden z nich”."
    : `Wybierz poniżej produkt z ${SHOP_LABELS[shop].of} albo „Anuluj”.`;
}

/** The card's action for a stored match's or decline's view action in `shop`. */
function cardActionOf(shop: MatchableShop, action: MatchAction, decision: "matched" | "unmatched"): MatchCardAction {
  return action.kind === "repin"
    ? { link: { label: REPIN_LABELS[decision], href: action.href }, hint: null }
    : { link: { label: "Anuluj", href: action.href }, hint: repinHint(shop, decision) };
}

/**
 * The card of a matched shop for the page's view of it, with the notice of a decision just saved (`notice`), why a
 * decision wasn't (`error`), and whether the lookup's outcome couldn't be stored (`unsaved`), in that order as alerts.
 * Every text names the shop by its label.
 */
export function matchCardOf<Shop extends MatchableShop>({
  shop,
  view,
  notice,
  error,
  unsaved,
}: MatchedShopView<Shop>): MatchCard<Shop> {
  const label = SHOP_LABELS[shop];
  const alerts: MatchCardAlert[] = [];
  if (notice !== null) {
    alerts.push({ tone: "success", text: notice });
  }
  if (error !== null) {
    alerts.push({ tone: "destructive", text: error });
  }
  if (unsaved) {
    alerts.push({ tone: "warning", text: unsavedText(label) });
  }
  switch (view.kind) {
    case "matched":
      return {
        shop,
        kind: "matched",
        note: view.note,
        warnings: view.warnings,
        item: view.item,
        unsaved: view.unsaved,
        action: view.action === null ? null : cardActionOf(shop, view.action, "matched"),
        alerts,
      };
    case "unmatched":
      return {
        shop,
        kind: "unmatched",
        text: `Brak ${label.in} — Twój wybór.`,
        action: cardActionOf(shop, view.action, "unmatched"),
        alerts,
      };
    case "prompt":
      return {
        shop,
        kind: "prompt",
        text: `Produkt nie jest jeszcze dopasowany ${label.in}.`,
        link: { label: `Dopasuj ${label.in}`, href: view.href },
        alerts,
      };
    case "not-found":
      return { shop, kind: "not-found", text: view.text, link: { label: "Szukaj ponownie", href: view.href }, alerts };
    case "unavailable":
      return { shop, kind: "unavailable", text: view.message, alerts };
    case "decided":
      return {
        shop,
        kind: "decided",
        text: DECISION_NOTICES.decided,
        link: { label: "Pokaż zapisaną decyzję", href: view.href },
        alerts,
      };
    case "read-failed":
      return { shop, kind: "read-failed", text: `Nie udało się wczytać dopasowania ${label.of}.`, alerts };
    case "choose":
      return { shop, kind: "choose", text: "Wybierz pasujący produkt poniżej.", alerts };
  }
}
