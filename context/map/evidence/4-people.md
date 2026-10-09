# Evidence: people

- **Window:** the whole history, 2026-09-20..2026-10-09 (HEAD f087611): 179 non-merge commits, 177 counted by the shared attribution (`countedCommits` in `.work/attribute.mjs`). The template import b6b09c1 is excluded as mass, and 60103c2, a course-lessons fetch, loses every file to the noise filter. (evidence)
- **Humans in window: 1.** The owner commits under two git display names: "yarkhu" (125 commits, 2026-09-20..10-06) and "Yaroslav Khudchenko" (54 commits, 2026-10-06..10-09).
  - Both names have one and the same address, compared privately and not written here.
  - There is no `.mailmap`. The names change over on a single day (both appear only on 2026-10-06), so this is a configuration change, not a hand-over.
  - The two identities are merged into one person. (evidence)
- **Bots:** 0. **Agent:** Claude Opus 5.5 is `Co-authored-by` on 177 of the 179 commits. It counts as activity, not as a person (false-signal 7). (evidence)
- **Forge:** 45 PRs, all opened by the owner. 44 are merged, all by the owner, and #45 is open. There are 0 reviews and 0 comments on any PR, and the repository has one collaborator (admin). (evidence)
- **Baseline: one human, so every concentration figure here is the baseline, not a finding (false-signal 6).** The evidence below therefore records how knowledge is held, not who holds it.
- **Areas:** all 11 capabilities are covered: 9 rated high, `shared` rated medium, and `docs` (rated low) added because it is #1 by counted changes. The "In scope because" column gives the reason for each.

## People per capability

Every row has the same person: the owner, with the agent as co-author. Each topic group is a change folder, taken from the commit scopes, with its phases (`pN`). Paths are counted file changes.

