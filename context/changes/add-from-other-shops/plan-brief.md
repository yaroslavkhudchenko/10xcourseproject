# Add products from other shops — Plan Brief

> Full plan: `context/changes/add-from-other-shops/plan.md`
> Research: `context/changes/add-from-other-shops/research.md`

## What & Why

On 2026-10-06 the owner found on the phone that a product Rossmann doesn't sell can't be added: the list's search asks Rossmann alone. This change makes the search ask all four shops, shows each product once with the shops that have it, and lets "Dodaj" add a product from any of them, which is then compared like any other.

## Starting Point

- **The search** is one Rossmann request, and its texts name Rossmann. "Dodaj" takes Rossmann items only.
- **The roles are fixed:** every product's own shop is Rossmann, and its matched shops are always Natura, Hebe and Super-Pharm.
- **The database** already accepts any shop.
- **The adapters** answer "nothing found" honestly since rollout Phase 3.
- **Rossmann has no adapter entry,** and its search reads no prices.

## Desired End State

**The search:**

- It asks the four shops at once, 10 hits each.
- Each entry is one product, with the shops that have it.
- A line says what each shop's search came to: its count, „brak wyników” or „nie odpowiada”.
- „Na liście” marks a product already listed or matched. "Dodaj" adds the first shop's item.

**A product added from Natura, Hebe or Super-Pharm** shows its own price and link, and is matched in the other three shops, Rossmann included, by the same rule as any product.

## Key Decisions Made

| Decision                             | Choice                                                                              | Why (1 sentence)                                        | Source                   |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------ |
| Results                              | One entry per product: items sharing an EAN, the size and the brand join            | The owner's examples ("gives both")                     | change.md (call 1)       |
| Missing shops                        | Name only the shops that have it; a line gives each shop's count or „nie odpowiada” | A search can't prove a shop lacks a product             | change.md (call 2)       |
| Super-Pharm items                    | Join entries by `match-by-name`'s rule                                              | The owner's later reversal; its index has no EAN        | change.md                |
| The product's shop                   | The entry's item from the first shop: Rossmann, Natura, Hebe, Super-Pharm           | One fixed order                                         | change.md (call 3)       |
| "Dodaj" saves                        | Only the product; its page looks the other shops up as today                        | No claim beyond what a lookup proves                    | change.md (call 4)       |
| Duplicates                           | „Na liście” when any item is listed or matched; else it can be added                | Simple, honest per item                                 | change.md (call 7)       |
| Loading                              | The page waits for all four shops, server-side                                      | Works without JavaScript, as today                      | change.md (call 8)       |
| Hits per shop                        | 10 each; Rossmann goes from 24 to 10                                                | Equal cost per shop                                     | change.md (call 9)       |
| A captionless product's name rule    | Every word of its name is required                                                  | On the recordings it removes all 4 wrong silent matches | Plan (owner, 2026-10-08) |
| Rossmann as a matched shop           | Same rule as the other shops; its candidates carry their caption                    | One rule; the Maybelline shades come out right          | Plan (owner, 2026-10-08) |
| Live evidence                        | 3 Rossmann lookups recorded during implementation                                   | The new path's real answers                             | Plan (owner, 2026-10-08) |
| Caching                              | None: 4 requests per search, and a reload repeats                                   | Each is the user's own navigation                       | Plan                     |
| A decision in the product's own shop | Ignored by per-product reads; no page offers it                                     | No migration needed                                     | Plan                     |
| Lookup queries                       | Brand and size once each, the size kept when cut                                    | Other shops' names repeat both                          | Plan (evidence)          |
| Hebe sets                            | No size from a set's name, one rule shared with Super-Pharm                         | A set's name ends with one item's size                  | Plan (evidence)          |

## Scope

**In scope:**

- Rossmann's adapter entry, with prices on its search items.
- Per-product shop roles.
- "Dodaj" from any shop.
- The captionless name rule, lookup queries and Hebe sets.
- The four-shop search with its entries and lines.
- 3 approved recordings, the e2e spec, the database checks and the docs.

**Out of scope:**

- Caching.
- Prices in the search.
- A progressive search island.
- Merging duplicates.
- Saving matches from the search.
- EAN search at Rossmann or Super-Pharm.
- `f[]=type:item` on Luigi's Box searches.
- Migrations and roadmap changes.
- Any other live request.

## Architecture / Approach

**Rossmann becomes a regular adapter.** It's the first of four priced shops, with a search that returns candidates with offers.

**A product's matched shops become "every priced shop but its own"** (`matchedShopsOf(source)`). Every per-product rule takes that set: prices, targets, decisions, list rows, the island.

**The search runs the four adapters at once and groups their items** with the existing matching rule (`pickMatch`), entry by entry, in a pure, tested service. The page only draws the entries.

## Phases at a Glance

| Phase                                   | What it delivers                                                            | Key risk                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1. Rossmann as a shop like the others   | Rossmann's offers, its adapter entry, and the fetcher moved                 | The shared price rules must not drift between search and detail |
| 2. Each product's own shop              | Per-product roles; "Dodaj" from any shop; the e2e spec; the database checks | The widest change: three own-item rules must move together      |
| 3. Matching a product without a caption | The every-word rule, query dedupe, Hebe sets, 3 recordings                  | A rule change; the evidence comes from 2 queries                |
| 4. The four-shop search                 | Entries, lines, „Na liście”, texts, the 10-hit Rossmann search              | Shop answers vary; the grouping is pinned on 8 recordings       |
| 5. Docs and rollout                     | PRD, CLAUDE.md, test plan, research note; the owner's phone check           | Docs drifting from what shipped                                 |

**Prerequisites:** the worktree `10xcourseproject-wt` on `feat/add-from-other-shops`. The owner's approval for 3 Rossmann requests (given).

**Estimated effort:** ~3 sessions across 5 phases, one PR.

## Open Risks & Assumptions

- **The grouping and the rule rest on two recorded queries,** mostly NIVEA and AA LAAB. Other products may join or miss differently.
- **Hebe's query suggestions can still use up its 10 hits.** For „nivea soft”, 7 of 10 were suggestions.
- **A choice left open is asked again on each view,** as today. That's likelier for products from Super-Pharm, which only the name rule can match.
- **Rossmann's search answers can be cached by Cloudflare for an hour** (`max-age=3600`), so a repeated search may get an older answer.

## Success Criteria (Summary)

- A search for a product sold outside Rossmann finds it, names its shops, and lets the user add it.
- A product added from another shop shows its own price and is compared in the other three shops, Rossmann included, with no silent wrong match on the recorded cases.
- CI is green, and the owner's phone check passes in production.
