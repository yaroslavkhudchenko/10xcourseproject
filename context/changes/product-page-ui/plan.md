# Design-System Contract for the Product Page Implementation Plan

## Overview

The product page `/watchlist/<id>` gets a design-system contract:

- It reads the navy-and-purple "cosmic" palette from `.dark` tokens, applied on `<html>`.
- It is built from shared `card`, `alert` and `badge` components, copied from shadcn's new-york-v4 source, and the Button.
- It shows each shop once and never contradicts itself.

A dev-only kitchen sink shows the view in every state, and a lint rule plus a CLAUDE.md rule keep the next agent on the contract. This is Module 2, Lesson 5 (`/10x-ui`), with one view per change.

## Current State Analysis

From `context/changes/product-page-ui/research.md`:

- **Tokens exist, but the dark theme is never applied.**
  - `src/styles/global.css` defines 31 colours in `:root` (6-39) and in `.dark` (41-73), published through `@theme inline` (75-111).
  - `<html>` has no `dark` class (`src/layouts/Layout.astro:15`), so every token resolves to the light values.
- **The page paints its look from literals instead.** It uses `bg-cosmic` (`global.css:113-115`, a hex gradient) and palette classes. The three view files contain 88 of them and no colour token:
  - `src/pages/watchlist/[id].astro`: 61, plus `bg-cosmic`
  - `src/components/watchlist/PriceComparison.tsx`: 22
  - `src/components/watchlist/ProductSummary.astro`: 5
- **One shared component, overridden by its only user.** `src/components/ui` holds `button.tsx`, whose only consumer, `SubmitButton.tsx:18`, overrides its colour classes. `LibBadge.astro` is unused.
- **Hand-built copies instead of components:** the page builds 9 notice boxes, 5 cards, 4 pills, 5 buttons and 6 text links itself (research C2).
- **Shops are shown twice.** The S-03 price island (`[id].astro:302-334`) sits above S-02's Rossmann card (336-354) and Natura section (356-525), so each shop appears twice (C3).
- **The page's server messages contradict the island (C4):**
  - **C4.1:** "Nie udało się wczytać cen." (`[id].astro:322-326`) stays above the rows after the island's refetch has filled them.
  - **C4.2:** "Brak ceny online w {site}" (`PriceComparison.tsx:164-165`) also shows for a row that was never checked.
  - **C4.3:** the decision notices and errors (`[id].astro:228-235, 288-300`) sit at the top of the page, far from the Natura buttons, and their `?matched`/`?error=` codes survive a reload.
  - **C4.4:** the decision forms (`[id].astro:428-472`) have no submit-once guard, so a double tap shows "Ten produkt ma już zapisaną decyzję." after the user's own save.
- **The kitchen sink can't reuse the Natura section yet.** Its view builders and their formatters are inline in the page (`[id].astro:41-131`). The island renders only its initial state server-side.
- **Accessibility:** the focus ring is about 1.5-1.9:1 against WCAG 1.4.11's 3:1, and nothing states the colour scheme, so native controls render light.

## Desired End State

**The product page:**

- **Tokens and components only.** It uses token classes and the components in `src/components/ui` only; the hardcoded-value scan finds 0 hits in its files. It looks like today's cosmic page.
- **Theme:**
  - `<html class="dark">` makes the canvas, overscroll, scrollbars and native controls dark.
  - Focus is visible on every control, at 3:1 or more.
  - Every control keeps its 44 px tap target.
- **One block per shop.** Each shop appears once, in its price row with its "Zobacz w sklepie" link. The Natura section shows only the matching decision, and each candidate keeps its own link.
- **Notices:**
  - A decision's notice or error appears next to the Natura buttons and leaves the address bar once shown.
  - A double tap sends one decision.
  - A row that was never checked says "Jeszcze bez ceny".
  - A row whose stored price couldn't be read says so, never "Jeszcze bez ceny".
  - The failed-prices alert clears once every such row has an answer.

**The kitchen sink:** `/dev/product-page` exists under `astro dev` only. It shows every component variant and the whole view in each state of the 7-state matrix.

**Guards:**

- **ESLint** refuses palette literals in the cleaned files.
- **CLAUDE.md** says where the tokens and components live and how to add them.
- **A dependency-free script** checks the contrast of every token pair the view uses.

### Key Discoveries:

- **Registry dependencies:** the shadcn CLI's new-york-v4 items now import `cn` from the `cn` package and `Slot` from the unified `radix-ui` package. The registry JSON at `https://ui.shadcn.com/r/styles/new-york-v4/{card,alert,badge}.json` shows this. Copying the source with imports pointed at `@/lib/utils` and `@radix-ui/react-slot` adds no dependency; the docs allow it: "Update the import paths to match your project setup".
- **New tokens follow shadcn's theming docs, "Adding New Tokens":** define them under `:root` and `.dark`, then publish them in `@theme inline`. New variants are added by editing the copied component's `cva` variants.
- **The dark variant doesn't match `<html>` itself.** It is `@custom-variant dark (&:is(.dark *))` (`global.css:4`), which matches only descendants. So `color-scheme` goes inside the `.dark {}` block, not into a `dark:` utility on `<html>`.
- **shadcn's `Alert` renders `role="alert"`, an assertive live region.** Props spread after it, so callers can pass `role="status"`.
- **`asChild` doesn't work in `.astro` files.** Astro hands slotted children to React as an HTML string (`node_modules/@astrojs/react/dist/server.js:70-79`), since `astro.config.mjs` doesn't enable `experimentalReactChildren`, so `Slot` has no element to style. Links styled as buttons there use the exported `buttonVariants()` (`src/components/ui/button.tsx:50`).
- **Static React components in `.astro` behave differently from islands.** Without `client:*`:
  - They render once, in their initial state; effects don't run.
  - The renderer deletes a `class` prop (`server.js:56`), so pass `className`.
  - Slotted children render without a wrapper: the `<astro-static-slot>` tags are stripped (`node_modules/astro/dist/runtime/server/render/component.js:55-59, 266`), so a Card's gaps apply to them.
  - The renderer's `check()` calls the component function once before the real render (`server.js:26-37`), so component bodies must stay pure.
