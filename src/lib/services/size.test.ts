import { describe, expect, it } from "vitest";
import { parseSize } from "@/lib/services/size";

describe("parseSize", () => {
  it.each([
    { text: "300 ml", value: 300, unit: "ml" },
    { text: "300ml", value: 300, unit: "ml" },
    { text: "0,5 l", value: 500, unit: "ml" },
    { text: "0.3 L", value: 300, unit: "ml" },
    { text: "1 l", value: 1000, unit: "ml" },
    { text: "4,8 g", value: 4.8, unit: "g" },
    { text: "50 g", value: 50, unit: "g" },
    { text: "1 kg", value: 1000, unit: "g" },
    { text: "10 szt.", value: 10, unit: "pcs" },
    { text: "10 szt", value: 10, unit: "pcs" },
    { text: "20 sztuk", value: 20, unit: "pcs" },
  ])("reads $text as $value $unit", ({ text, value, unit }) => {
    expect(parseSize(text)).toEqual({ value, unit });
  });

  it.each(["4x57 szt.", "2 x 50 ml", "0 ml", "300", "ml", "300 oz", "około 300 ml", "", "   "])(
    "gives null for %j, which can't be compared",
    (text) => {
      expect(parseSize(text)).toBeNull();
    },
  );

  it("gives null when there is no size text", () => {
    expect(parseSize(null)).toBeNull();
  });
});
