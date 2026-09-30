import { DECISION_NOTICES } from "@/lib/notices";
import type { NaturaItemSummary, NaturaView } from "@/lib/services/natura-view";

// Natura's card on the product's page, without React: what it says for each view the page builds of Natura
// (src/lib/services/natura-view.ts), with the notices of a decision just made. The price island renders it, so this
// module imports nothing server-only; the views come in as data. It offers no way to change a stored decision:
// re-pinning waits for S-08.

/**
 * Whether Natura is still to be matched: nothing is stored, and the page offers the lookup (`prompt`), a choice of
 * candidates (`choose`), or says Natura couldn't be asked just now (`unavailable`). A decision stored or just made,
 * a lookup that found nothing, and a decision that couldn't be read all count as decided, and so does no view at all.
 */
export function naturaUndecided(view: NaturaView | null): boolean {
  return view?.kind === "prompt" || view?.kind === "choose" || view?.kind === "unavailable";
}

/** A link the card shows: its words and where it leads. */
export interface NaturaCardLink {
  label: string;
  href: string;
}

/** An alert the card shows: a decision just saved, a decision that wasn't, or a lookup's outcome that wasn't stored. */
export interface NaturaCardAlert {
  tone: "success" | "destructive" | "warning";
  text: string;
}

/**
 * What Natura's card shows, by the view's kind: a match's footer below its price, with how it was decided, a size
 * that differs and, only while the match isn't saved, its item; the line and the link of a product not matched yet,
 * or of a lookup that found nothing; or the line of every other kind. A declined Natura is a ghost card, and a choice
 * of candidates points to the section below the cards, which holds its forms.
 */
export type NaturaCard = { alerts: NaturaCardAlert[] } & (
  | { kind: "matched"; note: string; sizeWarning: string | null; item: NaturaItemSummary | null }
  | { kind: "prompt" | "not-found"; text: string; link: NaturaCardLink }
  | { kind: "unmatched" | "unavailable" | "decided" | "read-failed" | "choose"; text: string }
);

/** What Natura's card says when the lookup's own outcome couldn't be stored, so the next visit asks again. */
const UNSAVED_TEXT =
  "Nie udało się zapisać wyniku. Przy następnym otwarciu produktu Natura zostanie sprawdzona ponownie.";

/**
 * Natura's card for the page's view, with the notice of a decision just saved (`notice`), why a decision wasn't
 * (`error`), and whether the lookup's outcome couldn't be stored (`unsaved`), in that order as alerts.
 */
export function naturaCardOf({
  view,
  notice,
  error,
  unsaved,
}: {
  view: NaturaView;
  notice: string | null;
  error: string | null;
  unsaved: boolean;
}): NaturaCard {
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
        sizeWarning: view.sizeWarning,
        item: unsaved ? (view.item ?? null) : null,
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
    case "unmatched":
      return { kind: "unmatched", text: "Brak w Naturze — Twój wybór.", alerts };
    case "unavailable":
      return { kind: "unavailable", text: view.message, alerts };
    case "decided":
      return { kind: "decided", text: DECISION_NOTICES.decided, alerts };
    case "read-failed":
      return { kind: "read-failed", text: "Nie udało się wczytać dopasowania Natury.", alerts };
    case "choose":
      return { kind: "choose", text: "Wybierz pasujący produkt poniżej.", alerts };
  }
}
