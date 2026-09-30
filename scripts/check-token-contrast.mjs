// Design token contrast check: proves that both themes in src/styles/global.css, the light one in :root and the dark one
// in .dark, keep the text, focus and field-border pairs listed in PAIRS below readable by WCAG 2's contrast ratio: 4.5:1
// for text (1.4.3), and 3:1 for a focus outline or a text field's border against what surrounds it (1.4.11). Each pair
// is measured at the opacity its component renders it with, as SURFACES copies it from src/components/ui and the views,
// over the theme's paper (bg-paper): its --background, and wherever the paper shows through, also a dot of its grid.
// A pair a view starts to render joins PAIRS, and a changed opacity in a component changes here too.
// Run: node scripts/check-token-contrast.mjs
// It reads only the CSS file, so it needs no server, no browser and no dependency.

import { readFileSync } from "node:fs";

const CSS_FILE = "src/styles/global.css";

let failed = 0;
function check(name, ok, actual) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual}`);
  if (!ok) failed++;
}

// sRGB's transfer function, from linear light to the encoded value and back.
const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// OKLCH to encoded sRGB, through OKLab and linear sRGB, with Björn Ottosson's OKLab matrices. A colour outside sRGB has
// each channel clamped to [0, 1]: a browser on an sRGB screen clips it in much the same way, near enough for a
// threshold check.
function oklchToSrgb(lightness, chroma, hue) {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((channel) => encode(Math.min(1, Math.max(0, channel))));
}

// A colour laid over the one beneath it at `alpha`, blended in encoded sRGB, as browsers composite.
const over = (color, alpha, beneath) => color.map((channel, i) => channel * alpha + beneath[i] * (1 - alpha));

// WCAG 2's relative luminance and contrast ratio.
const luminance = ([r, g, b]) => 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)`;
const OKLCH = new RegExp(
  String.raw`^oklch\(\s*(${NUMBER})(%?)\s+(${NUMBER})(%?)\s+(${NUMBER})(?:deg)?\s*(?:/\s*(${NUMBER})(%?)\s*)?\)$`,
  "i",
);
const VAR = /^var\(\s*--([\w-]+)\s*\)$/;

/** A token's value as { rgb, alpha }, or null when it isn't an oklch() colour this check can read. */
function parseOklch(value) {
  const match = OKLCH.exec(value);
  if (!match) return null;
  const [, l, lPercent, c, cPercent, h, a, aPercent] = match;
  const lightness = Number(l) / (lPercent ? 100 : 1);
  // CSS Color 4 reads a chroma of 100% as 0.4.
  const chroma = cPercent ? (Number(c) * 0.4) / 100 : Number(c);
  const alpha = a === undefined ? 1 : Number(a) / (aPercent ? 100 : 1);
  if (lightness < 0 || lightness > 1 || chroma < 0 || alpha < 0 || alpha > 1) return null;
  return { rgb: oklchToSrgb(lightness, chroma, Number(h)), alpha };
}

// The custom properties that aren't colours, which the blocks may hold: they are neither parsed nor measured.
const NOT_COLORS = new Set(["radius"]);

// Each theme's block, without comments. <html> gets the dark theme's class, or a wrapper does inside a light page, so
// each block's values are the ones its theme renders.
const css = readFileSync(new URL(`../${CSS_FILE}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const THEMES = [
  { theme: "light", block: ":root", pattern: /^:root\s*\{([^}]*)\}/gm },
  { theme: "dark", block: ".dark", pattern: /^\.dark\s*\{([^}]*)\}/gm },
];

/**
 * The block's colour tokens by name, each as { rgb, alpha }, or null when it can't be read. Every custom property in it
 * is a colour, written as oklch(L C H) or oklch(L C H / A), or var(--name) of another colour in the same block, since a
 * var() resolves where the block applies. One this check can't read fails by its name, and so does every pair that
 * needs it: it is never skipped.
 */
function readTokens(block, body) {
  const values = new Map();
  for (const declaration of body.split(";")) {
    const text = declaration.trim();
    // Plain properties, such as color-scheme, aren't tokens.
    if (!text.startsWith("--")) continue;
    const match = /^--([\w-]+)\s*:([\s\S]*)$/.exec(text);
    if (!match) {
      check(`"${text}" in ${block}`, false, "can't read it as --name: value");
      continue;
    }
    const [, name, value] = match;
    if (!NOT_COLORS.has(name)) values.set(name, value.trim());
  }

  const tokens = new Map();
  const resolve = (name, seen) => {
    if (tokens.has(name)) return tokens.get(name);
    const value = values.get(name);
    const reference = VAR.exec(value);
    let color = null;
    if (reference === null) {
      color = parseOklch(value);
      if (color === null) {
        check(`--${name} in ${block}`, false, `can't read "${value}" as oklch(L C H), oklch(L C H / A) or var(--name)`);
      }
    } else {
      const [, target] = reference;
      if (seen.includes(target)) {
        check(`--${name} in ${block}`, false, `var(--${target}) closes a loop of var()s`);
      } else if (!values.has(target)) {
        check(`--${name} in ${block}`, false, `var(--${target}) isn't a colour set in ${block}`);
      } else {
        color = resolve(target, [...seen, target]);
      }
    }
    tokens.set(name, color);
    return color;
  };
  for (const name of values.keys()) resolve(name, [name]);
  return tokens;
}

