# Shop Matching in the First Two Shops — Plan Brief

> Full plan: `context/changes/shop-matching-first-two-shops/plan.md`

## What & Why

Each watched product gets its match in Rossmann and Drogerie Natura once, so the comparison in S-03 can fetch prices for the right item in each shop. The confirmed per-shop item is the product's anchor (FR-004). The app accepts only an exact match (a shared EAN and the same size) on its own and leaves everything else to the user, because matching is where wrong data can enter unnoticed.

## Starting Point

S-01 stores each product privately with the Rossmann item the user picked as its source, and searches Rossmann through the F-01 gate. The gate already allows Natura's Luigi's Box host, but there's no Natura adapter, no place to store matches and no page per product.

## Desired End State

"Dodaj" opens the new product page, `/watchlist/<id>`. It shows the Rossmann item as the source and settles Natura once:

- an exact match is stored and shown as matched automatically
- otherwise up to 3 candidates appear, with size flags and a labelled online price, to confirm or reject
- a miss is stored as not found, with "Szukaj ponownie"

The list links to every product page and shows its Natura status. Decisions are private and aren't asked again.

## Key Decisions Made

| Decision        | Choice                                                                                                    | Why (1 sentence)                                                                                   | Source                  |
| --------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------- |
| Second shop     | Drogerie Natura, via Luigi's Box                                                                          | The cleanest EAN lookup of the remaining shops, so the first matches are trustworthy.              | Plan (roadmap default)  |
| Rossmann match  | The item picked in the search; no extra row, no request                                                   | It is already the exact item the user chose.                                                       | Plan                    |
| Flow            | "Dodaj" opens the product page, which matches right away                                                  | Matching happens once, at home, never at the shelf.                                                | Plan                    |
| Candidate price | Shown, labelled as Natura's online price with its fetch time; not stored                                  | US-02 lists price, and it exposes a wrong pack fast; storing prices is S-03.                       | Plan                    |
| Auto-accept     | Exactly one candidate sharing any of the product's EANs with an equal size (within 0.1% after conversion) | Old and new barcodes still match, the size stops wrong variants, and two exact hits are ambiguous. | Plan                    |
| No EAN hit      | One name search (brand, name, size), same rule, else the 3 best candidates                                | Finds products Natura lists under another barcode, at most two requests per product.               | Plan                    |
| Tracker id      | A constant in the adapter; a rejection shows as unavailable and is logged                                 | Avoids a 3.3 MB page that redirects, for a value that rarely changes.                              | Plan (research differs) |
| Stored states   | `matched`, `unmatched` (the user's no), `not_found` (retry allowed)                                       | PRD: a choice is remembered; a miss isn't an error and can be retried.                             | PRD                     |
| Ownership       | Composite key (item, user) plus RLS; updates only on `not_found` rows                                     | A match can't attach to another user's product, and decisions can't change before S-08.            | Plan                    |
| Lookup trigger  | Only on the user's own navigation; retry via `?retry=1` on a `not_found` row only                         | A link from another site can't spend the shared cap (S-01 review F5).                              | Plan                    |

## Scope

**In scope:**

- the `watchlist_matches` table, with RLS, the ownership key and a two-user database check
- S-01's pending bounds on `watchlist_items`
- the Natura adapter, recorded fixtures, the matching rule and the EAN-then-name lookup
- the product page, the confirm route, "Dodaj" landing there, and list links with status
- CLAUDE.md notes and the production push

**Out of scope:**

- re-pinning, removing matches or products (S-08)
- storing or comparing prices (S-03)
- Hebe and Super-Pharm (S-05, S-06)
- brand-mismatch warnings
- background lookups, reading Natura's page for the tracker id, and image proxying

## Architecture / Approach

Product page → `lookupInNatura`. It runs an EAN query and, only if that's empty, a name query, both through `gate.fetch` to Luigi's Box. `pickMatch` then gives accepted, choose or none. Outcomes the app decides itself (accepted, not found) are stored during the render. The user's picks go through `POST /api/watchlist/matches`, which inserts, or updates only a `not_found` row, and redirects with a notice or an error code.

## Phases at a Glance

| Phase                                  | What it delivers                                                          | Key risk                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Match data contract                 | Matches table, ownership key, RLS, new `watchlist_items` bounds, DB check | A missed ownership path lets a match point at another user's product          |
| 2. Natura lookup and the matching rule | Fixtures, Natura adapter, shared outcome mapping, rule, lookup, tests     | Real Luigi's Box data differs from the research note (sizes, images, tracker) |
| 3. Product page and confirm flow       | `/watchlist/<id>`, confirm route, "Dodaj" landing, list status, smoke     | Lookups and writes during a GET render; double submits                        |
| 4. Docs and production rollout         | CLAUDE.md notes, the owner's push, `migration list --linked` check        | Merging before the migration is live (S-01's incident)                        |

**Prerequisites:** S-01 is done and on production; Docker for the local Supabase; the owner available for `db push` before the merge.
**Estimated effort:** about 2–3 sessions across 4 phases, the size of S-01.

## Open Risks & Assumptions

- If Luigi's Box answers an unknown tracker id exactly like an empty result, a changed id would look like "not found" everywhere. The adapter then relies on the lookup's "nothing for EAN or name" log line; the fixture recording will tell.
- Natura's `image_link` host is unknown until it's recorded; images show only from that exact https host.
- Rossmann may list another product's EAN on an item. A same-size hit would then match automatically, and S-08's re-pin would be the fix.

## Success Criteria (Summary)

- Adding a product lands on its page, where Nivea Soft 300 ml is matched in Natura without a question.
- Any match that isn't exact is decided by the user once, with the size mismatch flagged and a labelled price, and is never asked again.
- No user can see or attach matches for another user's products, and the database proves it in CI.
