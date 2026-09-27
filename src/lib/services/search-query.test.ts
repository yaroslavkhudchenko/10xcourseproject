import { describe, expect, it } from "vitest";
import { isOwnNavigation, searchQuerySchema, toShopQuery } from "@/lib/services/search-query";

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
