---
date: 2026-09-29T17:06:06+02:00
researcher: Claude Code (claude-opus-5-5)
git_commit: 6d71c436e6704955aa21a09c8be30d43317974d3
branch: feat/product-page-ui
repository: yaroslavkhudchenko/10xcourseproject
topic: "/10x-ui audit of the product page /watchlist/<id>: charges, token source, states and visual gate"
tags: [research, ui, design-tokens, shadcn, product-page, 10x-ui]
status: complete
last_updated: 2026-09-29
last_updated_by: Claude Code (claude-opus-5-5)
---

# Research: /10x-ui audit of the product page /watchlist/<id>

**Date**: 2026-09-29T17:06:06+02:00
**Researcher**: Claude Code (claude-opus-5-5)
**Git Commit**: 6d71c436e6704955aa21a09c8be30d43317974d3
**Branch**: feat/product-page-ui
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

Audit the product page `/watchlist/<id>` in both directions, source → views and view → source, for a design-system contract. The view is `src/pages/watchlist/[id].astro`, the React island `src/components/watchlist/PriceComparison.tsx` and `src/components/watchlist/ProductSummary.astro`.

The audit delivers:

- 3-5 charges, each with file:line and its effect on the user, across missing tokens, missing shared components and accidental architecture.
- The view's 7-state matrix as it is today.
- How a kitchen-sink page and a screenshot gate could be done in this repo.

The work was read-only, and three parallel workers covered view → source, source → views with the theme, and entry points with states and the gate.

## Summary

**The view reads no colour token.** `src/styles/global.css` is a correct shadcn new-york token file:

- `:root` (6-39) and `.dark` (41-73) each define the same 31 colours.
- `@theme inline` (75-111) publishes them as `var(--x)`.

But `<html>` never gets the `dark` class (`src/layouts/Layout.astro:15`), so every token resolves to the light values. The product page paints its own dark look from a raw hex gradient (`@utility bg-cosmic`, `global.css:113-115`, used at `[id].astro:253`) and palette literals:

| File                   | Palette literals     | Colour-token classes | `components/ui` imports |
| ---------------------- | -------------------- | -------------------- | ----------------------- |
| `[id].astro`           | 61, plus `bg-cosmic` | 0                    | 0                       |
| `PriceComparison.tsx`  | 22                   | 0                    | 0                       |
| `ProductSummary.astro` | 5                    | 0                    | 0                       |

The same holds for every view under `src/pages` and `src/components` except `button.tsx` itself.

**The shared components exist in one file only.** `src/components/ui` has `button.tsx`, whose one consumer, `SubmitButton.tsx`, overrides its colour tokens, and the unused starter `LibBadge.astro`. The page hand-builds 9 boxed notices, 5 cards, 4 pill badges, 5 buttons and 6 text links.

**The page's structure mirrors the order the slices shipped.** The S-03 price island sits above S-02's Rossmann and Natura sections, so each matched shop appears twice. The page's server messages aren't reconciled with the island, and a signed-out or expired entry loses the product.

**States.** Focus-visible is the browser default, recoloured to the light `--ring` at 50% (`global.css:119`); none of the three files has a focus class. Disabled exists only on "Odśwież ceny" (`PriceComparison.tsx:126-127`), and loading is the "Odświeżam…" text (`PriceComparison.tsx:156`).

**The visual gate.** No screenshot tooling is installed. It can be done without new dependencies:

- a dev-only kitchen-sink route, added through an inline integration's `injectRoute` when `command === "dev"`;
- screenshots at 1280 px and 390 px, captured by hand in DevTools or by the installed headless Chrome.

The island first needs a presentational split, so that its transient states can be rendered from props.

## Charges

Five charges. C1-C4 are recommended for this change; C5 is recommended as deferred to S-07, with the reason given below.

### C1 (missing tokens): the page's look bypasses the token layer, which is set to the wrong theme

**Evidence:**

