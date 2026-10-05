import { parseWatchlistItemId } from "@/lib/services/watchlist";
import { filterHref, LIST_FILTERS, parseListFilter } from "@/lib/services/watchlist-rows";

// Where a sign-in may send the user back to: the list, or one of its products, with at most the list's filter. The page
// a sign-in lands on counts as the user's own navigation (isOwnNavigation), so a return path never carries what makes a
// page ask a shop (`repin`, `retry`, `q`), nor a notice's code: a crafted link then can't spend the cap everyone shares
// or put a notice on the page. Every return path is rebuilt from what was read, never passed on as it came.

/** Where a sign-in goes without a return path, or with one it may not take: the list. */
export const DEFAULT_RETURN_PATH = "/watchlist";

// The list's filter, the only parameter a return path keeps, as filterHref writes it.
const FILTER_PARAM = "f";

// A made-up origin that no return path can name (.invalid is reserved, RFC 6761). It only lets the URL parser read a
// path: a target the parser reads as another origin, such as //evil.example or /\evil.example, doesn't share it.
const PARSE_BASE = "https://return-path.invalid";

/** The list's page or a product's page that `pathname` names exactly, or null for any other path. */
function listPageOf(pathname: string): string | null {
  if (pathname === DEFAULT_RETURN_PATH) {
    return DEFAULT_RETURN_PATH;
  }
  const productPrefix = `${DEFAULT_RETURN_PATH}/`;
  if (!pathname.startsWith(productPrefix)) {
    return null;
  }
  const itemId = parseWatchlistItemId(pathname.slice(productPrefix.length));
  return itemId === null ? null : `${productPrefix}${itemId}`;
}

/**
 * The page a sign-in goes back to, from the `next` the sign-in page or its form carries: the canonical form of a path
 * on this site that is exactly the list's (`/watchlist`) or a product's (`/watchlist/<uuid>`), with no parameter but the
 * list's filter, which must be one a chip links to, and no hash. Anything else is the list: an absolute or
 * protocol-relative URL, a path the parser reads as another origin (`/\evil.example`), another path, an id that isn't
 * a UUID, a filter no chip links to, any other parameter (`repin`, `retry`, `q`, a notice's), a hash, and a field
 * that isn't text.
 */
export function returnPathOf(raw: FormDataEntryValue | string | null): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.includes("#")) {
    return DEFAULT_RETURN_PATH;
  }
  let url: URL;
  try {
    url = new URL(raw, PARSE_BASE);
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  const page = url.origin === PARSE_BASE ? listPageOf(url.pathname) : null;
  const names = [...url.searchParams.keys()];
  if (page === null || names.length > 1 || names.some((name) => name !== FILTER_PARAM)) {
    return DEFAULT_RETURN_PATH;
  }
  const value = url.searchParams.get(FILTER_PARAM);
  if (value === null) {
    return page;
  }
  const filter = LIST_FILTERS.find((each) => each === value);
  return filter === undefined ? DEFAULT_RETURN_PATH : filterHref(page, filter);
}

/**
 * The page a signed-out request to `url` goes back to after a sign-in, which the middleware hands to the sign-in page:
 * the list's or a product's page with only its list filter kept (filterHref), a filter no chip links to being every
 * product's. Null for any other path, the API routes included, which go to the plain sign-in page.
 */
export function returnPathFor(url: URL): string | null {
  const page = listPageOf(url.pathname);
  return page === null ? null : filterHref(page, parseListFilter(url.searchParams.get(FILTER_PARAM)));
}
