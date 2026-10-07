# Super-Pharm in the Comparison (S-06) — Plan Brief

> Full plan: `context/changes/super-pharm-in-comparison/plan.md`
> Research: `context/changes/super-pharm-in-comparison/research.md`

## What & Why

Super-Pharm joins the price comparison as the fourth shop (roadmap S-06; PRD US-02, FR-006, FR-011, FR-013). Its search index (Algolia) carries no EAN, so every Super-Pharm match is the user's choice. The owner chose on 2026-10-05 to keep it cheap: Super-Pharm is searched only when the user asks, and a rejected search key stops it like any refusal.

## Starting Point

S-05 built the per-shop seams, so a new shop is an adapter plus labels. The gate's hosts, the seeded `super-pharm` row and the tables already take Super-Pharm, and no migration is needed. On 2026-10-05, 5 approved probes confirmed:

- a name search with the size finds the item;
- an EAN search finds nothing;
- pinned prices come back by `objectID`;
- the public search key was unchanged after 18 days and has no expiry.

## Desired End State

- **Product page:** Super-Pharm has its own card. Undecided, it shows "Dopasuj w Super-Pharmie" and costs no request. A tap searches Super-Pharm alone and offers up to 3 candidates, the same size and brand first.
- **Once matched,** the card shows the item's price, its age and its 30-day low, with a regular price only when Super-Pharm's record carries one.
- **The watchlist** names the cheapest of four shops and counts an undecided Super-Pharm in "Do sprawdzenia".

## Key Decisions Made

