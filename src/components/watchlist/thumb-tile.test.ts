import { describe, expect, it } from "vitest";
import { initialOf, tileOf, TILES } from "@/components/watchlist/thumb-tile";

// Brands a drugstore list holds, which between them fall on every tile.
const BRANDS = ["Nivea", "Isana", "Ziaja", "Colgate", "Garnier", "Dove", "Bielenda", "Eveline"];

describe("tileOf", () => {
  it("gives a brand the same tile every time, whatever its case or the spaces around it", () => {
    const tile = tileOf("Nivea");

    expect(tileOf("Nivea")).toBe(tile);
    expect(tileOf("NIVEA")).toBe(tile);
    expect(tileOf("  nivea ")).toBe(tile);
    // Natura writes its brands in capitals, Polish letters included.
    expect(tileOf("PRZYKŁAD")).toBe(tileOf("Przykład"));
  });

  it("always gives one of the four tiles", () => {
    for (const brand of [...BRANDS, "Head & Shoulders", "L'Oréal Paris", "Tołpa", "4organic", "x"]) {
      expect(TILES).toContain(tileOf(brand));
    }
  });

  it("spreads brands over all four tiles", () => {
    expect(new Set(BRANDS.map(tileOf))).toEqual(new Set(TILES));
  });

  it("gives a product without a brand the first tile", () => {
    expect(tileOf(null)).toBe(1);
    expect(tileOf("")).toBe(1);
    expect(tileOf("   ")).toBe(1);
  });
});

describe("initialOf", () => {
  it("is the brand's first letter, in upper case", () => {
    expect(initialOf("Nivea")).toBe("N");
    expect(initialOf("ziaja")).toBe("Z");
    expect(initialOf("łysoń")).toBe("Ł");
    expect(initialOf("  isana")).toBe("I");
  });

  it("skips what isn't a letter or a digit", () => {
    expect(initialOf("#hashtag")).toBe("H");
    expect(initialOf("4organic")).toBe("4");
  });

  it("is a question mark for a product without a brand, or a brand with no letter", () => {
    expect(initialOf(null)).toBe("?");
    expect(initialOf("")).toBe("?");
    expect(initialOf(" & ")).toBe("?");
  });
});