- **A failed price read hands the island every shop with `latest: null`** (`[id].astro:211-218`), the same shape as a shop that was never checked. On the user's own navigation such rows are refetched (`needsRefetch(null)` is true, `src/lib/services/price-comparison.ts:61-64`); from a link they aren't.
- **A dev-only route is possible.** An inline integration's `astro:config:setup` receives `command` (`'dev' | 'build' | 'preview' | 'sync'`) and `injectRoute` (`node_modules/astro/dist/types/public/integrations.d.ts:317-331`).
  - Injecting only when `command === "dev"` serves the route under `astro dev` on workerd, with middleware.
  - The route stays out of `astro build`.
  - `astro check` still type-checks the file through `tsconfig.json:3` (`**/*`).
  - Tailwind scans `src/dev` too, so `@source not "../dev"` (Tailwind 4.3.3 is installed; `@source not` needs 4.1+) keeps kitchen-sink-only classes out of production CSS.
- **A made-up product id reaches no shop.** The refresh route reads the product's targets before any shop request, and a product that isn't the user's costs none (`src/pages/api/watchlist/refresh.ts:36-37`). A fixture UUID that matches no product is therefore safe behind the kitchen sink's forms and links.
- **`ProductSummary.astro` is shared** with the list (`src/pages/watchlist.astro:209, 304`). Its token values reach the list too.

## What We're NOT Doing

- **The other pages:** the list, auth, index and dashboard aren't migrated. They keep their literals and look the same apart from the dark canvas. Each gets its own `/10x-ui` change.
- **C5, the sign-in path** (the language, the "Sign up" link, the return path after sign-in): deferred to S-07, which reworks that page.
- **No new npm dependencies:** no `cn` or `radix-ui` packages, no `shadcn` CLI run and no screenshot tool. Playwright arrives with Module 3 (m3l4).
- **No change to the Natura matching flow or its routes** (`/api/watchlist/matches`), or to the price rules (`src/lib/services/price-comparison.ts`).
- **No light theme or theme toggle.** The `:root` light values stay, unused.
- **No redesign of `src/components/auth/SubmitButton.tsx` or `LibBadge.astro`.**

## Implementation Approach

The work follows `/10x-ui`'s order: the library first, then the token values, then the one view, then its states.

- **Library:** the components and the new token names land and are visible in the kitchen sink before the values change.
- **Tokens:** the tokens then take today's cosmic values, so the kitchen sink shows the target look before the view moves.
- **The view:** it moves to tokens and components in one phase, together with the structural fixes (C3, C4). The fixes need the same extractions the kitchen sink does:
  - the Natura view builders move to a tested module;
  - the island splits into a presentational view and a stateful container.
- **States and the gate:** the kitchen sink grows to the whole view in every state, and is screenshotted.
- **Guard:** the lint rule and the rules text come last, once the cleaned files exist.

**Decisions made in planning** (brief, Key Decisions): all six were the owner's recommended options.

- The cosmic look lives in `.dark` tokens applied on `<html>`.
- `--primary` is the purple fill, with a separate `--link` token for text links.
- Components are copied from the registry with imports rewritten.
- The layout is trimmed of duplicates.
- All four C4 fixes are in.
- C5 is deferred to S-07.

**Settled while writing the plan, from the code and the lessons:**

- A row whose stored price couldn't be read carries its own mark. It never reads as "Jeszcze bez ceny", following the lesson "Never read an unreadable answer as missing".
- The Natura builders move to `src/lib/services/`, following "Keep decision logic in tested services".
- The list page and the Natura section share one submit-once script, following "Define shared constants and helpers once".

## Critical Implementation Details

- **Kitchen sink safety:**
  - Keep its path outside `PROTECTED_ROUTES` (`src/middleware.ts:5`, which matches by `startsWith`: `/dashboard`, `/watchlist`, `/api/watchlist`). `/dev/product-page` is safe.
  - Never hydrate the price island there with `autoRefresh`, because its effect would call the prices route on mount.
  - Keep it on-demand; don't set `prerender: true`, because prerendered routes are flaky under `astro dev` on workerd (withastro/astro#17922).
  - Its fixtures use one made-up UUID that matches no product, so a stray tap on a form or link reaches no shop.
- **ESLint globs:** in `files`, escape the brackets of `[id].astro` (`"src/pages/watchlist/\\[id\\].astro"`). Unescaped, `[id]` is a character class that matches `i.astro` or `d.astro`, and the rule would check nothing. Phase 5's deliberate break proves the escaped glob.
- **Tailwind tokens:** opacity modifiers on tokens (`bg-warning/10`) compile to `color-mix()` with a solid fallback. The contrast check must use the opacity each variant renders.

## Phase 1: Components and the kitchen sink

### Overview

The shared components the view needs and the token names they read, added through the stack's own source. A dev-only kitchen sink shows each of their variants.

### Changes Required:

#### 1. The new token names

**File**: `src/styles/global.css`

**Intent**: The added variants need the roles shadcn doesn't ship, so the names exist before any component reads them.

**Contract**:

- `--link`, `--success`, `--success-foreground`, `--warning` and `--warning-foreground` are each defined in `:root` and `.dark` and published in `@theme inline` as `--color-*`, following "Adding New Tokens".
- Their values are provisional; Phase 2 sets the final `.dark` values.

#### 2. Card, Alert and Badge

**File**: `src/components/ui/card.tsx`, `src/components/ui/alert.tsx`, `src/components/ui/badge.tsx` (new)