- `src/layouts/Layout.astro:15`: `<html lang={lang}>` has no `dark` class, so tokens resolve to `:root`, a white background and near-black text (`global.css:6-39`).
- `src/pages/watchlist/[id].astro:253`: `bg-cosmic min-h-screen p-4 text-white` paints the dark page instead. `bg-cosmic` is `linear-gradient(to bottom, #0a0e1a, #0f1529, #0a0e1a)` in raw hex, with no token and no light counterpart (`global.css:113-115`).
- The three files use six colour roles with no token for three of them:
  - The purple accent, on every link and primary button (`[id].astro:255, 349, 377, 443, 453, 490, 504`; `PriceComparison.tsx:213`), has no token.
  - Warning (amber) and success (emerald) have no tokens either. `global.css` defines only `--destructive`, among status colours.
  - Muted text uses three opacities of `blue-100`: 16 occurrences at `/80`, `/70` and `/60` (for example `[id].astro:271, 343, 385`; `PriceComparison.tsx:156, 165, 185`; `ProductSummary.astro:32, 35, 36`).
- The card border `border-white/10` (`[id].astro:277, 338, 362, 404`; `PriceComparison.tsx:150`) is exactly `.dark`'s `--border: oklch(1 0 0 / 10%)`: a dark token reproduced by hand.

**Effect on the user:**

- The same secondary text shows in three different blue-greys.
- The browser's focus outline is the light theme's mid grey at 50% over navy (`global.css:25, 119`).
- With no `color-scheme` declared, native scrollbars and controls render light on the dark page.

These last two are inferred from the CSS; the plan's screenshots confirm them.

### C2 (missing shared components): notices, cards, badges and buttons are hand-built copies

**Evidence** (`src/components/ui` holds `button.tsx` and `LibBadge.astro` only):

- **Boxed notices, 9 times, in 3 colour variants,** with the same `rounded-lg border … px-3 py-2 text-sm` markup:
  - error `[id].astro:263, 297, 323`;
  - warning `[id].astro:310, 479, 520` and `PriceComparison.tsx:94`;
  - success `[id].astro:291, 317`.
- **Unboxed status text, 5 times, with the same meanings:** `[id].astro:370, 371, 512` and `PriceComparison.tsx:202, 204`. The failed Natura read at `[id].astro:512` is plain red text, while the other errors are boxed.
- **Cards, 5 times,** as `rounded-xl border border-white/10 bg-white/5 p-3`: `[id].astro:277, 338, 362, 404` and `PriceComparison.tsx:149-150`. Their inner gaps are `gap-1`, `gap-2` and `gap-3` for the same role.
- **Pill badges, 4 times:** `[id].astro:417-419` and `PriceComparison.tsx:159, 191, 194`. Only "Najtaniej" (`PriceComparison.tsx:159`) is `font-medium`.
- **Buttons and links:**
  - Primary: `[id].astro:443, 490`.
  - Outline: `[id].astro:392, 468` and `PriceComparison.tsx:127`.
  - Text links: `[id].astro:255, 349, 377, 453, 504` and `PriceComparison.tsx:213`.
  - Every one of them is `min-h-11` (44 px); `button.tsx`'s tallest size is `lg`, `h-10`.
- **The one Button consumer undoes it:** `src/components/auth/SubmitButton.tsx:18` passes `bg-purple-600 text-white hover:bg-purple-500`, which `tailwind-merge` uses to replace the variant's token classes.

**Effect on the user:** the same kind of message looks different depending on where it appears. A failed read is bare red text in one place and a boxed alert in another. Every new view would copy the literals again.

**Adding the components:**

- `components.json` is a valid Tailwind v4 new-york configuration, with aliases resolving through `tsconfig.json` paths and `cn` in `src/lib/utils.ts:4-6`.
- `npx shadcn@latest add card alert badge` should add `card.tsx`, `alert.tsx` and `badge.tsx`. It needs the network, and it may add the unified `radix-ui` package for the badge's Slot. Not verified offline; `--dry-run` would show it.
- Alert and Badge ship no success or warning variant, so those need the new tokens from C1.
- Button needs a size of at least 44 px, or the page's tap targets shrink.
- In `.astro` files, links styled as buttons should use the exported `buttonVariants()` rather than `asChild`. `astro.config.mjs` doesn't enable `experimentalReactChildren`, so slotted children arrive wrapped (per worker B; not run).

### C3 (accidental architecture): the page is stacked in the order the slices shipped

**Evidence:**

