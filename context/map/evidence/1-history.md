# Evidence: history

- **Window:** the whole history, 2026-09-20 (first commit) to 2026-10-09 (HEAD `f087611`, equal to `origin/main`; the local `main` ref is stale at `4944e63`).
- **Buckets:** ISO weeks of each commit's UTC date, the way the contract counted them: W39 36, W40 73, W41 68 commits. W41 is partial (Mon 5 Oct to Fri 9 Oct, 10:49 UTC). Local dates would move 7 after-midnight commits into the next week (32/74/71). Dates are author dates throughout. 7 commits were amended later; for one of them (`816db23`) the committer date falls in another week.
- **Counted:** 177 of the 179 non-merge commits (the 45 merge commits are left out): 1563 file changes, 1059 of them outside `docs`. Excluded: `b6b09c1`, the mass import of the starter. The noise filter empties `60103c2` ("fetch Module 3 lessons"). `424f3da` and `22f272e` still count 3 and 1 files, so the contract's "2 more commits lose every file" is really one commit; no total changes.
- **People:** one human under two identities (the contract). 176 of the 177 counted commits carry a Claude co-author trailer; the exception is `730f0ac`, an archive chore. No commit is agent-authored. Every share below is "the owner with the agent".
- **Workflow:** 83 commits are planned phases "(pN)" of 17 changes. 172 commits touch `docs`, because each phase updates its plan, and 82 touch only `docs`. Every change merged as its own PR: 39 first-parent merges carry 173 commits. 6 commits went straight to `main`: the starter import (09-20) and 5 deploy-setup commits on 09-23/24. Every merge deploys (CLAUDE.md).

## Activity per capability

| Capability           | Changes | % of code changes | Commits | % of 177 | A / M / D / R      | Test and check-script share of changes |
| -------------------- | ------: | ----------------: | ------: | -------: | ------------------ | -------------------------------------: |
| price-comparison     |     215 |             20.3% |      53 |      30% | 26 / 187 / 2 / 0   |                                    24% |
| shop-matching        |     159 |             15.0% |      38 |      21% | 22 / 131 / 1 / 5   |                                    51% |
| watchlist            |     132 |             12.5% |      39 |      22% | 23 / 109 / 0 / 0   |                                    22% |
| platform (bucket)    |     119 |             11.2% |      45 |      25% | 33 / 86 / 0 / 0    |                                    27% |
| shared (bucket)      |     107 |             10.1% |      40 |      23% | 23 / 83 / 1 / 0    |                                     9% |
| shop-integrations    |     106 |             10.0% |      27 |      15% | 21 / 85 / 0 / 0    |                                    38% |
| price-refresh        |     105 |              9.9% |      38 |      21% | 15 / 90 / 0 / 0    |                                    51% |
| sign-in              |      67 |              6.3% |      17 |      10% | 18 / 40 / 9 / 0    |                                    25% |
| product-search       |      25 |              2.4% |      12 |       7% | 6 / 19 / 0 / 0     |                                    32% |
| shop-gate            |      19 |              1.8% |      10 |       6% | 6 / 13 / 0 / 0     |                                    58% |
| docs (bucket, prose) |     504 |      32.2% of all |     172 |      97% | 105 / 311 / 2 / 86 |                                      – |
| unmapped             |       5 |              0.5% |       3 |       2% | 0 / 2 / 3 / 0      |                                      – |

- `evidence`: **price-comparison** leads on both changes and commits. **shop-matching** and **watchlist** follow, then three areas of about 105 changes each: shop-integrations, price-refresh and the shared bucket.
- `evidence`: the unmapped share is 0.3% of all changes (5) and 0.5% of code changes. They are the starter's demo pages (`Topbar.astro`, `Welcome.astro`, `dashboard.astro`), all deleted. The agent-authored share is 0%, and the co-authored share is 100% in every code capability, so that ratio carries no signal.
- `evidence`: 61 code changes (5.8%) fall on paths absent at HEAD. They are the Natura-only views (renamed into shop-matching), the replaced product summary and header (price-comparison), and the starter's sign-up forms and routes (sign-in's 9 deletions, removed by `invite-only-access`).
- `inference`: test files take half the changes in shop-matching, price-refresh and shop-gate. Each phase writes its tests with its code, so churn there measures tests being written, not instability.

