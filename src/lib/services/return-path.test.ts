import { describe, expect, it } from "vitest";
import { LIST_NOTICE_PARAMS, NOTICE_PARAMS, REPIN_PARAM, RETRY_PARAM, SIGN_IN_NOTICE_PARAMS } from "@/lib/notices";
import { DEFAULT_RETURN_PATH, returnPathFor, returnPathOf } from "@/lib/services/return-path";

// A sign-in lands on its return path as the user's own navigation, so these tests pin what it may carry: the list or a
// product, with at most the list's filter. A path that carried `repin`, `retry` or `q` would make the page it lands on
// ask a shop, from the cap everyone shares, and one that carried a notice's code would put its words on the page.

const PRODUCT_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const PRODUCT = `/watchlist/${PRODUCT_ID}`;
const SITE = "https://drogeria.example";

describe("returnPathOf, the page a sign-in goes back to", () => {
  it.each<{ raw: string; to: string }>([
    { raw: "/watchlist", to: "/watchlist" },
    { raw: "/watchlist?f=check", to: "/watchlist?f=check" },
    { raw: "/watchlist?f=promo", to: "/watchlist?f=promo" },
    { raw: PRODUCT, to: PRODUCT },
    { raw: `${PRODUCT}?f=promo`, to: `${PRODUCT}?f=promo` },
    { raw: `${PRODUCT}?f=check`, to: `${PRODUCT}?f=check` },
  ])("takes $raw", ({ raw, to }) => {
    expect(returnPathOf(raw)).toBe(to);
  });

  it("gives every target in the form its links have, the filter of every product being the bare page", () => {
    expect(returnPathOf("/watchlist?f=all")).toBe("/watchlist");
    expect(returnPathOf(`${PRODUCT}?f=all`)).toBe(PRODUCT);
    // A query with nothing in it names no parameter.
    expect(returnPathOf(`${PRODUCT}?`)).toBe(PRODUCT);
  });

  it.each<{ why: string; raw: string }>([
    { why: "an absolute URL", raw: "https://evil.example/watchlist" },
    { why: "an absolute URL to a product", raw: `https://evil.example${PRODUCT}?f=check` },
    { why: "an absolute URL to this very site", raw: `${SITE}${PRODUCT}` },
    { why: "a URL of another scheme", raw: "javascript:alert(1)" },
    { why: "a protocol-relative URL", raw: "//evil.example/watchlist" },
    { why: "a protocol-relative URL with this site's path", raw: `//evil.example${PRODUCT}` },
    { why: "a path the parser reads as another host, after a backslash", raw: "/\\evil.example/watchlist" },
    { why: "a path that starts with two backslashes", raw: "\\\\evil.example/watchlist" },
    { why: "a path with a tab that the parser drops between its slashes", raw: "/\t/evil.example/watchlist" },
    { why: "an encoded //", raw: "/%2F%2Fevil.example/watchlist" },
    { why: "an encoded / in the list's path", raw: "/%2Fwatchlist" },
    { why: "a path that doesn't start with /", raw: "watchlist" },
    { why: "a path with a space before it", raw: " /watchlist" },
  ])("refuses $why: the list instead", ({ raw }) => {
    expect(returnPathOf(raw)).toBe(DEFAULT_RETURN_PATH);
  });

  it.each<{ why: string; raw: string }>([
    { why: "the home page", raw: "/" },
    { why: "the sign-in page", raw: "/auth/signin" },
    { why: "an API route", raw: "/api/watchlist/prices" },
    { why: "the sign-out route", raw: "/api/auth/signout" },
    { why: "the list with a trailing slash", raw: "/watchlist/" },
    { why: "a longer path", raw: "/watchlists" },
    { why: "a path below a product", raw: `${PRODUCT}/remove` },
    { why: "a path that isn't a product", raw: "/watchlist/refresh" },
    { why: "an id that isn't a UUID", raw: "/watchlist/26900" },
    { why: "an id with its own path", raw: `/watchlist/${PRODUCT_ID}%2F..%2F..%2Fapi%2Fauth%2Fsignout` },
  ])("refuses $why: the list instead", ({ raw }) => {
    expect(returnPathOf(raw)).toBe(DEFAULT_RETURN_PATH);
  });

  it.each<{ why: string; raw: string }>([
    { why: "a filter no chip links to", raw: `${PRODUCT}?f=najtańsze` },
    { why: "a filter in capitals", raw: "/watchlist?f=PROMO" },
    { why: "an empty filter", raw: `${PRODUCT}?f=` },
    { why: "two filters", raw: "/watchlist?f=check&f=promo" },
    { why: "a re-pin", raw: `${PRODUCT}?${REPIN_PARAM}=natura` },
    { why: "a re-pin after the filter", raw: `${PRODUCT}?f=check&${REPIN_PARAM}=natura` },
    { why: "a retry", raw: `${PRODUCT}?f=promo&${RETRY_PARAM}=hebe` },
    { why: "a search", raw: "/watchlist?q=nivea" },
    { why: "a search beside the filter", raw: "/watchlist?f=check&q=nivea" },
    { why: "a hash", raw: "/watchlist#top" },
    { why: "a hash after the filter", raw: `${PRODUCT}?f=check#remove` },
    { why: "an empty hash", raw: `${PRODUCT}#` },
  ])("refuses $why: the list instead", ({ raw }) => {
    expect(returnPathOf(raw)).toBe(DEFAULT_RETURN_PATH);
  });

  it("refuses every notice's parameter, on the list and on a product's page", () => {
    for (const param of new Set<string>([...LIST_NOTICE_PARAMS, ...NOTICE_PARAMS, ...SIGN_IN_NOTICE_PARAMS])) {
      expect(returnPathOf(`/watchlist?${param}=done`)).toBe(DEFAULT_RETURN_PATH);
      expect(returnPathOf(`${PRODUCT}?f=check&${param}=1`)).toBe(DEFAULT_RETURN_PATH);
    }
  });

  it("refuses a field that isn't text, an empty one and none at all", () => {
    expect(returnPathOf(new File([PRODUCT], "next.txt"))).toBe(DEFAULT_RETURN_PATH);
    expect(returnPathOf("")).toBe(DEFAULT_RETURN_PATH);
    expect(returnPathOf(null)).toBe(DEFAULT_RETURN_PATH);
  });

  it("gives back the path it rebuilt, never the text it was given", () => {
    // The parser reads an encoded parameter name and drops a dot segment; the target is rebuilt from what it read.
    expect(returnPathOf(`/watchlist/./${PRODUCT_ID}?%66=check`)).toBe(`${PRODUCT}?f=check`);
  });
});