- S-02 (eee8536) created the Rossmann section (`[id].astro:336-354`) and the Natura section (`[id].astro:356-525`).
- S-03 (61d1e5b) put the price island above them (`[id].astro:302-334`).
- Each matched shop therefore appears twice, each time with its own "Zobacz w sklepie" link:
  - Rossmann: its section at `[id].astro:344-353` and its price row in `PriceComparison.tsx:208-217`.
  - Natura: its section at `[id].astro:372-381` and its price row.
- The Rossmann card holds only "Produkt wybrany w wyszukiwarce Rossmanna" and that duplicate link (`[id].astro:343-353`).

**Effect on the user:** on a phone at the shelf, the user scrolls past a near-empty Rossmann card and up to five "Zobacz w sklepie" links. They have to connect a Natura price row with a separate Natura decision block further down.

### C4 (accidental architecture): the page's server messages contradict the island

**Evidence:**

- `[id].astro:207-212, 322-326`: "Nie udało się wczytać cen." is rendered on the server and stays above the rows, even after the island's own-navigation refetch (`PriceComparison.tsx:72-83`) has filled them with fresh prices.
- `PriceComparison.tsx:164-165`: a row with no stored price says "Brak ceny online w {site}", both before the first fetch and while "Odświeżam…" shows. The list page says "Jeszcze bez cen. Otwórz produkt, aby je pobrać." for the same state (`src/lib/services/price-comparison.ts:371`).
- `[id].astro:228-235, 239-249, 288-321`: `?matched`, `?error=` and `?prices=` notices stay after a reload. Decision errors appear at the top of the page, far from the Natura buttons that caused them.
- The decision forms (`[id].astro:428-447, 462-472`) have no pending state and no submit-once guard, unlike the list's refresh form (`src/pages/watchlist.astro:325-342`). A double tap shows "Ten produkt ma już zapisaną decyzję." after the user's own save.

**Effect on the user:** the page can say the prices failed to load directly above fresh prices, and a price that simply hasn't been fetched yet reads as "this shop has no online price".

### C5 (accidental architecture, recommended deferred to S-07): a signed-out or expired entry loses the product

**Evidence:**

- `src/middleware.ts:5, 23-26`: a protected path redirects to `/auth/signin`, dropping the path.
- `src/pages/api/auth/signin.ts:19` always sends the user on to `/watchlist`.
- The sign-in page is the starter's English page with a "Sign up" link (`src/pages/auth/signin.astro:8-19`).
- The island's session-ended link goes to `/auth/signin` with no return path either (`PriceComparison.tsx:97`).

**Effect on the user:** a bookmarked product, or a session that expires at the shelf, ends on an English form and then on the list, not the product.

**Why defer:** the sign-in page, its language and the invite-only flow belong to S-07 (`context/foundation/roadmap.md`, S-07 `invite-only-access`). A return path touches the auth routes, not this view's contract.

## Detailed Findings

### Source → views: token source and consumers

- **Token file** (`src/styles/global.css`):
  - `:root` and `.dark` each define the same 31 colours; `--radius` exists only in `:root` (6-73).
  - `@theme inline` (75-111) publishes `--radius-sm/md/lg/xl` and every `--color-*` as `var(--x)`, with no raw values. `.dark` would therefore take effect as soon as an ancestor has the `.dark` class.
  - The dark variant is class-based: `@custom-variant dark (&:is(.dark *))` (line 4). So the operating system's dark setting has no effect.
  - The base rules are `* { @apply border-border outline-ring/50 }` (119) and `body { @apply bg-background text-foreground }` (122).
- **Theme application:** nothing adds `dark` anywhere. Worker B searched `src/**`, `astro.config.mjs`, `public/`, `scripts/`, `wrangler.jsonc` and `eslint.config.js`. `Layout.astro:15-22` gives `<html>` and `<body>` no class, and `<head>` declares no `color-scheme`.
- **Consumers:**
  - Colour-token classes: 0 in each view file under `src/pages/**` and `src/components/**`. The only exception is `src/components/ui/button.tsx`, the component itself (26 of them).
  - Palette literals: 242 across those files.
  - Radius tokens (`rounded-sm/md/lg/xl`) are the only token family the views read.
  - `bg-cosmic` is used by all seven pages: `dashboard.astro:8`, `watchlist.astro:116`, `Welcome.astro:5` (via `index.astro`), `auth/confirm-email.astro:22`, `auth/signin.astro:9`, `auth/signup.astro:9` and `[id].astro:253`.