## Top files in top capabilities

The count is the number of counted commits that touched the file, with renames followed (earlier names folded in). Every file listed exists at HEAD.

| Capability        | Top files (commits; first..last touch)                                                                                                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| price-comparison  | `src/pages/watchlist/[id].astro` 23 (09-27..10-08); `src/lib/services/price-comparison.ts` 22; `src/dev/fixtures.ts` 22; `src/dev/product-page.astro` 20; `src/components/watchlist/price-comparison-state.ts` 19 (its test 18)                                                                                                                |
| shop-matching     | `src/lib/services/shop-matching.test.ts` 16 (..10-09); `src/lib/services/matches.test.ts` 14; `src/lib/services/match-view.test.ts` 13 (was `natura-view.test.ts`); `src/lib/services/matches.ts` 11; `src/lib/services/match-view.ts` 11 (was `natura-view.ts`); `src/components/watchlist/match-card.test.ts` 10 (was `natura-card.test.ts`) |
| watchlist         | `src/pages/watchlist.astro` 20 (..10-09); `src/lib/services/watchlist-rows.test.ts` 14; `src/lib/services/watchlist-rows.ts` 13; `src/dev/watchlist.astro` 13; `src/dev/watchlist-fixtures.ts` 12; `src/lib/services/watchlist.test.ts` 10                                                                                                     |
| platform          | `.github/workflows/ci.yml` 17 (09-23..10-07); `eslint.config.js` 16; `package.json` 9; `tests/e2e/support/watchlist-data.ts` 9 (since 10-02); `astro.config.mjs` 7                                                                                                                                                                             |
| shared            | `src/types.ts` 16; `src/styles/global.css` 13; `src/lib/notices.ts` 11 (its test 7); `scripts/check-token-contrast.mjs` 8                                                                                                                                                                                                                      |
| shop-integrations | `src/lib/services/shops/rossmann.ts` 12; `super-pharm.test.ts` 11 and `super-pharm.ts` 10 (both born 10-05); `natura.ts` 9; `natura.test.ts` 9; `rossmann.test.ts` 9                                                                                                                                                                           |
| price-refresh     | `src/lib/services/price-refresh.test.ts` 16; `src/lib/services/price-refresh.ts` 14; `src/lib/services/prices.test.ts` 12; `src/lib/services/prices.ts` 11; `src/lib/services/price-targets.test.ts` 11                                                                                                                                        |
| sign-in           | `scripts/smoke.mjs` 13; `src/middleware.ts` 5; `scripts/owner-link.mjs` 3; `src/dev/auth.astro` 3; `src/pages/auth/signin.astro` 3                                                                                                                                                                                                             |
| product-search    | `src/lib/services/search-query.ts` 7 (its test 7); `src/components/watchlist/SearchResults.astro` 5; `src/components/shell/SearchForm.astro` 4; `src/lib/services/product-search.ts` 1 (new on 10-09)                                                                                                                                          |
| shop-gate         | `src/lib/services/shop-gate.ts` 5 (its test 5); `scripts/check-shop-gate-db.mjs` 5; `src/lib/shop-messages.ts` 2                                                                                                                                                                                                                               |

- `evidence`: the most-changed code file is the product page (`[id].astro`, 23 commits). The kitchen-sink fixtures (`src/dev/fixtures.ts`, 22) change as often as the core rule module (`price-comparison.ts`, 22). The most-changed file of all is `CLAUDE.md`, the rules file, at 47 commits, which counts under docs.

## Trend

Rule: a capability is **seasonal** when one week holds at least 60% of its commits and its share of that week's commits is at least twice its share in each other week. Otherwise its W41 share is compared with its W39–W40 share: **rising** at 1.25× or more, **fading** at 0.75× or less, **constant** in between. Shares divide by the week's total commits, which corrects for the partial W41.

