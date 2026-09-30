# "Etykiety i naklejki" Redesign Implementation Plan

## Overview

The owner's Claude Design handoff "Etykiety i naklejki" (`handoff/`) redesigns the two shopping screens, the watchlist `/watchlist` and the product page `/watchlist/<id>`:

- prices styled as shelf labels;
- a sticker on the product's price;
- a price track against the 30-day low;
- light and dark themes with a switch;
- a two-pane desktop layout.

This change rebuilds both screens on that design, in the codebase's own patterns: server-rendered pages, forms that work without JavaScript, tokens and shared components, and decision logic in tested services. It adds no server state, no migration and no npm dependency. The pages the redesign doesn't cover stay dark until S-07.

## Current State Analysis

- **Theme:** one dark look, hardcoded as `<html lang={lang} class="dark">` (`src/layouts/Layout.astro:15`), with the "cosmic" values in `.dark` (`src/styles/global.css:54-96`) and a gradient utility `bg-cosmic` (`global.css:143-145`). The light `:root` values (`global.css:8-48`) are the unused shadcn defaults. There's no web font and no theme code anywhere in `src/`.
- **Pages outside the redesign:** `/` (through `Welcome.astro` and `Topbar.astro`), `/dashboard`, `/auth/signin`, `/auth/signup` and `/auth/confirm-email`, with the React forms in `src/components/auth/*`, paint white and translucent-white literals on `bg-cosmic`. They only work on a dark canvas.
- **The list page** (`src/pages/watchlist.astro`, 328 lines) is a single 512 px column of palette literals (`bg-cosmic`, `text-white`, `bg-white/5`, emerald/amber/purple tints). Its row logic lives in the page:
  - `NATURA_STATUS` and `naturaStatus()` at `:47-60`, and the price line and row lines at `:77-96`.
  - The row itself is inline markup at `:299-318`, with `ProductSummary` and visible `listSummaryText` lines.
  - The page reads items, match states and latest prices at `:35-40`. The price read (`listLatestPrices`, `src/lib/services/prices.ts:133`) and the match read (`listMatchStates`, `src/lib/services/matches.ts:279-290`) drop odd rows silently. `src/lib/services/price-targets.ts:58-59` shares both reads.
- **The product page** (`src/pages/watchlist/[id].astro`) is already on tokens and `src/components/ui` (product-page-ui). It's still a single column:
  - `ProductHeader` (`:180`), then the price island `PriceComparison` (`:194-201`), which renders only the matched shops (`:113-138`).
  - Below them the server-rendered `NaturaSection` (`:204`), whose eight view kinds come from `NaturaView` (`src/lib/services/natura-view.ts`).
  - The island's refresh form doubles as the no-JavaScript fallback (`PriceComparisonView.tsx:70-87`).
- **Contrast guard:** `scripts/check-token-contrast.mjs` reads only the `.dark` block (`:71-75`), accepts only `oklch()` values for every custom property (`:50-67`, `:80-95`), and measures 29 pairs over the two stops of `bg-cosmic` (`:99`). CI runs it (`.github/workflows/ci.yml:21-22`).
- **Lint guard:** `tokenConfig` (`eslint.config.js:136-162`) refuses palette classes, `-[Npx]`/`-[Nrem]` values and arbitrary colours in the product page's files only. `islandConfig` (`:83-134`) keeps server modules out of the island's modules, by an explicit file list.
- **The handoff** sits untracked in `context/changes/etykiety-redesign/handoff/`, where `eslint .` and the TypeScript program pick up its 69 KB `support.js`: ESLint and tsconfig ignore neither it nor `context/`.

## Desired End State

**On a phone:**

- `/watchlist` shows:
  - the logo, and an avatar that opens a menu with the email, the theme switch and "Wyloguj";
  - "Moja lista" with a count bubble and "Odśwież ceny";
  - the search field and the three filter chips;
  - the product rows, each with a shelf-label price tag.
- `/watchlist/<id>` shows:
  - a back link;
  - the product's title;
  - the hero naming the cheapest shop in big shelf-label digits;
  - the price track;
  - one card per shop, with Natura's matching state inside its card;
  - a sticky bottom bar with "Odśwież ceny".

**At 1024 px and up:** a header on top (logo, search with a `/` shortcut, theme switch, account), the list in a 420 px left column, and the product, the search results or a prompt on the right. Both columns scroll independently. The selected product's row follows its refresh.

**Throughout:**

- light and dark themes, following the system until the user picks one, with no flash on load;
- self-hosted Bricolage Grotesque and DM Mono;
- every control at least 44 px to tap;
- a visible focus outline;
- WCAG AA contrast in both themes;
- everything works without JavaScript except the theme switch.

**Facts only:** the stickers say only "Tylko 1 sklep" or "Stara cena", and nothing judges a price until FR-012 exists.

**Verify** with:

- the rewritten contrast check (both themes);
- the built-font check;
- the unit tests of the new row, verdict, hero and track rules;
- the kitchen sinks at 1280 and 390 px in both themes;
- the owner's phone walk-through.

### Key Discoveries:

- Astro 7.3.2 has a stable top-level `fonts` config and `<Font />` from `astro:assets` (`node_modules/astro/dist/core/config/schemas/base.js:272`). Its Google provider drops Bricolage's optical-size axis unless the family passes `options.experimental.variableAxis`. With the axis, the files carry opsz 12–96 plus wght 400–800, about 107 KB for latin and latin-ext.
- A build that can't reach Google still succeeds, but ships no web fonts; Astro only warns "No data found for font family" (`compute-font-families-assets.js:29-41`). Built fonts land in `dist/client/_astro/fonts/` and the Worker's static assets serve them.
- Astro's processed `<script>` is a deferred module, so the no-flash theme script must be `is:inline` in `<head>`. CSP is off (`security.csp` defaults to false) and there's no client router, so the head script runs on every full page load.
- The handoff's hex tokens round-trip exactly as oklch at 3-decimal L/C and 1-decimal hue, keeping the contrast script's oklch-only rule.
- **Every handoff pair passes 4.5:1 (text) and 3:1 (focus) in both themes, except:**
  - the dark `--input` search border, at 1.98:1;
  - `--label-ink` on the success and warning fills, which turn dark in dark mode;
  - the pending price's 14/12 px "zł" at 60 % opacity, at 4.44:1;
  - the dark ring (sun) crossing the selected row's sun shadow, at 1.00:1.
- **The closest pass** is light `--muted-foreground` on paper over a dot, at 4.507:1.
- `lucide-react` 1.45.0 is already a dependency (used in `src/components/auth/*`), and all six icons the handoff needs exist.
- `compareShops` returns `cheapest` / `only` / `none` (`src/lib/services/price-comparison.ts:132-141`, `:164`). `listSummaryText` (`:385`) mislabels three cases today:
  - two fresh prices that can't be ordered online read "Ceny nieaktualne";
  - an unreadable price row reads "Jeszcze bez cen";
  - a product checked but missing before its first price reads "Jeszcze bez cen".
- Natura never has a promotion end (`src/lib/services/shops/natura.ts:207`). Rossmann can have `promoEndsOn` without `regularPrice`, because `storableOffer` drops a regular price that isn't above the price (`shop-offer.ts:29-32`). Rossmann sends `lowestPrice30d` only on reduced items.
- `refresh.ts:8-10` redirects a whole-list refresh to `/watchlist?prices=` and a product refresh to `/watchlist/<id>?prices=`.
- **Astro prefetch must stay off.** Its fallback `fetch` sends no `Sec-Purpose` header, so `isOwnNavigation` (`src/lib/services/search-query.ts:19-26`) would accept it and a prefetched product page would run a Natura lookup.

## What We're NOT Doing

- The "Dobra / cena!" and "Zwykła / cena" stickers and any judgement sentence: they wait for FR-012 (S-04).
- "Zmień" and "Dopasuj ponownie": re-pinning is S-08.
- Restyling `/`, `/dashboard` and `/auth/*`: they stay pinned to dark until S-07 restyles or replaces them.
- A Natura "promocja do" pill: Natura sends no promotion end.
- Hebe, Super-Pharm or dm: that's S-05 and S-06, and dm is parked.
- New server state, migrations or npm dependencies; a client router or prefetch.
- Changes to the price rules (fresh for 24 h, refetch after 15 min, who can win), the matching rules or the shop gate.
- Syncing any aside row other than the selected product's.
- Screenshot tests in CI (Module 3), and the address-bar cleanup on the list page (an existing follow-up).
- The handoff's section 1 and its "Obecny interfejs" reference.

## Implementation Approach

Build from the bottom up, so each phase has something to check:

1. The two themes' tokens, the fonts and the guards that keep them honest.
2. The primitives, in the kitchen sink.
3. The shell and the list, with their tested row rules.
4. The product area, with its tested hero and track rules.
5. Natura's card and the list beside the product.
6. Every state in the kitchen sinks, the visual gate and the docs.

The tests and the build stay green after every phase, but the pages look coherent only after phase 5. So the change merges as one PR after phase 6.

**Where the logic lives:** the price component takes over the product area from the title row down, and gets the product and Natura's view as props. One browser-safe verdict function decides what a product's price says. The list's tag, the product's hero and the selected row's live tag all use it:

- unreadable;
- cheapest;
- the only shop;
- unavailable online;
- stale;
- none.

The list's row rules live in a new browser-safe service, `src/lib/services/watchlist-rows.ts`. The island's allow-list admits it, so the selected row's tag island can use it.

**Tailwind sizes:** design values the default scale can't express become `@theme` tokens or `@utility` rules in `global.css`, never arbitrary px/rem values in guarded files. Tailwind's spacing scale covers 4 px steps and their quarters, so `p-6.5` is 26 px.

## Critical Implementation Details

- **Timing & lifecycle:**
  - The theme must be on `<html>` before the first paint, through an `is:inline` head script that reads `localStorage` inside try/catch and falls back to `prefers-color-scheme`.
  - The storage key comes from one browser-safe module through `define:vars`, and the switch's script imports the same module.
  - Pages pinned to dark render `class="dark"` and no script.
  - The sticker stamps once on mount; a product change is a full page load.
- **User experience spec:**
  - The desktop product page shows two "Odśwież ceny" buttons with different scopes. Each gets an sr-only scope: "wszystkich produktów" or "tego produktu".
  - In dark mode the ring is the sun colour, like the selected row's shadow, so the selected row's focus outline sits outside the shadow.
  - A control drawn below 44 px keeps its drawn size and gets a centred 44 × 44 px hit area.
- **Debug & observability:**
  - A build with no web fonts is caught by `scripts/check-built-fonts.mjs` after the build in CI.
  - The first `astro dev` start downloads Google's 2.7 MB font metadata into `.astro/fonts/`, which can exceed the agent's 30 s start limit. Start it as CLAUDE.md says, with `ASTRO_DEV_BACKGROUND=1`.

## Phase 1: Themes, fonts and the guards

### Overview

Both themes' token values and the new tokens, the fonts, the no-flash theme choice, the pinned legacy pages, the contrast check rewritten for two themes on the dotted paper, a built-font check, and the handoff kept out of the tooling.

### Changes Required:

#### 1. The two themes' tokens

**File**: `src/styles/global.css`

**Intent**: replace the `:root` (light) and `.dark` values with the handoff's table, converted to oklch, with the source hex in a comment on each. Add the handoff's new roles and publish them through `@theme inline`. `bg-paper` replaces `bg-cosmic` for the redesigned pages. `bg-cosmic` keeps today's gradient from fixed values, so the pinned pages don't change when `.dark` takes the new palette.

**Contract**:

