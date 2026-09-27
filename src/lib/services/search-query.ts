import { z } from "astro/zod";

// Letters of any script, digits, spaces and the punctuation product names and sizes use. Nothing else reaches a shop
// URL: odd input could trip a shop's firewall into a 403, and one 403 stops that shop for everyone.
const ALLOWED = /^[\p{L}\p{N} .,%&'+/()-]+$/u;

/**
 * True when the browser says the request is the user's own navigation: typed, bookmarked, or from one of this app's
 * pages. A link on another site must not start a shop search, because it would spend the cap everyone shares. Browsers
 * that don't send Sec-Fetch-Site are trusted.
 */
export function isOwnNavigation(headers: Headers): boolean {
  const site = headers.get("Sec-Fetch-Site");
  return site === null || site === "same-origin" || site === "none";
}

/** Search text that may go into a shop URL: trimmed, single-spaced, and 2-80 allowed characters. */
export const searchQuerySchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2).max(80).regex(ALLOWED));