| Capability        | W39 n (share) | W40 n (share) | W41 n (share) | W41 ÷ W39–40 | Label                | Campaigns behind it (subject scopes)                                                                                                                             |
| ----------------- | ------------- | ------------- | ------------- | -----------: | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| price-comparison  | 4 (11%)       | 30 (41%)      | 19 (28%)      |         0.90 | constant (since W40) | W40 `etykiety-redesign` 8, `hebe-in-comparison` 5, `fix-matches-and-watchlist` 5; W41 `good-price-judgement` 4, `super-pharm-in-comparison` 4, `match-by-name` 3 |
| shop-matching     | 5 (14%)       | 22 (30%)      | 11 (16%)      |         0.65 | fading               | W40 `hebe-in-comparison` 6, `fix-matches-and-watchlist` 5                                                                                                        |
| watchlist         | 6 (17%)       | 25 (34%)      | 8 (12%)       |         0.41 | seasonal (W40 spike) | W40 `etykiety-redesign` 7, `hebe-in-comparison` 5, `fix-matches-and-watchlist` 5                                                                                 |
| shop-integrations | 6 (17%)       | 5 (7%)        | 16 (24%)      |         2.33 | **rising**           | W41 `testing-shop-answer-contracts` 5, `add-from-other-shops` 4, `match-by-name` 3; Super-Pharm born 10-05                                                       |
| price-refresh     | 0 (0%)        | 23 (32%)      | 15 (22%)      |         1.05 | constant (born W40)  | W40 `cheapest-shop-today` 5, `etykiety-redesign` 6, `fix-matches-and-watchlist` 5; W41 `testing-route-and-database-seams` 4                                      |
| sign-in           | 4 (11%)       | 10 (14%)      | 3 (4%)        |         0.34 | fading               | W40 `invite-only-access` 3 and `etykiety-redesign` 4 (S-07 finished 10-05)                                                                                       |
| product-search    | 4 (11%)       | 3 (4%)        | 5 (7%)        |         1.14 | constant; low volume | W41 `add-from-other-shops` 3                                                                                                                                     |
| shop-gate         | 4 (11%)       | 1 (1%)        | 5 (7%)        |         1.60 | rising; low volume   | W39 `polite-shop-access` 3; W41 `testing-shop-answer-contracts` 3, `testing-route-and-database-seams` 2                                                          |
| platform          | 10 (28%)      | 23 (32%)      | 12 (18%)      |         0.58 | fading               | W40 `testing-critical-browser-flows` 5 (Playwright), `product-page-ui` 5; W41 testing rollout phases 2 and 4                                                     |
| shared            | 6 (17%)       | 27 (37%)      | 7 (10%)       |         0.34 | seasonal (W40 spike) | W40 `etykiety-redesign` 8 (tokens, shell, themes), `fix-matches-and-watchlist` 5, `product-page-ui` 5                                                            |
| docs              | 35 (97%)      | 71 (97%)      | 66 (97%)      |         1.00 | constant             | every change                                                                                                                                                     |

Commit types per week: W39 feat 8, fix 5; W40 feat 26, fix 7; W41 feat 19, fix 11.

- `evidence`: the one rising business capability is **shop-integrations**: Super-Pharm, then the shop-answer contract tests, then the four-shop search. W40's design campaign (`etykiety-redesign`, `product-page-ui`) explains the shared and watchlist spikes. Fix-typed commits rise in W41 to 11: 4 phases of the shop-answer contract tests, 5 review fixes and 2 UI fixes.
- `inference`: the curve follows the build order of a three-week MVP: the roadmap's slices, then the test-plan rollout. Three buckets, one of them partial, make every label weak.

## Fix pressure

**Heuristic:** a subject matching `\b(fix(es|ed|ing)?|bugs?|bugfix(es)?|hotfix(es)?|revert(s|ed|ing)?|regressions?|broken|incidents?)\b`, case-insensitive. The word boundaries keep "fixture", "prefix" and "debug" out; a plain substring match would add none here. No subject references an issue, so no bug label applies. **Reverts: 0**: no subject says revert, and no message body says "This reverts commit".

The raw count is **33 of 177 commits (19%)**. Read one by one (rules 5 and 12):

