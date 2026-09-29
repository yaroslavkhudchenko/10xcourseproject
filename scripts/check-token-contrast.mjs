// Design token contrast check: proves that the dark theme in src/styles/global.css keeps every text and focus ring the
// product page renders readable, by WCAG 2's contrast ratio: 4.5:1 for text (1.4.3) and 3:1 for the focus ring
// (1.4.11). Each pair is measured at the opacity its component renders it with, over both stops of the page's
// bg-cosmic gradient.
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

// The one .dark block, without comments: <html> carries the class, so its values are the ones every page renders.
const css = readFileSync(new URL(`../${CSS_FILE}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const darkBlocks = [...css.matchAll(/^\.dark\s*\{([^}]*)\}/gm)];
if (darkBlocks.length !== 1) {
  check(`one .dark { … } block in ${CSS_FILE}`, false, `found ${darkBlocks.length}`);
  process.exit(1);
}

// Every custom property in the block is a colour, written as oklch(L C H) or oklch(L C H / A). One this check can't
// read fails by its name, and so does every pair that needs it: it is never skipped.
const tokens = new Map();
for (const declaration of darkBlocks[0][1].split(";")) {
  const text = declaration.trim();
  // Plain properties, such as color-scheme, aren't tokens.
  if (!text.startsWith("--")) continue;
  const match = /^(--[\w-]+)\s*:([\s\S]*)$/.exec(text);
  if (!match) {
    check(`"${text}" in .dark`, false, "can't read it as --name: value");
    continue;
  }
  const [, name, value] = match;
  const color = parseOklch(value.trim());
  tokens.set(name.slice(2), color);
  if (color === null) {
    check(`${name} in .dark`, false, `can't read "${value.trim()}" as oklch(L C H) or oklch(L C H / A)`);
  }
}

// The page's canvas is bg-cosmic, a gradient from --background through --background-glow and back, so every pair is
// measured over both stops.
const CANVAS = ["background", "background-glow"];

// What the product page puts text and focus rings on, as layers over the canvas, bottom first: each a token and the
// opacity, in percent, its component renders it at. Tailwind's /NN modifier mixes the token with transparent, which
// keeps its colour and multiplies its alpha.
const CARD = [["card", 100]];
const SURFACES = {
  canvas: [],
  card: CARD, // Card and the default Alert: bg-card
  "destructive alert": [["destructive", 10]], // Alert destructive: bg-destructive/10
  "success alert": [["success", 10]], // Alert success: bg-success/10
  "warning alert": [["warning", 10]], // Alert warning: bg-warning/10
  "success badge in a card": [...CARD, ["success", 15]], // Badge success: bg-success/15
  "warning badge in a card": [...CARD, ["warning", 15]], // Badge warning: bg-warning/15
  primary: [["primary", 100]], // Button default: bg-primary
  "primary in a card": [...CARD, ["primary", 100]],
  "primary hover": [["primary", 90]], // Button default: hover:bg-primary/90
  "primary hover in a card": [...CARD, ["primary", 90]],
  "outline button": [["input", 30]], // Button outline: dark:bg-input/30
  "outline button hover": [["input", 50]], // Button outline: dark:hover:bg-input/50
};

const TEXT = 4.5; // WCAG 1.4.3, text at normal size
const FOCUS = 3; // WCAG 1.4.11, a focus indicator against what surrounds it

// Each pair: the token drawn, the opacity it's drawn at, what it's drawn on, and the ratio it needs.
const PAIRS = [
  // Headings, prices and body text: the page's text-foreground, and a Card's text-card-foreground.
  ["foreground", 100, "canvas", TEXT],
  ["foreground", 100, "card", TEXT],
  ["card-foreground", 100, "card", TEXT],
  // Hints, sizes, and each price's source and age.
  ["muted-foreground", 100, "canvas", TEXT],
  ["muted-foreground", 100, "card", TEXT],
  // Text links: "← Moja lista" on the canvas, "Zobacz w sklepie" in a card, the session alert's sign-in link.
  ["link", 100, "canvas", TEXT],
  ["link", 100, "card", TEXT],
  ["link", 100, "warning alert", TEXT],
  // Primary buttons at rest and on hover: "Dopasuj w Naturze" on the canvas, "To ten produkt" in a candidate's card.
  ["primary-foreground", 100, "primary", TEXT],
  ["primary-foreground", 100, "primary in a card", TEXT],
  ["primary-foreground", 100, "primary hover", TEXT],
  ["primary-foreground", 100, "primary hover in a card", TEXT],
  // Outline buttons ("Odśwież ceny", "Żaden z nich"): the text inherits the page's, and hover sets accent-foreground.
  ["foreground", 100, "outline button", TEXT],
  ["accent-foreground", 100, "outline button hover", TEXT],
  // Errors: bare error text, and the destructive Alert's text and its description at /90.
  ["destructive", 100, "canvas", TEXT],
  ["destructive", 100, "destructive alert", TEXT],
  ["destructive", 90, "destructive alert", TEXT],
  // Success: a note on the canvas or in a card, the Alert's text and description, and "Najtaniej" as a Badge.
  ["success-foreground", 100, "canvas", TEXT],
  ["success-foreground", 100, "card", TEXT],
  ["success-foreground", 100, "success alert", TEXT],
  ["success-foreground", 90, "success alert", TEXT],
  ["success-foreground", 100, "success badge in a card", TEXT],
  // Warnings: the same, with a price row's notices in its card and "nieaktualna" as a Badge.
  ["warning-foreground", 100, "canvas", TEXT],
  ["warning-foreground", 100, "card", TEXT],
  ["warning-foreground", 100, "warning alert", TEXT],
  ["warning-foreground", 90, "warning alert", TEXT],
  ["warning-foreground", 100, "warning badge in a card", TEXT],
  // The focus ring, the base layer's outline-ring/50 and the components' ring-ring/50, around a control on each surface.
  ["ring", 50, "canvas", FOCUS],
  ["ring", 50, "card", FOCUS],
  ["ring", 50, "warning alert", FOCUS],
];

/** The pair's contrast over one stop of the canvas, or why it can't be measured. */
function measure(stop, [color, percent, surface]) {
  const layers = [...SURFACES[surface], [color, percent]];
  const unreadable = [stop, ...layers.map(([token]) => token)].find((token) => !tokens.get(token));
  if (unreadable !== undefined) {
    return { problem: tokens.has(unreadable) ? `can't read --${unreadable}` : `--${unreadable} isn't set in .dark` };
  }
  const canvas = tokens.get(stop);
  if (canvas.alpha < 1) return { problem: `--${stop} must be opaque, since it is the page's canvas` };
  const blend = (beneath, [token, opacity]) => {
    const { rgb, alpha } = tokens.get(token);
    return over(rgb, (alpha * opacity) / 100, beneath);
  };
  const background = SURFACES[surface].reduce(blend, canvas.rgb);
  return { ratio: contrast(blend(background, [color, percent]), background) };
}

for (const stop of CANVAS) {
  for (const pair of PAIRS) {
    const [color, percent, surface, minimum] = pair;
    const drawn = percent === 100 ? color : `${color}/${percent}`;
    const name = `${drawn} on ${surface === "canvas" ? stop : `${surface} over ${stop}`}`;
    const { ratio, problem } = measure(stop, pair);
    if (problem === undefined) {
      // Rounded down, so a failing ratio never reads as the minimum.
      check(name, ratio >= minimum, `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1, needs ${minimum}:1`);
    } else {
      check(name, false, problem);
    }
  }
}

if (failed) console.log(`\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