| Capability        | In scope because                                                        | People    | Topic groups (change folders; most-touched paths)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Active                | Commits |
| ----------------- | ----------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------- |
| sign-in           | high: identity and access, public entry points                          | the owner | Invite-only accounts: no self-registration, Polish sign-in with a return path, invite and recovery links (`invite-only-access` p1–p3 and its review fixes). 5 other changes extended the smoke test (`scripts/smoke.mjs`, 13 changes in all), and one of them, `watchlist-add-by-search`, also changed the middleware, the response headers and the auth routes (`src/middleware.ts`, 5 changes in all). Auth pages restyled (`etykiety-redesign` p1, p2, p5). The production check (`testing-deploy-and-production-checks` p1).                                                    | 09-27..10-07, 10 days | 17      |
| product-search    | high: user text reaches four shops; the entry to the core value         | the owner | Rossmann search (`watchlist-add-by-search` p2). The four-shop search and products without a caption (`add-from-other-shops` p2–p4). The search form and results in the redesign (`etykiety-redesign` p3, p6). One unplanned fix (2c79778). Paths: `src/lib/services` 16, `src/components/{watchlist,shell}` 9.                                                                                                                                                                                                                                                                      | 09-27..10-09, 8 days  | 12      |
| watchlist         | high: user data, privacy between users                                  | the owner | Data contract and the add flow (`watchlist-add-by-search` p1, p3). Removal, re-pin, suspicious matches on the list (`fix-matches-and-watchlist` p1, p3–p5). The list's shell, rows, tags and chips (`etykiety-redesign` p1, p3, p5, p6). The list for every matched shop (`hebe-in-comparison` p2, p4–p6). Each product's own shop (`add-from-other-shops` p1, p2, p4). Paths: `src/lib/services` 52, `src/dev` 25, `src/components/watchlist` 20, `src/pages` 20.                                                                                                                  | 09-27..10-09, 12 days | 39      |
| shop-matching     | high: user decisions; matches decide what compares                      | the owner | Match contract, Natura lookup, the matching rule (`shop-matching-first-two-shops` p1–p3). Brand rule, re-pin, suspicious matches (`fix-matches-and-watchlist` p1–p3, p5). Matching for every matched shop (`hebe-in-comparison` p1, p2, p4, p6; `super-pharm-in-comparison` p3, p4). The name check (`match-by-name` p2, p3). Products without a caption (`add-from-other-shops` p1–p3). Paths: `src/lib/services` 111, `src/components/watchlist` 35, `scripts/check-matches-db.mjs` 5.                                                                                            | 09-27..10-09, 12 days | 38      |
| price-comparison  | high: core value                                                        | the owner | The cheapest shop today on the product page (`cheapest-shop-today` p2–p4). The page on tokens and its states (`product-page-ui` p1, p3, p4). The product area's redesign (`etykiety-redesign` p1–p6). The good-price judgement and its history (`good-price-judgement` p1–p4). Per-shop generalisation (`hebe-in-comparison`, `super-pharm-in-comparison`). Honest prices in a browser (`testing-critical-browser-flows` p3, p4). One unplanned fix (d0c78d5). Paths: `src/components/watchlist` 93, `src/dev` 42, `src/lib/services` 41, `src/pages/watchlist` 23, `tests/e2e` 15. | 09-27..10-08, 11 days | 53      |
| price-refresh     | high: shared data written, external calls                               | the owner | Price contract, shop price lookups, the list's refresh (`cheapest-shop-today` p1–p4). Prices for every matched shop (`hebe-in-comparison` p3). Route and database seams (`testing-route-and-database-seams` p1–p3). History in the database (`good-price-judgement` p2). Refresh loops (`testing-shop-answer-contracts` p1, p4). Paths: `src/lib/services` 77, `src/pages/api/watchlist` 9, `scripts/check-prices-db.mjs` 6.                                                                                                                                                        | 09-28..10-08, 10 days | 38      |
| shop-integrations | high: external integrations that search, matching and refresh depend on | the owner | Rossmann and Natura adapters (`watchlist-add-by-search` p2, `shop-matching-first-two-shops` p2). Price lookups (`cheapest-shop-today` p2). Hebe on a shared Luigi's Box client (`hebe-in-comparison` p1). Super-Pharm's adapter (`super-pharm-in-comparison` p1, p2) and its sizes from names (`match-by-name` p1). Shop-answer contracts, with findings D1–D5 named in its fix subjects (`testing-shop-answer-contracts` p1–p4). Rossmann as a shop like the others (`add-from-other-shops` p1–p4). Paths: `src/lib/services/shops` 102.                                           | 09-27..10-09, 9 days  | 27      |
| shop-gate         | high: the deployment's standing with each shop                          | the owner | The gate and its database contract (`polite-shop-access` p1, p2 and its review fixes). Routes ask shops only as stated, and the database catalogue (`testing-route-and-database-seams` p2, p3). Paths and refresh loops (`testing-shop-answer-contracts` p1, p4). Paths: `src/lib/services` 10, `scripts/check-shop-gate-db.mjs` 5.                                                                                                                                                                                                                                                 | 09-27..10-08, 4 days  | 10      |
| platform          | high: the deploy pipeline and migrations reach production               | the owner | First Cloudflare deploy and CI on Node 24 (3553b4a, fd8f452, documented in the deploy plan). Lint and token guards (`product-page-ui` p2, p5; `etykiety-redesign` p1). Playwright harness and the e2e gate (`testing-critical-browser-flows` p1, p2). Agent hooks (1a1810d). Deploy and production checks (`testing-deploy-and-production-checks` p1–p3). Paths: `.github/workflows` 18, `tests/e2e/support` 17, `eslint.config.js` 16, `package.json` 9.                                                                                                                           | 09-23..10-08, 13 days | 45      |
| shared            | medium: every view depends on it                                        | the owner | Tokens, components, themes and fonts (`product-page-ui` p1, p2; `etykiety-redesign` p1, p2). Shared types and helpers carried by feature changes (`src/types.ts` 16, `src/lib` 27). Paths: `src/components/ui` 15, `src/styles` 13, `scripts/check-token-contrast.mjs` 8.                                                                                                                                                                                                                                                                                                           | 09-27..10-07, 10 days | 40      |
| docs              | low, but #1 by counted changes (504)                                    | the owner | Each change's plan, progress, research and reviews (149 of 177 counted commits touch a change folder). The rules file `CLAUDE.md` (47 commits). Roadmap 31, test plan 30, deploy plan 18, PRD 11, shop research 10, lessons 1. 16 archive moves. This is prose: discussion, not activity (false-signal 8).                                                                                                                                                                                                                                                                          | 09-23..10-09, 15 days | 172     |

## Concentration

**Small team: concentration is the baseline.** One person, the owner, is the only one who has ever touched each of the 11 capabilities, and the 3 deleted starter demo pages too. Bus-factor figures are skipped. (evidence)

The other origins, from the import commit's tree compared with HEAD (evidence unless marked):

- **sign-in:** 6 files came from the imported starter, and the owner has changed all of them since (`scripts/smoke.mjs` in 13 commits, `src/middleware.ts` in 5).
- **shared:** 8 starter files. `src/components/Banner.astro` and `src/lib/config-status.ts` are unchanged since the import.
- **platform:** 19 starter files, 10 of them unchanged since (the editor, Prettier and husky configs, `components.json`, `.env.example`, …).
- **docs:** the import commit also carried the PRD, the shape notes, the tech stack, the infrastructure note and the shop research. These were drafted before the repository existed (the research is dated 2026-09-17), so their drafting history is not in git. (inference)