- **9 match only by name** (`evidence`): S-08's change id `fix-matches-and-watchlist` ("Fix a wrong match and remove a product") is a planned feature. Its phase, docs and archive commits are not fixes and are left out below.
- **14 implementation-review fixes** (`evidence`): each planned change ends with one review-fix commit (15 of the 17 changes; `b0c254f` covers two). 12 of the 14 touch more than 3 capabilities. 11 landed in the change's own PR before merge. Since 10-07, review fixes have landed in a later "close" PR, after the phases merged and deployed. That covers 3 commits for 4 changes: `df551f3`, `b0c254f` (10-07) and `0f9ebc5` (10-08).
- **4 defect fixes found by tests** (`evidence`): the `testing-shop-answer-contracts` phases fixed D1–D5 in merged code, all shop answers misread silently. D1 read Rossmann's 404 as `missing` because the gate dropped the body; D2/D3 skipped Luigi's Box hits as suggestions; D4 read an empty page with a count as "found nothing"; D5 turned a failed Rossmann search into "no results". A fourth phase fixed paths and refresh loops. They changed the adapters, `shop-gate.ts` (D1) and `price-refresh.ts`.
- **6 standalone fixes:**
  - `d0c78d5`: PriceTrack labels overlapping (UI polish).
  - `2c79778`: search copy (UI text).
  - `7857030`: one odd row emptied the list's reads, a data-read defect across `src/lib/services/matches.ts`, `src/lib/services/prices.ts`, `src/lib/services/price-targets.ts` and `src/lib/services/watchlist-rows.ts`.
  - `5e23df6`: ESLint and TypeScript config.
  - `468c9cb`: lockfile for `npm ci`. It counts under docs because the lockfile is noise.
  - `86dc852`: a docs list.

| Capability        | Commits | Raw fix (share) | Name-only | Adjusted fix (share) | Review / test-found / standalone | Cross-cutting among adjusted (>3 caps: with / without docs) | About this capability (rule 12) | Spillover (touches it, about another) |
| ----------------- | ------: | --------------- | --------: | -------------------- | -------------------------------- | ----------------------------------------------------------- | ------------------------------: | ------------------------------------: |
| shop-integrations |      27 | 11 (41%)        |         0 | 11 (41%)             | 7 / 4 / 0                        | 9 / 8                                                       |      **7 (26% of its commits)** |                                     4 |
| shop-gate         |      10 | 4 (40%)         |         0 | 4 (40%)              | 2 / 2 / 0                        | 3 / 3                                                       |                               1 |                                     3 |
| sign-in           |      17 | 6 (35%)         |         0 | 6 (35%)              | 6 / 0 / 0                        | 5 / 5                                                       |                               1 |                                     5 |
| price-refresh     |      38 | 17 (45%)        |         4 | 13 (34%)             | 10 / 2 / 1                       | 12 / 11                                                     |                               3 |                                    10 |
| product-search    |      12 | 4 (33%)         |         0 | 4 (33%)              | 3 / 0 / 1                        | 3 / 3                                                       |                               2 |                                     2 |
| shop-matching     |      38 | 13 (34%)        |         4 | 9 (24%)              | 7 / 1 / 1                        | 8 / 8                                                       |                               4 |                                     6 |
| price-comparison  |      53 | 15 (28%)        |         4 | 11 (21%)             | 10 / 0 / 1                       | 10 / 9                                                      |                               5 |                                     6 |
| watchlist         |      39 | 12 (31%)        |         4 | 8 (21%)              | 7 / 0 / 1                        | 7 / 7                                                       |                               2 |                                     6 |
| platform          |      45 | 9 (20%)         |         1 | 8 (18%)              | 7 / 0 / 1                        | 6 / 6                                                       |                               3 |                                     6 |
| shared            |      40 | 9 (23%)         |         4 | 5 (13%)              | 4 / 1 / 0                        | 5 / 5                                                       |                               1 |                                     4 |
| docs              |     172 | 29 (17%)        |         9 | 20 (12%)             | 14 / 4 / 2                       | 14 / 13                                                     |                               – |                                     – |

