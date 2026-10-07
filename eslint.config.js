import { fixupPluginRules } from "@eslint/compat";
import eslint from "@eslint/js";
import { defineConfig, globalIgnores, includeIgnoreFile } from "eslint/config";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

// eslint-plugin-react still uses context APIs removed in ESLint 10; wrap it until it ships native support.
const reactPlugin = fixupPluginRules(pluginReact);

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = defineConfig({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = defineConfig({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [eslintPluginReactHooks.configs.flat["recommended-latest"]],
  plugins: { react: reactPlugin },
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...pluginReact.configs.flat.recommended.rules,
    "react/react-in-jsx-scope": "off",
  },
});

const astroConfig = defineConfig({
  files: ["**/*.astro"],
  languageOptions: {
    // astro-eslint-parser does not support projectService yet and warns on every file; hand it a project path instead.
    parserOptions: { projectService: false, project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
  },
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
    // A page redirects with a top-level `return Astro.redirect(...)` in its frontmatter; the rule's `returns` check
    // expects every return inside a function and crashes on that one. Its other checks stay on.
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false, returns: false } }],
  },
});

// The scripts run in Node and name each global they use; any other comes from a node: module. AbortSignal gives a
// request its timeout (scripts/check-production.mjs).
const scriptsConfig = defineConfig({
  files: ["scripts/**/*.mjs"],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: {
    globals: { console: true, process: true, fetch: true, URL: true, URLSearchParams: true, AbortSignal: true },
  },
  rules: { "no-console": "off" },
});

// The watchlist's pages run these modules in the browser: the product page's price island and the selected list row's
// tag beside it (RowTag), with every piece, rule and shadcn component they render with and the cn() helper; the address
// bar's script (the notice codes); and the theme switch's script (the theme's names). So none may import server-only
// code: a well-meant import would pull zod, Supabase or the shop gate into the page's JavaScript. Type-only imports are
// erased from the bundle, so they stay allowed. The names below are the `@/` ones, so a relative path, which would slip
// past them, has to go through the alias too. A module an island starts to import joins `files`.
const ISLAND_MESSAGE = "The watchlist's pages run this file in the browser, so it must stay free of server-only code.";
const islandConfig = defineConfig({
  files: [
    "src/lib/services/matching.ts",
    "src/lib/services/price-comparison.ts",
    "src/lib/services/watchlist-rows.ts",
    "src/lib/shop-messages.ts",
    "src/lib/json-request.ts",
    "src/lib/notices.ts",
    "src/lib/theme.ts",
    "src/lib/utils.ts",
    "src/components/ui/alert.tsx",
    "src/components/ui/badge.tsx",
    "src/components/ui/button.tsx",
    "src/components/ui/card.tsx",
    "src/components/watchlist/match-card.ts",
    "src/components/watchlist/price-comparison-state.ts",
    "src/components/watchlist/shop-fills.ts",
    "src/components/watchlist/thumb-tile.ts",
    "src/components/watchlist/MatchCard.tsx",
    "src/components/watchlist/Price.tsx",
    "src/components/watchlist/PriceComparison.tsx",
    "src/components/watchlist/PriceComparisonView.tsx",
    "src/components/watchlist/PriceTrack.tsx",
    "src/components/watchlist/ProductThumb.tsx",
    "src/components/watchlist/ProductTitle.tsx",
    "src/components/watchlist/RefreshBar.tsx",
    "src/components/watchlist/RefreshForm.tsx",
    "src/components/watchlist/RowTag.tsx",
    "src/components/watchlist/ShopCard.tsx",
    "src/components/watchlist/ShopLink.tsx",
    "src/components/watchlist/Sticker.tsx",
    "src/components/watchlist/VerdictHero.tsx",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            // Every service is server-side except the comparison rules, the list's row rules and the matching rule
            // whose comparisons the row rules use, which the islands share with the pages.
            group: [
              "zod",
              "zod/*",
              "astro/zod",
              "@supabase/*",
              "astro:*",
              "@/lib/supabase",
              "@/lib/services/*",
              "!@/lib/services/matching",
              "!@/lib/services/price-comparison",
              "!@/lib/services/watchlist-rows",
            ],
            message: ISLAND_MESSAGE,
            allowTypeImports: true,
          },
          {
            regex: "^\\.\\.?/",
            message: `${ISLAND_MESSAGE} Import through the @/ alias, which this check reads.`,
            allowTypeImports: true,
          },
        ],
      },
    ],
  },
});

