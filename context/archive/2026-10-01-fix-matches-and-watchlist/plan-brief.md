# Fix a wrong match and remove a product (S-08) — Plan Brief

> Full plan: `context/changes/fix-matches-and-watchlist/plan.md`
> Research: `context/changes/fix-matches-and-watchlist/research.md`

## What & Why

S-08 adds four things: removing a product from your own list without touching shared prices (FR-005); fixing a wrong Natura match with "Zmień" and "Dopasuj ponownie" (FR-007); flagging a suspicious match, whose size or brand differs, on the product page and counting it on the list (FR-007); and keeping the list's filter through the product page's own actions (review finding F8). It is the certification's update and delete, and it closes the roadmap's S-08 carry-overs.

## Starting Point

- There's no delete path, though deleting your own row would still delete no shared data: observations reference no product, and the cascade takes only your own decisions (probe P1).
- Re-pinning is refused by one policy condition (`state = 'not_found'`) and by the same filter in `record()`. Today's lookup would accept an automatic match's item again.
- Brand is stored on both sides but compared nowhere, a saved match's item is read and then dropped from the card, and `?f=` is lost at five points.

## Desired End State

- **Removal:** "Usuń z listy" at the foot of a product's page confirms in place, without JavaScript. It deletes your entry and your Natura decision for it, while everyone else keeps the prices. The list then says so once.
- **Fixing a match:** a matched card names its item and offers "Zmień"; a declined card offers "Dopasuj ponownie". Both open a choice from Natura's EAN and name searches, never accepted on its own, with the current item marked. "Żaden z nich" declines, and "Anuluj" leaves it as it was.
- **Brand:** a different brand is flagged and never accepted automatically. A suspicious automatic match counts in "Do sprawdzenia"; one you confirmed keeps its warning in the card. The filter survives every action.

## Key Decisions Made

| Decision                 | Choice                                                                                                                                      | Why (1 sentence)                                                                 | Source                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| How a product is removed | Hard delete of your own row; the cascade takes only your decisions                                                                          | Observations reference no product, so shared prices can't go                     | Plan (research probe P1)         |
| Confirm and placement    | `<details>` at the product page's foot, every width; red "Usuń z listy"                                                                     | Works without JavaScript; WCAG 3.3.4 accepts a confirmed deletion                | Plan                             |
| What a re-pin shows      | Both searches together, never accepted, current item marked                                                                                 | Finds the right item even when the EAN search returns the wrong one (S-02)       | Plan (research §2)               |
| Removing a match         | "Zmień" → "Żaden z nich"; no separate control                                                                                               | One flow for both fixes, as the handoff draws it                                 | Plan                             |
| Brand rule               | Case, diacritics, spaces, punctuation ignored; agree when one starts with the other                                                         | Few false alarms on thin evidence (one recorded pair)                            | Plan (research §3)               |
| Brand mismatch at lookup | Never accepted automatically; the user chooses                                                                                              | Catches another product's EAN before a wrong match is stored                     | Plan                             |
| Suspicious match, list   | An automatic one counts in "Do sprawdzenia", with its reason on the row's screen-reader line; one you confirmed keeps only its card warning | FR-007's "so it does not go unnoticed": a confirmed one was seen, with its flags | Plan, narrowed by plan review F1 |
| The card's item          | Brand and size above the name; no photo, no second shop link                                                                                | Enough to spot a wrong item inside the footer the handoff draws                  | Plan                             |
| Two tabs                 | A re-pin form names the decision it replaces; otherwise it reads "decided"                                                                  | A stale tab can't overwrite a newer decision                                     | Plan                             |
| Re-pin cost              | The island's refetch is off while choosing                                                                                                  | Bounds the choice to 2 Natura requests                                           | Plan                             |

## Scope

**In scope:**

- one migration, with the three database check scripts proving it;
- the brand rule, and the item and warnings in the card;
- the re-pin choice and its compare-and-swap write;
- the removal confirm, `/api/watchlist/remove` and the list's notices shown once;
- the suspicious count on the list, and `?f=` through every product-page action;
- docs, the production push and the PR.

**Out of scope:**

- undo or soft delete, and removing from a list row;
- re-pinning Rossmann, and a free-text Natura search;
- storing candidates or posted prices;
- a warning mark on list rows;
- price policy and view changes (S-04's F4 and F6);
- end-to-end tests (Module 3).

## Architecture / Approach

Database first: the user's own delete on `watchlist_items`, and the user's own update of a decision in any state on `watchlist_matches`. Since RLS no longer narrows a decision's update, the code does: a lookup writes only over `not_found`, as today, and a re-pin only over the decision its form names. `record()` stays insert-first, so a product removed meanwhile reads `gone`. The rules live in tested services: `matching.ts`, which can run in the browser, `shop-matching.ts`, `match-step.ts`, `natura-view.ts`, `matches.ts`, `watchlist.ts`, `price-refresh.ts`, `watchlist-rows.ts` and the card model in `natura-card.ts`. Pages and routes only call them and map the results.

## Phases at a Glance

| Phase                                    | What it delivers                                                               | Key risk                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. Database contract                     | The two permissions, with refusals, the cascade and surviving prices proven    | A grant allowing more than the app needs                     |
| 2. Brand rule and the saved match's item | "Inna marka", a stopped auto-accept, the item and warnings in the card         | Normalisation breaking today's case-only pairs (nivea/NIVEA) |
| 3. Re-pinning a Natura match             | The choice, compare-and-swap writes, `?f=` through Natura's actions            | The largest phase: lookup, page, island, section and route   |
| 4. Removing a product                    | The in-place confirm, the route, notices shown once, `?f=` through the refresh | A failure or a double post read as removed                   |
| 5. Suspicious matches on the list        | "Do sprawdzenia" counts automatic ones, and the row's line says why            | New columns making today's test rows odd                     |
| 6. Docs and rollout                      | CLAUDE.md, PRD and roadmap notes; the verified production push; the PR         | Merging before the migration is on production (PGRST205)     |

**Prerequisites:** the local Supabase stack running (Docker on); the branch `feat/fix-matches-and-watchlist` from `main` `583bedb`; the owner available for `npx supabase db push` before the merge.
**Estimated effort:** about 4–6 sessions across 6 phases, Phase 3 the largest.

## Open Risks & Assumptions

- The brand evidence is one recorded same-product pair, and the lenient rule can miss a sub-brand mix-up (accepted).
- It can also raise a false alarm, when one shop writes a brand with a title or parent word in front ("Dr Irena Eris" against "IRENA ERIS"). Since a brand mismatch now stops an automatic match, such an exact EAN-and-size match needs your one tap, and its card keeps "Inna marka". Being user-confirmed, it stays out of "Do sprawdzenia".
- Reloading the choice repeats its 2 Natura requests, since candidates aren't stored, as with any choice today.
- The production PostgreSQL version is unconfirmed. The relevant docs read the same in versions 13–18, and Phase 6 records it.
- Self-service watching is unchanged: a user could already point a match at any SKU by inserting one.

## Success Criteria (Summary)

- You remove a product in two taps without JavaScript, another watcher keeps its prices, and the database checks prove no observation is deleted.
- You fix a wrong Natura match from its card, and a stale tab can't undo it.
- A different brand or size is flagged, an automatic one is counted on the list, and the filter you came with is never lost.
