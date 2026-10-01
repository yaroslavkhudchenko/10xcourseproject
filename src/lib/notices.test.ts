import { describe, expect, it } from "vitest";
import {
  DECISION_CODES,
  ERROR_PARAM,
  EXISTS_PARAM,
  LIST_NOTICE_PARAMS,
  LIST_PRICES_PARAM,
  NOTICE_PARAMS,
  PRICES_PARAM,
  REMOVAL_PARAM,
  REMOVED_PARAM,
  withoutNotices,
} from "@/lib/notices";

// Each page's address-bar script forgets the parameters these lists name once their notice has shown, and keeps every
// other one. The scripts are inline browser code, so these tests pin what they forget: a parameter left out would show
// its notice again on a reload or from a copied link, and one put in would drop what the address keeps, such as the
// list's filter.

describe("LIST_NOTICE_PARAMS, which the list's address bar forgets", () => {
  it("holds every parameter the list shows a notice by: Dodaj's, an error's, the refresh's and a removal's", () => {
    expect(LIST_NOTICE_PARAMS).toHaveLength(4);
    expect(LIST_NOTICE_PARAMS).toEqual(
      expect.arrayContaining([EXISTS_PARAM, ERROR_PARAM, LIST_PRICES_PARAM, REMOVED_PARAM]),
    );
  });

  it("keeps the list's filter and its search", () => {
    expect(LIST_NOTICE_PARAMS).not.toContain("f");
    expect(LIST_NOTICE_PARAMS).not.toContain("q");
  });
});

describe("NOTICE_PARAMS, which the product page's address bar forgets", () => {
  it("holds a decision's, an error's, both refreshes' and a failed removal's", () => {
    expect(NOTICE_PARAMS).toEqual(
      expect.arrayContaining([...DECISION_CODES, ERROR_PARAM, PRICES_PARAM, LIST_PRICES_PARAM, REMOVAL_PARAM]),
    );
  });

  it("keeps the list's filter", () => {
    expect(NOTICE_PARAMS).not.toContain("f");
  });
});

describe("a removal's parameters", () => {
  it("differ, so the list's notice and the product page's error never read each other's code", () => {
    expect(REMOVED_PARAM).not.toBe(REMOVAL_PARAM);
  });
});

describe("withoutNotices, which both pages' address-bar scripts forget their notices through", () => {
  const BASE = "https://drogeria.example";

  it("drops every notice parameter it names and keeps the filter, the search and the hash", () => {
    expect(withoutNotices(`${BASE}/watchlist?f=check&q=nivea&removed=done&exists=1#top`, LIST_NOTICE_PARAMS)).toBe(
      `${BASE}/watchlist?f=check&q=nivea#top`,
    );
    expect(withoutNotices(`${BASE}/watchlist/x?f=promo&matched=1&removal=failed#remove`, NOTICE_PARAMS)).toBe(
      `${BASE}/watchlist/x?f=promo#remove`,
    );
  });

  it("gives null for an address without any of them, which has nothing to forget", () => {
    expect(withoutNotices(`${BASE}/watchlist?f=check&q=nivea`, LIST_NOTICE_PARAMS)).toBeNull();
    expect(withoutNotices(`${BASE}/watchlist/x?repin=1`, NOTICE_PARAMS)).toBeNull();
  });

  it("drops a parameter it names even when the address holds it more than once", () => {
    expect(withoutNotices(`${BASE}/watchlist?removed=done&removed=gone`, LIST_NOTICE_PARAMS)).toBe(`${BASE}/watchlist`);
  });
});
