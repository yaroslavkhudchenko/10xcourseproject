import { describe, expect, it } from "vitest";
import { isOwnNavigation, searchQuerySchema, searchStepOf, toShopQuery } from "@/lib/services/search-query";

describe("isOwnNavigation", () => {
  it.each([
    { site: null, own: true },
    { site: "same-origin", own: true },
    { site: "none", own: true },
    { site: "cross-site", own: false },
    { site: "same-site", own: false },
  ])("is $own for Sec-Fetch-Site $site", ({ site, own }) => {
    const headers = new Headers(site === null ? {} : { "Sec-Fetch-Site": site });

    expect(isOwnNavigation(headers)).toBe(own);
  });

  it.each<{ request: string; headers: Record<string, string> }>([
    {
      request: "Chrome's address-bar prerender",
      headers: { "Sec-Purpose": "prefetch;prerender", "Sec-Fetch-Site": "none" },
    },
    {
      request: "an older browser's prefetch from this app",
      headers: { Purpose: "prefetch", "Sec-Fetch-Site": "same-origin" },
    },
    { request: "a prefetch without Sec-Fetch-Site", headers: { "Sec-Purpose": "prefetch" } },
  ])("is false for $request, which the user may never open", ({ headers }) => {
    expect(isOwnNavigation(new Headers(headers))).toBe(false);
  });
});

// Whether the list page asks Rossmann: the one search a submitted form costs, and none for a link on another site, a
// prefetch, text that can't go into a shop URL, or no text (CLAUDE.md, "only the user's own navigation reaches a shop").
describe("searchStepOf", () => {
  const own = new Headers({ "Sec-Fetch-Site": "same-origin" });

  it("searches the trimmed text the user submitted from the list's own form", () => {
    expect(searchStepOf("  nivea   soft ", own)).toEqual({ kind: "search", query: "nivea soft" });
  });

  it.each<{ request: string; headers: Record<string, string> }>([
    { request: "a link on another site", headers: { "Sec-Fetch-Site": "cross-site" } },
    { request: "a link on another subdomain", headers: { "Sec-Fetch-Site": "same-site" } },
    {
      request: "Chrome's address-bar prerender",
      headers: { "Sec-Purpose": "prefetch;prerender", "Sec-Fetch-Site": "none" },
    },
  ])("only fills the form in for $request, asking no shop", ({ headers }) => {
    expect(searchStepOf("nivea soft", new Headers(headers))).toEqual({ kind: "filled", query: "nivea soft" });
  });

  it.each([{ text: "n" }, { text: "nivea<script>" }, { text: "x".repeat(81) }])(
    "asks no shop for text that can't be searched: $text",
    ({ text }) => {
      expect(searchStepOf(text, own)).toEqual({ kind: "invalid" });
    },
  );

  it("does nothing without search text", () => {
    expect(searchStepOf(null, own)).toEqual({ kind: "none" });
  });
});

