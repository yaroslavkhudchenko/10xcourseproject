# Whether today's price is a good one (S-04) — Plan Brief

> Full plan: `context/changes/good-price-judgement/plan.md`
> Research: `context/changes/good-price-judgement/research.md`

## What & Why

A shopper standing at the shelf wants to know whether today's best price is worth taking, or whether it was cheaper recently. FR-012 asks for that judgement: against the product's own price history once enough exists, and against the shop's declared 30-day low until then, always saying which. It was blocked on PRD Open Question 4, how much history and which threshold. The owner answered it on 2026-10-06.

## Starting Point

- **The data exists, unread.** Every price check is stored with its shop's declared 30-day low (`price_observations`), but nothing reads beyond the latest check.
- **The design is drawn.** The „Dobra cena!” and „Zwykła cena” stickers are designed, and the redesign left them out until this rule existed.
- **The page has room.** The hero and the price card already have the slots.

## Desired End State

- **On a product's page,** the best price carries „Dobra cena!” when it's below what it's compared with, and „Zwykła cena” when it's equal or above.
- **The price card says what was compared:** the shop's 30-day low while the product's history is short, or the lowest price seen across the user's shops in the last 30 days once it's enough.
- **With nothing to compare with,** there is no sticker, and the card says why.
- **A single-shop product** keeps its „Tylko 1 sklep” sticker, and its card gives the judgement.

## Key Decisions Made

| Decision            | Choice                                                                              | Why (1 sentence)                                                                  | Source          |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------- |
| Compared with       | The cheapest shop's declared 30-day low, then the product's own history once enough | What the PRD and the design ask, and it works from day one                        | Owner           |
| Enough history      | On the list 30 days, with prices on 5 different days in the 30 days before today    | A full 30-day window, like the shops' own low                                     | Owner           |
| Good price          | Below the comparison is good; equal or above is ordinary                            | Exactly the design's two stickers                                                 | Owner           |
| Nothing to compare  | No sticker; the card says why                                                       | Honest about the gap, like the rest of the app                                    | Owner           |
| Where               | Product page only                                                                   | The design; the list needs no history read                                        | Owner           |
| Single-shop product | Judged in the sentence; the sticker stays „Tylko 1 sklep”                           | The fact stays visible, and the judgement is still there                          | Owner           |
| History's window    | The 30 Warsaw days before today, today excluded                                     | The baseline is stable through the day, and a price is never compared with itself | Plan            |
| How history is read | A new view `price_summaries`, in the product page's existing read                   | No extra request on a page near its connection limit                              | Research / Plan |
| F4 and F6           | F6's bounds and F4's index are added; F4's view rework is left                      | At today's scale the list's read gains nothing measurable                         | Plan            |

## Scope

**In scope:**

- The rule (`judgementOf`) and its tests.
- The `price_summaries` view, with the index and the bounds.
- The product page's read, the two stickers and the card's sentence.
- The sample pages and one e2e check.
- The list's screen-reader line for stale products.
- The PRD, the roadmap, `CLAUDE.md` and the test plan.

**Out of scope:**

- A mark on the list.
- A third level ("Drożej niż zwykle").
- Another shop's low as a fallback.
- The daily refresh (FR-015).
- F4's view rework.

## Architecture / Approach

1. **The rule.** It is pure and browser-safe, in `price-comparison.ts`. It reads the verdict, the cheapest shops' declared lows, each item's history summary and the product's "added" date.
2. **The summary.** It comes from a security-invoker view over `price_observations` that the product page reads in place of its current latest-price read: the lowest orderable price in the 30 days before today, and the days that carried one.
3. **The display.** The hero's sticker and the price card's sentence take the judgement.

## Phases at a Glance

| Phase                             | What it delivers                                             | Key risk                                                                    |
| --------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1. The rule                       | `judgementOf` with boundary tests                            | The boundaries: equal, today excluded, 30 days, 5 days                      |
| 2. History in the database        | `price_summaries`, index, bounds, read, DB check             | A test needs backdated rows; the bounds validate old rows                   |
| 3. The product page               | Stickers, sentence, sample pages, e2e                        | `heroOf`'s `toEqual` tests change deliberately                              |
| 4. The list's line, docs, rollout | The stale line; the PRD, roadmap and rules; the owner's push | The migration must reach production before the merge (the gate enforces it) |

**Prerequisites:** the owner pushes the migration before the merge, then looks at a product after the deploy.
**Estimated effort:** ~3 sessions across 4 phases.

## Open Risks & Assumptions

- **History is young and uneven,** so for the first weeks every judgement uses the shop's low, and products nobody opens never reach "enough".
- **Rossmann outside a sale, and many Super-Pharm items,** declare no 30-day low, so they show "nothing to compare" until their history is enough.
- **The shops' lows aren't confirmed.** Recordings suggest each is the low before a reduction while one runs, and a rolling minimum otherwise; the shops don't say.

## Success Criteria (Summary)

- On a product's page you see at a glance whether today's best price is good, and what it was compared with.
- When the app can't judge, it says why instead of guessing.
- Every outcome is pinned by tests, from the rule to the page on the production build.