- **Values:** existing names keep their meaning (`--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--secondary`, `--accent`, their `-foreground` pairs, `--border`, `--input`, `--primary`, `--primary-foreground`, `--ring`, `--link`, `--success`, `--warning`, `--thumbnail`). `--destructive` and the unused `--chart-*` and `--sidebar-*` keep today's values.
- **New roles, each with a `--color-*` entry:** `--background-dot`, `--primary-shadow`, `--sun`, `--label-ink`, `--shadow-ink`, `--tag-warn`, `--tag-warn-border`, `--tag-plain`, `--shop-rossmann`, `--shop-natura`, `--sticker-info`, `--sticker-plain`, `--avatar`, `--tile-1` to `--tile-4`.
- **Removed:** `--background-glow`.
- **Dark `--input`** is `#6E6986` (3.47:1), not the handoff's `#4A4560` (the owner's call: the rules win).
- **`color-scheme`:** `light` in `:root`; `.dark` keeps `dark`.
- **Utilities:** `@utility bg-paper` is the background colour plus `radial-gradient(var(--background-dot) 1px, transparent 1.4px)` at 18 px. `@utility bg-cosmic` uses the literal values of today's `.dark` background, `oklch(0.1663 0.0262 269.371)`, and glow, `oklch(0.2014 0.0412 269.806)`.
- **Scanning:** `@source not "../../context";` keeps the handoff and the docs out of Tailwind's scan.
- **Values in oklch** (L C H; alpha where given):