**Intent**: Copy the new-york-v4 registry source for the three components, so the view and the island share one implementation of each. Point the imports at what the repo already has.

**Contract**:

- The files equal `https://ui.shadcn.com/r/styles/new-york-v4/{card,alert,badge}.json` except for:
  - `cn` imported from `@/lib/utils`;
  - `Slot` from `@radix-ui/react-slot` (the registry's `Slot.Root` becomes `Slot`);
  - the added variants below.
- A comment at the top of each file names the registry URL, the date it was copied and the rewritten imports.
- **Alert:** variants `default`, `destructive`, `success` and `warning`. A caller can pass `role`; it defaults to `alert`.
- **Badge:** variants as in the registry, plus `success` and `warning`.
- The new variants read only tokens: `success`, `success-foreground`, `warning` and `warning-foreground`.

#### 3. Button

**File**: `src/components/ui/button.tsx`

**Intent**: Keep the view's 44 px tap targets, and give text links their own token.

**Contract**:

- A new size `touch`: 44 px minimum height, with padding like `default`.
- The `link` variant reads `text-link` instead of `text-primary`. `SubmitButton.tsx` uses the default variant only, so nothing else changes.

#### 4. Dev-only kitchen sink route

**File**: `astro.config.mjs`, `src/styles/global.css`, `src/dev/product-page.astro` (new)

**Intent**: A page that exists only under `astro dev`, rendering the design system and, later, the view in every state, for review and screenshots.

**Contract**:

- **The route:** an inline integration (`name: "dev-kitchen-sink"`) injects `{ pattern: "/dev/product-page", entrypoint: "./src/dev/product-page.astro" }` from `astro:config:setup` only when `command === "dev"`.
- **Tailwind:** `global.css` adds `@source not "../dev";`.
- **The page:**
  - It uses `Layout` with `lang="pl"`.
  - Phase 1 shows: Card; Alert in each variant, with its role; Badge in each variant; Button in each variant at `touch` size; a disabled Button; and an `<a>` styled with `buttonVariants()`.
  - It uses fixture data only, and imports nothing that reaches Supabase or a shop.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes, and no file under `dist/` mentions `dev/product-page`
- With the dev server started as `ASTRO_DEV_BACKGROUND=1 npx astro dev`, `curl` of `http://localhost:4321/dev/product-page` answers 200

#### Manual Verification:

- The kitchen sink shows each component variant, including the new ones, and the disabled Button.
- A diff against the registry JSON shows only the rewritten imports and the added variants and size.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Token values

### Overview

Today's cosmic palette moves into the `.dark` tokens, applied on `<html>`, with the few roles the page needs and shadcn doesn't ship. A script proves the contrast of every pair the view renders.

### Changes Required:

#### 1. The dark theme's values

**File**: `src/styles/global.css`

**Intent**: The tokens carry the look the pages paint by hand today, so the view can move to tokens without changing how it looks.

**Contract**:

- **`.dark` takes the cosmic values,** matching today's literals (the research's view → source table). The new values are derived from the Tailwind v4 palette values the literals use today, and each is written as `oklch(L C H)` or `oklch(L C H / A)`, which the contrast script reads.

  | Token                               | Takes today's                                                 |
  | ----------------------------------- | ------------------------------------------------------------- |
  | `--background`                      | navy base, `#0a0e1a`                                          |
  | `--foreground`, `--card-foreground` | white                                                         |
  | `--card`                            | white at 5%                                                   |
  | `--border`                          | white at 10% (already)                                        |
  | `--input`                           | white at 20%                                                  |
  | `--muted`, `--accent`               | white at 10%                                                  |
  | `--muted-foreground`                | one value replacing `blue-100` at 80, 70 and 60%              |
  | `--primary`                         | purple-600 fill                                               |
  | `--primary-foreground`              | white                                                         |
  | `--link`                            | purple-300, for text links                                    |
  | `--success`, `--success-foreground` | emerald: tint surface and its text                            |
  | `--warning`, `--warning-foreground` | amber: tint surface and its text                              |
  | `--destructive`                     | red-300, today's error text; the view has no destructive fill |
  | `--ring`                            | a focus colour                                                |

  The tokens the view doesn't use (popover, secondary, chart, sidebar) keep shadcn's neutral dark values.

- **Two more tokens,** each defined in `:root` and `.dark` and published in `@theme inline`:

  | Token               | For                                   |
  | ------------------- | ------------------------------------- |
  | `--thumbnail`       | the white product-photo tile          |
  | `--background-glow` | the gradient's middle stop, `#0f1529` |

- **Surfaces and text:** a status surface uses `--success`/`--warning`, and its text uses the `-foreground` token. Text never uses the surface token.
- **`bg-cosmic`** becomes `linear-gradient(to bottom, var(--background), var(--background-glow), var(--background))`, with no literal colour left in it.
- **`.dark` sets `color-scheme: dark`.**
- **Focus:** the focus outline (the base layer's `outline-ring/50`, and the components' `ring-ring/50`) reaches 3:1 or more against the background and the card surface. Either the `--ring` value or the opacity applied changes to get there.

#### 2. Apply the dark theme

**File**: `src/layouts/Layout.astro`

**Intent**: Every page renders inside `.dark`.

**Contract**: `<html lang={lang} class="dark">`. No script and no toggle.

#### 3. Token contrast check

**File**: `scripts/check-token-contrast.mjs` (new), `.github/workflows/ci.yml`

**Intent**: A later token edit that breaks readability fails a check, not a phone at the shelf.

**Contract**:

- **What it reads:** the dependency-free Node script reads the `.dark` values from `src/styles/global.css`. It converts OKLCH to sRGB, composites alpha over the colour beneath, and computes WCAG contrast.
- **What it checks,** each pair at the opacity its component renders:
  - text at 4.5:1: `foreground` and `muted-foreground` on the background and on the card; `link` on the background and the card; `primary-foreground` on `primary`; `destructive` on the background and on its alert surface; `success-foreground` and `warning-foreground` on their surfaces and on the background;
  - `ring` at 3:1 against the background and the card.