describe("searchQuerySchema", () => {
  it.each([
    { input: "nivea soft", text: "nivea soft" },
    { input: "  Nivea   Soft 300 ml ", text: "Nivea Soft 300 ml" },
    { input: "żel pod prysznic 0,5 l", text: "żel pod prysznic 0,5 l" },
    { input: "L'Oréal Men Expert", text: "L'Oréal Men Expert" },
    { input: "krem 50+ (SPF) 100%", text: "krem 50+ (SPF) 100%" },
  ])("accepts $input as $text", ({ input, text }) => {
    expect(searchQuerySchema.parse(input)).toBe(text);
  });

  it.each([
    { input: "a", why: "too short" },
    { input: " b ", why: "too short once trimmed" },
    { input: "x".repeat(81), why: "too long" },
    { input: "<script>alert(1)</script>", why: "markup" },
    { input: "nivea\u0000soft", why: "a control character" },
    { input: "nivea; drop table", why: "a semicolon" },
  ])("rejects text that is $why", ({ input }) => {
    expect(searchQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe("toShopQuery", () => {
  it.each([
    { text: "NIVEA Soft 300 ml", query: "NIVEA Soft 300 ml" },
    { text: "Ziaja Masło kakaowe żel pod prysznic 0,5 l", query: "Ziaja Masło kakaowe żel pod prysznic 0,5 l" },
    { text: "L'Oréal Men Expert krem SPF 50+ (4,8 g)", query: "L'Oréal Men Expert krem SPF 50+ (4,8 g)" },
    { text: "NIVEA; Soft <300 ml>", query: "NIVEA Soft 300 ml" },
    { text: "  Bielenda®  krem — 50 ml  ", query: "Bielenda krem 50 ml" },
  ])("makes $text into $query", ({ text, query }) => {
    expect(toShopQuery(text)).toBe(query);
  });

  it("cuts text over 80 characters after the last whole word that fits", () => {
    const text = "Krem nawilżający do twarzy i ciała z olejkiem jojoba oraz witaminą E dla całej rodziny, 300 ml";

    expect(toShopQuery(text)).toBe("Krem nawilżający do twarzy i ciała z olejkiem jojoba oraz witaminą E dla całej");
  });

  it.each([
    { text: "", why: "empty" },
    { text: "x", why: "too short" },
    { text: "<>;", why: "only characters a shop URL can't take" },
    { text: "x".repeat(81), why: "one word over 80 characters" },
  ])("gives null for text that is $why", ({ text }) => {
    expect(toShopQuery(text)).toBeNull();
  });
});

// A lookup's search by name: a product's name between its brand and its size, which stay whole (nameQuery).
describe("toShopQuery: text it keeps whole around what it may cut", () => {
  // 86 characters.
  const longName = "Krem nawilżający do twarzy i ciała z olejkiem jojoba oraz witaminą E dla całej rodziny";

  it.each([
    { why: "they fit", text: "Soft", before: "NIVEA", after: "300 ml", query: "NIVEA Soft 300 ml" },
    {
      why: "each is cleaned",
      text: "Soft <krem>",
      before: "Bielenda®",
      after: "(300 ml)",
      query: "Bielenda Soft krem (300 ml)",
    },
    { why: "one is left out", text: "Soft", before: null, after: "300 ml", query: "Soft 300 ml" },
    {
      why: "the whole is over 80 characters: only the text is cut, after its last whole word that fits",
      text: longName,
      before: "NIVEA",
      after: "300 ml",
      query: "NIVEA Krem nawilżający do twarzy i ciała z olejkiem jojoba oraz witaminą 300 ml",
    },
    {
      // Hebe's serum, 450256, whose legal name ends with its size: the name before it, and its size after the cut.
      why: "a size after the text alone",
      text: "AA LAAB 100% Centella B12 Skoncentrowane serum-ampułka nawilżająco-odbudowujące",
      before: null,
      after: "30 ml",
      query: "AA LAAB 100% Centella B12 Skoncentrowane serum-ampułka 30 ml",
    },
    {
      why: "no word of the text fits beside them",
      text: "x".repeat(75),
      before: "NIVEA",
      after: "300 ml",
      query: "NIVEA 300 ml",
    },
  ])("joins the text between what it keeps when $why", ({ text, before, after, query }) => {
    expect(toShopQuery(text, { before, after })).toBe(query);
  });

  it("cuts the whole after its last whole word that fits when what it keeps alone leaves the text no room", () => {
    // 77 characters, beside the size's 7.
    const brand = Array.from({ length: 13 }, () => "Marka").join(" ");

    expect(toShopQuery("Soft", { before: brand, after: "300 ml" })).toBe(brand);
  });

  it("cuts text over 80 characters as before when it keeps nothing", () => {
    expect(toShopQuery(longName, {})).toBe(toShopQuery(longName));
    expect(toShopQuery(longName)).toBe(
      "Krem nawilżający do twarzy i ciała z olejkiem jojoba oraz witaminą E dla całej",
    );
  });
});
