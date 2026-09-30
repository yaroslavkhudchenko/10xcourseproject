import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

// The tokens src/styles/global.css's @theme blocks define, which cn() must know: tailwind-merge takes a name it doesn't
// know for another kind of class and drops it beside one of that kind (src/lib/utils.ts).
const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// Each @theme block's body, up to the brace that closes it at the start of a line; a nested @keyframes is indented.
const themeBlocks = [...css.matchAll(/^@theme[^{]*\{([\s\S]*?)^\}/gm)].map(([, body]) => body);

/** The names the @theme blocks give a namespace: "price-hero" for --text-price-hero. */
function themeNames(namespace: string): string[] {
  const names = new Set<string>();
  const declaration = new RegExp(String.raw`^\s*--${namespace}-([\w-]+?)\s*:`, "gm");
  for (const block of themeBlocks) {
    for (const [, name] of block.matchAll(declaration)) {
      // A token's own settings, such as --text-price-hero--line-height, make no class of their own.
      if (!name.includes("--")) {
        names.add(name);
      }
    }
  }
  return [...names];
}

describe("cn and the @theme tokens", () => {
  it("finds the tokens it checks", () => {
    expect(themeNames("text")).toEqual(expect.arrayContaining(["price-hero", "price-hero-lg", "compact"]));
    expect(themeNames("radius")).toEqual(expect.arrayContaining(["card", "card-lg", "button"]));
    expect(themeNames("shadow")).toEqual(expect.arrayContaining(["primary", "selected"]));
    expect(themeNames("tracking")).toContain("price");
    expect(themeNames("animate")).toContain("stamp");
    expect(themeNames("border-width")).toContain("hairline");
    // Colours set in :root and .dark, such as --shadow-ink, aren't in a @theme block.
    expect(themeNames("shadow")).not.toContain("ink");
  });

  it.each(themeNames("text"))("keeps text-%s beside a text colour, and merges it with another size", (name) => {
    expect(cn(`text-${name}`, "text-label-ink")).toBe(`text-${name} text-label-ink`);
    expect(cn("text-sm", `text-${name}`)).toBe(`text-${name}`);
  });

  it.each(themeNames("radius"))("merges rounded-%s with another radius", (name) => {
    expect(cn("rounded-full", `rounded-${name}`)).toBe(`rounded-${name}`);
    expect(cn(`rounded-${name}`, "rounded-full")).toBe("rounded-full");
  });

  it.each(themeNames("shadow"))("keeps shadow-%s beside a shadow colour, and merges it with another shadow", (name) => {
    expect(cn(`shadow-${name}`, "shadow-sun")).toBe(`shadow-${name} shadow-sun`);
    expect(cn("shadow-none", `shadow-${name}`)).toBe(`shadow-${name}`);
  });

  it.each(themeNames("tracking"))("merges tracking-%s with another tracking", (name) => {
    expect(cn("tracking-tight", `tracking-${name}`)).toBe(`tracking-${name}`);
  });

  it.each(themeNames("animate"))("merges animate-%s with another animation", (name) => {
    expect(cn("animate-spin", `animate-${name}`)).toBe(`animate-${name}`);
  });

  it.each(themeNames("border-width"))(
    "keeps border-%s beside a border colour, and merges it with another width, on every side",
    (name) => {
      for (const side of ["", "-x", "-y", "-s", "-e", "-t", "-r", "-b", "-l"]) {
        expect(cn(`border${side}-${name}`, `border${side}-border`)).toBe(`border${side}-${name} border${side}-border`);
        expect(cn(`border${side}-2`, `border${side}-${name}`)).toBe(`border${side}-${name}`);
      }
    },
  );
});
