// A price a shop writes as Polish text, such as Super-Pharm's 30-day low "33,99 zł", with a no-break space before the
// currency. A misread would be stored as a price, so only the exact forms below are read, and nothing is guessed.

// Złoty as digits, grouped in threes by a space, a no-break space or a narrow no-break space, or not at all; a comma
// and exactly two digits of grosze; then a space or a no-break space, and "zł".
const POLISH_PRICE = /^(\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+),(\d{2})[ \u00A0]zł$/;

/**
 * A price written in Polish, such as "33,99 zł" or "1 234,56 zł", as an amount in złoty; null for any other value,
 * such as a dot as the decimal mark, one digit of grosze, no "zł", `false` or empty text.
 */
export function parsePolishPrice(value: unknown): number | null {
  const match = typeof value === "string" ? POLISH_PRICE.exec(value) : null;
  if (match === null) {
    return null;
  }
  const [, zloty, grosze] = match;
  const amount = Number(`${zloty.replace(/\D/g, "")}.${grosze}`);
  return Number.isFinite(amount) ? amount : null;
}