- **Output:** one PASS or FAIL line per pair, and exit 1 on any failure.
- **CI:** the `ci` job runs it as "Check design token contrast" after lint.

### Success Criteria:

#### Automated Verification:

- `node scripts/check-token-contrast.mjs` prints only PASS lines
- `npm run test` passes
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Screenshots of the kitchen sink at 1280 and 390 px show the cosmic look with every component on tokens.
- The product page, the list and the sign-in page look as before, with a dark canvas, overscroll and scrollbar.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: The product page on tokens and components

### Overview

The page, `ProductSummary` and the island use tokens and shared components only. Each shop appears once (C3), and the page's messages agree with the island (C4). This phase does the extractions the kitchen sink needs next.

### Changes Required:

#### 1. The Natura section's view state

**File**: `src/lib/services/natura-view.ts` (new), `src/lib/services/natura-view.test.ts` (new)

**Intent**: What the Natura section shows is decided in a tested module, not inline in the page (lesson "Keep decision logic in tested services"), so the page and the kitchen sink use the same builders.

**Contract**:

- The `NaturaView` type, its builders (`sizeLabel`, `otherSize`, `matchedView`, `notFoundView`, `storedView`, `optionView`) and their formatters move here from `[id].astro:41-131`. The formatters stay on the Europe/Warsaw clock, and each builder takes its times as arguments.
- **The `matched` view** carries the note and the size warning only (C3). The section no longer shows the matched item's summary or a "Zobacz w sklepie" link: the price row shows Natura's price and link.
- **Tests:**
  - each view kind;
  - a size warning only when both sizes are known and differ;
  - the candidate flags ("Ten sam EAN", other size, unknown size);
  - a candidate's price text with and without an offer.

#### 2. The shared submit-once guard

**File**: `src/components/SubmitOnce.astro` (new), `src/pages/watchlist.astro`

**Intent**: The list's refresh form and the Natura decision forms share one guard (lesson "Define shared constants and helpers once").

**Contract**:

- The component holds the script now at `src/pages/watchlist.astro:325-342`, unchanged:
  - a submit disables every button of its `form[data-submit-once]`;
  - a page restored from the back/forward cache enables them again.
- The list page renders the component in place of its inline script. Astro bundles a component's script once per page.

#### 3. The Natura section

**File**: `src/components/watchlist/NaturaSection.astro` (new)

**Intent**: The section renders from a `NaturaView`, so the page and the kitchen sink render it the same way. The decision's feedback sits next to the decision.

**Contract**:

- **Props:** `view: NaturaView | null`, `productId`, `unsaved`, and `notice`/`error` (the `?matched`/`?declined`/`?decided` notice and the `?error=` message, as texts). Each state renders today's text, built from Card, Alert, Badge and Button/`buttonVariants()`.
- **Notices and errors:** a success notice is an Alert with `role="status"`, and an error is a destructive Alert. Both render at the top of the section (C4.3).
- **Submit-once:** the decision forms carry `data-submit-once`, and the section renders `SubmitOnce` (C4.4).
- **Links:** each candidate keeps its own "Zobacz w sklepie": it is how the user checks a candidate before choosing it.
- **Accessible names:**
  - Each candidate's "To ten produkt" and "Zobacz w sklepie" are described by that candidate's name (`aria-describedby`).
  - A link that opens a new tab says so to screen readers.

#### 4. The page

**File**: `src/pages/watchlist/[id].astro`

**Intent**: The page composes the header, the price island and the Natura section from tokens and components. The duplicate Rossmann block goes, and the address bar forgets a code once its notice has shown.

**Contract**:

- **Wrapper and branches:**
  - The wrapper is `bg-cosmic` with `text-foreground`.
  - The not-found and failed branches use tokens: the heading, a muted hint, the back link via `buttonVariants({ variant: "link" })`, and the error as a destructive Alert.
- **Header:** the header card is a Card around `ProductSummary`.
- **Removed (C3):** the Rossmann card (`[id].astro:336-354`).
- **The prices section:**
  - The island gets a new prop, `pricesFailed`; the page no longer renders "Nie udało się wczytać cen." itself (C4.1).
  - The `?prices=` notice (the no-JavaScript refresh) stays in this section, as an Alert.
- **Address bar:** a small `<script>` removes `matched`, `declined`, `decided`, `error` and `prices` from the address bar with `history.replaceState` once the page has loaded (C4.3). It keeps every other parameter and the hash.

#### 5. ProductSummary

**File**: `src/components/watchlist/ProductSummary.astro`

**Intent**: The shared summary reads tokens, for the list as well.

**Contract**: the muted text uses `text-muted-foreground`, the photo tile `bg-thumbnail`, and the empty placeholder `bg-muted`. Nothing else changes.

#### 6. The price island

**File**: `src/components/watchlist/PriceComparison.tsx`, `src/components/watchlist/PriceComparisonView.tsx` (new), `src/components/watchlist/price-comparison-state.ts` (+ its test), `eslint.config.js`

**Intent**: A presentational view renders any state the reducer can produce, for the page and the kitchen sink alike. The container keeps the effects. The view uses tokens and components, and the island owns the read-failure alert (C4.1, C4.2).

**Contract**:

- **`PriceComparisonView`:**
  - It takes `itemId`, the reducer state, and an `onRefresh` handler that is absent when rendered statically. Without the handler, the refresh form posts as it does without JavaScript.
  - It renders the rows, the session alert, the read-failure alert, the live region and the refresh form.
  - Rows are Cards, with Badges for "Najtaniej", "nieaktualna" and "niedostępny online", and link-token links. The refresh button is an outline Button at `touch` size.
  - Each row's "Zobacz w sklepie" is described by its shop's name and says it opens a new tab.
