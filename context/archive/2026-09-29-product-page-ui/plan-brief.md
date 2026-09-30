# Design-System Contract for the Product Page — Plan Brief

> Full plan: `context/changes/product-page-ui/plan.md`
> Research: `context/changes/product-page-ui/research.md`

## What & Why

The product page `/watchlist/<id>` is the screen a shopper opens at the shelf, and it was built feature by feature from palette literals: 88 of them, with no colour token. As a result it shows each shop twice and contradicts itself: a failed-prices alert sits above fresh prices, and "no online price" is shown for a price that simply hasn't been fetched.

This change gives the page a design-system contract: tokens, shared components, every state visible in a kitchen sink, and a guard, so the next views inherit it instead of copying literals. It is Module 2, Lesson 5 (`/10x-ui`).

## Starting Point

- **Tokens:** `src/styles/global.css` already carries shadcn new-york tokens, but `<html>` never gets `.dark`, so they resolve to the unused light theme.
- **Components:** `src/components/ui` has only a Button, and its one consumer overrides it.
- **Structure:** the S-03 price island sits above the S-02 Rossmann and Natura sections, so each matched shop appears twice.
- **Messages:** the page's server notices ignore the island's state.

## Desired End State

**The page:**

- It looks as it does today, in the cosmic look, but is built only from tokens and the components in `src/components/ui`.
- Each shop appears once, in its price row with its link.
- The Natura section shows only the matching decision, with its notice or error next to it.
- A double tap sends one decision.
- A price not fetched yet, or one that couldn't be read, says so.
- Focus is visible at 3:1 or more, and every tap target is 44 px.

**Around it:**

- A dev-only kitchen sink shows every state.
- A contrast script guards the token values.
- ESLint refuses palette literals in the cleaned files.

## Key Decisions Made

| Decision                    | Choice                                                                                                        | Why (1 sentence)                                                                                                           | Source           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Theme                       | The cosmic palette as `.dark` token values, with `class="dark"` on `<html>`                                   | The page keeps its look, and the other six pages stay unchanged because they read no colour token.                         | Plan             |
| Accent                      | `--primary` is the purple fill, plus a `--link` token for text links                                          | White on the fill and the link colour on navy each need their own value to reach 4.5:1.                                    | Plan             |
| Components                  | Copy the new-york-v4 card, alert and badge source, with imports rewritten to the repo's `cn` and Slot         | The CLI now pulls in the `cn` and `radix-ui` packages, which the owner declined as new dependencies.                       | Plan             |
| Layout (C3)                 | Remove the Rossmann card and the section-level shop links; a match shrinks to its note and size warning       | Each shop then appears once, in its price row, without redesigning the Natura flow.                                        | Plan             |
| Notices (C4)                | All four fixes: the gap text, the island-owned alert, notices next to the decision, and submit-once           | Each one removes a place where the page contradicts itself or repeats a decision.                                          | Plan             |
| Sign-in path (C5)           | Defer to S-07                                                                                                 | The sign-in page, its language and its return path belong to invite-only access, not to this view.                         | Research → Plan  |
| Status tokens               | `success` and `warning` with `-foreground` pairs, plus `--thumbnail` and `--background-glow`                  | shadcn ships no status roles, and the gradient and photo tile need token values too.                                       | Research         |
| Kitchen sink and gate       | A dev-only `injectRoute` page, with screenshots taken in DevTools or headless Chrome                          | No screenshot tooling is installed, and the route never reaches the production build.                                      | Research         |
| Island structure            | Split into a presentational view and a stateful container                                                     | The kitchen sink can then render every reducer state without effects or shop calls.                                        | Research         |
| Rows the page couldn't read | A per-row `readFailed` mark: "Nie udało się wczytać ceny.", never "Jeszcze bez ceny"                          | A failed read and a never-checked shop reach the island in the same shape, and lesson L3 forbids reading one as the other. | Plan (lesson L3) |
| Natura view logic           | Move the builders into the tested `src/lib/services/natura-view.ts`                                           | The page and the kitchen sink then share one tested source of the section's states.                                        | Plan (lesson L4) |
| Submit-once                 | One `SubmitOnce.astro` shared by the list and the Natura section                                              | The guard exists once instead of being copied.                                                                             | Plan (lesson L6) |
| Guard                       | A CLAUDE.md UI bullet, an `AGENTS.md` pointer, and an ESLint `no-restricted-syntax` rule on the cleaned files | A failing check outlasts a rule an agent might forget.                                                                     | Research → Plan  |