### Where the knowledge is held instead

| Capability        | Commits with their change folder | Change folders (with impl review) | Commits that also changed `CLAUDE.md` | Non-test files named in `CLAUDE.md`/`AGENTS.md` | … named anywhere in prose | Code commits touching no prose |
| ----------------- | -------------------------------- | --------------------------------- | ------------------------------------- | ----------------------------------------------- | ------------------------- | ------------------------------ |
| sign-in           | 17/17                            | 8 (7)                             | 7                                     | 20/21                                           | 21/21                     | 0                              |
| product-search    | 11/12                            | 5 (4)                             | 3                                     | 4/4                                             | 4/4                       | 1: 2c79778                     |
| watchlist         | 37/39                            | 14 (13)                           | 9                                     | 17/20                                           | 20/20                     | 2: 7857030, 94f4877            |
| shop-matching     | 36/38                            | 14 (13)                           | 8                                     | 11/12                                           | 12/12                     | 2: 7857030, 94f4877            |
| price-comparison  | 50/53                            | 14 (13)                           | 14                                    | 14/16                                           | 16/16                     | 2: d0c78d5, 94f4877            |
| price-refresh     | 36/38                            | 12 (11)                           | 13                                    | 8/9                                             | 9/9                       | 2: 7857030, 94f4877            |
| shop-integrations | 27/27                            | 10 (9)                            | 6                                     | 11/13                                           | 13/13                     | 0                              |
| shop-gate         | 10/10                            | 5 (5)                             | 2                                     | 3/4                                             | 4/4                       | 0                              |
| platform          | 40/45                            | 16 (14)                           | 13                                    | 24/46                                           | 43/46                     | 1: 5e23df6                     |
| shared            | 39/40                            | 14 (14)                           | 8                                     | 17/27                                           | 26/27                     | 1: 94f4877                     |

"Named" is a heuristic: the file's path appears, or its stem appears right after `/` or a backtick and right before `.` or a backtick. It reads only prose files, never source.

- **The rules file** (`CLAUDE.md`, 99 long lines) changed in 47 of the 177 counted commits and names 129 of the 172 current non-test code files. It names no migration file but does name the tables those migrations create (for example `watchlist_matches` 4 times, `applied_migrations` 5). `AGENTS.md` is a single line. (evidence)
- **The change folders:** 16 archived and 1 active (`add-from-other-shops`). Together they hold 15 implementation reviews, 4 plan reviews, 13 research files and 7 review-fix follow-ups. (evidence)
  - 14 commits named "implementation review fixes" close those 15 reviews (b0c254f closes two).
  - Two folders have no recorded implementation review. `testing-deploy-and-production-checks` (platform, sign-in) was archived without one. The review of `add-from-other-shops` is in the open PR #45. (evidence)
- **`context/foundation/lessons.md`** holds 6 lessons, seeded once from the first four implementation reviews (6d71c43, 2026-09-29). It has not changed since, while 11 more reviews followed. (evidence) So the later lessons live only in their change folders and in rules-file edits. (inference)
- **The forge:** every PR has a description (median 1,596 characters; feature PRs about 2,500–4,300), but none has a review or a comment. PR pages hold summaries, and the deliberation lives in the change folders. (evidence)
- **Knowledge only in code:** no capability is in this state. (inference from the table)
  - 4 non-test files are named in no prose at all: `.claude/hooks/lint-edited-file.mjs`, `.vscode/extensions.json` and `.vscode/launch.json` (platform), and `src/components/Banner.astro` (shared; from the starter and never changed). (evidence)
  - 5 code commits touched no prose: 2c79778 `fix(search)`, d0c78d5 `fix(price-track)`, 5e23df6 (lint config), and 7857030 and 94f4877. The last two are scoped `etykiety-redesign` but sit outside its folder. For these 5, the commit message is the only record. (evidence)

## Agent co-authorship

This is context, not a filter:

- **Share per capability:** 100% of commits for every code capability, and 171 of 172 for `docs`, where 730f0ac, an archive move, has no trailer. Overall, 177 of the 179 commits carry the trailer; the other one is the template import. (evidence)
- **Trailer variants:** one model under two trailers. "Claude Opus 5.5 (1M context)" is on 38 commits (2026-09-23..09-28) and "Claude Opus 5.5" on 138 commits from 2026-09-29. (evidence)
- **How the work was steered:** the owner authored and merged every change, and the agent co-wrote each one through the plan → implement → review loop that the change folders record. (evidence) The agent's sessions are not in the repository; only the folders, the rules file and the commit messages remain. (inference)

