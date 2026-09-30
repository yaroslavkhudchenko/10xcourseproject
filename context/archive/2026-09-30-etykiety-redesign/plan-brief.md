# "Etykiety i naklejki" Redesign — Plan Brief

> Full plan: `context/changes/etykiety-redesign/plan.md`
> Design handoff: `context/changes/etykiety-redesign/handoff/README.md` (captures in `design-captures/`)

## What & Why

The owner's Claude Design handoff restyles the two shopping screens, the watchlist and the product page:

- prices as shelf labels;
- a sticker on the product's price;
- a price track against the 30-day low;
- light and dark themes with a switch;
- a two-pane desktop layout.

This change builds that design on the app's own patterns: server-rendered pages, forms that work without JavaScript, tokens and shared components, and tested decision logic. It adds no server state, migration or dependency.

## Starting Point

The app has one dark "cosmic" look, hardcoded on `<html>`, and no web fonts. The product page is already on tokens and shared components (product-page-ui). The list page is a single column of palette literals, with its row logic inside the page.

## Desired End State

On a phone, the list shows shelf-label price tags and three filter chips. A product shows a hero naming the cheapest shop, a price track, one card per shop with Natura's state in its card, and a sticky "Odśwież ceny" bar. At 1024 px and up, a header sits above the list on the left and the product, the search results or a prompt on the right.

Both themes follow the system until the user picks one, and pass WCAG AA. Every control is at least 44 px to tap, and nothing judges a price until FR-012.

## Key Decisions Made

| Decision                 | Choice                                                                       | Why (1 sentence)                                                         | Source                        |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| Order and home           | After product-page-ui, with the handoff in this folder                       | The redesign builds on its tokens and components.                        | Owner (2026-09-29)            |
| Re-pin buttons           | "Zmień" and "Dopasuj ponownie" wait for S-08                                 | Re-pinning is S-08's scope.                                              | Owner (2026-09-29)            |
| Fonts                    | Self-hosted through Astro's Fonts API, keeping Bricolage's optical-size axis | No Google `<link>`, and the big digits look as designed (+48 KB).        | Owner (2026-09-29) → Research |
| Judgement                | Only the "Tylko 1 sklep" and "Stara cena" stickers                           | The good-price rule (FR-012) doesn't exist yet.                          | Owner (2026-09-29)            |
| Other pages              | `/`, `/dashboard` and `/auth/*` pinned dark until S-07                       | S-07 rewrites them anyway; they keep their colours.                      | Plan                          |
| Mobile account           | The avatar opens a `<details>` menu with email, theme switch and "Wyloguj"   | It matches the mobile drawing and works without JavaScript.              | Plan                          |
| Accessibility vs drawing | Drawn sizes with 44 px hit areas; dark search border `#6E6986`               | The look stays, and the tap rule and AA hold.                            | Plan                          |
| List misreads            | Fixed: unreadable rows say so, unorderable isn't "stale"                     | The new tags would otherwise make false claims.                          | Plan                          |
| "sprawdzono"             | The oldest check among the product's shops                                   | It never makes a product look fresher than its oldest price.             | Plan                          |
| "Promocje"               | A fresh offer with a promotion in any matched shop                           | It never lists a promotion the app can't vouch for today.                | Plan                          |
| "Do sprawdzenia"         | Anything actionable, except Natura the user declined                         | The chip works as a to-do list.                                          | Plan                          |
| Selected row             | Its tag is a small island that follows the product's refresh                 | The two panes never disagree about one product.                          | Plan                          |
| Track sentence           | A hint only where the user can act, else none                                | Facts only until FR-012.                                                 | Plan                          |
| One verdict              | `verdictOf` decides the list tag, the hero and the live tag                  | One rule, tested once, can't drift between views.                        | Research → Plan               |
| Natura in its card       | The island receives `NaturaView` as props; "choose" stays a server section   | Each shop appears once, and every state renders in the kitchen sink.     | Research → Plan               |
| Colours                  | The handoff's hex converted to oklch                                         | The contrast script keeps its oklch rule; the values round-trip exactly. | Research                      |
| Delivery                 | One PR after phase 6                                                         | Production never shows a half-new look.                                  | Plan                          |

## Scope

**In scope:**