## Scope

**In scope:**

- Card, Alert and Badge in `src/components/ui`, and the Button's `touch` size and link token.
- The `.dark` token values, `<html class="dark">`, `color-scheme` and a focus ring of 3:1 or more.
- The product page, `ProductSummary` and the price island on tokens and components.
- The C3 and C4 fixes.
- The dev-only kitchen sink and screenshots at 1280 and 390 px.
- The contrast script in CI, the ESLint rule, the CLAUDE.md UI rule, `AGENTS.md`, and the S-07 carry-over for C5.

**Out of scope:**

- Migrating the list, auth, index or dashboard pages.
- The sign-in path (C5, S-07).
- New npm dependencies or screenshot tooling (Playwright comes in Module 3).
- The Natura matching flow and the price rules.
- A light theme or a theme toggle.

## Architecture / Approach

**Tokens:** they live in `global.css`. `:root` and `.dark` hold the values, and `@theme inline` publishes them, so `bg-card`, `text-muted-foreground`, `bg-success/10` and the rest exist.

**The page is built in three layers:**

- **Components:** copied shadcn components in `src/components/ui`. In `.astro` files they render as static HTML without `client:*`, with `buttonVariants()` for links.
- **Sections:** the Natura section renders from a `NaturaView` built in a tested service.
- **The island:** a stateful container around a presentational `PriceComparisonView`, whose reducer now marks rows whose stored price the page couldn't read.

**The kitchen sink** is an Astro page injected only under `astro dev`. It renders the same components, the same section and the same view from fixtures, including reducer states the live page reaches only briefly.

## Phases at a Glance

| Phase                              | What it delivers                                                                             | Key risk                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1. Components and the kitchen sink | Card, Alert and Badge, Button `touch` and link, the new token names, `/dev/product-page`     | `injectRoute` under `astro dev` on workerd hasn't been run yet; criterion 1.5 proves it first          |
| 2. Token values                    | The cosmic `.dark` values, `class="dark"`, `color-scheme`, the contrast script in CI         | The translucent tokens and the focus ring at 3:1; the script measures them at the opacity each renders |
| 3. The product page                | The view on tokens and components, C3 and C4 fixed, the natura-view module, the island split | The largest phase: the split must keep S-03's live region, texts and order rules                       |
| 4. States and the visual gate      | Every view state in the kitchen sink, the 7-state matrix, screenshots                        | Hover and focus need DevTools' forced states, one control at a time                                    |
| 5. The guard and the docs          | The ESLint palette rule, the CLAUDE.md UI rule, `AGENTS.md`, the S-07 carry-over             | An unescaped `[id]` glob would silently check nothing; the deliberate break proves the rule            |

**Prerequisites:**

- PR #12 (lessons.md) merged, or this branch rebased on `main`: the branch is based on `docs/seed-lessons`.
- The local Supabase running for the phase 3 walk-through.
- No migration.

**Estimated effort:** about 3-4 sessions across 5 phases; phase 3 is the largest.

## Open Risks & Assumptions

- **If `injectRoute` fails under the Cloudflare dev server,** the fallback is a `src/pages/dev/` page answering 404 outside development. It would ship in the Worker, so the owner decides before it's used.
- **The theme change is global.** `class="dark"` changes every page's canvas, scrollbars and focus ring. The pages that read no token are expected to look the same; the phase 2 screenshots check the list and sign-in pages.
- **The copy is new.** "Jeszcze bez ceny" and "Nie udało się wczytać ceny." are the app's own Polish; the owner may reword them.
- **The copied registry source can drift from upstream.** Each file names its URL and copy date.
- **Screenshots stay out of CI.** They are manual evidence until Module 3 brings a screenshot test.

## Success Criteria (Summary)

- **At the shelf:** on a phone, the product page shows each shop once, in the familiar cosmic look, with visible focus and 44 px targets.
- **No contradictions:** no failed-prices alert over fresh prices, no "no online price" for a price not yet fetched or not readable, and decision feedback next to the decision.
- **For the next agent:** the kitchen sink shows every state, and a palette literal added to the view fails lint.