- **`PriceComparison`:** it keeps the reducer and effects and renders the view. Its props add `pricesFailed: boolean`.
- **The reducer:**
  - `initialState` takes `pricesFailed`, defaulting to false, and gives every row `readFailed: pricesFailed`.
  - A `done` whose answer is a price or missing clears that row's `readFailed`; an unavailable or session-ended answer keeps it.
  - The read-failure alert ("Nie udało się wczytać cen.") shows while any row has `readFailed`.
  - **A row's gap text:** "Nie udało się wczytać ceny." while it has `readFailed`; "Jeszcze bez ceny" when it was never checked (`latest === null`); otherwise "Brak ceny online w {site}", as today.
  - The existing texts, the announcements and the order rules are unchanged.
- **Tests:**
  - `readFailed` starts on every row when the read failed;
  - a price or missing answer clears it for that row only;
  - an unavailable or session-ended answer keeps it.
- **Lint:** the new view file joins `islandConfig.files` in `eslint.config.js`, so it can't import server-only code.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the natura-view tests and the reducer's read-failure tests
- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- `npm run build` passes
- The `/10x-ui` hardcoded-value scan finds 0 hits in `src/pages/watchlist/[id].astro`, `src/components/watchlist/*.astro` and `src/components/watchlist/*.tsx`

#### Manual Verification:

- A phone-viewport walk-through on the dev server:
  - each shop appears once, with one "Zobacz w sklepie" in its price row, and each candidate keeps its own;
  - a decision's notice or error sits in the Natura section, and its code leaves the address bar;
  - a double tap on "To ten produkt" saves once, without "Ten produkt ma już zapisaną decyzję.";
  - a row not fetched yet says "Jeszcze bez ceny".
- The list page's product summaries and its "Odśwież ceny" guard work as before.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: States and the visual gate

### Overview

The kitchen sink shows the whole view in every state, and the 7-state matrix is proven cell by cell. The screenshots become the change's visual evidence.

### Changes Required:

#### 1. The whole view in the kitchen sink

**File**: `src/dev/product-page.astro`, `src/dev/fixtures.ts` (new)

**Intent**: Every state the product page can show is visible at once, from fixtures, so a review can judge them together.

**Contract**:

- **Header:** the header card with and without a photo.
- **Natura:** the Natura section in each `NaturaView` kind, with the unsaved alert, and with a decision notice and error.
- **Prices:** `PriceComparisonView`, rendered statically, in these states built with the reducer from fixtures:
  - cheapest, a tie and a lone shop;
  - stale, not orderable online, missing with and without a price, and never checked;
  - refreshing, with the button disabled;
  - each row notice (busy, paused, stopped, failed);
  - session ended;
  - read failed, before and after one shop has answered.
- **Page branches:** the page's not-found and failed branches.
- **Fixtures:** they use a fixed `now`, one made-up product UUID, and no real user data.

#### 2. Screenshots

**File**: `context/changes/product-page-ui/screenshots/` (new PNGs)

**Intent**: The gate's evidence, taken after the change, for the review and the PR.

**Contract**:

