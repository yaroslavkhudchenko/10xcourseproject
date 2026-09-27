import { z } from "astro/zod";

// Letters of any script, digits, spaces and the punctuation product names and sizes use. Nothing else reaches a shop
// URL: odd input could trip a shop's firewall into a 403, and one 403 stops that shop for everyone.
const ALLOWED_CHARACTERS = String.raw`\p{L}\p{N} .,%&'+/()-`;
const ALLOWED = new RegExp(`^[${ALLOWED_CHARACTERS}]+$`, "u");
const NOT_ALLOWED = new RegExp(`[^${ALLOWED_CHARACTERS}]`, "gu");
const MAX_LENGTH = 80;
// How a browser marks a prefetch or prerender, in Sec-Purpose or the older Purpose header.
const PREFETCH = /prefetch/i;

/**
 * True when the browser says the request is the user's own navigation: typed, bookmarked, or from one of this app's
 * pages. A link on another site must not start a shop search, because it would spend the cap everyone shares, and
 * neither may a prefetch or prerender of a page the user may never open, whatever Sec-Fetch-Site says: Chrome
 * prerenders what's typed in its address bar with `Sec-Fetch-Site: none` and `Sec-Purpose: prefetch;prerender`.
 * Browsers that don't send Sec-Fetch-Site are trusted.
 */
export function isOwnNavigation(headers: Headers): boolean {
  const purposes = [headers.get("Sec-Purpose"), headers.get("Purpose")];
  if (purposes.some((purpose) => purpose !== null && PREFETCH.test(purpose))) {
    return false;
  }
  const site = headers.get("Sec-Fetch-Site");
  return site === null || site === "same-origin" || site === "none";
}

/** Search text that may go into a shop URL: trimmed, single-spaced, and 2-80 allowed characters. */
export const searchQuerySchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2).max(MAX_LENGTH).regex(ALLOWED));

/**
 * Search text made from product text, such as a watched product's brand, name and size. Characters that may not go
 * into a shop URL become spaces, and text over 80 characters is cut after the last whole word that fits. Null when
 * what's left isn't valid search text.
 */
export function toShopQuery(text: string): string | null {
  const plain = text.replace(NOT_ALLOWED, " ").replace(/\s+/g, " ").trim();
  // Up to the last space within the limit; a first word longer than the limit leaves nothing.
  const cut = plain.length <= MAX_LENGTH ? plain : plain.slice(0, Math.max(plain.lastIndexOf(" ", MAX_LENGTH), 0));
  const parsed = searchQuerySchema.safeParse(cut);
  return parsed.success ? parsed.data : null;
}