- Both themes, the switch and the no-flash head script.
- The fonts and a built-font check in CI.
- The pinned legacy pages, the contrast check for both themes, and the handoff kept out of lint and type-checking.
- The primitives: Button, Badge, Alert, Card, Price, Sticker, LogoMark, ProductThumb, ThemeToggle and the hit area.
- The AppHeader, the avatar menu, the two-pane shell, the list rows, chips and search results.
- The product area: the title, the hero, the track, the shop cards and the bottom bar.
- Natura in its card, the list beside a product, the synced selected row, and the list refresh returning to the product.
- Two kitchen sinks, the screenshots, the lint guards and the docs.

**Out of scope:**

- The good and ordinary price stickers and the judgement (S-04), and the re-pin buttons (S-08).
- Restyling the pinned pages (S-07).
- Hebe and Super-Pharm, and a Natura promotion-end pill (Natura has no such data).
- New server state, migrations, dependencies, a client router or prefetch.
- Changes to the price, matching or gate rules.
- Screenshot tests in CI.

## Architecture / Approach

**Tokens:** `global.css` holds both themes in oklch, the new roles (sun, label ink, tags, shop colours, stickers, tiles) and a `@theme` scale for the handoff's sizes. Guarded files never use arbitrary px values.

**The theme:** it's chosen before the first paint by an inline head script. `Layout`'s new `theme` prop pins the legacy pages to dark and the kitchen sink to light.

**The list:** a new browser-safe `watchlist-rows.ts` decides each row's tag, its chips and its sr-only line. It builds on `verdictOf` in `price-comparison.ts`, which also drives the product's hero and the selected row's live tag.

**The product area:** the island takes over from the title row down, with the product and Natura's view as props. Tested functions (`heroOf`, `trackOf`, `trackHint`, `checkedCaption`) decide what it says.

**The shell:** `WatchlistShell` lays both pages out with CSS grid areas, one DOM for both sizes.

## Phases at a Glance

| Phase                                                  | What it delivers                                                                                | Key risk                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Themes, fonts and the guards                        | Both themes, the fonts, the head script, the pinned pages, the contrast and font checks         | A build that can't reach Google ships no fonts silently; the font check catches it |
| 2. Primitives                                          | Restyled ui components, Price, Sticker, LogoMark, ProductThumb, ThemeToggle, the hit area       | Class-scoped `.dark` wrappers in the kitchen sink must switch every token          |
| 3. The shell and the list                              | The row service, the reads' unread rows, the header, the avatar menu, the shell, rows and chips | The largest rules change: the chips' and tags' boundaries                          |
| 4. The product area                                    | Title, hero, sticker, track, shop cards and bottom bar, with tested rules                       | The island's restructure must keep S-03's live region, texts and no-JS forms       |
| 5. Natura in its card, and the list beside the product | Natura's states in its card, the aside, the synced row, and the refresh returning               | Two islands talking through one event, and a moved notice parameter                |
| 6. Every state, the gate and the docs                  | Full kitchen sinks, screenshots, QA, lint guards, CLAUDE.md, roadmap carry-overs                | Visual drift from the handoff surfaces only here                                   |

**Prerequisites:**

- `main` at `57deb04` or later, with product-page-ui archived.
- The local Supabase running for the walk-throughs.
- The root duplicates of the handoff deleted by the owner, or they keep failing a local `npm run lint`.

**Estimated effort:** about 6–8 sessions across 6 phases; phases 3 and 4 are the largest.

## Open Risks & Assumptions

- **Fonts:** the opsz option is experimental inside the stable Fonts API, so it needs a recheck on every Astro upgrade. Workers Builds is assumed to reach Google at build time; the font check proves it on the first deploy.
- **The pinned pages** keep their colours and gradient but take the new fonts, the dark focus ring and the dark scrollbars.
- **New copy:** the tag labels ("Błąd odczytu", "Bez ceny", "Niedostępny"), the hero eyebrows for the states the handoff doesn't draw, and the two track hints are the plan's Polish, for the owner to reword.
- **The product page's aside** costs 3 database reads per view on every viewport. At this scale that's acceptable.
- **The design reference differs from the real rules in two places:** its one-shop sample dated "wczoraj" is stale under the 24-hour rule, and its Natura promotion pill can't occur.

## Success Criteria (Summary)

- **At the shelf:** on a phone, the list's tags and a product's hero say which shop is cheapest today, or honestly that a price is old, missing or unreadable, in either theme.
- **On desktop:** the list and the product sit side by side and never disagree.
- **For the next agent:** both kitchen sinks show every state, both contrast checks and the font check run in CI, and a palette literal in a redesigned file fails lint.
