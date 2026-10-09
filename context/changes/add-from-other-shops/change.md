---
change_id: add-from-other-shops
title: Add products Rossmann doesn't sell, found through the other shops' search
status: impl_reviewed
created: 2026-10-06
updated: 2026-10-09
archived_at: null
---

## Notes

Let the user add a product that Rossmann doesn't sell, found through the other shops' search (Natura, Hebe, Super-Pharm), and compare it like any other watched product. Found by the owner's S-06 phone check on 2026-10-06; the owner chose to start it as its own change.

2026-10-06, what the phone check showed:

- The owner pasted a Super-Pharm product's name ("AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający") into the list's search and got „Brak wyników”. The search asks only Rossmann (`searchRossmann` in `src/pages/watchlist.astro`), as it has since S-01, so a product Rossmann doesn't sell, or names differently, can't be added at all. The Worker log of that request showed the search; production's `watchlist_matches` held no Super-Pharm row, so no Super-Pharm lookup had ended in a pick or a "not found" there.
- Super-Pharm's adapter works: five live searches with its exact request (approved by the owner, 5 of 12) found the right items for real Rossmann products. Its search also drops unmatched words on its own: "NIVEA Derma Control Clinical 150 ml" returned 1,811 hits, led by the right sprays.
- `fix/search-names-rossmann` (PR #31) makes the search name Rossmann in its field, its results' heading and its empty result. This change revisits those texts once the search covers more shops.
- What the code has today: `watchlist_items.source` already references `public.shops (id)`, but the add form accepts only `z.literal("rossmann")`. The product's own price comes from Rossmann's detail by id, and Natura, Hebe and Super-Pharm are matched to it (FR-004: the picked product fixes the identity, its EAN a helper). Super-Pharm's index carries no EAN, and Rossmann has no EAN search (research note §2.1, §2.3).
- S-06's step 5.5, the owner's phone check of „Dopasuj w Super-Pharmie”, is still open and is separate from this change.

2026-10-06, the owner's calls on the research's open questions (`research.md`, Open Questions):

- **Results** (1): one entry per product. Items from different shops that share an EAN, the size and the brand become one entry, which names each shop that has it.
- **Missing shops** (2): an entry names only the shops that have it. A line above the results gives each shop's count, „brak wyników” or „nie odpowiada”. No entry claims that a shop lacks the product.
- **Super-Pharm** (5): its items stay their own entries, with no name comparison, as FR-006 and the S-05 and S-06 calls stand. The same product can appear twice.
- **Loading** (8): the page waits for all four shops and renders on the server, without JavaScript, as today.
- **The product's shop** (3): one „Dodaj” per entry, and the product is the entry's item from the first shop in a fixed order: Rossmann, Natura, Hebe, Super-Pharm.
- **What „Dodaj” saves** (4): only the product. The product page matches the other shops as today; the search's other items aren't saved as matches.
- **Duplicates** (7): „Na liście” shows on an entry when any of its items is already on the list, as a product or as one of a product's matches. Anything else can be added.
- **Rossmann for a product from another shop** (6): looked up by name the first time the product opens (1 request), accepted automatically only with a shared EAN, the same size and a brand that doesn't differ; otherwise the user picks, as in Natura and Hebe. Superseded by the plan's interview of 2026-10-08: Rossmann follows the same rule as the other shops, so the name check can accept a Rossmann item where EANs can't decide, as for a product picked in Super-Pharm (`plan.md`, Overview).
- **Results per shop** (9): 10 in each shop, so Rossmann's search goes from 24 to 10.
- **Live evidence** (11): approved: „nivea soft” and the owner's „AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający” in each of the four shops, 8 requests, one at a time and at least 2 s apart, from the developer machine with the gate's User-Agent and the adapters' own requests, kept as fixtures.
- Each call is the research's recommended option. Questions 10 (the cost statement and any caching) and 12 (the documents) are left to the plan.
- The recordings (`recordings/`, `research.md` „Live evidence”) show Rossmann answering the phone check's exact text with the AA LAAB face wash in two sizes at 10:37 UTC, where the phone got „Brak wyników” at 08:11 UTC. Repeating that search on the phone would tell a passing gap in Rossmann's search from Rossmann answering the Worker differently.

2026-10-06, later:

- The repeat ran from a desktop browser, since the owner's phone couldn't reach the app at the time while the desktop could. The app's search found the face wash at Rossmann and the owner added it, so the morning's „Brak wyników” was a passing gap in Rossmann's answers, not the Worker being answered differently.
- **Super-Pharm (5), reversed:** the search joins Super-Pharm's items into entries by the name rule of `match-by-name`, the owner's call after seeing its product page ask for a tap. That change comes first, and this one reuses its rule, also for a product without an EAN, such as one added from Super-Pharm (`context/changes/match-by-name/change.md`).
