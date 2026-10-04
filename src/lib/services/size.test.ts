import { describe, expect, it } from "vitest";
import { parseSize, trailingSizeText } from "@/lib/services/size";

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

describe("trailingSizeText", () => {
  // The first six are the legal names and short descriptions Hebe's recorded hits end with (hebe-*.json).
  it.each([
    { text: "Nivea Soft Rose Pielęgnująca pomadka do ust 5,5 ml", sizeText: "5,5 ml", value: 5.5, unit: "ml" },
    { text: "Nivea Pielęgnujące Mydło W Kostce Creme Soft 100 g", sizeText: "100 g", value: 100, unit: "g" },
    { text: "Nivea Soft Lekki Krem Nawilżający, 200 ml", sizeText: "200 ml", value: 200, unit: "ml" },
    { text: "NIVEA Soft Krem intensywnie nawilżający 300 ml", sizeText: "300 ml", value: 300, unit: "ml" },
    { text: "Nivea Creme Soft Kremowy ŻEL POD Prysznic 750 ml", sizeText: "750 ml", value: 750, unit: "ml" },
    { text: "creme soft mydło w kostce, 100 g", sizeText: "100 g", value: 100, unit: "g" },
    { text: "Płyn micelarny 0,5l", sizeText: "0,5 l", value: 500, unit: "ml" },
    { text: "Wosk do włosów Wax 50 ml", sizeText: "50 ml", value: 50, unit: "ml" },
    { text: "Płatki kosmetyczne 120 szt.", sizeText: "120 szt.", value: 120, unit: "pcs" },
    { text: "  300 ml  ", sizeText: "300 ml", value: 300, unit: "ml" },
  ])("cuts $sizeText from the end of $text, and parseSize reads it as that size", ({ text, sizeText, value, unit }) => {
    expect(trailingSizeText(text)).toBe(sizeText);
    expect(parseSize(trailingSizeText(text))).toEqual({ value, unit });
  });

  it.each([
    "Nivea Soft",
    "Krem z filtrem SPF 50",
    "Krem 50 ml na dzień",
    "Chusteczki nawilżane 4x57 szt.",
    "Zestaw 2 x 50 ml",
    "Zestaw 2×50 ml",
    "Ręcznik 30 cm",
    "Krem 0 ml",
    "",
    "   ",
  ])("gives null for %j, which doesn't end with a size parseSize can read", (text) => {
    expect(trailingSizeText(text)).toBeNull();
  });
});
