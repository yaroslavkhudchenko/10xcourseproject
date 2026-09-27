import { describe, expect, it } from "vitest";
import { searchQuerySchema } from "@/lib/services/search-query";

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
