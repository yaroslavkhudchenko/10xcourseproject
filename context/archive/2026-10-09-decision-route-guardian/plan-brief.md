# Decisions posted from a product's page pass one guardian — Plan Brief

> Full plan: `context/changes/decision-route-guardian/plan.md`
> Research: `context/changes/decision-route-guardian/research.md`

## What & Why

Roadmap M-2's S-01, the north star: the decision route asks one guardian before it stores a shop decision.

The rules about a product's shop decisions live in five layers today. Two of them have a weak spot:

- **The product's own shop:** the route accepts a decision there, and every reader then ignores it.
- **The legal moves:** only the UI keeps them, by hiding the buttons for the others.

This slice proves the guardian on the path every user decision takes.

## Starting Point

`POST /api/watchlist/matches` parses the form and calls `recordDecision` without loading the product. Its compare-and-swap checks only that the stored decision is the one the form names.

So two things answer "saved" today:

- a crafted post for the product's own shop;
- a decline over a decline, or a confirmation of the user's own confirmed item again.

No unit test imports the route.

## Desired End State

The route loads the product and its decisions, asks `admitDecision`, and stores only an admitted decision.

| refusal                                                | code      | stored  |
| ------------------------------------------------------ | --------- | ------- |
| a shop outside the matched shops, the own one included | `invalid` | nothing |
| an illegal move                                        | `invalid` | nothing |
| a stale form                                           | `decided` | nothing |
| an unreadable stored decision                          | `failed`  | nothing |

A product not on the list answers `gone`, exactly as before. Every post the page's own forms send behaves as today. Nothing the user sees changes.

## Key Decisions Made

| Decision                                | Choice                                                         | Why (1 sentence)                                                                                                   | Source       |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------ |
| What a refused own-shop post shows      | Nothing: `error=invalid`, shown on no card                     | Only a crafted post sends it, and the existing rule that only a matched shop's card shows a decision's error stays | Plan (owner) |
| How the guardian reports a refusal      | A named result value, `{ kind: "refused", reason }`            | Every service in `src/` reports failure that way, with no classes or thrown errors                                 | Plan (owner) |
| An illegal move's code                  | `invalid`                                                      | Only a crafted post can send one                                                                                   | Roadmap      |
| An unreadable stored decision           | `failed`                                                       | Its card offers no form, so only a stale tab or a crafted post reaches it                                          | Research     |
| The matched-shops rule's home           | `matchedShopsOf`, staying in `price-comparison.ts`             | Island modules call it, and the island lint rule admits no other service                                           | Research     |
| The store until S-02                    | Today's `recordDecision`, with the admitted change's arguments | It already maps a confirm or a decline plus `replaces` onto the compare-and-swap                                   | Research     |
| Privacy of a product the read can't see | Today's `gone`, before any write                               | The two-user check needs another user's product to answer like a missing one                                       | Research     |
| Phases                                  | Rules test-first, then the route, then documents               | The rules are proven before the route depends on them                                                              | Plan (owner) |

## Scope

**In scope:** `admitDecision` and `watchedProductOf` (pure, `src/lib/services/watched-product.ts`); `loadWatchedProduct`; the route's new order and its first unit tests; shared stored-row builders; `CLAUDE.md`, the glossary, the roadmap's S-01 caveat and the test plan.

**Out of scope:** the database backstop and the one-statement save (S-02); the page's lookups and the eight read-side narrowings, with D-01 (S-03); a page-level alert; a class-based guardian; checking a confirmed item against the shop's offer; any UI change.

## Architecture / Approach

After its own early reads for the redirect, the route parses (`parseMatchForm`), loads the product and its decisions at once (`loadWatchedProduct`), admits (`admitDecision`: matched shop, then readable, then `replaces`, then the legal move) and stores (`recordDecision`). Each result maps to the codes the page already reads. The guardian judges the form against the decision just read, and the compare-and-swap judges it again at write time.

## Phases at a Glance

| Phase                                   | What it delivers                                          | Key risk                                                                                |
| --------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. The guardian's rules, test-first     | The pure module and every allowed and refused move pinned | Over-strict rules refusing a move the page's forms send (the tests list each)           |
| 2. The decision route asks the guardian | Load, admit, store, map, and the route's first unit tests | Breaking `gone`'s privacy or a notice the page shows (route tests, two-user check, e2e) |
| 3. Documents                            | `CLAUDE.md`, glossary, roadmap caveat, test plan          | Stale wording about own-shop decisions                                                  |

**Prerequisites:** the docs pull request #46, which opens M-2, merged or rebased in. No migration and no shop request.
**Estimated effort:** one session across 3 phases.

## Open Risks & Assumptions

- A decision post now makes two reads before its write: two selects at once, each with a 2-second limit.
- The compare-and-swap race between the guardian's read and the write stays pinned only by the existing service and real-database tests, since `stubSupabase` can't reach it.
- Rows stored earlier in a product's own shop stay; S-02 decides about them.

## Success Criteria (Summary)

- A crafted own-shop post, a decline over a decline, or a second confirmation stores nothing.
- Every decision the page's own forms post saves and shows its notice as before.
- CI's unit, database, two-user, smoke and e2e checks are all green.