"About" means the change the fix belongs to, mapped through the contract's scope-to-capability column; a standalone fix goes to the capability holding most of its files. One fix can be about two capabilities, and "about" can include a fix that doesn't touch the capability's files.

- `evidence`: after rules 5 and 12, **shop-integrations** carries the real fix pressure. 7 fix commits are about it (26% of its commits): the Hebe and Super-Pharm review fixes, the four defect phases D1–D5 found by tests, and that change's review fix, which landed after deploy. Its 4 defect fixes are the only ones in the window found in merged code by a test campaign.
- `evidence`: everywhere else the fix share mostly reflects the workflow's one review commit per change spreading across the capabilities it brushed. sign-in has 5 of 6 fix touches as spillover, price-refresh 10 of 13 and shared 4 of 5.
- `inference`: platform's 3 fixes about it are tooling iteration (rule 5), and `d0c78d5` and `2c79778` are UI polish (rule 5). None is evidence of a broken capability.

## Co-change between capabilities

The co-change rule drops commits that touch more than 5 of the 11 capabilities: **27 dropped** (21 planned phases and 6 review fixes), **150 kept**. Only 68 kept commits touch code (82 touch only docs), so the code pairs rest on 68 commits. Support counts the commits that share a pair. Confidence divides support by the commits of the less active side in the kept set.

| Pair, without docs                                       | Support | Confidence | Commits (A / B)              |
| -------------------------------------------------------- | ------: | ---------: | ---------------------------- |
| price-comparison + price-refresh                         |      13 |        65% | 29 / 20                      |
| price-comparison + shared                                |      12 |        67% | 29 / 18                      |
| price-comparison + watchlist                             |       8 |        53% | 29 / 15                      |
| shop-integrations + shop-matching                        |       8 |        47% | 17 / 20                      |
| price-refresh + shop-matching                            |       8 |        40% | 20 / 20                      |
| price-comparison + shop-matching                         |       8 |        40% | 29 / 20                      |
| platform + price-comparison                              |       8 |        28% | 29 / 29                      |
| price-refresh + watchlist                                |       7 |        47% | 20 / 15                      |
| price-refresh + shop-integrations                        |       7 |        41% | 20 / 17                      |
| shop-matching + watchlist                                |       6 |        40% | 20 / 15                      |
| shop-gate + price-refresh; shop-gate + shop-integrations |  4 each |        57% | 7 / 20; 7 / 17 (low support) |
| product-search + shop-integrations                       |       3 |        75% | 4 / 17 (low support)         |

- With docs, every capability pairs with docs at 87–100% confidence (docs + platform 28, docs + price-comparison 27, …). One cause explains all of it: each phase updates its plan. That is mechanical (rules 3, 4 and 8).
- Sensitivity: applying the drop rule to the 10 code capabilities alone (more than 5) drops 14 commits. The top three are the same and stronger: price-comparison + shared 20 (71%), + price-refresh 18 (67%), + watchlist 15 (60%). Shop-integrations + shop-matching reaches 12 (55%).
- `evidence`: **price-comparison is the co-change centre**, pairing with price-refresh, shared and watchlist at 53–67% (60–71% under the code-only rule). A second corridor runs **shop-integrations + shop-matching + price-refresh**: each new shop touched adapter, matching and refresh together. The fix list shows shop-gate in the same corridor (D1).
- `inference`: the first cluster is the product page's composition. The page and its island read prices, matches and the design system, and the kitchen-sink fixtures follow them.

## Hub files and freshness

These lists use the kept set. A partner is any capability other than the file's own, seen with the file in at least 2 commits; docs doesn't count as a partner.

