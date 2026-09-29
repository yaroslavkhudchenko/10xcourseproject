# See Which Shop Is Cheapest Today — Plan Brief

> Full plan: `context/changes/cheapest-shop-today/plan.md`
> Research: `context/changes/cheapest-shop-today/research.md`

## What & Why

S-03 is the roadmap's north star: at the shelf, the owner opens a watched product and sees which shop is cheapest today, with every price's source and age. The owner also asked, on 2026-09-28, for the watchlist itself to show each product's cheapest shop and price. "Dopasowano" alone doesn't say where to buy.

## Starting Point

S-02 matched each product in Rossmann (where it was picked) and Natura, but no price is stored anywhere. The adapters read only S-02's fields, and both pages do all their work before rendering. The research found that both shops' answers already carry the price, the regular price, the 30-day low and availability. Rossmann's detail by id answers from Workers, and Natura can return several pinned SKUs in one request.

## Desired End State

**Product page:**

- It shows the matched shops at once from stored prices, ordered, with the cheapest marked and every price labelled "cena online" with its age.
- Shops last checked more than 15 minutes ago are refetched, and each row updates as its shop answers.

**List:**

- Each product has one line, for example "Najtaniej: Natura 16,99 zł, o 10,00 zł taniej niż Rossmann · 2 godz. temu".
- One button refreshes the stale products.

**Honesty:** a stale, missing or not-orderable price is visible, and never marked cheapest.

## Key Decisions Made

| Decision               | Choice                                                                                              | Why (1 sentence)                                                                      | Source          |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------- |
| Cheapest rule          | Only fresh (≤ 24 h) and orderable prices can win; tied shops are all marked                         | The app never names a shop on an old or unbuyable offer                               | Plan            |
| Price ages             | Refetch after 15 minutes; stale after 24 hours                                                      | Reloads cost no request, and prices change at most a few times a day                  | Plan            |
| List freshness         | "Odśwież ceny" on the list, plus refresh when a product is opened; viewing the list fetches nothing | One tap updates everything without spending the cap on views                          | Plan            |
| Sharing                | Shared among each item's watchers; the database stamps time, source and recording user              | Keeps FR-005's shared prices with the smallest leak                                   | Plan            |
| Accepted risks         | An invitee can write a plausible fake price for an item they watch; co-watchers see fetch times     | No server-only key exists, as with F-01's accepted risk; revisit before inviting more | Plan            |
| Rendering              | React island, with a JSON API route per shop                                                        | Results appear as each shop answers, and the order and mark stay right                | Plan            |
| History                | Every check is appended: a price, or `missing` when the shop no longer returns the item             | S-04 gets history from day one, and "not found" marks the price stale for everyone    | Plan            |
| Not orderable online   | Shown with "niedostępny online", can't win                                                          | Don't point the user to an offer they can't buy online                                | Plan            |
| Rossmann endpoint      | v2 detail by id, confirmed from Workers by a throwaway-Worker probe                                 | Exact by id, 3–4.5 KB, and no 403 risk to the shared gate                             | Research + Plan |
| Natura endpoint        | `f[]=sku:` filter, up to 50 SKUs per request, `hit_fields`                                          | One request refreshes the whole list's Natura prices                                  | Research        |
| List row               | Cheapest, how much cheaper, age; "Tylko w Rossmannie" for one-shop products                         | Where to buy and how much it saves, at a glance                                       | Plan            |
| Where prices come from | Only the server's own shop requests, never posted form values                                       | Posted values are user input, and prices are shared                                   | Plan            |

## Scope

**In scope:**

- the shared `price_observations` table and its latest-state view, with watchers-only RLS and column grants
- S-02's database follow-ups
- Rossmann's and Natura's price lookups and a refresh service
- the comparison rules, the product page's island and JSON route
- the list's price lines and refresh form
- docs, and the production migration

**Out of scope:**

- good-price judgement (S-04)
- Hebe and Super-Pharm (S-05, S-06)
- re-pinning (S-08)
- daily refresh (FR-015) and manual prices (FR-009)
- retention of old rows, and prices in the search results
- server islands, and a server-only key

## Architecture / Approach

1. Pages read `latest_price_observations` through the user's own client, which is RLS-limited to watched items.
2. The product page renders the React island with those prices.
3. The island posts `{ itemId, shop }` to `/api/watchlist/prices` for each shop that needs it.
4. The route looks up the shop item from the user's own rows, fetches through the gate (`fetchRossmannPrice` or `fetchNaturaPrices`), appends the check, and answers JSON.
5. The list's "Odśwież ceny" posts a form to `/api/watchlist/refresh`, which runs the same refresh service for the stale items and redirects back with a result code.

One pure module, `price-comparison.ts`, decides freshness, eligibility, order, marks and texts for the page, the route and the island.

## Phases at a Glance

| Phase                  | What it delivers                                               | Key risk                                                      |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Price data contract | Table, view, RLS, grants, service, two-user DB check in CI     | A policy or grant that leaks prices beyond an item's watchers |
| 2. Shop price lookups  | Rossmann by id, Natura by SKU batch, refresh service, fixtures | An unknown item's answer shape; four new recordings needed    |
| 3. Product page prices | Comparison rules, JSON route, React island                     | Hydration mismatches and a route open to other sites          |
| 4. Watchlist prices    | Price line per row, refresh form, fallback without JavaScript  | The list refresh running into the cap                         |
| 5. Docs and rollout    | CLAUDE.md, research note, production migration                 | Merging before the migration reaches production               |

**Prerequisites:**

- S-02 merged and archived (done)
- Docker and the local Supabase
- the owner's approval for four fixture recordings (Phase 2)
- the owner's `db push` before the merge

**Estimated effort:** about five sessions, one per phase.

## Open Risks & Assumptions

- **The two accepted risks above,** recorded in the plan and CLAUDE.md.
- **Natura's `lowest_price` window** (rolling, or before a reduction) is unknown, so it's labelled "najniższa cena z 30 dni wg sklepu".
- **Rossmann's `price`** might be an app or club price for some items; that's unverified. Every price is labelled "cena online".
- **The latest-state view scans the growing history.** That's fine at this scale; S-04 revisits it.
- **Both shop endpoints are undocumented.** A changed answer becomes a visible gap and a log line, never a stored price.

## Success Criteria (Summary)

- At the shelf, opening a product shows the last known prices at once, then fresh ones shop by shop, with the cheapest marked and every price's source and age.
- The watchlist shows where each product is cheapest and by how much, without opening it.
- No stale, missing or unbuyable price is ever presented as today's cheapest.