- **Shared-component trap:** `ProductSummary.astro` is used by both `watchlist.astro` (209, 304) and `[id].astro` (278, 363, 405). Moving it to tokens while `:root` stays light would put `#737373` muted text on the navy list. Worker B estimates that at about 4:1 contrast, not measured.
- **What a theme change affects:**
  - Adding `class="dark"` to `<html>` in `Layout.astro` leaves the other six pages essentially unchanged, because they read no colour tokens.
  - It would change the canvas and overscroll to near-black, and the default focus outline and `SubmitButton`'s ring from `0.708` grey to `0.556` grey.
  - The token values themselves (`.dark` today is a neutral grey theme, with a light-grey primary) still don't match the navy-and-purple look. So with `.dark` alone, the product page would look different from its neighbours.

### View → source: literals and the tokens that cover them

| Role on the page         | Literal today                                                                 | Token (existing or needed)                                                               | Component                          |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| page background and text | `bg-cosmic`, `text-white` (`[id].astro:253`)                                  | `bg-background`, `text-foreground` (dark values needed)                                  | —                                  |
| card and surface         | `border-white/10 bg-white/5` (5 times)                                        | `border-border`, `bg-card`                                                               | Card                               |
| muted text               | `text-blue-100/80`, `/70`, `/60` (16 times)                                   | `text-muted-foreground`                                                                  | —                                  |
| primary action           | `bg-purple-600 hover:bg-purple-500` (`[id].astro:443, 490`)                   | `bg-primary` (purple value needed)                                                       | Button `default`                   |
| outline action           | `border-white/20 hover:bg-white/10` (3 times)                                 | `border-input`, `hover:bg-accent`                                                        | Button `outline`                   |
| text link                | `text-purple-300` (6 times)                                                   | `text-primary`, or a link/brand token (needed)                                           | Button `link` / `buttonVariants()` |
| error                    | `red-500/30`, `red-900/30`, `red-300` (4 times)                               | `destructive`                                                                            | Alert `destructive`                |
| warning                  | `amber-400/30`, `amber-900/30` or `/40`, `amber-200` (10 times)               | none: `warning` needed                                                                   | Alert or Badge variant (new)       |
| success, cheapest        | `emerald-400/30` or `/40`, `emerald-900/30` or `/40`, `emerald-200` (6 times) | none: `success` needed                                                                   | Alert or Badge variant (new)       |
| thumbnail tile           | `bg-white`, `bg-white/10` (`ProductSummary.astro:25, 28`)                     | `bg-white` is probably deliberate, behind product photos; `bg-muted` for the placeholder | —                                  |

