import { describe, expect, it } from "vitest";
import { priceMissingText, priceUnavailableText } from "@/lib/shop-messages";

// 12:05 UTC on 28 September is 14:05 in Poland, on summer time.
const PAUSE_END = "2026-09-28T12:05:00.000Z";

describe("priceUnavailableText", () => {
  it.each([
    { reason: "busy", text: "Sklep Rossmann jest teraz zajęty. Pokazujemy ostatnią znaną cenę." },
    {
      reason: "stopped",
      text: "Odświeżanie cen w sklepie Rossmann jest wyłączone, bo sklep zablokował zapytania.",
    },
    { reason: "failed", text: "Nie udało się pobrać ceny ze sklepu Rossmann." },
  ] as const)("keeps the last known price when the shop is $reason", ({ reason, text }) => {
    expect(priceUnavailableText("Rossmann", reason)).toBe(text);
  });

  it("says when a pause ends, on the clock in Poland", () => {
    expect(priceUnavailableText("Natura", "paused", PAUSE_END)).toBe(
      "Sklep Natura poprosił o przerwę do około 14:05. Pokazujemy ostatnią znaną cenę.",
    );
  });

  it.each([undefined, "po południu"])("leaves out a pause's end that isn't known (%s)", (until) => {
    expect(priceUnavailableText("Natura", "paused", until)).toBe(
      "Sklep Natura poprosił o przerwę. Pokazujemy ostatnią znaną cenę.",
    );
  });

  it("promises no price when there's none to keep showing", () => {
    expect(priceUnavailableText("Natura", "busy", undefined, false)).toBe(
      "Sklep Natura jest teraz zajęty. Spróbuj za minutę.",
    );
    expect(priceUnavailableText("Natura", "paused", PAUSE_END, false)).toBe(
      "Sklep Natura poprosił o przerwę do około 14:05. Spróbuj później.",
    );
    expect(priceUnavailableText("Natura", "failed", undefined, false)).toBe(
      "Nie udało się pobrać ceny ze sklepu Natura.",
    );
  });
});

describe("priceMissingText", () => {
  it("says the price may be out of date when the shop no longer returns the item", () => {
    expect(priceMissingText()).toBe("Sklep nie zwraca już tego produktu. Cena może być nieaktualna.");
  });

  it("mentions no price when there's none", () => {
    expect(priceMissingText(false)).toBe("Sklep nie zwraca tego produktu.");
  });
});