const tokensByTheme = new Map();
for (const { theme, block, pattern } of THEMES) {
  const blocks = [...css.matchAll(pattern)];
  if (blocks.length !== 1) {
    check(`one ${block} { … } block in ${CSS_FILE}`, false, `found ${blocks.length}`);
    process.exit(1);
  }
  tokensByTheme.set(theme, readTokens(block, blocks[0][1]));
}

// Both blocks set the same tokens: a .dark wrapper inside a light page would otherwise keep the light value of the one
// .dark leaves out, where its var() was resolved.
for (const { theme, block } of THEMES) {
  for (const { theme: other, block: otherBlock } of THEMES) {
    if (other === theme) continue;
    for (const name of tokensByTheme.get(theme).keys()) {
      if (!tokensByTheme.get(other).has(name)) {
        check(`--${name} in ${otherBlock}`, false, `set in ${block} but not in ${otherBlock}`);
      }
    }
  }
}

// What the views put text, focus outlines and field borders on, as layers over the paper, bottom first: each a token and
// the opacity, in percent, its component renders it at. Tailwind's /NN modifier mixes the token with transparent, which
// keeps its colour and multiplies its alpha.
const CARD = [["card", 100]];
const SURFACES = {
  paper: [],
  card: CARD, // Card and the default Alert: bg-card
  muted: [["muted", 100]], // the raised fills: bg-muted
  "destructive alert": [["destructive", 10]], // Alert destructive: bg-destructive/10
  success: [["success", 100]], // the promo pill: bg-success
  "success alert": [["success", 10]], // Alert success: bg-success/10
  "success badge in a card": [...CARD, ["success", 15]], // Badge success: bg-success/15
  warning: [["warning", 100]], // a warning pill: bg-warning
  "warning alert": [["warning", 10]], // Alert warning: bg-warning/10
  "warning badge": [["warning", 15]], // Badge warning on the paper: a match's size warning
  "warning badge in a card": [...CARD, ["warning", 15]], // Badge warning: bg-warning/15
  primary: [["primary", 100]], // Button default: bg-primary
  "primary hover": [["primary", 90]], // Button default: hover:bg-primary/90
  "primary hover in a card": [...CARD, ["primary", 90]],
  "active chip": [["foreground", 100]], // an active filter chip: bg-foreground
};
// Where a component's dark: variant draws another surface, each theme's own.
const THEME_SURFACES = {
  light: {
    "outline button": [["background", 100]], // Button outline: bg-background
    "outline button hover": [["accent", 100]], // Button outline: hover:bg-accent
  },
  dark: {
    "outline button": [["input", 30]], // Button outline: dark:bg-input/30
    "outline button hover": [["input", 50]], // Button outline: dark:hover:bg-input/50
  },
};
// The paper labels, which stay light in both themes and carry --label-ink: the price tags and the hero ("sun", "tag-warn"
// and "tag-plain"), the stickers, the avatar's initial and a product's tile without a photo.
const LABELS = [
  "sun",
  "tag-warn",
  "tag-plain",
  "sticker-info",
  "sticker-plain",
  "avatar",
  "tile-1",
  "tile-2",
  "tile-3",
  "tile-4",
];
for (const label of LABELS) SURFACES[label] = [[label, 100]];

// A dot of the paper's grid, measured at its centre, under a glyph pixel: the worst case of what sits on the paper.
const DOT = ["background-dot", 100];

const TEXT = 4.5; // WCAG 1.4.3, text at normal size
const NON_TEXT = 3; // WCAG 1.4.11, a focus outline or a field's border against what surrounds it