| File (own capability)                                                                                                  | Kept commits (all)      | Partners | What it is                                                                                                                 | Rules                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------: | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `context/foundation/test-plan.md` (docs)                                                                               | 30 (30)                 |        8 | the test plan, updated by each rollout phase and spec                                                                      | 8, 4: workflow, mechanical                                                     |
| `context/foundation/roadmap.md` (docs)                                                                                 | 28 (31)                 |        8 | the roadmap's slice status                                                                                                 | 8, 4: mechanical                                                               |
| `CLAUDE.md` (docs)                                                                                                     | 39 (47)                 |        7 | the rules file, updated by every change's docs phase                                                                       | 3, 4, 8: mechanical                                                            |
| `src/dev/fixtures.ts` (price-comparison)                                                                               | 13 (22)                 |        7 | kitchen-sink fixtures for every product-page state, "updated with the views" (CLAUDE.md)                                   | 3: a convention corridor; `astro check` guards its types, not its completeness |
| `src/lib/services/price-comparison.ts` (price-comparison)                                                              | 13 (22)                 |        7 | `MATCHED_SHOPS`/`MATCHABLE_SHOPS`, the switch that keys per-shop tables, plus verdict, freshness and judgement (CLAUDE.md) | partly 2 (the shop list as config); otherwise **a real domain hub**            |
| `src/lib/services/price-refresh.ts` and its test (price-refresh)                                                       | 7 (14) and 9 (16)       |        6 | `refreshPrices` over every priced shop                                                                                     | real: each new shop and each answer fix touches it                             |
| `src/types.ts` (shared)                                                                                                | 6 (16)                  |        6 | the shared entities and DTOs, hand-kept (no generated database types are tracked)                                          | 2: the compiler guards its TypeScript users                                    |
| `src/dev/product-page.astro`, `price-comparison-state.ts` (+test), `src/pages/watchlist/[id].astro` (price-comparison) | 11 (20), 9 (19), 8 (23) |   5 each | the kitchen-sink page, the island's state rules, the product page                                                          | composition of the product page                                                |
| `src/lib/services/shops/super-pharm.test.ts`, `src/lib/services/shop-matching.test.ts`                                 | 10 (11), 7 (16)         |   5 each | adapter and lookup tests                                                                                                   | tests follow their capability                                                  |

- Counting all 177 commits with nothing dropped adds three hubs, each with 9 partners:
  - `src/pages/watchlist.astro` (20 commits): the list page.
  - `eslint.config.js` (16): its `islandConfig`/`tokenConfig` file lists are config written as code, and lint guards them (rules 2, 3).
  - `scripts/smoke.mjs` (13): it pins every gated route's redirect and code, so a new page updates it, and it is itself the guard (rule 3).
- **Freshness** (`git cat-file -e HEAD:<path>`): all 68 current paths named in this file exist. Absent paths, history folded per rule 11:
  - Renamed on 10-04, when Hebe joined (`hebe-in-comparison` p2 `68758c8` and p4 `50fb7c6`): `natura-view.ts` → `match-view.ts`, `natura-view.test.ts` → `match-view.test.ts`, `natura-card.test.ts` → `match-card.test.ts`, `NaturaCard.tsx` → `MatchCard.tsx`, `NaturaSection.astro` → `MatchChoice.astro`.
  - Deleted:
    - `src/components/watchlist/natura-card.ts` (in `50fb7c6`);
    - `ProductSummary.astro` and `ProductHeader.astro` (in the 09-30 redesign, `052ed81` and `5c1c302`);
    - the unmapped demo pages `src/components/Topbar.astro`, `src/components/Welcome.astro` and `src/pages/dashboard.astro`.
  - Moved on archiving: change folders go from `context/changes/<id>/` to `context/archive/<date>-<id>/` (for example `context/changes/hebe-in-comparison/plan.md`). 250 docs changes sit on those pre-archive paths.

## Mechanical signals

1. **docs** is 32% of changes and is in 172 of 177 commits: planning prose and the per-phase plan update (rule 8). It is not ranked as a hot area, and its 87–100% co-change with everything has one cause (rule 4).
2. **Review-fix commits** come one per planned change by workflow (rule 4). They are 6 of the 27 dropped broad commits and spread fix counts over every capability their change brushed (rule 12). They are attributed in the "about" column; the spillover is reported separately.
3. **Name-only fix matches**: 9 commits match only through the S-08 change id.
4. **Trial-and-error fixes** (rule 5): `5e23df6` (lint and type-check config), `468c9cb` (lockfile for `npm ci`), the e2e review fix `e741d73` (platform), and the UI polish `d0c78d5` and `2c79778`.
5. **Workflow and config hubs**: `CLAUDE.md`, `roadmap.md` and `test-plan.md` are workflow docs (rule 8). `eslint.config.js` holds lint-guarded config-as-code lists (rules 2, 3), `scripts/smoke.mjs` is a check that pins routes (rule 3), and `src/types.ts` holds compiler-guarded shared types (rule 2).
6. **Agent co-authorship** (rule 7) appears on 176 of 177 commits; it is activity, not people. The team baseline is one human (rule 6).
7. **Archive renames** fold into their new paths (rule 11). The docs bucket's 86 R entries are archive moves, each counted once.
8. **Test-file churn** reflects tests written with each phase (shop-gate 58%, shop-matching 51%, price-refresh 51% of changes), not instability.
9. The contract's noise filter already removed the lockfile, shop-answer recordings, binary design captures and the course CLI's vendored skills.