// The front door, the sign-in pages, the watchlist's two pages, their shells, their components, the shadcn components
// and the kitchen sinks are built from the design tokens in src/styles/global.css and the components in
// src/components/ui only, so a Tailwind palette class, an arbitrary px/rem value or an arbitrary colour in any string
// there fails: a class, class:list or className value, a cn() argument or a template literal.
// The patterns start from the /10x-ui scan's: its palette part, widened to every colour utility's prefix (a border's
// side, ring-offset, decoration, caret, accent, placeholder) and to Tailwind 4.3's mauve, mist, olive and taupe; its
// px/rem part; and its colour functions, plus oklab(), as arbitrary values such as bg-[#0a0e1a] or text-[oklch(…)].
// Unlike the scan, the rule doesn't flag a plain hex string, which ids and anchors would hit, nor a colour in a `style`
// attribute. No pattern has a "/", which would end the selector's regex. A view cleaned later joins `files`; a glob
// reads brackets as a character class, so [id] is escaped. No other config sets no-restricted-syntax for these files,
// and one that did would replace these selectors rather than add to them.
const PALETTE_CLASS = String.raw`\b(bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|from|via|to|fill|stroke|shadow|divide|decoration|caret|accent|placeholder)-(slate|gray|zinc|neutral|stone|mauve|mist|olive|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b`;
const ARBITRARY_VALUE = String.raw`-\[[0-9.]+(px|rem)\]`;
const ARBITRARY_COLOR = String.raw`-\[(#|rgba?\(|hsla?\(|oklch\(|oklab\()`;
const TOKEN_MESSAGE =
  "Use a design token from src/styles/global.css (for example bg-card or text-muted-foreground) or a component from src/components/ui, not a Tailwind palette class or an arbitrary value.";
const tokenConfig = defineConfig({
  files: [
    "src/pages/index.astro",
    "src/pages/auth/**/*.astro",
    "src/pages/watchlist.astro",
    "src/pages/watchlist/\\[id\\].astro",
    "src/layouts/AuthShell.astro",
    "src/layouts/WatchlistShell.astro",
    "src/components/auth/**/*.astro",
    "src/components/shell/**/*.{astro,tsx}",
    "src/components/ui/**/*.{astro,tsx}",
    "src/components/watchlist/**/*.{astro,tsx}",
    "src/dev/**/*.{astro,ts}",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      ...[PALETTE_CLASS, ARBITRARY_VALUE, ARBITRARY_COLOR].flatMap((pattern) => [
        { selector: `Literal[value=/${pattern}/]`, message: TOKEN_MESSAGE },
        { selector: `TemplateElement[value.raw=/${pattern}/]`, message: TOKEN_MESSAGE },
      ]),
    ],
  },
});

// Every shop request goes through the gate (src/lib/services/shop-gate.ts), which counts it under the shop's cap and
// stops a shop that refuses, so the server's code names the global fetch nowhere else: not as a call, and not through
// globalThis, window or self. A new adapter or route that called a shop directly would bypass the cap everyone shares.
// The gate's file is the one place allowed, the tests and their helpers stub fetch, and the islands' browser code,
// which posts only to the app's own route, isn't server code.
const SHOP_FETCH_MESSAGE = "Send every shop request through gate.fetch (src/lib/services/shop-gate.ts), never fetch.";
const serverFetchConfig = defineConfig({
  files: ["src/lib/**/*.ts", "src/pages/**/*.{ts,astro}", "src/middleware.ts"],
  ignores: ["src/lib/services/shop-gate.ts", "src/lib/services/testing/**", "**/*.test.ts"],
  rules: {
    "no-restricted-globals": ["error", { name: "fetch", message: SHOP_FETCH_MESSAGE }],
    "no-restricted-properties": [
      "error",
      ...["globalThis", "window", "self"].map((object) => ({ object, property: "fetch", message: SHOP_FETCH_MESSAGE })),
    ],
  },
});

// unbound-method reads expect(mock.fn) assertions as detached methods, but a vi.fn() mock never relies on `this`.
const testConfig = defineConfig({
  files: ["**/*.test.ts"],
  rules: { "@typescript-eslint/unbound-method": "off" },
});

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  // Skills and their helper scripts are written by the 10x CLI, not project code, and a change's design handoff is a
  // reference kept byte for byte as its designer sent it.
  globalIgnores([".claude/", "context/**/handoff/"]),
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  scriptsConfig,
  islandConfig,
  tokenConfig,
  serverFetchConfig,
  testConfig,
  eslintPluginPrettier,
);