| Token                                                                                                 | Light                                                                        | Dark                                           |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| background, tag-plain (light)                                                                         | 0.972 0.017 84.6 (#FBF5E9)                                                   | 0.203 0.02 293.7 (#17151F)                     |
| background-dot                                                                                        | 0.236 0.034 293.8 / 7.5%                                                     | 0.96 0.021 85.9 / 6%                           |
| foreground, link (light), input (light), primary (light), ring (light), label-ink, shadow-ink (light) | 0.236 0.034 293.8 (#1F1B2D)                                                  | foreground and link: 0.96 0.021 85.9 (#F8F1E2) |
| card, popover                                                                                         | 1 0 0                                                                        | 0.25 0.028 293.4 (#221F2E)                     |
| muted, secondary, accent                                                                              | 0.945 0.021 85.9 (#F3ECDD)                                                   | 0.296 0.033 291.9 (#2D2A3C)                    |
| muted-foreground                                                                                      | 0.516 0.032 299 (#6A6478)                                                    | 0.774 0.032 302.2 (#B9B1C7)                    |
| border                                                                                                | 0.906 0.029 84.6 (#E9DFCB)                                                   | 0.334 0.044 293 (#37324B)                      |
| input                                                                                                 | as foreground                                                                | 0.537 0.045 292.8 (#6E6986)                    |
| primary, ring                                                                                         | as foreground                                                                | 0.879 0.162 90.9 (#FFD23F)                     |
| primary-foreground                                                                                    | 0.98 0.024 88.2 (#FFF8E7)                                                    | 0.236 0.034 293.8                              |
| primary-shadow                                                                                        | `var(--sun)`                                                                 | 0 0 0                                          |
| shadow-ink                                                                                            | as foreground                                                                | 0 0 0                                          |
| sun                                                                                                   | 0.879 0.162 90.9                                                             | same                                           |
| success / success-foreground                                                                          | 0.932 0.048 158.5 / 0.427 0.094 157.5                                        | 0.332 0.042 166.2 / 0.86 0.112 160.3           |
| warning / warning-foreground                                                                          | 0.897 0.058 46.4 / 0.452 0.119 41.8                                          | 0.308 0.044 39.2 / 0.841 0.095 46.6            |
| tag-warn / tag-warn-border                                                                            | 0.897 0.058 46.4 / 0.781 0.113 45                                            | same                                           |
| tag-plain                                                                                             | 0.972 0.017 84.6                                                             | same (always light)                            |
| shop-rossmann / shop-natura                                                                           | 0.871 0.064 259.4 / 0.898 0.074 157.9                                        | same                                           |
| thumbnail, sticker-plain                                                                              | 1 0 0                                                                        | same                                           |
| sticker-info / avatar                                                                                 | 0.917 0.04 258.8 / 0.914 0.049 299.8                                         | same                                           |
| tile-1 … tile-4                                                                                       | 0.925 0.036 268.3 · 0.929 0.043 57.1 · 0.942 0.044 128.4 · 0.921 0.041 318.4 | same                                           |

#### 2. The fonts

**File**: `astro.config.mjs`

**Intent**: self-host Bricolage Grotesque and DM Mono through Astro's Fonts API (the owner's decision 3), keeping Bricolage's optical-size axis as the design reference does.

**Contract**: top-level `fonts` with `fontProviders.google()`. Name each family's CSS variable and publish them in `global.css` as `--font-sans: var(--font-bricolage)` and `--font-mono: var(--font-dm-mono)`. The `variableAxis` option is experimental inside the stable API, so recheck it on every Astro upgrade.

```js
fonts: [
  { provider: fontProviders.google(), name: "Bricolage Grotesque", cssVariable: "--font-bricolage",
    weights: ["400 800"], styles: ["normal"], subsets: ["latin", "latin-ext"], fallbacks: ["sans-serif"],
    options: { experimental: { variableAxis: { opsz: [["12", "96"]] } } } },
  { provider: fontProviders.google(), name: "DM Mono", cssVariable: "--font-dm-mono",
    weights: [400, 500], styles: ["normal"], subsets: ["latin", "latin-ext"], fallbacks: ["monospace"] },
],
```

#### 3. The theme choice and the head

**Files**: `src/lib/theme.ts` (new, browser-safe), `src/layouts/Layout.astro`

**Intent**: the theme follows the stored choice or else the system, and is set before the first paint. Legacy pages are pinned to dark, and the kitchen sink to light.

**Contract**:

- **`src/lib/theme.ts`** exports the storage key and the theme names. Nothing else defines them.
- **`Layout.astro` gains `theme?: "user" | "dark" | "light"`,** default `"user"`:
  - `"user"` renders no class and an `is:inline` head script, which gets the key through `define:vars`. The script sets `dark` from the stored value, else from `prefers-color-scheme`, and reads storage inside try/catch.
  - `"dark"` renders `class="dark"` and no script.
  - `"light"` renders no class and no script.
- **The head also gets:**
  - `<Font cssVariable="--font-bricolage" preload />` and `<Font cssVariable="--font-dm-mono" />`;
  - the viewport meta `width=device-width, initial-scale=1, viewport-fit=cover`.

#### 4. The pinned pages

**Files**: `src/pages/index.astro`, `src/pages/dashboard.astro`, `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: keep today's dark look on the pages S-07 restyles or replaces (the owner's call).

**Contract**:

- Each passes `theme="dark"` to `Layout`.
- They keep their literals and `bg-cosmic`.
- They take the new dark `--ring`, scrollbars and the new fonts, since those are global.

#### 5. The contrast check for two themes

**File**: `scripts/check-token-contrast.mjs`

**Intent**: guard both themes' values over the paper they render on, with the handoff's colours in oklch.

**Contract**:

- **Parsing:**
  - It reads both `:root` and `.dark`.
  - Every custom property must parse as `oklch()` or as `var(--token)` of the same block, which it resolves.
  - An explicit allow-list covers the non-colour ones (`--radius`).
- **Canvas:** each theme's canvas is `--background`. The dot is a surface layer, measured at a glyph pixel on a dot's centre, which is the worst case. `--background-glow` is gone.
- **Surfaces and pairs** are listed per theme wherever a `dark:` variant differs, such as the outline button. The pairs are the text, focus and field-border pairs the redesigned views render:
  - text on paper, paper over a dot, card and muted;
  - primary text on the primary fill, and its hover;
  - label ink on sun, `tag-warn`, `tag-plain`, the sticker fills, the avatar and the tiles;
  - `success-foreground` and `warning-foreground` on their fills and on card;
  - the chips' labels and counts at 70 %;
  - destructive text on the destructive alert;
  - the ring at 100 % on paper, card and muted (3:1);
  - the `--input` border on paper and card (3:1).
- **Exit:** non-zero on any failure, as today.

#### 6. The built-font check

**Files**: `scripts/check-built-fonts.mjs` (new), `.github/workflows/ci.yml`

**Intent**: fail CI when a build shipped without its web fonts.

**Contract**:

- After `npm run build`, it counts the `.woff2` files in `dist/client/_astro/fonts/` and fails below the number the config yields (6).
- The `ci` job runs it right after its build step. The `smoke` job's build doesn't need it.

#### 7. The handoff out of the tooling

**Files**: `eslint.config.js`, `tsconfig.json`, `.prettierignore`

**Intent**: the handoff stays byte-identical and out of lint, the type-check and formatting (product-page-ui follow-up).

**Contract**: `globalIgnores` gains `context/**/handoff/`; tsconfig's `exclude` gains `context/**/handoff`; `.prettierignore` gains `context/**/handoff/`.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npx astro check` reports 0 errors and 0 warnings, and no hints from the handoff
- `npm run lint` reports 0 problems with the handoff in place
- `npm run test` passes
- `node scripts/check-token-contrast.mjs` passes every pair in both themes, and a deliberate break in each theme turns it red
- `npm run build` then `node scripts/check-built-fonts.mjs` finds every font file, and a deliberate break (a family Google doesn't have) turns it red

#### Manual Verification:

- On the dev server, `/watchlist/<id>` follows the system theme in both system themes, with no flash of the other theme on reload
- `/`, `/dashboard` and `/auth/signin` keep today's colours in both system themes
- The fonts load from `/_astro/fonts/` in the Network tab, and headings render in Bricolage Grotesque

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Until phase 3, the list page's literals are unreadable in light mode; that's expected.

---

## Phase 2: Primitives

### Overview

The shared pieces the screens are built from: the Button and Badge restyled, the Alert and Card to the handoff's radii and borders, a 44 px hit-area utility, the focus outline, and the new Price, Sticker, LogoMark, ProductThumb and ThemeToggle. All of them go in the kitchen sink, in light and dark.

### Changes Required:

#### 1. The size tokens, the hit area and the focus outline

**File**: `src/styles/global.css`

**Intent**: the handoff's type scale, radii, hard shadows, tracking and stamp animation as tokens and utilities, so guarded files never need arbitrary px values. Every interactive element gets the handoff's focus outline.

**Contract**:

- **`@theme` entries:**
  - `--text-*`: the product title 40/25, "Moja lista" 34/38, hero złote 124/84 and grosze 52/36, hero "zł" 24/18, hero shop 36/22, card price 56/46 with 24/20 and 14/12, tag 22/12, shop name 20/18;
  - `--radius-*`: tag 9, thumb and button 14, search 16, row 18, card 22, hero 26;
  - `--shadow-*`: hero 6/5, the selected row's 4 px sun shadow, the primary's 3 px `--primary-shadow`;
  - `--tracking-*`;
  - `--animate-stamp` with its `@keyframes`: 550 ms, `cubic-bezier(.2,1.5,.4,1)`, `scale(1.7)` at opacity 0 to `scale(1)`.
- **Utilities:**
  - `@utility hit-area` gives any control a centred hit area of at least 44 × 44 px, whatever its drawn size.
  - A 1.5 px hairline border utility.
- **The base layer's focus:** a 2 px `--ring` outline at full opacity with a 2 px offset, replacing `outline-ring/50`.

#### 2. Button, Badge, Alert and Card

**Files**: `src/components/ui/button.tsx`, `badge.tsx`, `alert.tsx`, `card.tsx`

**Intent**: the handoff's primary, outline and underlined looks; the promo pill and the hanging tag; Alerts and Cards at the handoff's radii and borders. Fix the two variants below 4.5:1 (a product-page-ui follow-up).

**Contract**:

- **Button:**
  - `default`: 2 px `label-ink` border, radius 14, the primary shadow; on `:active` it moves 2 px with no shadow.
  - `outline`: 1.5 px border, radius 12, `card` fill.
  - `underlined`: `--link` text with a 3 px `--sun` underline at a 5 px offset.
  - `touch` and `inline` stay.
  - A `compact` size draws 38 px and adds `hit-area`; an `icon` circle draws 42 px and adds `hit-area`.
  - The shadcn 3 px ring and `outline-hidden` give way to the base outline.
- **Badge:**
  - `promo`: a success-tinted pill, 12 px 700.
  - A hanging tag in `sun` and `warn` tones: 2 px ink border, radius 9, rotated −3°, with a 9 px "hole".
  - `link` reads `text-link`.
  - `destructive` text is a checked token pair, not `text-white`, in Button and Badge.
- **Alert:** radius 14, 1.5 px border, tinted `success` / `warning` / `destructive`.
- **Card:** radius 22 (20 on phones), 1.5 px border.
- **Headers:** each file's header comment lists every change from the registry.

#### 3. Price

**Files**: `src/components/watchlist/Price.tsx` (new), `src/lib/services/price-comparison.ts`

**Intent**: prices in shelf-label style, with the full price read aloud once.

**Contract**:

- **`priceParts(amount)`**, in `price-comparison.ts` and tested, splits złote (with the formatter's grouping) and grosze through `Intl.NumberFormat("pl-PL").formatToParts`.
- **`<Price amount size>`**, with `size: "hero" | "card" | "tag"` at the handoff's px:
  - the grosze raised and underlined (5/4 px hero, 3 px card);
  - the visual parts `aria-hidden`;
  - `formatPrice(amount)` as sr-only text, which keeps the NBSP contract (`price-comparison.test.ts:28`).
- It's a React component, rendered statically in `.astro` files and live in the island.

#### 4. Sticker

**File**: `src/components/watchlist/Sticker.tsx` (new)

**Intent**: the starburst sticker, limited to the two facts the owner allows until FR-012 (decision 4).

**Contract**:

- **Props:** `{ kind: "one-shop" | "stale"; size: "lg" | "sm" }`. "one-shop" is "Tylko / 1 sklep" on `--sticker-info`, and "stale" is "Stara / cena" on `--sticker-plain`.
- **Shape:**
  - a 24-point polygon `clip-path` (outer radius 50 %, inner 41 %), computed once as a constant;
  - an ink layer and a fill layer inset 3 px, rotated 12°;
  - the label at weight 800 and 17 % of the size, on two lines;
  - 128 px (lg) or 86 px (sm).
- **Motion:** `motion-safe:animate-stamp`.
- **Accessibility:** `aria-hidden`, since the hero's eyebrow says the same in text.

#### 5. LogoMark, ProductThumb and ThemeToggle

**Files**: `src/components/shell/LogoMark.astro` (new), `src/components/watchlist/ProductThumb.tsx` (new), `src/components/shell/ThemeToggle.astro` (new)

**Intent**: the radar mark and the wordmark; the product photo or a pastel initial tile; the theme switch.

**Contract**:

- **LogoMark** takes `size: "lg" | "sm"` (38 / 32 px). The mark is a `--sun` circle with a conic sweep, a 2 px `label-ink` border, an inner ring and a centre dot. The wordmark "Drogeria Radar" has "Radar" underlined in `--sun`.
- **ProductThumb** takes `{ brand, imageUrl, size: "row" | "title" }`. It shows the photo on `--thumbnail`, or the brand's initial on a tile picked deterministically by the tested `tileOf(brand)`, which returns 1–4.
  - `row` is 50/48 px, radius 14.
  - `title` is 80/56 px, radius 22, with a 2 px ink border, rotated −6°.
- **ThemeToggle** is a 42 px `icon` Button with `aria-pressed`, labelled "Ciemny motyw".
  - The moon or sun icon (`lucide-react`) swaps through `dark:` classes.
  - It stays hidden until its script runs.
  - The script flips `html.dark` and stores the choice under the key from `src/lib/theme.ts`, inside try/catch.

#### 6. The kitchen sink in both themes

**Files**: `src/dev/product-page.astro`, `src/dev/fixtures.ts`

**Intent**: every primitive visible in light and dark before any screen uses it.

**Contract**:

- The page renders with `theme="light"` and repeats each section inside a `.dark` `bg-paper` wrapper. Tokens are class-scoped, so the wrapper switches them.
- New sections cover Price in each size, both Stickers, LogoMark in both sizes, ProductThumb (photo and each tile), each Button variant and size with its hit area outlined, the Badges and the ThemeToggle.
- Tailwind doesn't scan `src/dev`, so the sink uses only classes the components use.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with new tests for `priceParts` and `tileOf`
- `npm run lint`, `npx astro check` and `npm run build` pass
- `node scripts/check-token-contrast.mjs` passes with the primitives' pairs added

#### Manual Verification:

- The kitchen sink at 1280 and 390 px, in light and dark, shows every primitive as the handoff draws it
- The theme switch flips the theme and keeps the choice across reloads
- Every control shows a 2 px focus outline on Tab and has a hit area of at least 44 px, in both themes
- The sticker stamps once on load, and not with reduced motion on

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: The shell and the list

### Overview

The tested row rules and the two list reads that report unreadable rows. The AppHeader, the avatar menu on phones, the two-pane shell, the list rows with their price tags, the filter chips, the search results, and a list kitchen sink.

### Changes Required:

#### 1. The list reads report what they couldn't read

**Files**: `src/lib/services/prices.ts`, `src/lib/services/matches.ts`, `src/lib/services/price-targets.ts`

**Intent**: an unreadable row is never read as "no price yet" or "undecided" (lesson "Never read an unreadable answer as missing"; the owner's call to fix the list's misreads).

**Contract**:

- **The list's unkeyed price read** returns `{ prices, unread } | null`, reusing `readLatestRows`. A row whose key doesn't read makes the whole read `null`, as the keyed read does.
- **`listMatchStates`** returns `{ states, unread: string[] } | null`, where `unread` holds the ids of products whose match row didn't parse. A row whose product id doesn't read makes the read `null`.
- **`price-targets.ts`** keeps today's behaviour: an unreadable price counts as never checked, and an unreadable match isn't refreshed.
- **Tests** in `prices.test.ts` and `matches.test.ts`.

#### 2. One verdict for a product's prices

**File**: `src/lib/services/price-comparison.ts`

**Intent**: one browser-safe rule that decides what a product's prices say. The list's tag, the product's hero and the selected row's live tag all use it. `listSummaryText` stops mislabelling three cases.

**Contract**:

- **`verdictOf(compared, now, unread)`** returns `PriceVerdict`, built on `compareShops`. The first rule that applies wins:
  1. `unread`: any of the product's priced rows couldn't be read.
  2. `cheapest`: two or more priced shops, and one is fresh and orderable. It carries `shops` (all tied), `price`, `ageFrom` and `savings`, as `compareShops` gives them.
  3. `only`: the single priced shop (no Natura match) is fresh and orderable.
  4. `unavailable`: no winner, and some fresh offer can't be ordered online. It carries the lowest such offer.
  5. `stale`: no winner, and some stale or missing offer exists. It carries the lowest such offer and its `pricedAt`.
  6. `none`: no offer at all.
- **`listSummaryText` fixes:**
  - two fresh offers that can't be ordered online say so, never "Ceny nieaktualne";
  - an unreadable row says "Nie udało się wczytać ceny.";
  - a product checked but missing before its first price no longer says "Jeszcze bez cen".
- **Tests** at each rule's boundary, including the tie, a fresh winner beside a lower stale price (the stale one can't win), and a promotion ended yesterday (stale).

#### 3. The list's row rules

**File**: `src/lib/services/watchlist-rows.ts` (new, browser-safe) with `watchlist-rows.test.ts`

**Intent**: the list's tags, chips, counts and screen-reader lines in one tested module that the pages only call (lesson "Keep decision logic in tested services"). The island's allow-list admits it.

**Contract**:

- **Filters:** `LIST_FILTERS = ["all", "promo", "check"]`, and `parseListFilter(raw)`, which returns `"all"` for anything else.
- **`listRowOf(item, pricedShops, natura, now)`** returns `{ itemId, eyebrow, name, brand, imageUrl, tag, summary, promo, check }`.
- **The tag** comes from the verdict (the handoff's tones, plus the owner's fixes):

| Verdict       | Tone           | Price          | Label                                  |
| ------------- | -------------- | -------------- | -------------------------------------- |
| `cheapest`    | sun            | the price      | the tied shop names, joined with " i " |
| `only`        | muted          | the price      | "Tylko {shop}"                         |
| `unavailable` | muted          | the price      | "Niedostępny"                          |
| `stale`       | warn           | the last price | "Nieaktualna"                          |
| `unread`      | none (outline) | none           | "Błąd odczytu"                         |
| `none`        | none (outline) | none           | "Bez ceny"                             |

- **`promo`** (the owner's rule): some priced shop whose `priceState` is `fresh` (checked within 24 h, and its promotion not ended), with `regularPrice` or `promoEndsOn` set. A shop that can't be ordered online still counts.
  - Rossmann 24,99 zł instead of 29,99 zł beside a cheaper Natura: yes.
  - A promotion on a price checked 2 days ago: no.
  - A promotion ending today: yes.
- **`check`** (the owner's rule), which applies when any of these holds:
  - some priced shop is stale, missing, never checked or unreadable;
  - the product has no Natura decision (including a pending choice);
  - Natura's decision is `not_found`;
  - Natura's match row is unreadable.
  - Natura declined (`unmatched`) doesn't count, and neither does a fresh offer that can't be ordered online.
- **`summary`** is the fixed `listSummaryText` plus the Natura status, as today's two lines combined, for the sr-only line.
- **`filterCounts(rows)`** counts all three chips over the whole list. `filterHref(path, filter)` builds a chip's link: it keeps the page's path and drops `q` and the notice parameters.

#### 4. The shell

**Files**: `src/components/shell/AppHeader.astro`, `src/components/shell/AccountMenu.astro` (new), `src/layouts/WatchlistShell.astro` (new)

**Intent**: the handoff's header and two-pane layout. On a phone, the avatar opens a menu with the email, the theme switch and "Wyloguj" (the owner's call).

**Contract**:

- **AppHeader, at 1024 px and up:**
  - 78 px tall, with LogoMark `lg` in a 356 px block.
  - The search: the same GET `/watchlist` form, `name="q"`, `required minlength="2" maxlength="80"`.
    - It's 52 px tall, radius 16, with a 2 px `--input` border and an inner "Szukaj" button.
    - It shows a `/` `kbd` hint, and a small script focuses the field on `/` unless the user is typing in a field.
  - ThemeToggle, the 38 px avatar with the email's first letter (or "?"), the email in DM Mono, and "Wyloguj" (`compact` outline, the existing sign-out form).
- **AppHeader, below 1024 px:** only on the list screen, as LogoMark `sm` plus AccountMenu.
- **AccountMenu:**
  - A `<details>` whose `summary` is the avatar (accessible name "Konto", with the email sr-only).
  - Its panel holds the email, the ThemeToggle row and the sign-out form.
  - A small script closes it on Escape, returning focus to the avatar, and on an outside click.
- **WatchlistShell:**
  - It wraps `Layout` (`theme="user"`, `lang="pl"`) in a `bg-paper` canvas.
  - Its slots are `head`, `rows`, `footer` and the default `main`.
  - At 1024 px and up: one DOM, with CSS grid areas. The 420 px left column holds `head`, then `rows` scrolling on their own, then `footer`, with a 1.5 px right border. `main` spans the right column and scrolls on its own.
  - Below 1024 px: in `mode="list"` the order is head, main, rows, footer, so search results sit above the rows as today. In `mode="product"` only `main` shows.

#### 5. The list

**Files**: `src/components/watchlist/WatchlistRow.astro` (new), `src/components/watchlist/RowTag.tsx` (new), `src/components/watchlist/FilterChips.astro` (new), `src/pages/watchlist.astro`, `src/dev/watchlist.astro` (new), `astro.config.mjs`

**Intent**: the list rebuilt on the shell, the row service and the primitives, and every row state visible in its own kitchen sink.

**Contract**:

- **WatchlistRow:** a link to `/watchlist/<id>`, carrying `?f=` when a filter is active.
  - Card fill, radius 18, `p-3`, `gap-3`.
  - ProductThumb `row`; an eyebrow ("NIVEA · 300 ML", DM Mono 11, uppercase, muted); the name (15 px, 600).
  - `RowTag` (React, static here) with the `tag` Price, and the `summary` as sr-only text.
  - A hover lift under `motion-safe`.
  - A `selected` prop draws the 2 px foreground border, the sun shadow and the lift, and sets `aria-current="page"`.
- **The list header:** "Moja lista" (h1), the count bubble (every item), and the list's "Odśwież ceny". That's a `compact` outline Button with an sr-only " wszystkich produktów" in the existing refresh form with `data-submit-once`.
- **FilterChips:** links built by `filterHref`, each with its count (DM Mono 11 at 70 %).
  - Active: foreground fill with background text, and `aria-current="true"`.
  - Drawn 34 / 38 px with `hit-area`, and a row gap large enough for the hit areas.
  - On phones the row scrolls horizontally.
- **The page** reads through the extended reads and builds rows with `listRowOf`. It filters by `parseListFilter(params.get("f"))`, rendering chips only when all three reads worked.
  - Mobile: a search field under the title.
  - Search results: the same row look, with "Dodaj" (primary, `touch`, the existing form) or a "Na liście" `promo` pill.
  - Unchanged: the spelling hint, "Wyniki z wyszukiwarki rossmann.pl" and the refresh notices, restyled as Alerts. The source footer reads "Ceny online z rossmann.pl i drogerienatura.pl".
  - On desktop without `q`, `main` shows "Wybierz produkt z listy albo wyszukaj nowy."
- **`/dev/watchlist`**, injected only under `astro dev` like `/dev/product-page`, renders the header (desktop and mobile, menu open), every tag tone, a selected row, the chips in each state, search results and the empty list, in light and dark.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with new tests for the row service, the verdict, the list reads' unread rows and the summary fixes
- `npm run lint`, `npx astro check` and `npm run build` pass
- `node scripts/check-token-contrast.mjs` passes
- `npm run smoke` passes against the dev server
- Deliberate breaks in the chip, tag and verdict rules turn their tests red

#### Manual Verification:

- The list at 1280 and 390 px, in light and dark, matches the handoff's list (`design-captures/2a-*`, `2b-*`)
- The chips hold the right products for the owner's own list, with the right counts
- Without JavaScript, search, the chips, "Odśwież ceny", the avatar menu and "Wyloguj" work
- "/" focuses the search on desktop, but not while typing in a field

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: The product area

### Overview

The island takes over the product area:

- the title row, with "Odśwież ceny" and the "sprawdzono" caption;
- the hero and its sticker;
- the price track and its hint;
- the shop cards;
- the phone's bottom bar.

The hero, track, hint and caption rules are tested. The page moves onto the shell, without the aside yet.

### Changes Required:

#### 1. The hero, track, hint and caption rules

**File**: `src/components/watchlist/price-comparison-state.ts` with `price-comparison-state.test.ts`

**Intent**: what the product area says, decided in tested, browser-safe functions over the island's state.

**Contract**:

- **`heroOf(verdict, natura)`** returns `{ tone, eyebrow, shops, price, sub, sticker }`:

| Verdict       | Tone  | Eyebrow                     | Sticker           |
| ------------- | ----- | --------------------------- | ----------------- |
| `cheapest`    | sun   | "Najtaniej dziś"            | none (decision 4) |
| `only`        | plain | "Jedyna znana cena"         | "one-shop"        |
| `unavailable` | plain | "Niedostępny online"        | none              |
| `stale`       | warn  | "Ostatnia znana cena"       | "stale"           |
| `unread`      | plain | "Nie udało się wczytać cen" | none              |
| `none`        | plain | "Jeszcze bez ceny"          | none              |

- The shop is `SHOP_LABELS[shop].in`, and ties join with " i " ("w Rossmannie i w Naturze").
- The sub is the savings ("o 4,00 zł taniej niż Rossmann") and the age of the price it names (`ageFrom` for a tie).
- `only` with Natura undecided adds "Natura czeka na dopasowanie". `stale` adds "cena może być nieaktualna".
- **`trackOf(rows, verdict)`** returns `Track | null`:
  - Its values are the prices of every row with an offer, plus the verdict shop's `lowestPrice30d` when it has one. It's null with fewer than 2 values.
  - Positions: `x% = 6 + (v − (min − pad)) / (span + 2·pad) · 88`, with `span = max − min || 1` and `pad = 0.22·span`.
  - The sun band spans the lowest to the highest shop price when there are two or more.
  - One marker per priced shop, in its shop colour.
  - The low tick is labelled "NAJNIŻSZA Z 30 DNI".
  - The note is "RÓŻNICA {savings}" or "CENA SPRZED {age}", or none.
- **`trackHint(verdict, natura)`** (the owner's call):
  - `only` with Natura undecided: "Dopasuj produkt w Naturze, aby porównać ceny.";
  - `stale`: "Odśwież ceny, aby sprawdzić aktualną cenę.";
  - otherwise null.
  - With no track and no hint, the card isn't rendered.
- **`checkedCaption(rows, now)`** (the owner's call: the oldest check) returns "sprawdzono {age}" of the least recent `lastCheckedAt` among the shops that have one.
  - A never-checked or unreadable shop is ignored, and it shows its own gap in its card.
  - With no check at all, it's "jeszcze nie sprawdzono".
  - It updates after each shop answers. A failed refetch stores nothing, so the caption keeps its old value.
- **Tests:**
  - every hero row;
  - the track's positions for the handoff's Nivea sample: Natura 22,99, Rossmann 26,99, low 23,99;
  - the hidden track;
  - each hint;
  - the caption's oldest check, a never-checked shop, and after a refetch.

#### 2. The island renders the product area

**Files**: `src/components/watchlist/PriceComparison.tsx`, `PriceComparisonView.tsx`, new pieces beside them (`ProductTitle.tsx`, `VerdictHero.tsx`, `PriceTrack.tsx`, `ShopCard.tsx`, `RefreshBar.tsx`)

**Intent**: the handoff's product pane, from the title row down, driven by the island's live state.

**Contract**:

- **Props:** the island gains `product: { brand, name, fullName, sizeText, imageUrl, addedAt }`. The page passes `fullName` (`productFullName`).
- **The title row:**
  - Desktop: ProductThumb `title`; the eyebrow "NIVEA · 300 ML · DODANO 20.09" (a day-and-month formatter on Europe/Warsaw); an `h1` whose visible text is the name, with the brand sr-only so it reads the full name.
  - On the right, primary "Odśwież ceny", with an sr-only " tego produktu", above the caption.
  - Phones: ProductThumb 56 px beside a 25 px title.
- **The hero:** `VerdictHero` with the hero Price and the Sticker, placed per the handoff (lg at −28/−34, sm at −28/−8). The hero keeps padding-right for the sticker, and the page never scrolls sideways.
- **The track card:** `PriceTrack`, or the plain hint card, or nothing.
- **ShopCards:** 2 columns at 1024 px and up, stacked below.
  - Border by state: cheapest 2 px foreground, stale 2 px `tag-warn-border`, else `border`.
  - The hanging tag: "Najtaniej" (sun) or "Nieaktualna" (warn).
  - The header row: a shop dot in its shop colour, the name and the site.
  - The card Price with "zamiast ~~X~~", and the `promo` pill only when `promoEndsOn` is set.
  - The fine print: "najniższa z 30 dni wg sklepu: X", and "cena online · {age}".
  - `ShopLink`, and "ODŚWIEŻAM…" while pending, with the price at 60 % and its "zł" at full opacity for contrast.
  - The existing gap texts and notices, in `warning-foreground`.
- **`RefreshBar`** on phones only: a fixed bar on `card` with a top border and safe-area padding. It holds "SPRAWDZONO" and the caption on two lines, and primary "Odśwież ceny" at 52 px, with the same form and `onRefresh`.
- **Unchanged:** the `aria-live` region, the session-ended Alert and the no-JavaScript forms. Both refresh forms post to the refresh route with `itemId`.

#### 3. The page on the shell

**Files**: `src/pages/watchlist/[id].astro`, `src/components/watchlist/ProductHeader.astro`

**Intent**: the product page inside WatchlistShell (`mode="product"`), with the phone's back link row. The island owns the title.

**Contract**:

- The phone's top row is "‹ Moja lista": 16 px 700, 44 px tall, ChevronLeft, and `href` `/watchlist` keeping `?f=`. The brand · size eyebrow sits on the right.
- `ProductHeader` retires, since the island renders the title. `ProductUnavailable` stays, restyled, for the not-found and failed branches.
- `NaturaSection` stays below the island until phase 5.

#### 4. The kitchen sink's price states

**Files**: `src/dev/product-page.astro`, `src/dev/fixtures.ts`

**Intent**: every price state through the new product area, in both themes.

**Contract**: the 15 existing `PRICE_FIXTURES` render through the new view with a fixture product. Add the handoff's samples: Nivea (cheapest and on promotion), Ziaja (one shop, Natura undecided) and Colgate (stale).

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with new tests for the hero, the track, the hint and the caption
- `npm run lint`, `npx astro check` and `npm run build` pass
- `node scripts/check-token-contrast.mjs` passes
- Deliberate breaks in the hero, track and caption rules turn their tests red

#### Manual Verification:

- The kitchen sink shows every price state in the new product area, in light and dark, at 1280 and 390 px
- On the dev server, a real product refreshes shop by shop, and the hero, the track and the caption follow
- Without JavaScript, both "Odśwież ceny" forms (title row and bottom bar) refresh the product
- The sticker never covers the price or the caption, at 1280 and 390 px

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Natura in its card, and the list beside the product

### Overview

Natura's states move into its shop card, and "choose" stays a restyled section below. On desktop, the product page shows the list beside it: its row is selected and follows the product's refresh, the chips keep the product, and the list's "Odśwież ceny" returns to it.

### Changes Required:

#### 1. Natura inside its card

**Files**: `src/components/watchlist/NaturaCard.tsx` (new), `PriceComparison.tsx`, `PriceComparisonView.tsx`, `src/components/watchlist/NaturaSection.astro`, `src/pages/watchlist/[id].astro`

**Intent**: each shop appears once, and Natura's decision sits in its card (the handoff's "Natura inside its card"), with no re-pin buttons (decision 2).

**Contract**:

- **Props:** the island gains `natura: { view: NaturaView; notice: string | null; error: string | null; unsaved: boolean } | null`. It's a type-only import from `natura-view.ts`, and `choose` passes no options.
- **The Natura card, by kind:**
  - `matched`: its price card, plus a footer with a 1.5 px dashed top border holding the note (DM Mono 11, muted), the size warning as a warning pill, and the item while unsaved.
  - `prompt`: "Produkt nie jest jeszcze dopasowany w Naturze." and a full-width primary link "Dopasuj w Naturze" to the view's `href`.
  - `not-found`: the view's text and "Szukaj ponownie".
  - `unmatched`: a dashed ghost card on a transparent fill, "Brak w Naturze — Twój wybór."
  - `unavailable`: the message.
  - `decided`: its notice.
  - `read-failed`: "Nie udało się wczytać dopasowania Natury."
  - `choose`: a line pointing to the choice below.
- **Notices:** the decision notice (success) and error (destructive) Alerts sit in the card.
- **NaturaSection** keeps only `choose`, restyled in the list-row language: "To ten produkt" primary, "Żaden z nich" outline, flags as `promo` / warning pills. Its `SubmitOnce` group is unchanged.

#### 2. The list beside the product

**Files**: `src/pages/watchlist/[id].astro`, `src/components/watchlist/RowTag.tsx`, `src/components/watchlist/price-comparison-state.ts`

**Intent**: at 1024 px and up the product page shows the list with this product selected. The owner decided that the selected row's tag follows the product's refresh.

**Contract**:

- **Reads:** the page also runs the three list reads, in parallel with its own, and builds rows with `listRowOf`. The rows render in the shell's aside with this product `selected`. Below 1024 px the aside isn't shown, but the reads still run (3 database reads, no shop request).
- **Links:**
  - Chips link to `/watchlist/<id>?f=…`, keeping the product. A chip click costs one product view by the user's own navigation.
  - Row links carry `?f=`.
- **The live tag:**
  - The selected row's `RowTag` is an island (`client:load`) that listens on `window` for `PRICES_EVENT`, a constant in `price-comparison-state.ts`.
  - After each shop answers, the product island dispatches `{ itemId, shops }`: the shop, the latest check and the read state.
  - `RowTag` recomputes its tag through `compareShops`, `verdictOf` and the row service's tag mapping. Before any event, its server render is the stored tag.

#### 3. The list's refresh returns to the product

**Files**: `src/pages/api/watchlist/refresh.ts`, `src/lib/services/price-refresh.ts`, `src/lib/notices.ts`, `src/pages/watchlist.astro`, `src/pages/watchlist/[id].astro`

**Intent**: "Odśwież ceny" in the aside refreshes the whole list and comes back to the product, with the list's notice in the aside and the product's own notices unchanged.

**Contract**:

- **The form:** the aside's form adds `back=<this product's id>` and `f`. The list page's form adds `f`.
- **The redirect:** a tested `listRefreshBackTo(back, f, code)` validates `back` with `parseWatchlistItemId` and `f` with `parseListFilter`. It returns `/watchlist/<back>?f=…&<LIST_PRICES_PARAM>=<code>`, or `/watchlist?f=…&<LIST_PRICES_PARAM>=<code>` without `back`. An invalid `back` goes to `/watchlist` with no code, like a crafted post.
- **The parameter:** the list refresh's code moves from `prices` to its own `LIST_PRICES_PARAM` in `notices.ts` on both pages. `prices` stays the product refresh's code.
- **Cleanup:** the product page's address-bar cleanup strips both parameters and keeps `f`.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, with new tests for the Natura card view, the list refresh's return path and the selected row's tag update
- `npm run lint`, `npx astro check` and `npm run build` pass
- `node scripts/check-token-contrast.mjs` passes
- `npm run smoke` passes against the dev server

#### Manual Verification:

- Every Natura state renders inside its card in the kitchen sink, with "choose" below the grid, in light and dark
- At 1280 px, the list beside a product shows it selected, and its tag follows the product's refresh
- Chips on a product page keep the product, and the list's "Odśwież ceny" returns to it with the list's notice
- Without JavaScript, the Natura links and the choose forms work
- The list beside the product adds no shop request to a product view, checked in `shop_requests`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Every state, the visual gate and the docs

### Overview

Both kitchen sinks show every state in both themes. The screenshots and the handoff's QA checklist are done. The lint guards cover the new files, and the docs, the CLAUDE.md UI rule and the roadmap carry-overs are updated.

### Changes Required:

#### 1. The kitchen sinks' full coverage

**Files**: `src/dev/product-page.astro`, `src/dev/watchlist.astro`, `src/dev/fixtures.ts`

**Intent**: every state the pages can reach, visible without a shop call.

**Contract**:

- **The product sink:** every price state × every Natura kind, in both themes.
- **The list sink:**
  - each tag, a selected row and each chip state;
  - the avatar menu open;
  - search results with "Dodaj" and "Na liście";
  - the empty list;
  - the three read failures;
  - long names and sizes, and 12 or more rows, to check scrolling.

#### 2. The visual gate

**File**: `context/changes/etykiety-redesign/screenshots/` (new)

**Intent**: the owner's gate against the handoff.

**Contract**:

- Captures at 1280 and 390 px, in light and dark, of both sinks and of the real list and product pages, beside `design-captures/`.
- The handoff's QA checklist:
  - 44 px targets;
  - a focus outline on every control, including the selected row in dark mode;
  - the contrast check;
  - no text wrapping inside pills or buttons;
  - the sticker clear of the price and the caption;
  - everything without JavaScript;
  - reduced motion;
  - the safe-area insets, including landscape side padding.

#### 3. The guards

**File**: `eslint.config.js`

**Intent**: the next agent keeps the redesigned files on tokens, and server code out of the browser.

**Contract**:

- `tokenConfig.files` gains `src/pages/watchlist.astro`, `src/layouts/WatchlistShell.astro`, `src/components/shell/**`, `src/components/ui/**`.
- `islandConfig.files` gains `Price.tsx`, `Sticker.tsx`, `ProductThumb.tsx`, `RowTag.tsx`, `NaturaCard.tsx`, the island's other new pieces, `src/lib/theme.ts` and `src/lib/services/watchlist-rows.ts`.
- Its import allow-list admits `@/lib/services/watchlist-rows`.

#### 4. The docs

**Files**: `CLAUDE.md` (above the course block only), `context/foundation/roadmap.md`

**Intent**: the rules match the code, and the deferred pieces have a home.

**Contract**:

- **CLAUDE.md's UI bullet** gains:
  - the two themes, the Layout `theme` prop and the head script;
  - the fonts and `scripts/check-built-fonts.mjs`;
  - the new tokens, the `@theme` scale, `bg-paper` and `hit-area`;
  - the shell and the list components;
  - `watchlist-rows.ts` and `verdictOf`;
  - the island's product area and `PRICES_EVENT`;
  - `/dev/watchlist`.
- **CLAUDE.md's Commands** gain the font check.
- **Roadmap carry-overs:**
  - S-07: restyle the pinned pages on the new tokens and drop the pin.
  - S-04: the "Dobra / cena!" and "Zwykła / cena" stickers and the judgement sentence in the price-track card.
  - S-08: "Zmień" and "Dopasuj ponownie" in the Natura card, and the match's item name.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check`, `npm run test`, `npm run build` with `node scripts/check-built-fonts.mjs`, and `node scripts/check-token-contrast.mjs` pass
- A deliberate palette class and an arbitrary px value in a newly guarded file fail lint, and so does a server import in a new island module
- `npm run smoke` passes

#### Manual Verification:

- The screenshots at 1280 and 390 px, in light and dark, match the handoff's 2a and 2b
- The QA checklist passes: 44 px targets, focus on every control, no wrapping inside pills or buttons, no JavaScript, reduced motion and the safe-area insets
- The owner's phone walk-through on the dev server passes: the list, a product, back, the chips, a refresh, the theme switch and the avatar menu

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before opening the PR for review.

---

## Testing Strategy

### Unit Tests:

- **`verdictOf`:** each rule and its boundary, including the tie, a fresh winner beside a lower stale price, a promotion ended yesterday, both shops unorderable, and an unreadable row.
- **`watchlist-rows.ts`:**
  - each tag row of the table;
  - `promo` (the dearer shop's promotion yes, a stale promotion no, one ending today yes);
  - `check` (declined no, not found yes, undecided yes, unreadable price or match yes, fresh but unorderable no);
  - counts, `parseListFilter` and `filterHref`.
- **The reads:** the unread keys and product ids, and the `null` read for an unattributable row.
- **`listSummaryText`:** the three fixes.
- **The island's state:**
  - `heroOf` for every verdict, and ties;
  - `trackOf` positions for the Nivea sample, and the hidden track;
  - `trackHint`;
  - `checkedCaption`: the oldest check, a never-checked shop, after a refetch.
- **Other rules:** `priceParts` (NBSP, grouping, rounding), `tileOf`, `listRefreshBackTo`, and the selected row's tag recompute from an event.

### Integration Tests:

- `scripts/check-token-contrast.mjs` for both themes, and `scripts/check-built-fonts.mjs` after the build, both in CI's `ci` job.
- The ESLint token and island rules, proven by deliberate breaks.
- The smoke test and the four database checks stay green. Nothing here touches the schema or the auth routes.

### Manual Testing Steps:

1. The kitchen sinks at 1280 and 390 px, in light and dark, phase by phase.
2. The list and a product on the dev server in a phone viewport, with and without JavaScript, and a keyboard pass.
3. After the merge, on a phone against production: the list in both themes, a product's refresh, the chips, the avatar menu, and sign-in still dark.

## Performance Considerations

- **Fonts:** Bricolage (variable with opsz, latin and latin-ext) is about 107 KB, preloaded. DM Mono is about 29 KB and not preloaded. Polish letters sit in latin-ext, so both Bricolage files load on every page.
- **The product page's aside:** 3 more database reads per product view on every viewport, since the server can't know the width. They make no shop request.
- **Shop requests per view and action** (lesson "Bound what each page view and action costs every shop"):

| View or action                                                 | Shop requests                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/watchlist`, a chip on it, the filter                         | 0 (a chip link drops `q`)                                                                  |
| Search, own navigation                                         | 1 Rossmann search, as today                                                                |
| A product, own navigation                                      | as today: 0–2 Natura lookups while undecided, plus 1 per shop last checked over 15 min ago |
| A product from another site                                    | 0, as today                                                                                |
| A chip or a row in the product page's aside                    | one product view as above; 0 when its prices are under 15 min old and Natura is decided    |
| The list's "Odśwież ceny", from either page                    | as today: 1 per stale Rossmann item, plus 1 per 50 stale Natura SKUs                       |
| The product's "Odśwież ceny"                                   | 1 per matched shop, as today                                                               |
| The selected row's live tag, the theme switch, the avatar menu | 0                                                                                          |

## Migration Notes

- No schema or data change.
- `<html>` now takes its theme from the user on the redesigned pages. The pinned pages keep `class="dark"`.
- Rollback: revert the merge. A stored `localStorage.theme` is harmless after a revert.

## References

- Design handoff: `context/changes/etykiety-redesign/handoff/README.md`, `PROMPTS.md`, `Drogeria Radar Redesign.dc.html` (sections 2a and 2b)
- Captures of the handoff: `context/changes/etykiety-redesign/design-captures/` (2a desktop and 2b mobile in the cheapest, one-shop and stale states, light and dark)
- The owner's decisions of 2026-09-29: `context/changes/etykiety-redesign/change.md`
- The previous UI change: `context/archive/2026-09-29-product-page-ui/` (plan, brief, `follow-ups/review-fixes.md`)
- Lessons: `context/foundation/lessons.md`
- Astro fonts: `https://docs.astro.build/en/guides/fonts/`; `node_modules/astro/dist/assets/fonts/config.js:17-33`
- Price rules: `src/lib/services/price-comparison.ts:85-97`, `:132-141`, `:164`, `:385`
- The island: `src/components/watchlist/PriceComparison.tsx`, `PriceComparisonView.tsx:70-87`, `price-comparison-state.ts:235-253`
- Natura's view: `src/lib/services/natura-view.ts` (`NaturaView`)

## Implementation Notes

**How it runs** (the owner's call, 2026-09-30):

- The rules of phases 3–5 are built test-first by a parallel agent in its own git worktree, and merged before phase 3's UI. That covers:
  - the list reads' `unread`, `verdictOf` and the `listSummaryText` fixes, `watchlist-rows.ts`;
  - `heroOf`, `trackOf`, `trackHint`, `checkedCaption` and `PRICES_EVENT`;
  - `natura-card.ts`, `LIST_PRICES_PARAM` and `listRefreshBackTo`.
- Their Progress rows still flip with their own phases.
- Phases 1 and 2 are checked by hand together after phase 2. Phase 1 is committed on its automated gates, with rows 1.6–1.8 open until then.

### Phase 1

- **Canvas:** `bg-paper` replaces `bg-cosmic` on `src/pages/watchlist.astro`, `src/pages/watchlist/[id].astro` and `src/dev/product-page.astro`. That's the phase's intent, but those files weren't listed. `Welcome.astro`, `/dashboard` and `/auth/*` keep `bg-cosmic`.
- **CLAUDE.md** (above the course block): phase 1 made two sentences in the UI bullet false, so they're corrected now: the theme through the Layout `theme` prop, and the contrast check reading both themes over the paper and its dots.
  - The later phases' agents read CLAUDE.md, so a false rule would mislead them.
  - A Commands bullet for `node scripts/check-built-fonts.mjs` is added. Phase 6 still rewrites the UI bullet in full.
- **Light `--destructive`** is `oklch(0.43 0.245 27.325)`, not today's 0.577 as the contract said. Hue and chroma are kept. On the cream paper, the destructive Alert's description at /90 reached only 3.11:1 over a dot; now it's 4.50:1. The dark value is unchanged.
- **Contrast check:**
  - The dot sits under every surface the paper shows through (tinted Alerts, Badges, the primary hover, the dark outline button, and the ring and `--input` on the paper), not only under text on bare paper. That's the plan's worst case, applied to every see-through surface.
  - `:root` and `.dark` must set the same colour tokens, since a `.dark` wrapper would otherwise keep a light value.
  - It runs 132 checks: the plan's pairs, plus today's pairs that the phase 1 views still render.
- **Tokens the handoff doesn't list:** `--card-foreground`, `--popover-foreground`, `--secondary-foreground` and `--accent-foreground` are `var(--foreground)` in both blocks. The light roles "as foreground" are literals with their hex, because they're separate roles in the handoff.
- **`src/lib/theme.ts`** exports `LIGHT_THEME`, `DARK_THEME`, `THEMES`, `Theme` and `THEME_STORAGE_KEY` (`"theme"`). The head script gets the key and both theme names through `define:vars`, and Layout's prop is `theme?: "user" | Theme`.
  - `<html>` takes its class through `class:list`, which is the repo's `astro/prefer-class-list-directive` rule.
  - The script reads the system's theme once, at load. A system switch while a page is open applies on the next load.
- **`scripts/check-built-fonts.mjs`** expects `2 + 2 * 2` files, with the derivation in a comment. The `fonts` comment in `astro.config.mjs` says to change both together.
- **Gates:** lint ran with `--ignore-pattern "Drogeria Radar redesign/**"`, for the owner's untracked duplicate of the handoff in the repo root. Its 4 `astro check` hints are the only ones, and none of them comes from the change folder.

### Phase 2

- **`src/lib/utils.ts`** (not in the phase's files): `cn()` uses `extendTailwindMerge` with every new `@theme` token.
  - Without it, tailwind-merge 3.7 drops `text-price-hero` beside a colour class, and `border-hairline` beside `border-border`.
  - `src/lib/utils.test.ts` reads global.css's `@theme` blocks and fails on any token `cn()` doesn't know.
  - Phase 6's CLAUDE.md rewrite should say that a new `@theme` token also needs its name there.
- **Tokens:**
  - A size that's larger on desktop gets a second token ending in `-lg`, used as `lg:…` (`text-price-hero lg:text-price-hero-lg`).
  - Beyond the plan's list: text sizes for the sticker, wordmark, title thumb and compact buttons; the `button-sm` and title-thumb radii and the phone card and hero radii; and a set of tracking tokens.
  - The hairline is `--border-width-hairline: 1.5px`, which Tailwind 4.3 resolves for `border-hairline` and each side, so it needs no custom utility.
- **`hit-area`:** `position: relative`, plus a centred `::after` of `max(100%, 44px)` each way. `[data-show-hit-areas]` outlines it, which is how the kitchen sink shows it.
  - The Button's `default`, `sm` and `lg` sizes get it too (the orchestrator's call, after the owner's "the rules win"), so every size is 44 px to tap.
- **Focus:** `:focus-visible` draws a 2 px `--ring` outline at a 2 px offset, and the base keeps `outline-ring` at full opacity. The Button's `transition-all` became `transition`: otherwise the outline animated in over 150 ms, and the handoff allows no motion besides the stamp, the row lift and the press.
- **Alerts:** success and warning are filled with the solid `--success` and `--warning`, the handoff's alert fills, with descriptions in full colour and /30 borders. Destructive keeps its /10 tint and /90 description.
- **Contrast check:** 124 checks. The two /90 pairs of the now-solid alerts are gone, and the outline Button's surfaces are shared, since the themes no longer differ there. It adds the destructive fill, its hover and its hover in a card.
- **`--destructive-foreground`:** light `#FFF8E7`, dark `#1F1B2D`, at 6.2–8.7:1.
- **Button:**
  - The registry's base `rounded-md` moved into the variants: 14 for default; 12 for destructive, secondary and ghost, like outline; `rounded-sm` for the two links.
  - The base reads `font-bold`, and no variant keeps `shadow-xs`.
- **`src/components/auth/SubmitButton.tsx`** (not in the phase's files) gets `border-0 shadow-none active:translate-none`. The pinned sign-in page's purple button would otherwise take the new default's border, shadow and press.
- **ThemeToggle** is a native `<button>` with `buttonVariants({ variant: "outline", size: "icon" })`, not `<Button>`: Astro wraps a static React component's children in `<astro-static-slot>`, which would put the icons in an inline wrapper.
- **Sizes:** ProductThumb `title` has radius 16 on phones and 22 from `lg`, following the handoff's 56 px mobile thumb. The Badge `promo` uses `px-2.25` beside the base's 1 px transparent border, to draw the handoff's 3 × 10 px.
- **Kitchen sink:** one `.map` draws every section twice, first light and then in a `dark bg-paper text-foreground rounded-card p-4` wrapper. The two sit side by side at 1280 px and stack on phones, and their ids are prefixed `light-` and `dark-`.
- **`thumb-tile.ts`:**
  - `tileOf` is an FNV-1a hash of the trimmed, lower-cased brand, with its high half folded in; the low bits alone put most brands on one tile. 30 real brands spread 8/5/8/9.
  - `initialOf` returns the first letter or digit, else "?".
- **`global.css`** gains `@source not "../../.claude"` (the orchestrator's call). Tailwind was scanning the parallel agent's worktree and the skills' docs there, so a local build could hide a class that CI's build lacks.
- **Manual check 2.5** (the switch keeps the choice) needs a signed-in watchlist page. The kitchen sink is pinned light, so a reload shows it light again.

### The rules pulled forward (phases 3–5)

They were built test-first in a parallel worktree and cherry-picked onto this branch after phase 2: `94f4877` (the rules) and `7857030` (the list reads' fix below). One conflict came up, the import list in `price-comparison.test.ts`, and it kept both names. 875 tests pass after the merge.

**The verdict:**

- `PriceVerdict` carries `at`, the `now` that `verdictOf(compared, now, unread)` was given. `compared` is `compareShops`' `{ rows, summary }`, and `unread` is a boolean. `heroOf` and `trackOf` read their ages from `at`, since their contracts take no time.
- `only`, `unavailable` and `stale` carry `{ shop, price, pricedAt }`, and `cheapest` is `compareShops`' summary plus `at`.
- `listSummaryText` takes an optional `unread = false` and is driven by `verdictOf`, so the tag and the sentence can't disagree.
- An unreadable Natura match row gives the verdict `unread` (lesson "Never read an unreadable answer as missing"). Otherwise an odd match row would show "Tylko Rossmann". So the product island sends a Natura shop with `readFailed: true` when its match couldn't be read (phase 5).

**The list's reads:**

- The contract said an unattributable row makes the whole read `null`. That recreated S-01 F8's "one odd row emptied the whole list", so it was replaced (the orchestrator's call):
  - The list's price and match reads return `{ prices | states, unread, unattributed }`, and they're `null` only for a failed query or a non-list answer.
  - While `unattributed` is above 0, `rowShopsOf` and `naturaStateOf` mark only the products without a readable row as unreadable.
  - A row for a shop the list doesn't watch is ignored and logged: outside `PRICED_SHOPS` for prices, outside `SHOP_IDS` for matches.
  - `listTargets` never fails on odd rows, and it fetches the affected shops as never checked.
  - The product page's keyed `readLatestPrices` keeps its rule, since it's per product.
- `listLatestPrices` is unkeyed only (no keyed caller remained).

**The row service** (`watchlist-rows.ts`):

- Helpers beyond the contract, so the pages only call and map: `rowShopsOf`, `naturaStateOf`, `inFilter`, `priceTagOf`.
- The tag tone "none (outline)" is named `"outline"`. `ListRow.name` is the name plus the caption, as the handoff shows it.

**The product area's texts:**

- The track's texts are lowercase data ("różnica …", "cena sprzed …", "najniższa z 30 dni"), and the view uppercases them with CSS, as the handoff's own data does.
- `sinceText(iso, now)` gives the genitive age after "sprzed".
- `namesOf` (with a label: `name` or `in`), `savingsText` and `PRICE_UNREAD_TEXT` are exported and defined once.
- `naturaCardOf` takes a non-null view and adds the existing "unsaved" warning, so that message isn't lost when Natura moves into its card.

**The return path:**

- `LIST_PRICES_PARAM` is `"list-prices"` and is in `NOTICE_PARAMS`. `PRICES_EVENT` is `"drogeria:prices"`, with `PricesEventDetail.shops` typed as `RowShop[]`.
- `listRefreshBackTo` takes `FormDataEntryValue | null`. An `f` that isn't a string counts as `all`, and a `back` that is empty, not a UUID or a File returns `/watchlist` with no code.

**New copy for the owner to review (the rules):**

- "Niedostępny online: Natura 24,99 zł · 5 min temu · Rossmann: niedostępny online"
- "Brak ceny online · Rossmann: nie zwraca tego produktu"
- "{shop}: jeszcze nie sprawdzono"
- "Natura: nie udało się wczytać dopasowania"
- "cena sprzed …"
- "Wybierz pasujący produkt poniżej."

### Phase 3

- **`src/components/shell/AppHeader.astro`** is new: the plan listed it without "(new)".
- **Shared components beyond the plan's list:** `SearchForm` (shell); `ListHead`, `ListRows`, `ListFooter` and `SearchResults` (watchlist). The page, `/dev/watchlist` and phase 5's aside share their markup. The list refresh's notice texts moved unchanged from the page into `ListHead`.
- **`watchlist-rows.ts`** gains two helpers, with 6 tests:
  - `rowProductOf` (types `RowProduct` and `NamedProduct`) gives a search result the list row's eyebrow and name. `ListRow` extends `RowProduct`.
  - `listRowsOf(items, matchRead, priceRead, now)` is the page's whole path from reads to rows.
- **New `@theme` tokens,** also named in `src/lib/utils.ts`: `text-body` 15, `text-meta` 11, `text-micro` 10, `radius-search-button` 11, `radius-kbd` 7, `radius-price-tag` 12.
- **The shell's grid:**
  - `lg:grid-cols-[calc(var(--spacing)*105)_minmax(0,1fr)]` and `lg:grid-rows-[auto_minmax(0,1fr)_auto]`, with explicit line placement instead of named areas.
  - List mode's `<main>` is the grid. Product mode puts the list slots in `<aside aria-label="Moja lista">`, hidden below `lg`; without them, `main` spans the full width.
  - The footer wrapper hides itself with `empty:hidden`. The shell's root pads the safe-area insets, since phase 1 set `viewport-fit=cover`.
- **The rows area** has a top padding of 10 px at `lg`, not 6: otherwise the selected row's lift and focus outline are clipped. That outline sits outside the 4 px sun shadow (`focus-visible:outline-offset-6`), which closes the dark theme's ring-on-sun gap.
- **The phone's search** keeps an inner "Szukaj" button, which capture 2b omits, because the notice "Naciśnij „Szukaj”…" names it. Both fields carry `aria-keyshortcuts="/"`, and the focus outline wraps the whole field.
- **WatchlistRow:** the drawn tag is `aria-hidden`, because the sr-only summary says the same. Only list rows (links) lift on hover, not search results.
- **What shows when:** the chips and the source footer need all three reads to have worked and a non-empty list. The count bubble needs at least one product.
- **For the kitchen sink only:** AccountMenu `open`; `idPrefix` on AppHeader and SearchResults; SearchResults `path`. Its ListHead copies are `inert`, because their refresh would refresh the viewer's own list. Its "Dodaj" posts an id the add form refuses. The open menu's spacer is an inline `style`.
- **The theme follows the system live** (the owner's report): `THEME_CHANGE_EVENT` (`"drogeria:theme"`) is in `src/lib/theme.ts` and reaches the head script through `define:vars`.
  - While no choice is stored, the head script follows `prefers-color-scheme` as it switches, and the switches listen, to keep `aria-pressed` right.
  - This replaces the phase 1 note that a system switch applies on the next load.
- **The page:**
  - It uses `PRICES_PARAM` and `SHOP_LABELS.rossmann` instead of literals.
  - The source footer drops its trailing full stop, as in the handoff.
  - Rows no longer show "dodano {date}" or "rozmiar nieznany".
  - Notices and read failures are Alerts, with today's texts and roles.
  - The avatar's letter comes from `initialOf`.
- **Contrast check:** a popover surface with three pairs, for the account menu's panel, for 130 checks.
- **`ProductSummary.astro`'s** header comment is corrected, since the list and the results no longer use it.
- **For phase 5:** `ListHead`'s `h1` "Moja lista" needs a lower level beside a product's title, and its refresh form needs `back`.
- **New copy for the owner to review:**
  - "Żaden produkt nie pasuje do tego filtra."
  - sr-only "Liczba produktów: N"
  - "Konto: {email}"
  - "Filtry listy", and "Moja lista" as the rows list's label
  - "Ciemny motyw", the menu's row
- **Two layout choices for the owner:** on phones, "Odśwież ceny" stays in the title row, and search results are followed by the rows with no visible heading (today's page has "Obserwowane produkty").
- **Local data:** a throwaway user `design-check-…@example.com` with 5 made-up products (Rossmann ids 990000001–5), their Natura decisions and 6 price observations. Two real searches ran through the gate, more than 2 s apart.

### Phase 4

- **The island's `product` prop** is `TitleProduct`, `{ brand, name, caption, sizeText, imageUrl, addedAt }`, with no `fullName`. The `h1` is the brand (sr-only) plus `rowProductOf`'s name, so it reads the full name with the visible caption: "NIVEA Soft krem intensywnie nawilżający".
- **`ProductTitle.tsx`** imports `rowProductOf` from `watchlist-rows.ts`. Phase 6 adds the new island files and that module to `islandConfig` together.
- **New tested helpers:**
  - `verdictOfState(state)` is the island's verdict: `readFailed` and `pricesFailed` feed F1's `unread`.
  - `checkedAge(rows, now)` is the bottom bar's age, and `checkedCaption` builds on it.
  - `markerLabelSides(markers)` turns the labels of markers less than 30 % apart away from each other.
  - `formatDayOf(iso)`, in `price-comparison.ts`, gives the "dodano dd.mm" day on Europe/Warsaw.
- **New `@theme` tokens,** named in `cn()` too: `text-track-title` 17/19, `text-track-price` 15/17, `rounded-button-lg` 16, `border-marker` 2.5 px.
- **Shared pieces beyond the plan's list:**
  - `RefreshForm.tsx` holds both refresh forms: `itemId`, `onRefresh`, disabled while pending, and the sr-only " tego produktu".
  - `shop-fills.ts` is one colour source for the shop dots and the track markers.
- **`Price` gains `pending`:** the digits go to 60 %, and "zł" stays at full opacity. The contrast check gains a large-text minimum (3:1) and `foreground/60 on card`, at 4.44:1 light and 6.01:1 dark, for 132 checks.
- **`ShopLink`** gains the handoff's ExternalLink icon, so NaturaSection's links show it too.
- **The island's destructive "Nie udało się wczytać cen." Alert is gone.** The `unread` hero says it, and each unread card says "Nie udało się wczytać ceny."
- **A hero without a price** (`unread`, `none`) shows its eyebrow text as its headline, at the hero-shop size.
- **Shop cards:**
  - The "Nieaktualna" tag and the warm border apply to `stale` rows and to `missing` rows that keep a price.
  - "niedostępny online" stays a warning Badge, and the gap texts and notices are in `warning-foreground`.
  - Every state has a 2 px border.
- **`WatchlistShell`'s `main`** gains `overflow-x-clip`, which contains the sticker and its 1.7× stamp. Nothing scrolls sideways at 390, 1024 or 1280 px.
- **The page:**
  - The no-JavaScript `?prices=` notice sits above the island.
  - An sr-only `h2` "Ceny" heads the cards; the track's title is an `h2`, and the shop names are `h3`.
  - The session-ended Alert is the island's first block.
  - `pb-28 lg:pb-0` keeps the fixed bar off the content.
- **The phone's back row** links to `filterHref("/watchlist", parseListFilter(f))`, with ChevronLeft, and shows `rowProductOf(product).eyebrow`. It shows on the not-found and failed branches too.
- **On phones** the track's labels are 10 px (`text-micro`), where the handoff has 9 px.
- **Kitchen sink:**
  - The product area is its own full-width section: every state in a light and a dark 860 px pane frame, whose `transform: translateZ(0)` contains its fixed bar.
  - The "Nagłówek" section and `HEADER_FIXTURES` are gone, with `ProductHeader`.
  - `PRICE_FIXTURES` gain the product and `naturaUndecided`.
  - `HANDOFF_FIXTURES` are Nivea; Ziaja (3 h old, Natura undecided); and Colgate (2 days old, Natura declined).
- **CLAUDE.md:** the UI bullet's shared-pieces sentence names `ProductTitle.tsx` (its title row, in the island) instead of `ProductHeader.astro`.
- **For the owner's check:**
  - the `h1`'s accessible text;
  - the 30 % threshold;
  - the price-less hero's headline;
  - the warning colour on every gap text.
  - The sticker clears a one-line title's caption by about 5 px at 1280, as in the handoff (4.8).
  - `missing-without-price` names the only priced shop "Najtaniej dziś", which is `compareShops`' existing rule.
- **What wasn't verified:** hydration and the live refresh (4.6). The dev server left running since 15:28 had a stale Vite cache, so no island hydrated on it. The subagent checked the server-rendered page, every reducer state in the kitchen sink, and the unit tests.
- **Local data:** throwaway users `p4-check-*@example.com`; made-up items (Rossmann 990000201 and 990000202, Natura NV99999201); three observations; one matched Natura decision. No shop request was made: the pages were loaded with `Purpose: prefetch`.
- **Until phase 5,** the desktop product area spans the full width, with no link back to the list.

### Phase 5

- **New tested helpers:**
  - In `natura-card.ts`: `naturaUnreadable(view)`, and a `NaturaCardInput` type, which is the island's `natura` prop.
  - In `price-comparison-state.ts`:
    - `verdictOfState(state, { naturaUnreadable })`: an unreadable match makes the verdict `unread`.
    - `rowShopsOfIsland(rows, { naturaUnreadable })`: the `PRICES_EVENT` shops, with Natura marked `readFailed` when its match couldn't be read.
    - `shopsOfPricesEvent(event, itemId)`: `RowTag`'s filter.
    - A `NaturaRead` type.
  - In `watchlist-rows.ts`: `listChipsOf(rows, readsWorked, raw)`, so both pages share the rule "chips only when all three reads worked and the list isn't empty".
- **The selected row's first tag** comes from the product page's own reads (`rowTagOf(rowShopsOfIsland(initialState(…).rows, …))`), so the aside and the product agree from the first paint. The island sends `PRICES_EVENT` on every change of its rows: after hydration, when a refetch starts, and when it's answered.
- **`refresh.ts`:** a crafted `back` on a whole-list refresh redirects to `/watchlist` before any refresh, so it costs no shop request. The product refresh uses `PRICES_PARAM`.
- **Components:**
  - `ShopCard.tsx` exports `SHOP_CARD` and `ShopHeader` and takes `children`, for Natura's footer and alerts.
  - `PriceComparisonView` exports `ShopGrid`, and its `naturaUndecided` prop became `natura`.
  - `ListHead` takes `level?: 1 | 2` (an `h2` in the aside) and `back?: string | null`, whose hidden field renders only when set.
- **`ProductSummary.astro` is deleted:** only the old NaturaSection used it. The restyled choice uses the list-row look.
- **The aside** shows on the not-found and failed branches too, with no selection and no `back`.
- **Layout:**
  - The prompt link is full width on phones and as wide as its text from `lg`, as the handoff draws it; the plan said full width.
  - An unsaved match has no price row, so its item stands where the price would be, above the dashed footer.
- **Contrast check:** a "destructive alert in a card" surface with its pairs, for 136 checks.
- **CLAUDE.md:** the UI bullet's Natura sentence is corrected: each shop appears once, in its card; Natura's card comes from `natura-card.ts`; `NaturaSection.astro` holds only the choice.
- **`scripts/smoke.mjs`:** the empty list's refresh now expects `/watchlist?list-prices=none`.
- **Kitchen sinks:**
  - The fixtures take `natura` (matched, declined, prompt), and there's a new `natura-read-failed` fixture. `NaturaFixture` is `{ code, text, idPrefix, natura, state }`.
  - The Natura states are their own full-width section.
  - `/dev/watchlist` has an "Obok produktu" section, where the selected rows' tags hydrate.
- **For S-05 and S-06:** when Natura's match can't be read, only the verdict says unread. The cards' "Najtaniej" mark and the live region's ", najtaniej" aren't withheld. That can't happen with two shops, since an unmatched Natura has no price row, but it can once more shops join.
- **For the owner's check:**
  - Only the selected row's tag follows the refresh; its sr-only line, its flags and the chip counts stay as they were read.
  - A filter that excludes the product shows no selected row.
  - "Pokaż zapisaną decyzję" links without `?f=`.
  - The read-failed text lost "Odśwież stronę.", and `unavailable` is a warning line rather than an Alert.
  - The Colgate sample's "Stara cena" sticker touches its caption at 1280 px (phase 6's QA).
- **Costs, verified:** the `shop_requests` max id was 85 before and after.
  - Product views with a stored decision and fresh prices: 0.
  - A chip click: one product view, 0.
  - The live tag: 0.
  - The list refresh from the aside, with nothing stale: 0.
  - A crafted `back` goes to `/watchlist` with no refresh.
- **Local data:** `p5-check-…@example.com`, with made-up products (Rossmann 990000501–503; Natura DEVNV0501) and 4 observations. Don't refresh them.

### Phase 6

- **The sticker's clearance:** VerdictHero gets `mt-2` when it carries a sticker, so the gap under the title row is 34 px on desktop and 32 px on phones, not 26/24. The sticker now clears the caption by at least 15.6 px at 1280, 10.9 px at 1024 and 18.6 px at 390, in every state.
  - The touch phase 5 saw was a capture artifact: `captureBeyondViewport` resizes the view, which toggles the `hidden lg:block` sticker and restarts its stamp. So every screenshot is taken with reduced motion on.
- **From 1024 to 1279 px** (this changes phase 4's "2 columns at 1024 px and up"): the hero's side-by-side grid, the two card columns and the title's 40/80 px scale start at `xl:`.
  - Below `xl`, the hero stacks as on phones but keeps the `lg` type sizes, the title uses the phone's 25/56 px, and the cards take one column.
  - At 1024 the pane is 604 px wide. The old layout broke the title mid-word, ran "w Rossmannie" into the price and left the site name too narrow.
- **Small tap targets and clipped focus:**
  - AppHeader shows the email from `xl` only; at 1024 the search field had shrunk to 0 px.
  - SearchForm's input fills the field's height (`self-stretch`); it was a 22.5 px tap target inside a 52 px field.
  - The session alert's "Zaloguj się ponownie" gets `hit-area whitespace-nowrap`; it was 17 px tall.
  - FilterChips gets `scroll-px-4.5`, `w-max` on its list and a small `focusin` script that scrolls a focused chip into view, so the last chip's outline isn't cut at 390. Without JavaScript the chips are still plain links.
  - WatchlistShell gets `lg:scroll-py-3` on the rows' scroller and the main pane, so a row scrolled into view by Tab keeps its outline.
  - `html:has([data-refresh-bar])` gets a bottom `scroll-padding` of 7rem plus the inset, so Tab stops above the phone's fixed bar.
- **Guards:**
  - `islandConfig.files` lists exactly the value-import graph of `PriceComparison.tsx` and `RowTag.tsx`, plus `src/lib/theme.ts`, computed with a script. Its allow-list admits `@/lib/services/watchlist-rows`.
  - `tokenConfig` gains the four globs, and `src/components/ui/LibBadge.astro` is deleted: it was unused, and it failed the rule.
- **Kitchen sinks:**
  - `max-w-lg` became an inline `max-width: 32rem`. No app file has used `max-w-lg` since phase 3, so it had no CSS, and the sinks' light and dark columns stacked.
  - The product sink adds the two-shop states `all-stale`, `all-unavailable` and `promo-ended`. A "Sama cena Rossmanna" group pairs each Rossmann-only price state with each other Natura kind; `choose` shows its section below through a new `choice` field.
  - It isn't a literal cross product of 144 frames, and the sink says why: Natura has a price row only with a saved match, and the rules tell the other kinds apart only as undecided, decided or unreadable.
  - The list sink adds a "Przewijanie" section (14 rows scrolling on their own, with the selected row at the foot) and a chip row whose counts are zero.
- **CLAUDE.md:** the UI bullet is rewritten to match the code. It adds one rule from the plan's key discoveries: Astro's prefetch stays off, because its fallback fetch would pass `isOwnNavigation`. The course block is byte-identical.
- **The roadmap** gains the carry-overs for S-04, S-07 and S-08, and the "Najtaniej" line for S-05 and S-06. No status changed.
- **Screenshots:** 65 PNGs, taken with reduced motion and without the dev toolbar, at 1280, 1024 and 390 px, light and dark, plus the QA evidence files. The set is 20 MB, and the owner decides what's committed.
- **For the owner's check:**
  - the layout between 1024 and 1279 px (compact title, stacked hero, one card column, no email);
  - without JavaScript the redesigned pages are light whatever the system theme, since the head script picks the theme;
  - `promo-ended` still shows "promocja do 28.09" on 29.09 under its "Nieaktualna" tag, which is ShopCard's rule.
- **Costs:** 0 shop requests. Every real page was loaded with `Purpose: prefetch`, and the `shop_requests` max id was 95 before and after. Ids 86–95 came from the owner's own session on the same dev server, which the agent only read.
- **Local data:** `p6-check-…@example.com`, with made-up items (Rossmann 990000601–604; Natura DEVNV0601 and DEVNV0602) and six observations.
- **The gates:** smoke ran first, while the dev server was healthy. The three lint breaks ran here: a palette class in AppHeader, a `w-[13px]` in WatchlistShell and an `astro/zod` import in RowTag, and each was refused. The dev server was restarted after `astro check` and the build.

### Manual verification

- **Who ran it:** the owner asked the agent to do the manual checks (2026-09-30). A verification agent ran all 23 rows in headless Chrome, through the DevTools protocol, against the dev server and the local Supabase, as throwaway `@example.com` users. Every row passed.
- **Shop requests:** 4 real ones. Rossmann 26900 and Natura NV81063 were refetched by the live refresh (4.6, 5.6), and one no-JavaScript submit of the title row's form refreshed both again (4.7). Every other page was loaded with `Purpose: prefetch`, behind a guard that failed any price, refresh, decision, "Dodaj" or search request.
- **Row 3.7** was verified on a seeded list of 9 products covering every state: counts 9/3/5, the same with and without JavaScript. The owner's own list wasn't checked, since that needs their account; the owner chose to tick the row on that basis.
- **Fixes after the verification:**
  - The header's search takes the phone's short placeholder, "np. nivea soft 300 ml" (the owner's call). The handoff's longer text was cut off between 1024 and 1279 px, where the field has room for about 186 px.
  - The kitchen sink's label and comment for the registry's button sizes no longer say they lack a hit area, since phase 2 gave them one. Their list's gap widened.
  - The gates were re-run after both fixes: smoke, `astro check`, the build with its fonts, contrast and lint.
- **Follow-ups found by the verification (existing rules, not changed here):**
  - While Natura's price is still loading, the hero and the Rossmann card say "Najtaniej", since only a shop with a price can win. The live region then ends naming both shops "najtaniej", as it did since S-03.
  - A price that's stale only because its promotion ended reads "CENA SPRZED 24 MIN" in the track and "cena może być nieaktualna" in the hero, while its card still shows "promocja do 28.09".
  - The sticker's rotated bounding box overlaps the caption's box at 1024 px. Only its transparent corner is involved; the drawn starburst clears the caption by at least 10.9 px.
- **The captures in `screenshots/`** predate the placeholder fix. The 44 kitchen-sink captures stay out of the repo, since the sinks regenerate them.
- **Local data:**
  - `verify-real-…@example.com`: Rossmann 26900 with a matched Natura NV81063, and 4 shared observations from real refreshes.
  - `verify-seed-…@example.com`: 9 made-up items (Rossmann 990000701–709), 8 Natura decisions and 10 observations. Its S9's promotion ends 2026-09-30.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Themes, fonts and the guards

#### Automated

- [x] 1.1 `npx astro sync && npx astro check` reports 0 errors and 0 warnings, and no hints from the handoff — f9d3d65
- [x] 1.2 `npm run lint` reports 0 problems with the handoff in place — f9d3d65
- [x] 1.3 `npm run test` passes — f9d3d65
- [x] 1.4 `node scripts/check-token-contrast.mjs` passes every pair in both themes, and a deliberate break in each theme turns it red — f9d3d65
- [x] 1.5 `npm run build` then `node scripts/check-built-fonts.mjs` finds every font file, and a deliberate break (a family Google doesn't have) turns it red — f9d3d65

#### Manual

- [x] 1.6 On the dev server, `/watchlist/<id>` follows the system theme in both system themes, with no flash of the other theme on reload — f9d3d65
- [x] 1.7 `/`, `/dashboard` and `/auth/signin` keep today's colours in both system themes — f9d3d65
- [x] 1.8 The fonts load from `/_astro/fonts/` in the Network tab, and headings render in Bricolage Grotesque — f9d3d65

### Phase 2: Primitives

#### Automated

- [x] 2.1 `npm run test` passes, with new tests for `priceParts` and `tileOf` — b041f7e
- [x] 2.2 `npm run lint`, `npx astro check` and `npm run build` pass — b041f7e
- [x] 2.3 `node scripts/check-token-contrast.mjs` passes with the primitives' pairs added — b041f7e

#### Manual

- [x] 2.4 The kitchen sink at 1280 and 390 px, in light and dark, shows every primitive as the handoff draws it — b041f7e
- [x] 2.5 The theme switch flips the theme and keeps the choice across reloads — b041f7e
- [x] 2.6 Every control shows a 2 px focus outline on Tab and has a hit area of at least 44 px, in both themes — b041f7e
- [x] 2.7 The sticker stamps once on load, and not with reduced motion on — b041f7e

### Phase 3: The shell and the list

#### Automated

- [x] 3.1 `npm run test` passes, with new tests for the row service, the verdict, the list reads' unread rows and the summary fixes — fb976f8
- [x] 3.2 `npm run lint`, `npx astro check` and `npm run build` pass — fb976f8
- [x] 3.3 `node scripts/check-token-contrast.mjs` passes — fb976f8
- [x] 3.4 `npm run smoke` passes against the dev server — fb976f8
- [x] 3.5 Deliberate breaks in the chip, tag and verdict rules turn their tests red — fb976f8

#### Manual

- [x] 3.6 The list at 1280 and 390 px, in light and dark, matches the handoff's list (`design-captures/2a-*`, `2b-*`) — fb976f8
- [x] 3.7 The chips hold the right products for the owner's own list, with the right counts — fb976f8
- [x] 3.8 Without JavaScript, search, the chips, "Odśwież ceny", the avatar menu and "Wyloguj" work — fb976f8
- [x] 3.9 "/" focuses the search on desktop, but not while typing in a field — fb976f8

### Phase 4: The product area

#### Automated

- [x] 4.1 `npm run test` passes, with new tests for the hero, the track, the hint and the caption — 5c1c302
- [x] 4.2 `npm run lint`, `npx astro check` and `npm run build` pass — 5c1c302
- [x] 4.3 `node scripts/check-token-contrast.mjs` passes — 5c1c302
- [x] 4.4 Deliberate breaks in the hero, track and caption rules turn their tests red — 5c1c302

#### Manual

- [x] 4.5 The kitchen sink shows every price state in the new product area, in light and dark, at 1280 and 390 px — 5c1c302
- [x] 4.6 On the dev server, a real product refreshes shop by shop, and the hero, the track and the caption follow — 5c1c302
- [x] 4.7 Without JavaScript, both "Odśwież ceny" forms (title row and bottom bar) refresh the product — 5c1c302
- [x] 4.8 The sticker never covers the price or the caption, at 1280 and 390 px — 5c1c302

### Phase 5: Natura in its card, and the list beside the product

#### Automated

- [x] 5.1 `npm run test` passes, with new tests for the Natura card view, the list refresh's return path and the selected row's tag update — 052ed81
- [x] 5.2 `npm run lint`, `npx astro check` and `npm run build` pass — 052ed81
- [x] 5.3 `node scripts/check-token-contrast.mjs` passes — 052ed81
- [x] 5.4 `npm run smoke` passes against the dev server — 052ed81

#### Manual

- [x] 5.5 Every Natura state renders inside its card in the kitchen sink, with "choose" below the grid, in light and dark — 052ed81
- [x] 5.6 At 1280 px, the list beside a product shows it selected, and its tag follows the product's refresh — 052ed81
- [x] 5.7 Chips on a product page keep the product, and the list's "Odśwież ceny" returns to it with the list's notice — 052ed81
- [x] 5.8 Without JavaScript, the Natura links and the choose forms work — 052ed81
- [x] 5.9 The list beside the product adds no shop request to a product view, checked in `shop_requests` — 052ed81

### Phase 6: Every state, the visual gate and the docs

#### Automated

- [x] 6.1 `npm run lint`, `npx astro check`, `npm run test`, `npm run build` with `node scripts/check-built-fonts.mjs`, and `node scripts/check-token-contrast.mjs` pass — f125980
- [x] 6.2 A deliberate palette class and an arbitrary px value in a newly guarded file fail lint, and so does a server import in a new island module — f125980
- [x] 6.3 `npm run smoke` passes — f125980

#### Manual

- [x] 6.4 The screenshots at 1280 and 390 px, in light and dark, match the handoff's 2a and 2b — f125980
- [x] 6.5 The QA checklist passes: 44 px targets, focus on every control, no wrapping inside pills or buttons, no JavaScript, reduced motion and the safe-area insets — f125980
- [x] 6.6 The owner's phone walk-through on the dev server passes: the list, a product, back, the chips, a refresh, the theme switch and the avatar menu — f125980