describe("returnPathFor, where the middleware sends a signed-out request back to", () => {
  it.each<{ path: string; to: string }>([
    { path: "/watchlist", to: "/watchlist" },
    { path: "/watchlist?f=check&q=x", to: "/watchlist?f=check" },
    { path: `${PRODUCT}?f=check&${REPIN_PARAM}=natura`, to: `${PRODUCT}?f=check` },
    { path: `${PRODUCT}?${RETRY_PARAM}=hebe&prices=done&f=promo`, to: `${PRODUCT}?f=promo` },
    { path: `${PRODUCT}#remove`, to: PRODUCT },
  ])("keeps only the list's filter of $path: $to", ({ path, to }) => {
    expect(returnPathFor(new URL(path, SITE))).toBe(to);
  });

  it("reads a filter no chip links to as every product's", () => {
    expect(returnPathFor(new URL(`${PRODUCT}?f=najtańsze`, SITE))).toBe(PRODUCT);
  });

  it.each([
    "/api/watchlist/prices",
    "/api/watchlist/refresh",
    "/api/watchlist",
    "/watchlist/refresh",
    "/watchlist/not-a-uuid",
    "/watchlist/",
    "/watchlists",
    "/",
  ])("gives nothing for %s, which goes to the plain sign-in page", (path) => {
    expect(returnPathFor(new URL(path, SITE))).toBeNull();
  });

  it("gives a path the sign-in takes as it is", () => {
    for (const path of ["/watchlist?f=promo&q=nivea", `${PRODUCT}?f=check&${REPIN_PARAM}=natura`, PRODUCT]) {
      const back = returnPathFor(new URL(path, SITE));

      expect(back).not.toBeNull();
      expect(returnPathOf(back)).toBe(back);
    }
  });
});
