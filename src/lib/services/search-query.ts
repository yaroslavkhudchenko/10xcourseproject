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

/** What the list page does with its search text: see searchStepOf. */
export type SearchStep =
  { kind: "none" } | { kind: "invalid" } | { kind: "filled"; query: string } | { kind: "search"; query: string };

/**
 * What the list page does with its search text (`rawQuery`, the `q` parameter): nothing without any; tells the user
 * text that can't be searched (`invalid`); only fills the form in (`filled`) when the request isn't the user's own
 * navigation (isOwnNavigation), so a link on another site or a prefetch never spends the cap everyone shares; or
 * searches Rossmann, once (`search`).
 */
export function searchStepOf(rawQuery: string | null, headers: Headers): SearchStep {
  if (rawQuery === null) {
    return { kind: "none" };
  }
  const parsed = searchQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return { kind: "invalid" };
  }
  return isOwnNavigation(headers) ? { kind: "search", query: parsed.data } : { kind: "filled", query: parsed.data };
}

/** Text a search query keeps whole around the text it may cut: a watched product's brand before its name, say. */
export interface KeptText {
  before?: string | null;
  after?: string | null;
}

/**
 * Search text made from product text: `text`, such as a watched product's name, between `before` and `after`, such as
 * its brand and its size. Characters that may not go into a shop URL become spaces. When the whole is over 80
 * characters, only `text` is cut, after the last whole word that fits beside the other two, which stay whole, so a
 * lookup never loses the product's size to the cut; only when they leave no room at all is the whole cut so. Null when
 * what's left isn't valid search text.
 */
export function toShopQuery(text: string, { before = null, after = null }: KeptText = {}): string | null {
  const head = plainText(before ?? "");
  const body = plainText(text);
  const tail = plainText(after ?? "");
  const whole = joinedText([head, body, tail]);
  let query = whole;
  if (whole.length > MAX_LENGTH) {
    const kept = joinedText([head, tail]);
    // What the text may take beside the kept text, with a space to join them.
    const room = MAX_LENGTH - kept.length - (kept === "" ? 0 : 1);
    query = room >= 0 ? joinedText([head, cutAtWord(body, room), tail]) : cutAtWord(whole, MAX_LENGTH);
  }
  const parsed = searchQuerySchema.safeParse(query);
  return parsed.success ? parsed.data : null;
}

/** Text with the characters a shop URL may not take as spaces, single-spaced and trimmed. */
function plainText(text: string): string {
  return text.replace(NOT_ALLOWED, " ").replace(/\s+/g, " ").trim();
}

/** The texts that aren't empty, joined by a space. */
function joinedText(texts: string[]): string {
  return texts.filter((text) => text !== "").join(" ");
}

/** Text up to the last space within `limit` characters; a first word longer than the limit leaves nothing. */
function cutAtWord(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, Math.max(text.lastIndexOf(" ", limit), 0));
}
