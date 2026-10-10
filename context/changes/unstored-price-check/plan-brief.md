# Say when a refreshed price couldn't be saved — Plan Brief

> Full plan: `context/changes/unstored-price-check/plan.md`
> Research: `context/changes/unstored-price-check/research.md`

## What & Why

Sometimes the product page refetches a shop's price, and the app fetches it but can't store it. The card then shows it exactly like a stored check, „przed chwilą” and perhaps „Najtaniej”. The list and the next view show the older price, and nothing ever says why. That is TD-02 of the refresh flow analysis and P6 of the observability audit. On 2026-10-10 the owner chose to keep the fetched price and say on its card that it wasn't saved.

## Starting Point

- **The data is already there.** The route answers `saved: false` for such a check, and the island parses it, then drops it.
- **Every view treats it as stored:** the card, the announcement, the hero and, from lg, the selected list row.
- **The no-JavaScript form already reports it,** with „Nie wszystkie ceny udało się odświeżyć…”.

## Desired End State

- **The shop's card keeps the fetched price,** its age „przed chwilą” and its marks, and adds „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.” in the warning colour.
- **Screen readers hear** „Natura: 16,99 zł, najtaniej. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”
- **The line stays while that price is on the card,** and goes with the shop's next stored price or a reload.
- **A stored answer looks as today.**

## Key Decisions Made

| Decision                                        | Choice                                                                                                                        | Why (1 sentence)                                                                                    | Source             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------ |
| The fix                                         | Option A: keep the fetched price and flag its row                                                                             | The price is the shop's current one, with its true time and source; the defect is the silence       | Owner (2026-10-10) |
| The line                                        | „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”, on the card and in the announcement                             | It names the app's failure, not the shop's, and promises no refetch                                 | Owner (2026-10-10) |
| Marks and the list beside the product           | Unchanged: an unstored price can be named cheapest, and the selected row's tag follows it                                     | Option A's answers, kept by choosing A; the test plan already accepts the tag following live prices | Research           |
| When the line shows                             | While the card shows the unstored price: kept through the next refetch's wait, an answer without a price and a missing answer | The sentence is about the price on the card, so it lasts as long as that price does                 | Plan               |
| An unstored missing answer after a stored price | No line; today's display                                                                                                      | The sentence names a price, and there the list shows that stored price, so it would be false        | Plan               |
| Where the sentence lives                        | `PRICE_UNSAVED_TEXT` in `src/lib/shop-messages.ts`                                                                            | The card and the announcement share their texts there, and the island may import it                 | Research / Plan    |
| How the card is tested                          | Rendered in Node with `react-dom/server`, the repository's first such test                                                    | e2e can't produce `saved: false`, and the render needs no DOM and no new dependency                 | Research / Plan    |

## Scope

**In scope:**

- The row's flag and the announcement (`price-comparison-state.ts`).
- The sentence (`shop-messages.ts`) and the card's line (`ShopCard.tsx`).
- Tests of the state, the sentence, the route's `saved: false` and the card.
- Two kitchen-sink states (`src/dev/fixtures.ts`).

**Out of scope:**

- A sentence for an unstored missing answer.
- Withholding the cheapest mark, or keeping the selected row's tag on the stored check.
- The route, the database and the form path.
- Error-level logging (P6's other half) and a database test of the insert (TD-18).
- An e2e spec, `CLAUDE.md` and colours.

## Architecture / Approach

The island's reducer is the one place a refetch's answer becomes a row. A price answer sets the row's new `unsaved` flag from `saved`. Every other answer, and a new refetch, keep it, since the card still shows that price. The card and the live region read the flag and add the owner's sentence from `shop-messages.ts`. Nothing reaches the route, the wire, the database or the list.

## Phases at a Glance

| Phase                       | What it delivers                                                      | Key risk                                                                            |
| --------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. The island reads `saved` | The flag, the sentence, the announcement; state, text and route tests | Clearing the flag on a new refetch, which would hide the line while the price stays |
| 2. The card shows the line  | The card's line, its Node render test, two kitchen-sink states        | The repository's first component render test                                        |

**Prerequisites:** none: no migration, no shop request, no secret. e2e and the database checks run in CI.
**Estimated effort:** ~1 session across 2 phases: about 20-40 lines of code in 3 files, 150-200 lines of tests in 4 files, and 2 kitchen-sink states.

## Open Risks & Assumptions

- **An insert that timed out may have committed** (audit W6). Then the line is a false alarm, and the list shows the price.
- **From lg, the selected row beside the product shows the unstored price** while the card says the list won't. The sentence holds for the list as it loads (`test-plan.md:412`).
- **An unstored missing answer after a stored price stays silent,** TD-02's residual for that case. For up to 15 minutes, the list and the next view may show that price as fresh after the shop said it no longer returns the item. A sentence for it would be the owner's later call.
- **How often inserts fail in production is unknown:** there is no error tracker.

## Success Criteria (Summary)

- When a refreshed price couldn't be stored, the user still sees it, and the card and the screen reader say the list won't show it.
- A stored price looks exactly as today, and no view or action asks a shop more than today.
- The unit tests pin the flag's life, the sentence, the route's `saved: false` and the card's line.
