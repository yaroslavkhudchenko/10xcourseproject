import { DECISION_NOTICES } from "@/lib/notices";
import type { MatchAction, MatchItemSummary, MatchView } from "@/lib/services/match-view";

// Natura's card on the product's page, without React: what it says for each view the page builds of Natura
// (src/lib/services/match-view.ts), with the notices of a decision just made. The price island renders it, so this
// module imports nothing server-only; the views come in as data, their links included, which keep the list's filter.

/**
 * Whether Natura is still to be matched: nothing is stored, and the page offers the lookup (`prompt`), a choice of
 * candidates (`choose`), or says Natura couldn't be asked just now (`unavailable`). A decision stored or just made,
 * a lookup that found nothing, and a decision that couldn't be read all count as decided, and so does no view at all.
 * A stored decision whose choice the user opened to change it is still decided until they pick.
 */
export function naturaUndecided(view: MatchView | null): boolean {
  return view?.kind === "prompt" || view?.kind === "choose" || view?.kind === "unavailable";
}

/**
 * Whether Natura's stored decision couldn't be read (`read-failed`). A match it hides could name a lower price, so the
 * product's prices then count as unread: the product area names no shop, and the list beside it says so, as the list's
 * own row does (listRowOf). No view at all is no such decision.
 */
export function naturaUnreadable(view: MatchView | null): boolean {
  return view?.kind === "read-failed";
}

/**
 * Natura as the product's page hands it to its island: the view it built, the notice of a decision just saved
 * (`?matched`, `?declined` or `?decided`), why a decision wasn't (`?error=`), both as text, and whether the lookup's
 * own outcome couldn't be stored, so the next visit looks the product up again.
 */
export interface NaturaCardInput {
  view: MatchView;
  notice: string | null;
  error: string | null;
  unsaved: boolean;
}

/** A link the card shows: its words and where it leads. */
export interface NaturaCardLink {
  label: string;
  href: string;
}

/**
 * A stored decision's way to change it: "Zmień" on a match and "Dopasuj ponownie" on the user's decline, which open
 * the choice of Natura's candidates below the cards, or, while the choice is open, "Anuluj", with the line that points
 * the user to the choice (`hint`).
 */
export interface NaturaCardAction {
  link: NaturaCardLink;
  hint: string | null;
}

/** An alert the card shows: a decision just saved, a decision that wasn't, or a lookup's outcome that wasn't stored. */
export interface NaturaCardAlert {
  tone: "success" | "destructive" | "warning";
  text: string;
}

/**
 * What Natura's card shows, by the view's kind: a match's footer below its price, naming its item, with how it was
 * decided, its action and a warning for each thing that differs from the product, its size or its brand, and, while
 * the match isn't saved (`unsaved`), the item's photo and page in the price's place, without an action; the line and
 * the action of the user's decline, a ghost card; the line and the link of a product not matched yet, of a lookup that
 * found nothing, or of a decision another tab stored meanwhile; or the line of every other kind. A choice of
 * candidates points to the section below the cards, which holds its forms.
 */
export type NaturaCard = { alerts: NaturaCardAlert[] } & (
  | {
      kind: "matched";
      note: string;
      warnings: string[];
      item: MatchItemSummary;
      unsaved: boolean;
      action: NaturaCardAction | null;
    }
  | { kind: "unmatched"; text: string; action: NaturaCardAction }
  | { kind: "prompt" | "not-found" | "decided"; text: string; link: NaturaCardLink }
  | { kind: "unavailable" | "read-failed" | "choose"; text: string }
);

/** What Natura's card says when the lookup's own outcome couldn't be stored, so the next visit asks again. */
const UNSAVED_TEXT =
  "Nie udało się zapisać wyniku. Przy następnym otwarciu produktu Natura zostanie sprawdzona ponownie.";

// What a stored decision's action says: the link that opens its choice, and, while the choice is open, the line that
// points to it, beside "Anuluj".
const REPIN_LABELS = { matched: "Zmień", unmatched: "Dopasuj ponownie" } as const;
const REPIN_HINTS = {
  matched: "Wybierz poniżej inny produkt albo „Żaden z nich”.",
  unmatched: "Wybierz poniżej produkt z Natury albo „Anuluj”.",
} as const;

/** The card's action for a stored match's or decline's view action. */
function cardActionOf(action: MatchAction, decision: "matched" | "unmatched"): NaturaCardAction {
  return action.kind === "repin"
    ? { link: { label: REPIN_LABELS[decision], href: action.href }, hint: null }
    : { link: { label: "Anuluj", href: action.href }, hint: REPIN_HINTS[decision] };
}

/**
 * Natura's card for the page's view, with the notice of a decision just saved (`notice`), why a decision wasn't
 * (`error`), and whether the lookup's outcome couldn't be stored (`unsaved`), in that order as alerts.
 */
export function naturaCardOf({ view, notice, error, unsaved }: NaturaCardInput): NaturaCard {
  const alerts: NaturaCardAlert[] = [];
  if (notice !== null) {
    alerts.push({ tone: "success", text: notice });
  }
  if (error !== null) {
    alerts.push({ tone: "destructive", text: error });
  }
  if (unsaved) {
    alerts.push({ tone: "warning", text: UNSAVED_TEXT });
  }
  switch (view.kind) {
    case "matched":
      return {
        kind: "matched",
        note: view.note,
        warnings: view.warnings,
        item: view.item,
        unsaved: view.unsaved,
        action: view.action === null ? null : cardActionOf(view.action, "matched"),
        alerts,
      };
    case "unmatched":
      return {
        kind: "unmatched",
        text: "Brak w Naturze — Twój wybór.",
        action: cardActionOf(view.action, "unmatched"),
        alerts,
      };
    case "prompt":
      return {
        kind: "prompt",
        text: "Produkt nie jest jeszcze dopasowany w Naturze.",
        link: { label: "Dopasuj w Naturze", href: view.href },
        alerts,
      };
    case "not-found":
      return { kind: "not-found", text: view.text, link: { label: "Szukaj ponownie", href: view.href }, alerts };
    case "unavailable":
      return { kind: "unavailable", text: view.message, alerts };
    case "decided":
      return {
        kind: "decided",
        text: DECISION_NOTICES.decided,
        link: { label: "Pokaż zapisaną decyzję", href: view.href },
        alerts,
      };
    case "read-failed":
      return { kind: "read-failed", text: "Nie udało się wczytać dopasowania Natury.", alerts };
    case "choose":
      return { kind: "choose", text: "Wybierz pasujący produkt poniżej.", alerts };
  }
}