The three files contain no arbitrary values (`-[…px|rem]`) and no hex, rgb, hsl or oklch colours (worker A's grep). Radius is consistent by role: `rounded-xl` on cards, `rounded-lg` on notices and buttons, `rounded-full` on pills.

### The 7-state matrix today

The controls are:

- 7 links: "← Moja lista", three "Zobacz w sklepie" in the sections, "Pokaż zapisaną decyzję", "Zaloguj się ponownie" in the session alert, and "Zobacz w sklepie" in each price row.
- 2 links styled as buttons: "Szukaj ponownie" and "Dopasuj w Naturze".
- 3 submit buttons: "To ten produkt", "Żaden z nich" and "Odśwież ceny".

The page has no text inputs, selects, checkboxes or radios in `[id].astro`, `PriceComparison.tsx` or `ProductSummary.astro`; each candidate is chosen through its own form.

| State         | Today                                                                                                                                                                                | Evidence                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| default       | literal palette classes on every control, no tokens                                                                                                                                  | C1, C2                                                                                    |
| hover         | colour or underline change on the buttons and on "← Moja lista"; the other text links have no hover change                                                                           | `[id].astro:255, 392, 443, 468, 490`                                                      |
| focus-visible | none of the three files has a focus class; every control falls back to the browser outline, recoloured to the light `--ring` at 50%                                                  | `global.css:25, 119`                                                                      |
| disabled      | only "Odśwież ceny", as `disabled:opacity-60` while a refetch runs; the decision buttons have no disabled or submit-once state                                                       | `PriceComparison.tsx:126-127`; `[id].astro:428-472`                                       |
| error         | boxed alerts at the top of the page, or bare red text (`[id].astro:512`); the island's row notices are amber text                                                                    | `[id].astro:263, 297, 323, 512`; `PriceComparison.tsx:202-207`                            |
| empty         | a row without a price says "Brak ceny online w {site}", which reads as a verdict; a product that isn't found shows a Polish heading and a back link; a candidate list is never empty | `PriceComparison.tsx:164-165`; `[id].astro:259-267`; `src/lib/services/matching.ts:38-48` |
| loading       | "Odświeżam…" beside the shop name, with no skeleton; rows grow from 1 to up to 5 lines and re-sort as prices arrive, pushing the sections below down                                 | `PriceComparison.tsx:154-157, 164-201`                                                    |

**Accessible names:** every control has visible text. "Zobacz w sklepie" repeats up to five times, twice for the same shop, and opens a new tab with no cue. "To ten produkt" repeats without naming its candidate.

**Colour alone:** a candidate's flag pills tell warning from good only by amber or emerald (`[id].astro:416-419`). The cheapest row doesn't rely on colour, since it also says "Najtaniej" (`PriceComparison.tsx:147-162`).

### Kitchen sink and screenshot gate

- **No tooling today:** `package.json` has no Playwright, Puppeteer, Storybook or `@vitest/browser`, and the repo has no visual tests. The `/10x-ui` skill's cheapest gate is a kitchen-sink page screenshotted at desktop and one mobile width, without installing a tool (`.claude/skills/10x-ui/SKILL.md`, "Visual gate").
- **A dev-only route:**
  - The option: an inline integration in `astro.config.mjs` whose `astro:config:setup` calls `injectRoute({ pattern: "/dev/product-page", entrypoint: "./src/dev/product-page.astro" })` only when `command === "dev"` (`node_modules/astro/dist/types/public/integrations.d.ts:317-325`).
  - The production build then has no such route and ships no fixtures, and `tsconfig.json:3` (`**/*`) still type-checks the file.
  - An `import.meta.env.DEV` guard would still ship the route in the Worker.
  - A `_` prefix is skipped in dev too (`node_modules/astro/dist/core/routing/create-manifest.js:92-94`).
  - Not run: whether `injectRoute` works under the Cloudflare dev server is unverified.
- **What must be extracted first:** the static sections are inline in `[id].astro:252-530`, next to the page's data calls (`[id].astro:133-193`). Rendering them with fixtures needs these as components:
  - the display-state builders (`[id].astro:41-131`);
  - the Natura section (`356-525`);
  - a notice;
  - the not-found and failed branches (`259-272`).
- **The island's transient states:** in the island, "refreshing", the row notices and "session ended" can't be reached through props:
  - `initialState` always starts idle (`price-comparison-state.ts:89-96`);
  - `PriceRow` isn't exported (`PriceComparison.tsx:142`).
  - The fix is a presentational part that takes a state.
- **Screenshots:**
  - By hand in Chrome DevTools, at about 390 px and 1280 px with "Capture full size screenshot". Two widths cover the page: it is one `max-w-lg` column, and `sm:` changes only the padding (`[id].astro:253-254`).
  - Or headless: installed are `C:\Program Files\Google\Chrome\Application\chrome.exe` (153) and `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` (154), for example `chrome.exe --headless --window-size=390,2400 --screenshot=<out>.png http://localhost:4321/dev/product-page`. Not run.
  - Hover and focus-visible need DevTools' "Force element state" or keyboard focus, one control at a time.
  - Keep PNGs with fixture data only: the repo is public.

## Code References

- `src/styles/global.css:4` — class-based `dark` variant
- `src/styles/global.css:6-73` — `:root` and `.dark` values (31 colours each)
- `src/styles/global.css:75-111` — `@theme inline` publishing
- `src/styles/global.css:113-115` — `bg-cosmic` hex gradient
- `src/styles/global.css:117-124` — base layer (`outline-ring/50`, `bg-background text-foreground`)
- `src/layouts/Layout.astro:15-22` — `<html>`/`<body>` with no theme class, no `color-scheme`
- `src/pages/watchlist/[id].astro:252-530` — the view's markup; `302-334` prices, `336-354` Rossmann, `356-525` Natura
- `src/components/watchlist/PriceComparison.tsx:91-131, 142-218` — island shell and rows
- `src/components/watchlist/ProductSummary.astro:25-36` — thumbnail and muted text (shared with the list)
- `src/components/ui/button.tsx:8-30, 50` — Button variants and sizes, `buttonVariants` export
- `src/components/auth/SubmitButton.tsx:18` — the only Button consumer, overriding its tokens
- `components.json` — shadcn new-york, Tailwind v4, aliases
- `src/middleware.ts:5, 23-26` and `src/pages/api/auth/signin.ts:19` — sign-in redirect without a return path

## Architecture Insights

**The starter's placeholders set the look.** `CLAUDE.md` (project section, the Project paragraph) calls the demo pages placeholders. Yet the product look, `bg-cosmic`, purple buttons and `white/10` cards, is inherited from them. Each new view copied its neighbour: the notice strings are identical in `watchlist.astro:163, 169, 184` and `[id].astro:291, 297, 310`.

**No rule required the tokens.** No agent rule invites one-off values. `CLAUDE.md`'s UI bullet names the tokens, `.dark` and `src/components/ui`, but doesn't require them or forbid palette literals in views, and it advertises a `.dark` variant nothing applies. `AGENTS.md` is a one-line text file reading `CLAUDE.md` (mode 100644, not a symlink), so agents that load `AGENTS.md` get no rules.

**The token contract is global even when the change is one view.** `ProductSummary.astro` is shared with the list, and every page draws on `bg-cosmic`. The token values and the theme's application are global decisions. The view migration is local.

## Historical Context (from prior changes)

- `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md`: S-02 built the Rossmann and Natura sections of the product page (commit `eee8536`, per `git log` of the view).
- `context/archive/2026-09-28-cheapest-shop-today/plan.md`: S-03 added the price island above them (`61d1e5b`). Its review F2 made one hidden live region announce each shop's answer (`0de341b`), which the states phase must keep.
- `context/foundation/lessons.md`: its six entries contain no UI rule. "Define shared constants and helpers once" applies to the component work.

## Related Research

- `context/archive/2026-09-28-cheapest-shop-today/research.md`: covers the island's data and rendering, not its styling.

## Open Questions

These are decisions for `/10x-plan`. The first four are the owner's.

1. **Theme strategy.** Which option?
   - **(a)** Set `class="dark"` on `<html>` and write the page's current cosmic palette (navy background, purple primary, blue-tinted muted text, white-alpha borders and cards) into `.dark`. The `:root` light values stay unused.
   - **(b)** Replace `:root` with the cosmic palette as the only theme.
   - **(c)** Adopt shadcn's neutral dark. That is a visible change, and the product page would differ from the other six pages.
   - Either way, `bg-cosmic` becomes a token-driven background, or it stays as the one named decoration on top of `--background`.
2. **New tokens.** `success` and `warning`, with foregrounds, and whether the purple accent is `--primary` alone or also a separate link token.
3. **Components.** Either `npx shadcn@latest add card alert badge`, which needs the network and possibly the `radix-ui` dependency (the owner decides on new dependencies), or hand-written equivalents in `src/components/ui` from the shadcn source. Either way, a Button size of at least 44 px is needed.
4. **Scope of C3 and C4 in this change.** Folding the Rossmann and Natura sections into the price rows is a layout decision. The notices can be fixed without it.
5. **The gate.** A dev-only `injectRoute` kitchen sink, the island's presentational split, and hand-captured or headless screenshots. Before relying on it, confirm `injectRoute` under `astro dev` on the Cloudflare adapter.
6. **The rule, to make it stick.** A UI block in `CLAUDE.md`'s project section (tokens, components, no palette literals in cleaned views, where the kitchen sink lives). Possibly also an ESLint restriction on palette classes in the cleaned files, and fixing `AGENTS.md` to point at `CLAUDE.md`.
