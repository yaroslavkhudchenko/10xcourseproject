import { describe, expect, it } from "vitest";
import { parsePolishPrice } from "@/lib/services/shops/price-text";

// Super-Pharm's answers write a no-break space before "zł"; some formatters group thousands with a narrow one.
const NBSP = "\u00A0";
const NARROW_NBSP = "\u202F";

describe("parsePolishPrice", () => {
  it.each([
    { form: "a space before zł", text: "33,99 zł", amount: 33.99 },
    { form: "a no-break space before zł, as Super-Pharm writes it", text: `33,99${NBSP}zł`, amount: 33.99 },
    { form: "grosze only", text: "0,99 zł", amount: 0.99 },
    { form: "four digits of złoty, ungrouped as Polish writes them", text: "1234,56 zł", amount: 1234.56 },
    { form: "thousands grouped by a space", text: "1 234,56 zł", amount: 1234.56 },
    { form: "thousands grouped by a no-break space", text: `1${NBSP}234,56 zł`, amount: 1234.56 },
    { form: "thousands grouped by a narrow no-break space", text: `1${NARROW_NBSP}234,56${NBSP}zł`, amount: 1234.56 },
    { form: "millions grouped", text: "12 345 678,90 zł", amount: 12345678.9 },
  ])("reads a price with $form", ({ text, amount }) => {
    expect(parsePolishPrice(text)).toBe(amount);
  });

  it.each<{ why: string; value: unknown }>([
    { why: "a dot as the decimal mark", value: "33.99 zł" },
    { why: "one digit of grosze", value: "33,9 zł" },
    { why: "three digits of grosze", value: "33,999 zł" },
    { why: "no grosze", value: "33 zł" },
    { why: "no złoty", value: ",99 zł" },
    { why: "no zł", value: "33,99" },
    { why: "another currency", value: "33,99 PLN" },
    { why: "no space before zł", value: "33,99zł" },
    { why: "two spaces before zł", value: "33,99  zł" },
    { why: "a narrow no-break space before zł", value: `33,99${NARROW_NBSP}zł` },
    { why: "a group of two digits", value: "1 23,45 zł" },
    { why: "a first group of four digits", value: "1234 567,89 zł" },
    { why: "a sign", value: "-33,99 zł" },
    { why: "spaces around it", value: " 33,99 zł " },
    { why: "more digits than a number holds", value: `${"9".repeat(400)},00 zł` },
    { why: "false, which Super-Pharm sends for no 30-day low", value: false },
    { why: "empty text", value: "" },
    { why: "a number", value: 33.99 },
    { why: "null", value: null },
    { why: "a list", value: ["33,99 zł"] },
  ])("reads nothing from $why", ({ value }) => {
    expect(parsePolishPrice(value)).toBeNull();
  });
});