- Full-page captures of the kitchen sink and of the product page, at 1280 and 390 px. Take them in the Chrome DevTools device toolbar, or with the installed headless Chrome: `--headless --window-size=390,2400 --screenshot`, dev kitchen sink only.
- Fixture or local test data only, since the repo is public.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npx astro check` reports 0 errors
- `npm run lint` passes
- The hardcoded-value scan finds 0 hits in `src/dev/`

#### Manual Verification:

- The 7-state matrix is complete for the view's controls. Each cell is shown in the kitchen sink or marked N/A with its reason:
  - **default:** tokens and components only;
  - **hover:** each control type in DevTools' forced `:hover`;
  - **focus-visible:** a keyboard pass reaches every control, and the ring is visible;
  - **disabled:** "Odśwież ceny" while refreshing, and a decision button after submit;
  - **error:** a destructive Alert next to the Natura buttons, the read-failure alert, and the row notices;
  - **empty:** "Jeszcze bez ceny", a declined decision, and the not-found product;
  - **loading:** "Odświeżam…" with no layout jump beyond the row's own growth.
- The screenshots are saved at 1280 and 390 px for the kitchen sink and the product page.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: The guard and the docs

### Overview

The contract outlives this session: a lint rule refuses literals in the cleaned files, and the rules file tells the next agent where to look.

### Changes Required:

#### 1. The palette-literal lint rule

**File**: `eslint.config.js`

**Intent**: A palette class or arbitrary value added to a cleaned file fails `npm run lint` and the pre-commit hook. A rule an agent might forget isn't enough.

**Contract**:

- **Scope:** an override for `src/pages/watchlist/\\[id\\].astro` (brackets escaped), `src/components/watchlist/**/*.{astro,tsx}` and `src/dev/**/*.{astro,ts}`.
- **The rule:** `no-restricted-syntax` flags any string literal or template-literal text containing a Tailwind palette class, or an arbitrary `-[…px|rem]` value. It uses the `/10x-ui` scan's pattern, and its message points at the token file.
- It adds no dependency.

#### 2. The rules text

**File**: `CLAUDE.md` (project section only), `AGENTS.md`, `context/foundation/roadmap.md`

**Intent**: The next agent finds the tokens, the components, the kitchen sink and the checks without re-auditing.

**Contract**:

- **The UI bullet in CLAUDE.md says:**
  - **Tokens:** they live in `src/styles/global.css`, with the dark theme applied on `<html>`. A new role goes into `:root`, `.dark` and `@theme inline`.
  - **Components:** they live in `src/components/ui`, so check there first. A missing one is copied from the new-york-v4 registry with its imports pointed at `@/lib/utils` and `@radix-ui/react-slot`.
  - **In `.astro` files:** shadcn React components render there without `client:*`, and links styled as buttons use `buttonVariants()`.
  - **Checks:** no palette literals or arbitrary values in the cleaned views, which ESLint enforces. `/dev/product-page` shows every state, under `astro dev` only, so update it with the view. `scripts/check-token-contrast.mjs` guards the values.
  - **Unchanged:** the rest of the bullet stays.
- **`AGENTS.md`**, today the bare text "CLAUDE.md", says to read `CLAUDE.md` for every project rule.
- **The roadmap's S-07 item** records C5 as a carry-over: the return path after sign-in, and the sign-in page's language.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- A deliberate break fails lint: a palette class planted in a cleaned file makes `npm run lint` fail, and the file is restored afterwards
- `npm run test` passes
- `npx astro sync && npx astro check` reports 0 errors
- CI `ci` and `smoke` jobs are green on the PR

#### Manual Verification:

- The CLAUDE.md UI bullet, `AGENTS.md` and the S-07 carry-over read correctly.
- The course block in CLAUDE.md is byte-identical.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `natura-view` builders: each view kind, the size warning, the candidate flags and the price text.
- The price reducer: the per-row read failure is set, cleared by a price or missing answer, and kept by the others. The existing reducer and comparison tests keep passing.

### Integration Tests:

- `scripts/check-token-contrast.mjs` in CI's `ci` job.
- The ESLint palette rule, proven with a deliberate break.
- The existing smoke test and database checks stay green; nothing here touches the routes or the schema.

### Manual Testing Steps:

1. The kitchen sink at 1280 and 390 px: every component variant (phase 1), then the cosmic look (phase 2), then every view state (phase 4).
2. The product page on the dev server in a phone viewport: the C3 and C4 checks of phase 3, and a keyboard pass for focus.
3. After the merge, on a phone against production: a matched product's page, a decision notice, "Odśwież ceny", and the list and sign-in pages unchanged apart from the canvas.

## Performance Considerations

- **Page weight:** the shadcn components render as static HTML in `.astro`, with no added JavaScript. The island's chunk grows by the Card and Badge code, a few hundred bytes.
- **Kitchen sink:** it and its fixtures are absent from the build, and `@source not "../dev"` keeps their classes out of the CSS.

## Migration Notes

- **No data or schema change.**
- **`<html class="dark">` changes every page's canvas:**
  - overscroll, scrollbars and native controls turn dark;
  - the default focus outline and `SubmitButton`'s ring take the new `--ring`;
  - pages that read no colour token otherwise look the same;
  - the list's product summaries take the token colours.
- **Rollback:** revert the change's commits. No state depends on them.

## References

- Research: `context/changes/product-page-ui/research.md` (charges C1-C5, the 7-state matrix, the gate)
- `/10x-ui` skill: `.claude/skills/10x-ui/SKILL.md` and `references/ui-quality-checklist.md`
- shadcn registry and docs: `https://ui.shadcn.com/r/styles/new-york-v4/{card,alert,badge}.json`, `https://ui.shadcn.com/docs/theming` ("Adding New Tokens")
- Tailwind CSS v4: `https://tailwindcss.com/docs/theme`, `https://tailwindcss.com/docs/dark-mode`, `https://tailwindcss.com/docs/color-scheme`, `https://tailwindcss.com/docs/detecting-classes-in-source-files`
- WCAG 2.2: 1.4.3, 1.4.11, 2.4.7, 2.5.8 (`https://www.w3.org/TR/WCAG22/`)
- Astro integration API: `https://docs.astro.build/en/reference/integrations-reference/`; `node_modules/astro/dist/types/public/integrations.d.ts:317-331`
- Astro's React renderer: `node_modules/@astrojs/react/dist/server.js:11-38, 50-80`
- Patterns: the submit-once script at `src/pages/watchlist.astro:325-342`; `islandConfig` in `eslint.config.js:88-125`; `src/components/ui/button.tsx`
- Lessons: `context/foundation/lessons.md` ("Never read an unreadable answer as missing", "Keep decision logic in tested services", "Define shared constants and helpers once")

## Implementation Notes

### Phase 1

- **Links styled as buttons use `class:list={buttonVariants(…)}`, not `class={…}`** (Phase 1 kitchen sink; applies to Phase 3's page and Phase 5's CLAUDE.md wording). The repo's ESLint rule `astro/prefer-class-list-directive` flags `class={expression}`, and every `.astro` file already uses `class:list`. The rendered classes are the same.
- **"The files equal the registry" means equal after the repo's Prettier** (Phase 1, criterion 1.7). Prettier adds semicolons and wraps at 120 columns, and its Tailwind plugin reorders the `cva()` class strings. So 1.7 diffs each copy against the registry's `files[0].content` formatted with `npx prettier --stdin-filepath src/components/ui/<name>.tsx`. The diff shows only the header comment, the `cn` and `Slot` imports, `Slot.Root` → `Slot`, and the added variants.
- **`@source not "../dev"` applies under `astro dev` too, not only in production** (corrects the Key Discovery; binds Phase 4). `@tailwindcss/vite` builds CSS only from its scan of the source files, in dev as in the build. So a class used only under `src/dev` gets no CSS anywhere, and the kitchen sink may use only classes the app itself uses. `global.css` and the page say so in a comment.
- **The kitchen sink shows two disabled Buttons and three button-styled links** (Phase 1 contract: "a disabled Button" and "an `<a>` styled with `buttonVariants()`"). These are the controls the view actually uses: default "To ten produkt", outline "Odśwież ceny", and the default, outline and link `<a>`s.
- **For Phase 2, the status surfaces render at these opacities:** Alert `success`/`warning` with borders at `/30`, fills at `/10` and the description at `/90`; Badge `success`/`warning` with fills at `/15`, and `/25` on hover as a link. The contrast check measures these, and Phase 2 may tune them. The provisional `.dark` values are purple-300, emerald-400/200 and amber-400/200; in `:root` they are purple-700, emerald-600/800 and amber-500/800.
- **For Phase 3, Alert text goes inside `AlertDescription` or `AlertTitle`.** The Alert's grid is `grid-cols-[0_1fr]`, so bare text passed straight to `<Alert>` lands in the zero-width first column.
- **For Phase 4, headless Chrome can't lay a page out at 390 px** (Phase 4 screenshot contract). At `--window-size=390`, Chrome 153's `--headless=new` lays the page out 504 px wide (`innerWidth=504`, its minimum window width) and crops the capture to 390. A true 390 px capture needs the DevTools device toolbar, or a DevTools-protocol device-metrics override (`Emulation.setDeviceMetricsOverride`). A capture made that way measured `innerWidth` = `scrollWidth` = 390 on the Phase 1 page, so nothing overflows. Astro's dev toolbar is fixed to the bottom of the viewport and lands on top of full-page captures, so hide it for the gate's screenshots. Removing its element after the page loads isn't enough, since a hot reload can bring it back (seen at Phase 2). Turn it off on the machine with `npx astro preferences disable devToolbar` for the captures, and back on with `enable` afterwards.