// Each pair: the token drawn, the opacity it's drawn at, what it's drawn on, and the ratio it needs.
const PAIRS = [
  // Headings, prices and body text: the page's text-foreground, and a Card's text-card-foreground.
  ["foreground", 100, "paper", TEXT],
  ["foreground", 100, "card", TEXT],
  ["card-foreground", 100, "card", TEXT],
  ["foreground", 100, "muted", TEXT],
  // Hints, sizes, and each price's source and age.
  ["muted-foreground", 100, "paper", TEXT],
  ["muted-foreground", 100, "card", TEXT],
  ["muted-foreground", 100, "muted", TEXT],
  // Text links: "← Moja lista" on the paper, "Zobacz w sklepie" in a card. The session alert's sign-in link takes the
  // alert description's warning-foreground/90, measured with the warnings below.
  ["link", 100, "paper", TEXT],
  ["link", 100, "card", TEXT],
  // Primary buttons at rest and on hover: "Dopasuj w Naturze" on the paper, "To ten produkt" in a candidate's card.
  ["primary-foreground", 100, "primary", TEXT],
  ["primary-foreground", 100, "primary hover", TEXT],
  ["primary-foreground", 100, "primary hover in a card", TEXT],
  // Outline buttons ("Odśwież ceny", "Żaden z nich"): the text inherits the page's, and hover sets accent-foreground.
  ["foreground", 100, "outline button", TEXT],
  ["accent-foreground", 100, "outline button hover", TEXT],
  // The filter chips: an inactive chip's label and its count at 70% on the paper, an active chip's on its fill.
  ["foreground", 70, "paper", TEXT],
  ["background", 100, "active chip", TEXT],
  ["background", 70, "active chip", TEXT],
  // The paper labels' text.
  ...LABELS.map((label) => ["label-ink", 100, label, TEXT]),
  // Errors: the destructive Alert's text and its description at /90. The page shows no error text outside an Alert.
  ["destructive", 100, "destructive alert", TEXT],
  ["destructive", 90, "destructive alert", TEXT],
  // Success: the promo pill, a note on the paper or in a card, the Alert's text and description, and "Najtaniej" as a
  // Badge in a card.
  ["success-foreground", 100, "success", TEXT],
  ["success-foreground", 100, "paper", TEXT],
  ["success-foreground", 100, "card", TEXT],
  ["success-foreground", 100, "success alert", TEXT],
  ["success-foreground", 90, "success alert", TEXT],
  ["success-foreground", 100, "success badge in a card", TEXT],
  // Warnings: the same, with a warning pill, a price row's notices in its card, "nieaktualna" as a Badge in a card, and
  // a match's size warning as a Badge on the paper.
  ["warning-foreground", 100, "warning", TEXT],
  ["warning-foreground", 100, "paper", TEXT],
  ["warning-foreground", 100, "card", TEXT],
  ["warning-foreground", 100, "warning alert", TEXT],
  ["warning-foreground", 90, "warning alert", TEXT],
  ["warning-foreground", 100, "warning badge", TEXT],
  ["warning-foreground", 100, "warning badge in a card", TEXT],
  // The focus outline, drawn in --ring at full opacity, around a control on each surface.
  ["ring", 100, "paper", NON_TEXT],
  ["ring", 100, "card", NON_TEXT],
  ["ring", 100, "muted", NON_TEXT],
  ["ring", 100, "warning alert", NON_TEXT],
  // A text field's border, the search's on the paper and a field's in a card.
  ["input", 100, "paper", NON_TEXT],
  ["input", 100, "card", NON_TEXT],
];

/** The pair's contrast in one theme, over its paper or a dot of it, or why it can't be measured. */
function measure(theme, layers, [color, percent]) {
  const tokens = tokensByTheme.get(theme);
  const block = THEMES.find((entry) => entry.theme === theme).block;
  const needed = ["background", ...layers.map(([token]) => token), color];
  const unreadable = needed.find((token) => !tokens.get(token));
  if (unreadable !== undefined) {
    return { problem: tokens.has(unreadable) ? `can't read --${unreadable}` : `--${unreadable} isn't set in ${block}` };
  }
  const paper = tokens.get("background");
  if (paper.alpha < 1) return { problem: "--background must be opaque, since it is the page's paper" };
  const blend = (beneath, [token, opacity]) => {
    const { rgb, alpha } = tokens.get(token);
    return over(rgb, (alpha * opacity) / 100, beneath);
  };
  const background = layers.reduce(blend, paper.rgb);
  return { ratio: contrast(blend(background, [color, percent]), background) };
}

/**
 * Whether the paper shows through the surface: none of its layers is opaque as drawn. A layer that can't be read fails
 * the pair anyway, so it counts as opaque, and the pair fails once.
 */
function showsPaper(theme, layers) {
  const tokens = tokensByTheme.get(theme);
  return !layers.some(([token, opacity]) => {
    const color = tokens.get(token);
    return !color || color.alpha * opacity >= 100;
  });
}

for (const { theme } of THEMES) {
  const surfaces = { ...SURFACES, ...THEME_SURFACES[theme] };
  for (const pair of PAIRS) {
    const [color, percent, surface, minimum] = pair;
    const drawn = percent === 100 ? color : `${color}/${percent}`;
    const layers = surfaces[surface];
    const variants = [{ name: surface, layers }];
    if (showsPaper(theme, layers)) variants.push({ name: `${surface} over a dot`, layers: [DOT, ...layers] });
    for (const variant of variants) {
      const name = `${theme}: ${drawn} on ${variant.name}`;
      const { ratio, problem } = measure(theme, variant.layers, pair);
      if (problem === undefined) {
        // Rounded down, so a failing ratio never reads as the minimum.
        check(name, ratio >= minimum, `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1, needs ${minimum}:1`);
      } else {
        check(name, false, problem);
      }
    }
  }
}

if (failed) console.log(`\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