## Implications

- **Whom to ask:** the owner, for every capability and every kind of change. Nobody else appears in git or on the forge. (evidence)
- **What to read before asking**, per kind of change. The first PRs listed for each are the ones with the most commits in that capability.
  - **Sign-in, accounts or links:** `context/archive/2026-10-04-invite-only-access/` (plan, research, plan review, impl review, review fixes) and PR #25 (S-07). The production check is in PR #34, which has no recorded implementation review.
  - **Product search:** PR #5 (S-01) and PR #44 (`add-from-other-shops`; its close-out, PR #45, is still open).
  - **Watchlist:** add, list and remove are in PR #5, #17 (S-08), #15 (redesign) and #23 (S-05, the list for every matched shop).
  - **Matching rules or decisions:** PR #7 (S-02), #17 (S-08), #23 (S-05), #32 (`match-by-name`) and #39 (its review fixes).
  - **Price display and the good-price judgement:** PR #9 (S-03), #13 (`product-page-ui`), #15 (`etykiety-redesign`), #36 (S-04) and #39.
  - **Fetching and storing prices:** PR #9, #23, #40 (route and database seams) and #42.
  - **A shop adapter:** the shop research doc (changed in 10 commits), PR #42 and #43 (`testing-shop-answer-contracts`), #23 (Hebe), #30 (S-06, Super-Pharm) and #44.
  - **The shop gate:** PR #3 (F-01, `polite-shop-access`) and #40.
  - **CI, deploys or e2e:** PR #20 (e2e), #34 (deploy checks), #22 (agent hooks) and `context/deployment/deploy-plan.md` (changed in 18 commits).
  - **Tokens and components:** PR #13 and #15.
- **Work in flight:** the open PR #45 (created 2026-10-09) holds the implementation review and fixes for `add-from-other-shops`. It touches shop-matching (4 files: `matching.ts`, `shop-matching.ts` and their tests), watchlist (2), price-comparison (2), product-search (1) and shop-integrations (1, `rossmann.ts`). Check with the owner before changing those files. (evidence)
- **Mechanical, not a risk:** "one person carries 100%" in every capability is the team-size baseline (false-signal 6). The agent's co-authorship of 100% is workflow (false-signal 7).

## Unknowns

- **Anyone else who knows the system:** there is none in git, in PR reviews or comments, or among collaborators (1). Whether review happens off GitHub, for example with course mentors, is unknown.
- **Formal ownership:**
  - There is no CODEOWNERS file. (evidence)
  - The `preventFailedDeploy` ruleset requires a PR with 0 approvals and the ci, smoke and e2e checks, and has no bypass actors. (evidence)
  - Who holds the production accounts (Cloudflare, Supabase) can't be seen beyond the rules file's statement that the owner does. (unknown)
- **Upstream knowledge:** the authors of the starter template, of the shadcn registry, and of the course CLI's vendored skills and prompts that drive the workflow (noise-filtered) are all outside this repository. (unknown)
- **The agent's sessions:** what the agent was told beyond the committed rules, skills and plans is not in the repository. (unknown)
- **The team after the MVP:** who will maintain the code, or whether anyone joins, is unknown.

## Commands run

- `node context/map/.work/attribute.mjs` and `… commits`: coverage and the capabilities of each commit.
- `git -c core.quotepath=off log --format=%aN|%cN`, `… -- context/foundation/lessons.md`, `… -- AGENTS.md`, and a private count of distinct author addresses (no address printed).
- `.work/people-identities.mjs`, `people-capabilities.mjs`, `people-unplanned.mjs`, `people-change-matrix.mjs`, `people-knowledge.mjs`, `people-review-pattern.mjs`, `people-template-origin.mjs`, `people-prose-coverage.mjs`, `people-prose-cochange.mjs`, `people-pr-capabilities.mjs` (merge ranges `^1..^2` mapped to capabilities). Their output is in `.work/people-*`.
- `git ls-tree` / `git ls-files` on `context/{archive,changes}` and on the import commit b6b09c1; `grep -o <table> CLAUDE.md`.
- Read-only `gh` calls with `GH_TOKEN` from `gh auth token --user yaroslavkhudchenko`:
  - `gh pr list --state all --json number,author,mergedBy,reviews,comments,body,…`
  - `gh pr view 45 --json files,commits,…`
  - `gh api …/rulesets`, `gh api …/rulesets/<id>` and `gh api …/collaborators`