### Phase 2

- **The contrast check measures more than the plan's minimum list** (Phase 2 contract, "What it checks"). It runs 60 lines: 30 pairs, each over both of `bg-cosmic`'s stops (`--background` and `--background-glow`). Beyond the plan's pairs, it adds:
  - `card-foreground` on a card;
  - the primary button in a card and on hover (`/90`);
  - the outline button (`input/30`) and its hover (`input/50`, `accent-foreground`);
  - the Alert descriptions at `/90`;
  - the status Badges at `/15` in a card;
  - a warning Alert as a surface, for the session-ended alert's sign-in link and the focus ring around it.

  A passing run prints only PASS lines; a failing run adds "N check(s) failed" and exits 1.

- **The check is strict about `.dark`** (Phase 2 contract, lesson "Never read an unreadable answer as missing"):
  - Every custom property in `.dark` must read as `oklch(L C H)` or `oklch(L C H / A)`, or it fails by name.
  - A missing or unreadable token fails every pair that needs it.
  - Both canvas stops must be opaque.
  - So a future non-colour custom property belongs outside `.dark`.
- **Focus reaches 3:1 through `--ring` alone:** purple-300, drawn at 50%. No component or base-layer opacity changed. The margins are the tightest in the check: 3.23:1 at worst, on a warning Alert over the glow stop. purple-200 would give about 4:1, but would no longer match the links.
- **`--muted-foreground` is blue-100 at 80% alpha**, the opacity 12 of the 16 uses had. The 2 uses at `/70` and the 2 at `/60` become slightly brighter once Phase 3 moves them to the token.
- **`--accent-foreground` keeps shadcn's `oklch(0.985 0 0)`.** The plan's table doesn't list it, but the outline button's hover reads it: 13.20:1 at the lowest.
- **Looks that shift in Phase 3, when the view moves to the components:**
  - Warning fills (amber-400 at `/10`) are slightly more olive than today's amber-900 at `/30`.
  - The primary button darkens on hover (`bg-primary/90`) instead of lightening to purple-500.
  - Outline buttons gain a 6% white fill (`dark:bg-input/30`).
  - shadcn's `destructive` Alert had no red tint: `bg-card` with red text, where today's error boxes are red-tinted. The owner settled it at the Phase 2 gate, in the next note.
- **The owner's call at the Phase 2 gate: errors are tinted like the other statuses** (changes Phase 1's contract that the copies equal the registry apart from the added variants). The Alert's `destructive` variant is now `border-destructive/30 bg-destructive/10 text-destructive`, where the registry draws it on `bg-card`.
  - Errors keep today's red box and match the success and warning Alerts.
  - `alert.tsx`'s header comment records the change.
  - The contrast check measures that surface as `destructive` at 10% over the canvas: 6.69:1 at the lowest, for the `/90` description over the glow stop.
- **Not checked, because the view doesn't render them:** the `destructive` Button and Badge fills (`dark:bg-destructive/60` under white text). They measure 4.59:1 on the base stop and 4.41:1 on the glow, below 4.5:1, so a view that starts using them needs a pair in the check first. Nor is the registry's Badge `link` variant checked. It reads `text-primary`, now purple-600, at about 3.5:1 on the canvas, so a view that uses it should switch it to `text-link`, as the Button's link variant already reads.
- **The gradient's stops are `oklch()` now, so browsers interpolate it in Oklab rather than sRGB.** Both stops round-trip to the same 8-bit hex, and the change isn't visible between colours this close.

### Phase 3

- **`natura-view.ts` has two builders beyond the plan's list, both tested** (Phase 3 contract, item 1). The page's view literals held logic, so it moved (lesson "Keep decision logic in tested services"):
  - `chooseView(options, via, fetchedAt, own)` picks the EAN or name intro;
  - `promptView(own, retrying)` keeps `?retry=1` in the prompt's link.

  The `unavailable`, `decided` and `read-failed` views hold no logic, so they stay literals in the page.