| Decision                       | Choice                                                                                          | Why (1 sentence)                                                                                                               | Source       |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Search key                     | A constant; the gate is unchanged, so a rejected key stops Super-Pharm, and a runbook covers it | The key was stable and has no expiry, and a gate exception would cost the gate's first body read and a reworded non-negotiable | Plan (owner) |
| Undecided Super-Pharm          | Looked up only on a tap, through the prompt card and `?retry=<shop>`                            | A view at the shelf never waits for Super-Pharm or spends its cap                                                              | Plan (owner) |
| "Do sprawdzenia"               | An undecided Super-Pharm counts                                                                 | The chip stays the to-do list, as for Hebe                                                                                     | Plan (owner) |
| Candidate order                | Same size and agreeing brand first, for every shop, still 3                                     | With no EAN nothing qualifies, and the likeliest item should come first                                                        | Plan (owner) |
| A sale without a regular price | A plain price with its 30-day low                                                               | States only what the record says; no migration                                                                                 | Plan (owner) |
| Colour                         | Lavender `oklch(0.87 0.07 300)` (#DBCAFC)                                                       | Distinct from blue, mint and pink; apricot was too close to the warning tag                                                    | Plan (owner) |
| Request budget                 | At most 3 recordings and 10 live requests, each with the owner's OK                             | Real multi-hit answers make the tests honest                                                                                   | Plan (owner) |
| Never automatic                | No EAN, so no automatic match, as FR-006 and test-plan risk #6 require                          | The rule stays unchanged                                                                                                       | Research     |
| Name query and EAN search      | Brand, name and size; no EAN search for Super-Pharm                                             | Probes P3 and P5                                                                                                               | Research     |
| Pinned prices                  | `objectID` filters, 20 per request, `analytics=false`                                           | Probe P6, and the 512-byte filter limit                                                                                        | Research     |
| One switch per shop            | A browser-safe `MATCH_MODES`, with Super-Pharm `on-request`                                     | One fact drives the lookups, the step, the link and the card's text                                                            | Plan         |
| Shared helpers                 | The pinned-price helpers move out of `luigis-box.ts`                                            | `lessons.md`; Natura's and Hebe's tests stay unedited as the proof                                                             | Plan         |
| The address after a tap        | The page forgets `?retry=` once rendered, as it does `?repin=`                                  | A reload or Back on an open choice then searches nothing                                                                       | Plan review  |
| Orderable online               | `in_stock` 1 and `inStoreOnly` 0 or missing                                                     | A missing flag is the usual unset attribute, so Super-Pharm stays comparable                                                   | Plan review  |

## Scope

**In scope:**

- The shared pinned-price helpers, request bodies in the replay, and a Polish price parser.
- Super-Pharm's adapter, its fixtures and contract tests.
- The `on-request` matching mode and the new candidate order.
- The switch, the colour, kitchen-sink states and the flipped tests.
- e2e helpers and a four-shop phone spec.
- A budgeted live check, the docs, the runbook and the rollout.

**Out of scope:**

- A gate exception or reading the key from the page.
- Automatic Super-Pharm matches.
- A lookup on a plain view or after "Dodaj".
- A promotion marker without a regular price, which would need a migration.
- Club prices and dm.
- The observability audit's fixes.
- Live shops in automated tests.

## Architecture / Approach

The structure is S-05's: build switched off, switch on last.

1. Groundwork with no visible change.
2. The Algolia adapter joins `MATCHABLE_SHOPS` and the registry, but not `MATCHED_SHOPS`.
3. `MATCH_MODES` marks Super-Pharm `on-request`, which skips its EAN search, keeps it at its prompt on a plain view, and makes the prompt's link name it (`?retry=super-pharm`). That link already runs a single-shop first lookup.
4. `MATCHED_SHOPS` gains Super-Pharm.

## Phases at a Glance

| Phase                    | What it delivers                                                                                                        | Key risk                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Groundwork            | Shared pinned-price helpers, request bodies in the replay, `parsePolishPrice`                                           | The move changes Natura's or Hebe's behaviour (guard: their tests pass unedited)   |
| 2. Super-Pharm's adapter | `super-pharm.ts`, fixtures, contract tests, label, registry, test-plan §6.4                                             | A one-hit sample hides a mapping gap (guard: up to 3 recordings with several hits) |
| 3. Matching rules        | The `on-request` step, the prompt's link, no EAN search, the forgotten `?retry=`, the unsaved text, the candidate order | A plain view searching Super-Pharm (guard: a break-check)                          |
| 4. Switched on           | The switch, the colour, sinks, flipped tests, e2e spec, live check                                                      | Many tests flip at once; the four-shop track and cards                             |
| 5. Docs and rollout      | CLAUDE.md, PRD, research note, roadmap, test plan, runbook; PR and phone check                                          | Production's `super-pharm` row must be enabled before the merge                    |

**Prerequisites:**

- Docker and the local Supabase stack for e2e, smoke and the database checks.
- The owner's OK for each recording (Phase 2) and for the live check (Phase 4).
- The price-track fix (PR #28) merged before Phase 4's sink check.

**Estimated effort:** about 3–5 sessions across 5 phases; Phases 2 and 4 are the largest.

## Open Risks & Assumptions

- **A regenerated key stops Super-Pharm for everyone,** with the false text "sklep zablokował zapytania", until the owner follows the runbook. This is accepted.
- **Hidden promotions:** a Super-Pharm sale without a regular price isn't marked as one and doesn't appear under "Promocje".
- **Untested batch size:** batches of 20 `objectID`s are untested beyond 2 ids, and the 512-byte limit is documented, not probed.
- **One-day price lag:** Super-Pharm's prices are as fresh as its index (`algoliaLastUpdateAtCET`), which can lag a shelf change by up to a day.
- **An unset in-store flag:** an in-store-only item whose `inStoreOnly` is missing would count as orderable online, as Super-Pharm's own tile would show it.
- **Nothing alerts the owner of a stop.** The runbook says how a stop shows on the cards, and the observability audit's alert fix is the lasting remedy.

## Success Criteria (Summary)

- On a phone, a product shows four shops' prices with their ages. An undecided Super-Pharm costs nothing until tapped, and a tap leads to its choice.
- The watchlist names the cheapest of four shops and counts an undecided Super-Pharm in "Do sprawdzenia".
- The unit suite, the e2e suite with the four-shop spec, and CI are green, and no automated test reaches a live shop.
