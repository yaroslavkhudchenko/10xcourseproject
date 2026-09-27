import type { SearchUnavailableReason } from "@/types";

// The clock a pause's end is shown on: the shopper's own time in Poland.
const clock = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });

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
