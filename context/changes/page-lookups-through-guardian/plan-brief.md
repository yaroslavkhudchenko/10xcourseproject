# A product's page looks shops up and shows decisions through the guardian — Plan Brief

> Full plan: `context/changes/page-lookups-through-guardian/plan.md`
> Research: `context/changes/page-lookups-through-guardian/research.md`

## What & Why

Roadmap M-2's S-03: the product page looks shops up and shows its decisions through the guardian S-01 built for the decision route, with the same results. Today three things stand outside it:

- **A lookup stores without the guardian.** A lookup's automatic match or „not found” goes straight to `recordLookup`.
- **The rules are copied.** A product's matched shops are derived in 8 places, and four readers of one product's decisions answer three ways when the product and its decisions disagree (S-01's review finding F5).
- **The PRD falls short.** Its definition of „Do sprawdzenia” misses the price half (the domain map's D-01).

## Starting Point

S-01 left a pure guardian (`watchedProductOf`, `admitDecision`) and a loader (`loadWatchedProduct`) that only the decision route uses. The product page composes its reads, steps and prices in its own frontmatter, which no test imports and the seam table copies by hand.

## Desired End State

- **A lookup asks the guardian.** Its outcome is stored only once `admitLookup` admits it: over undecided or „not found”, never over a match or a decline, never in the product's own shop.
- **One loader, one precedence.** The page, the decision route and the product's refresh read through `loadWatchedProduct`, the product's read first.
- **One loaded product for the page.** Its matched shops, steps and price keys come from it, through `openProductPage`, which the page and the seam table both call.
- **The PRD** carries „Do sprawdzenia”'s full definition.

Nothing the user sees changes, and no shop request is added.

## Key Decisions Made

| Decision                     | Choice                                                                                                                                          | Why (1 sentence)                                                                                            | Source       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ |
| Test proof                   | Inputs may become a loaded product and tests may be added; every existing expect line and title stays                                           | The code takes the loaded product directly, and a diff check plus review shows no assertion moved           | Plan (owner) |
| Decisions unread as a whole  | Each reader keeps today's answer: the loader marks them `unread`, apart from one shop's unreadable decision                                     | The page still renders, the route answers `failed` and the refresh `?prices=failed`, with no shop asked     | Plan (owner) |
| What the load hands the page | The row beside S-01's unchanged `WatchedProduct`; matched shops are the shops with a standing; keys by `productPriceKeys` from the steps' items | One derivation stays `watchedProductOf`'s, and a match a lookup just stored shows its first price at once   | Plan (owner) |
| Merge order                  | S-03 first, then S-02, which moves both writers to its one-statement save                                                                       | S-03 needs no migration, and S-02's save then takes one kind of input from both callers                     | Plan (owner) |
| D-01                         | A new dated FR-007 note with the full list, the 2026-10-04 note kept as history                                                                 | The PRD's convention, with both edge cases named                                                            | Plan (owner) |
| F5's precedence              | The product's read first everywhere                                                                                                             | Only one redirect moves, onto a 404 page that shows no prices notice either way                             | Research     |
| `itemInRows`                 | Keeps its product-first reads and takes only the standing rule                                                                                  | Three assertions pin one query for an own item                                                              | Research     |
| A lookup's refusals          | `not-a-matched-shop`, `unreadable`, `settled`; `settled` shows today's "decision already stored" card                                           | The roadmap's outcome and the domain plan's `lookUp`, which refuse exactly where the compare-and-swap would | Research     |
| The page's service           | `openProductPage` composes everything after the reads; the loader still runs at once with the list's reads                                      | The list's reads stay before any lookup, as today                                                           | Plan         |
| `match-step.test.ts`         | A local `decideMatchStep` over a read builds the standing with `watchedProductOf`                                                               | Its expect lines carry the step's input inline, so this keeps them byte for byte                            | Plan         |
| Where the new code lives     | Server-only, outside `islandConfig`                                                                                                             | The list keeps `matchedShopsOf` (the roadmap's Parked list)                                                 | Research     |

## Scope

**In scope:** `admitLookup`; `LoadedProduct`, `loadedProductOf` and `matchedShopsIn`; `loadWatchedProduct`'s fourth outcome and its use by the decision route and `productTargets`; `itemInRows`' standing rule; `decideMatchStep` on a standing; `runMatchSteps` on the loaded product; `openProductPage` and the page on it; new tests for every new rule; the PRD's D-01 note, CLAUDE.md, the read rules' comment, the glossary's guardian row and one test-plan line.

**Out of scope:** the store and the one-statement save, F3 and F4 (S-02); the list and its `matchedShopsOf`; the three own-shop comparisons; a wider `WatchedProduct`; compatibility wrappers; any database, UI, island-prop or shop-request change.

## Architecture / Approach

The page reads `loadWatchedProduct` at once with the list's three reads, then calls `openProductPage`. That service takes the matched shops from the loaded product's standings, narrows `?repin=` and `?retry=` to them, and runs one step per shop, each decided from the shop's standing. A lookup's outcome passes `admitLookup` before `recordLookup`, whose compare-and-swap still checks it at write time. It then builds the island's prices from the steps' items. The decision route and the product's refresh read through the same loader, and the island's refetch takes the guardian's standing rule.

## Phases at a Glance

| Phase                                          | What it delivers                                                            | Key risk                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. The guardian admits a lookup, test-first    | `admitLookup` and its tests, red first                                      | A refusal too wide for a retry over „not found” (the tests list each case)    |
| 2. One loader, gone first (F5)                 | The loaded product, the loader's four outcomes, the route and refresh on it | Moving a route's redirect (route tests, the two-user check in CI)             |
| 3. The product page runs on one loaded product | The step on a standing, the steps on the loaded product, `openProductPage`  | Changing what a view shows or asks a shop (seam table, step tests, e2e in CI) |
| 4. Documents                                   | The D-01 note, CLAUDE.md, the read rules' comment, glossary, test plan      | Wording that misstates the code's „Do sprawdzenia” (the owner reads it)       |

**Prerequisites:** S-01's head (c1edc39), which `main` holds since PR #47; the base's test names recorded from a test run before Phase 1, one per test, a table test once per row. No migration, and no shop request.
**Estimated effort:** about two sessions across 4 phases.

## Open Risks & Assumptions

- A `settled` refusal can't be reached through the page's own flow, since the step never looks a shop up over a match or a decline. Only the guardian's tests pin it, and the race stays with the compare-and-swap, which `npm run test:db` pins in CI.
- The user-visible proof, the 10 e2e specs, the two-user check, smoke and the database test, runs only in CI, since the developer machine has no Docker.
- The diff check can't see a changed line inside a multi-line expect statement, so the reviewer reads the test diff.
- `npm run build` needs network for the fonts.
- S-02 rebases onto this slice and teaches `shop-matching.test.ts`'s stub its RPC over the rearranged `opened` helper.
- How often production meets a decisions read that fails as a whole is unknown: there's no error tracker.

## Success Criteria (Summary)

- A product's page shows, asks and stores exactly what it did, through one loaded product and the guardian.
- Every existing expect line and test title stands, and CI's unit, database, two-user, smoke and e2e checks are green.
- The PRD says what „Do sprawdzenia” holds, prices included.
