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

const scriptsConfig = defineConfig({
  files: ["scripts/**/*.mjs"],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: { globals: { console: true, process: true, fetch: true, URL: true, URLSearchParams: true } },
  rules: { "no-console": "off" },
});

// The product page's island runs these modules in the browser, so none may import server-only code: a well-meant
// import would pull zod, Supabase or the shop gate into the page's JavaScript. Type-only imports are erased from the
// bundle, so they stay allowed. The names below are the `@/` ones, so a relative path, which would slip past them, has
// to go through the alias too.
const ISLAND_MESSAGE = "The product page's island imports this file, so it must stay free of server-only code.";
const islandConfig = defineConfig({
  files: [
    "src/lib/services/price-comparison.ts",
    "src/lib/shop-messages.ts",
    "src/lib/json-request.ts",
    "src/components/watchlist/price-comparison-state.ts",
    "src/components/watchlist/PriceComparison.tsx",
    "src/components/watchlist/PriceComparisonView.tsx",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            // Every service is server-side except the comparison rules, which the island shares with the pages.
            group: [
              "zod",
              "zod/*",
              "astro/zod",
              "@supabase/*",
              "astro:*",
              "@/lib/supabase",
              "@/lib/services/*",
              "!@/lib/services/price-comparison",
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

// unbound-method reads expect(mock.fn) assertions as detached methods, but a vi.fn() mock never relies on `this`.
const testConfig = defineConfig({
  files: ["**/*.test.ts"],
  rules: { "@typescript-eslint/unbound-method": "off" },
});

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  // Skills and their helper scripts are written by the 10x CLI, not project code.
  globalIgnores([".claude/"]),
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  scriptsConfig,
  islandConfig,
  testConfig,
  eslintPluginPrettier,
);
