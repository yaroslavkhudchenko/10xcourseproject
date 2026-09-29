import type { SearchUnavailableReason } from "@/types";

// The pages' texts about shops that couldn't be asked. The product page's island shows them too, so this module
// imports nothing server-only.

// The clock a pause's end is shown on: the shopper's own time in Poland.
const clock = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });
// What a price text adds when the page keeps showing the last known price.
const KEEPING_LAST_PRICE = "Pokazujemy ostatnią znaną cenę.";

/**
 * Why a shop can't be asked right now, in the words every page uses: its search is busy under the cap, it asked for a
 * pause (until `until`, an ISO timestamp, when known), it's stopped after a block, or the call failed.
 */
export function shopUnavailableText(shopName: string, reason: SearchUnavailableReason, until?: string): string {
  switch (reason) {
    case "busy":
      return `Wyszukiwarka sklepu ${shopName} jest teraz zajęta. Spróbuj za minutę.`;
    case "paused": {
      // A time that doesn't parse is treated as unknown rather than shown as a wrong one.
      const end = until === undefined ? Number.NaN : Date.parse(until);
      return Number.isNaN(end)
        ? `Sklep ${shopName} poprosił o przerwę. Spróbuj później.`
        : `Sklep ${shopName} poprosił o przerwę. Wyszukiwanie wróci około ${clock.format(end)}.`;
    }
    case "stopped":
      return `Wyszukiwanie w sklepie ${shopName} jest wyłączone, bo sklep zablokował zapytania. Właściciel musi je ponownie włączyć.`;
    case "failed":
      return `Wyszukiwarka sklepu ${shopName} jest chwilowo niedostępna. Spróbuj za chwilę.`;
  }
}

/**
 * Why a shop's price couldn't be fetched just now, in the words a product's page shows next to the last known price:
 * the shop is busy under the cap, it asked for a pause (until `until`, an ISO timestamp, when known), it's stopped after
 * a block, or the call failed. With `lastKnown` false, when there's no price to keep showing, the busy and paused texts
 * don't promise one.
 */
export function priceUnavailableText(
  shopName: string,
  reason: SearchUnavailableReason,
  until?: string,
  lastKnown = true,
): string {
  switch (reason) {
    case "busy":
      return `Sklep ${shopName} jest teraz zajęty. ${lastKnown ? KEEPING_LAST_PRICE : "Spróbuj za minutę."}`;
    case "paused": {
      // A time that doesn't parse is treated as unknown rather than shown as a wrong one.
      const end = until === undefined ? Number.NaN : Date.parse(until);
      const pause = Number.isNaN(end) ? "poprosił o przerwę" : `poprosił o przerwę do około ${clock.format(end)}`;
      return `Sklep ${shopName} ${pause}. ${lastKnown ? KEEPING_LAST_PRICE : "Spróbuj później."}`;
    }
    case "stopped":
      return `Odświeżanie cen w sklepie ${shopName} jest wyłączone, bo sklep zablokował zapytania.`;
    case "failed":
      return `Nie udało się pobrać ceny ze sklepu ${shopName}.`;
  }
}

/**
 * What a product's page says when the shop's last answer came without the item. With `lastKnown` false, when no price
 * is left to show, it doesn't mention one.
 */
export function priceMissingText(lastKnown = true): string {
  return lastKnown
    ? "Sklep nie zwraca już tego produktu. Cena może być nieaktualna."
    : "Sklep nie zwraca tego produktu.";
}
