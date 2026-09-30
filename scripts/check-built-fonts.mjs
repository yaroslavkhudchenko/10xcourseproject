// Built-font check: proves that the production build shipped the web fonts the `fonts` config in astro.config.mjs asks
// for. A build that can't reach Google Fonts, or asks for a family Google doesn't have, still succeeds, with only a
// warning ("No data found for font family"), and ships no files for that family: its pages then quietly fall back to
// the system's fonts. So this counts the .woff2 files the build copied to dist/client/_astro/fonts/, which the Worker
// serves with its static assets, and fails below the number the config yields.
// `npm run build` runs it after `astro build`, so a build without its fonts fails wherever it runs: in CI, in Workers
// Builds, which then deploys nothing, and locally, offline too. On its own, after `astro build`:
// node scripts/check-built-fonts.mjs
// It reads only the build output, so it needs no server, no network and no dependency.

import { readdirSync } from "node:fs";

const FONTS_DIR = "dist/client/_astro/fonts";

// The files the config yields, one per subset of each file Google serves: Bricolage Grotesque is one variable file for
// its weights 400 to 800 and optical sizes, and DM Mono one file for each of its weights, 400 and 500, each in latin and
// latin-ext. Change it with the config.
const EXPECTED_FILES = 2 + 2 * 2;

let failed = 0;
function check(name, ok, actual) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual}`);
  if (!ok) failed++;
}

let files = null;
try {
  files = readdirSync(new URL(`../${FONTS_DIR}/`, import.meta.url)).filter((name) => name.endsWith(".woff2"));
} catch (error) {
  check(`${FONTS_DIR}/`, false, `can't read it (${error.code ?? error.message}): run npm run build first`);
}

if (files !== null) {
  check(
    `.woff2 files in ${FONTS_DIR}/`,
    files.length >= EXPECTED_FILES,
    `found ${files.length}, needs at least ${EXPECTED_FILES}`,
  );
}

process.exit(failed ? 1 : 0);
