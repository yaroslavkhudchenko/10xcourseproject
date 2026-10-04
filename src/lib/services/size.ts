import type { Size } from "@/types";

// The units shops write, mapped to the unit sizes are compared in and the factor to get there.
const UNITS: Partial<Record<string, { unit: Size["unit"]; factor: number }>> = {
  ml: { unit: "ml", factor: 1 },
  l: { unit: "ml", factor: 1000 },
  g: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 },
  szt: { unit: "pcs", factor: 1 },
  "szt.": { unit: "pcs", factor: 1 },
  sztuk: { unit: "pcs", factor: 1 },
};
// A size at the very end of a text: an amount that starts the text or follows a space or a comma, then its unit, as in
// "… pomadka do ust 5,5 ml" or "…, 200 ml". An amount after a multiplication sign, as in "2 x 50 ml" or "4x57 szt.", is
// one item of a multipack, which has no single size.
const TRAILING_SIZE = /(?:^|[\s,])(?<!(?:(?:^|[\s\d])x|×)\s*)(\d+(?:[.,]\d+)?)\s*([a-z.]+)$/i;

/**
 * Parses a shop's size text, such as "300 ml", "0,5 l", "4,8 g" or "10 szt.", into millilitres, grams or pieces.
 * Anything else gives null, multipacks like "4x57 szt." included: the text is kept, but the size can't be compared.
 */
export function parseSize(text: string | null): Size | null {
  const match = /^(\d+(?:[.,]\d+)?)\s*([a-z.]+)$/i.exec(text?.trim() ?? "");
  if (!match) {
    return null;
  }
  const known = UNITS[match[2].toLowerCase()];
  const amount = Number(match[1].replace(",", "."));
  if (!known || !(amount > 0)) {
    return null;
  }
  // Round away the float noise a factor can add, so 0.3 l reads as 300 ml.
  return { value: Math.round(amount * known.factor * 1000) / 1000, unit: known.unit };
}

/**
 * The size a product text ends with, as text parseSize reads as that size: "… pomadka do ust 5,5 ml" gives "5,5 ml",
 * "… W Kostce Creme Soft 100 g" gives "100 g". Null for a text that doesn't end with a size parseSize can read,
 * a multipack's included.
 */
export function trailingSizeText(text: string): string | null {
  const match = TRAILING_SIZE.exec(text.trim());
  if (!match) {
    return null;
  }
  const sizeText = `${match[1]} ${match[2]}`;
  return parseSize(sizeText) === null ? null : sizeText;
}