- **`natura-view.ts` reuses `formatPrice` and `SHOP_LABELS.natura.site` from `price-comparison.ts`** instead of moving the page's identical `pln` formatter and its `drogerienatura.pl` literal (lesson "Define shared constants and helpers once"). The output is identical.
  - The builders take `NaturaProduct` (`Pick<WatchlistProduct, "id" | "sizeText" | "size">`), and `matchedView` takes only the item's `sizeText` and `size`.
  - New exported types: `NaturaOption`, and `CandidateFlag` (the page's local `Flag`).
- **The gap-text choice is `gapText(row)` in the browser-safe `price-comparison-state.ts`, with tests** (Phase 3 contract, item 6). It reads the site from `SHOP_LABELS`. The view computes the read-failure alert's condition inline, as it does `refreshing`, and renders that alert above the session alert, in today's order.
- **Screen-reader descriptions:**
  - Each price row's `aria-describedby` id comes from React's `useId`. Astro's React renderer passes a per-render prefix that hydration reuses, so the ids match across hydration and stay unique across several static views.
  - Natura candidates use index-based ids (`natura-candidate-<n>`) on a `hidden` span holding the brand and name. A hidden element still counts when `aria-describedby` points at it, and `ProductSummary` itself stays unchanged beyond tokens.
- **Text links are `cn(buttonVariants({ variant: "link", size: "touch" }), "px-0 …")`,** flush with the column. The links underlined today keep `underline`; "← Moja lista" underlines on hover only, as today.
- **`SubmitOnce.astro` holds the list page's script unchanged apart from its comments.** `NaturaSection` renders it every time.
- **Gate fix: the page no longer declares `pageUrl`.** Once `promptView` built the prompt's link, `astro check` flagged `pageUrl` as unused (hint ts(6133)): it doesn't count the frontmatter's `return Astro.redirect(pageUrl)` as a read. The redirect now builds its URL inline, and the check reports 0 hints.
- **The owner's call at the Phase 3 gate: a match's size warning is a warning Badge** (Phase 3 contract, item 3; FR-007). The matched state has no card, so the warning ("Inny rozmiar: X zamiast Y") uses the same pill the candidate's flag had before it was confirmed, above the note as plain text. A suspicious match then stands out without a live region. The change landed after the walk-through, and Phase 4's kitchen sink shows it.
- **Looks the components shift slightly:** `font-medium` on links and badges, `rounded-md` buttons (today's are `rounded-lg`), the Card's `shadow-sm`, and the badges' `py-0.5` (today's pills use `py-1`).
- **For Phase 4:**
  - Several `NaturaSection`s, or a price section beside a page, on one kitchen-sink page repeat `natura-heading`, `natura-candidate-<n>` and `prices-heading`. So the kitchen sink either renders one of each per page, or the components take an id prefix.
  - The not-found and failed branches are still inline in `[id].astro`, as the contract left them. The kitchen sink needs its own copy of them or an extraction.
- **For Phase 5:** CLAUDE.md's UI text still says the product page shows the Rossmann item "with its 'Zobacz w sklepie' link". That link is now only in the price row, so reword it.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Components and the kitchen sink

#### Automated

- [x] 1.1 `npm run test` passes — ce3f433
- [x] 1.2 `npx astro sync && npx astro check` reports 0 errors — ce3f433
- [x] 1.3 `npm run lint` passes — ce3f433
- [x] 1.4 `npm run build` passes, and no file under `dist/` mentions `dev/product-page` — ce3f433
- [x] 1.5 With the dev server started as `ASTRO_DEV_BACKGROUND=1 npx astro dev`, `curl` of `http://localhost:4321/dev/product-page` answers 200 — ce3f433

#### Manual

- [x] 1.6 The kitchen sink shows each component variant, including the new ones, and the disabled Button — ce3f433
- [x] 1.7 A diff against the registry JSON shows only the rewritten imports and the added variants and size — ce3f433

### Phase 2: Token values

#### Automated

- [x] 2.1 `node scripts/check-token-contrast.mjs` prints only PASS lines — 12f2075
- [x] 2.2 `npm run test` passes — 12f2075
- [x] 2.3 `npx astro sync && npx astro check` reports 0 errors — 12f2075
- [x] 2.4 `npm run lint` passes — 12f2075
- [x] 2.5 `npm run build` passes — 12f2075

#### Manual

- [x] 2.6 Screenshots of the kitchen sink at 1280 and 390 px show the cosmic look with every component on tokens — 12f2075
- [x] 2.7 The product page, the list and the sign-in page look as before, with a dark canvas, overscroll and scrollbar — 12f2075

### Phase 3: The product page on tokens and components

#### Automated

- [x] 3.1 `npm run test` passes, including the natura-view tests and the reducer's read-failure tests
- [x] 3.2 `npx astro sync && npx astro check` reports 0 errors
- [x] 3.3 `npm run lint` passes
- [x] 3.4 `npm run build` passes
- [x] 3.5 The `/10x-ui` hardcoded-value scan finds 0 hits in `src/pages/watchlist/[id].astro`, `src/components/watchlist/*.astro` and `src/components/watchlist/*.tsx`

#### Manual

- [x] 3.6 A phone-viewport walk-through on the dev server: each shop once, decision feedback in the Natura section, a double tap saves once, "Jeszcze bez ceny" for a row not fetched yet
- [x] 3.7 The list page's product summaries and its "Odśwież ceny" guard work as before

### Phase 4: States and the visual gate

#### Automated

- [ ] 4.1 `npx astro sync && npx astro check` reports 0 errors
- [ ] 4.2 `npm run lint` passes
- [ ] 4.3 The hardcoded-value scan finds 0 hits in `src/dev/`

#### Manual

- [ ] 4.4 The 7-state matrix is complete for the view's controls, each cell shown in the kitchen sink or marked N/A with its reason
- [ ] 4.5 The screenshots are saved at 1280 and 390 px for the kitchen sink and the product page

### Phase 5: The guard and the docs

#### Automated

- [ ] 5.1 `npm run lint` passes
- [ ] 5.2 A deliberate break fails lint: a palette class planted in a cleaned file makes `npm run lint` fail, and the file is restored afterwards
- [ ] 5.3 `npm run test` passes
- [ ] 5.4 `npx astro sync && npx astro check` reports 0 errors
- [ ] 5.5 CI `ci` and `smoke` jobs are green on the PR

#### Manual

- [ ] 5.6 The CLAUDE.md UI bullet, `AGENTS.md` and the S-07 carry-over read correctly
- [ ] 5.7 The course block in CLAUDE.md is byte-identical