## Unknowns

- Pairs that should change together, which co-change can't confirm. Each comes from CLAUDE.md and was measured on counted commits:
  - **Migrations and hand-kept TypeScript row types:** no generated database types are tracked, and 2 of 8 migration commits touched `src/types.ts`. Whether every row shape follows its migration is unknown. A partial guard exists: 7 of 8 migration commits also changed a database check script, which CI's smoke job runs.
  - **`PRODUCT_LIMITS`/`PRICE_LIMITS` (`src/lib/services/product-limits.ts`) and their SQL bounds:** 2 of 4 limit commits touched a migration (`887bd45` and `e372569` did not). Whether those two changed a mirrored bound would take reading the diffs.
  - **`islandConfig` in `eslint.config.js` and the modules islands import:** 3 of 9 commits that added a `src/components/watchlist` module touched the config. An island module missing from the list goes unchecked without any error.
  - **Kitchen sinks and their views:** product 15 of 18, list 7 of 8 and auth 3 of 5 view commits also touched their sink. Whether the misses (`ae7f6f4`, `f77e6b8`, `afad362`, `2c79778`, `4b92983`, `b041f7e`) needed a sink change is unknown, since nothing guards completeness.
  - **`docs/research/polish-drugstore-price-apis.md` and the shop adapters:** 2 of 23 adapter commits touched the doc. Whether the doc still matches the adapters is unknown.
  - **`src/lib/notices.ts` texts and the routes' codes:** by design, a code without a text shows nothing, so drift is invisible to co-change.
- **State outside git** (external): the production Supabase settings (sign-up off), Workers Builds results and production incidents. No commit references an issue; the discussion evidence may say whether any post-deploy defect existed beyond the 3 review fixes that landed after deploy.
- **Line churn** was not measured (the contract counts files per commit). **Trend labels** rest on 3 weekly buckets, one of them partial.
- No tool was missing: git and node covered every measure.

## Commands

- `node context/map/.work/attribute.mjs` and `node context/map/.work/attribute.mjs commits` (coverage, capabilities per commit)
- `node context/map/.work/h-analyze.mjs` → `.work/h-analysis.txt` (activity, top files with renames followed, trend, fix list, co-change, hubs)
- `node context/map/.work/h-fix.mjs` → `.work/h-fix.txt`; `.work/h-fix-crosscut.txt` (fix classes, PR timing, about and spillover)
- `node context/map/.work/h-trend.mjs` → `.work/h-trend.txt` (week shares, labels, type mix); `node context/map/.work/h-twins.mjs` → `.work/h-twins.txt`
- `git -c core.quotepath=off log --no-merges --format='%h %aI %cI'`, `--grep='This reverts commit'`, and a subject grep for `#N` (dates, reverts, issue references)
- `git -c core.quotepath=off log --first-parent --merges origin/main`, then `git log --no-merges <M>^1..<M>^2` per merge → `.work/h-commit-pr.tsv`
- `git -c core.quotepath=off show --name-status <sha>` (the standalone and shop-answer contract fixes); `git -c core.quotepath=off cat-file -e HEAD:<path>` per named path → `.work/h-freshness.txt`
- `git -c core.quotepath=off ls-files` (database types, migrations, kitchen sinks); `grep` and `sed` on two archived change files to confirm what the subjects named (the D1–D5 list, the S-08 title)
