# Evidence: discussion

Sources: `gh` read-only on yaroslavkhudchenko/10xcourseproject (45 PRs, 0 issues, 180 Actions runs, the check runs of 44 merge commits), git (`.work/git-log.txt` through the shared `attribute.mjs`), and the in-repo planning artifacts: 17 change folders, 15 implementation reviews and 4 plan reviews, 7 follow-up files, `test-plan.md` §7, `lessons.md`, the PRD's dated updates and the observability audit of 2026-10-05. Window: 2026-09-20 to 2026-10-09 (HEAD f087611), with ISO weeks W39, W40 and W41 as buckets. No limits were hit: every forge list fit one page, and nothing timed out. The open PR #45 sits outside HEAD, so it's read from its local branch and reported apart.

The baseline (`evidence`): one person (two git identities) wrote all 45 PRs with an AI agent. Each change goes through a plan, phase commits, an agent-run implementation review that the owner triages, and a close-out PR. No PR has a review or a comment from anyone, human or bot, so the forge carries no discussion. That discussion lives in the PR descriptions (45 of 45 have one, median about 1,600 characters) and in the in-repo reviews.

## Buzz per capability

How to read the table:

- A PR counts for a capability when one of its counted commits touched that capability's files. Each merged PR maps to its commits as `merge^1..merge^2`.
- "Review findings by name" are the plan-review and implementation-review findings of the changes named for the capability.
- "Impl findings by location" sends each finding's `Location` path through `capabilityOf()`. It counts the primary (first) path, with warnings in brackets.
- The audit column counts the 37 findings of the observability audit by primary path, with critical and high findings in brackets.
- The §7 column counts accepted edges, attributed by name (`inference`).
- "PRD updates" are the dated updates of the capability's FRs.
- "Prose churn" counts docs file changes, attributed through each commit's change scope.
- Every capability has 0 closed-unmerged PRs, 0 human reviews, 0 reverts and 0 open bugs, so one column holds all four.

| Capability        | PRs touching (feat · fix · close-out) | Unmerged · human reviews · reverts · open bugs | Changes by name (W39/W40/W41) | Review findings by name (plan + impl) | Impl findings by location: primary (warnings) | Audit findings: primary (crit+high) | §7 accepted edges | PRD dated updates         | Prose churn (docs changes)         | Debt markers in code |
| ----------------- | ------------------------------------- | ---------------------------------------------- | ----------------------------- | ------------------------------------- | --------------------------------------------- | ----------------------------------- | ----------------- | ------------------------- | ---------------------------------- | -------------------- |
| shop-matching     | 15 (13 · 0 · 2)                       | 0 · 0 · 0 · 0                                  | 5 (1/3/1)                     | 63 (23 + 40)                          | 11 (2)                                        | 5 (2)                               | 5                 | 10 (FR-006 ×6, FR-007 ×4) | 169                                | 0                    |
| price-comparison  | 18 (14 · 1 · 3)                       | 0 · 0 · 0 · 0                                  | 4 (0/3/1)                     | 39 (0 + 39)                           | 28 (10)                                       | 2 (2)                               | 1                 | 2 (FR-011, FR-012)        | 123                                | 0                    |
| shop-integrations | 11 (9 · 0 · 2)                        | 0 · 0 · 0 · 0                                  | 4 (0/2/2)                     | 43 (17 + 26), +6 pending in #45       | 14 (4)                                        | 4 (3)                               | 6                 | 3 (FR-013)                | 120                                | 0                    |
| price-refresh     | 14 (11 · 0 · 3)                       | 0 · 0 · 0 · 0                                  | 2 (0/1/1)                     | 18 (0 + 18)                           | 19 (7)                                        | 2 (0)                               | 1                 | 0                         | 55                                 | 0                    |
| watchlist         | 14 (14 · 0 · 0)                       | 0 · 0 · 0 · 0                                  | 2 (1/1/0)                     | 22 (6 + 16)                           | 9 (1)                                         | 5 (1)                               | 3                 | 1 (FR-005)                | 52                                 | 0                    |
| product-search    | 6 (5 · 1 · 0)                         | 0 · 0 · 0 · 0                                  | 2 (1/0/1)                     | 10 (0 + 10), +6 pending in #45        | 0 (0)                                         | 0 (0)                               | 7                 | 3 (FR-003, FR-004 ×2)     | 36                                 | 0                    |
| sign-in           | 8 (7 · 0 · 1)                         | 0 · 0 · 0 · 0                                  | 1 (0/1/0)                     | 12 (6 + 6)                            | 6 (0)                                         | 7 (3)                               | 0                 | 1 (FR-001)                | 33                                 | 0                    |
| shop-gate         | 6 (5 · 0 · 1)                         | 0 · 0 · 0 · 0                                  | 1 (1/0/0)                     | 9 (0 + 9)                             | 8 (4)                                         | 3 (1)                               | 1                 | 0                         | 18                                 | 0                    |
| platform          | 19 (16 · 0 · 1, plus 2 tooling)       | 0 · 0 · 0 · 0                                  | 2 (0/1/1)                     | 10 (0 + 10); 1 change never reviewed  | 15 (8)                                        | 3 (1)                               | 4 (test strategy) | —                         | 85                                 | 0                    |
| shared            | 14 (14 · 0 · 0)                       | 0 · 0 · 0 · 0                                  | 1 (0/1/0)                     | 10 (0 + 10)                           | 6 (2)                                         | 2 (1)                               | 0                 | —                         | 56                                 | 0                    |
| docs (prose)      | 41                                    | 0 · 0 · 0 · 0                                  | —                             | —                                     | 14 (4)                                        | 1 (0)                               | —                 | —                         | 504 in all (472 above, 32 general) | 5 (PRD 4, roadmap 1) |

Notes on the table:

- **Audit columns.** 2 audit findings point only at framework code (Astro's render and origin check) and 1 at a page the repo lacks (`src/pages/500.astro`) (`evidence`).
- **Counting.** A change, PR or finding counts once for every capability it names, as the scan contract counts commits. So the columns don't add up to the totals: 17 changes, 44 merged PRs, 130 implementation findings and 29 plan-review findings (`evidence`).
- **Findings that span capabilities.** By any path rather than the primary one, the findings per capability are:
  - price-comparison 37
  - price-refresh 22
  - shop-matching 18
  - platform 16
  - shop-integrations 16
  - watchlist 14
  - sign-in 10
  - shared 9
  - shop-gate 8
  - product-search 2

  32 of the 130 name more than one code capability (`evidence`).

- **Change-name mapping.** Changes are mapped to capabilities by the scan contract's scope list, plus two additions the names make plain: `fix-matches-and-watchlist` goes to shop-matching, and `testing-critical-browser-flows` (the e2e harness) to platform (`inference`).

## Friction

Seven signals come out at zero:

- **Reverts:** 0, in subjects and in bodies.
- **Hotfix or rollback subjects:** 0.
- **PRs closed without a merge:** 0 of 45.
- **Bugs:** none in an issue tracker, since the tracker holds 0 issues.
- **Red Workers Builds checks:** 0 on the 44 merge commits. 42 are green, and #28 and #29, merged within a minute of others, have no check.
- **Real CI failures:** 0 (the 8 failed Actions runs are all mechanical, see below).
- **Red CI runs on a feature PR:** 0 (`evidence`).

The friction shows instead in second attempts that the reviews and plans record:

1. **"Unreadable answer read as missing" keeps coming back. It's in shop-integrations first, then price-refresh, price-comparison and shop-matching** (`evidence` for the dates and titles, `inference` for the grouping by class, checked by hand).
   - **Before the lesson.** Lesson 3 ("Never read an unreadable answer as missing") was written on 2026-09-29 from 3 findings in the first reviews (S-02 F1 and F2, S-01 F8).
   - **After the lesson.** 9 more findings (5 of them warnings) came between 2026-09-29 and 2026-10-07:
     - product-page-ui F1
     - etykiety F1
     - Hebe F2, F3 and F4
     - Super-Pharm F1 and F3
     - good-price F3
     - shop-contracts F4
   - **Defects D1–D5.** Then the research for `testing-shop-answer-contracts` (2026-10-07) found 5 more places in the shop adapters (D1–D5), each storing or showing a changed answer as a fact. The change fixed them in 4 planned `fix(...)` commits.
   - **The same bug twice in one week.** "One odd row empties the list" was fixed in `watchlist.ts` after the S-01 review (2026-09-27). It was fixed again in the list's price and decision reads by `7857030` (2026-09-30).
2. **The matching rule's decisions churn (shop-matching)** (`evidence`).
   - **PRD updates.** FR-006 has 6 dated updates between 2026-10-01 and 2026-10-09, and FR-007 has 4. That's 10 of the 20 dated updates on the PRD's FRs (25 in the whole PRD).
   - **The tap, reversed.** S-06 put "Automatic Super-Pharm matches" and "a lookup on a plain view" out of scope on 2026-10-04/05. On 2026-10-06, FR-006's update "supersedes the 2026-10-05 update" and does both.
   - **The name check, corrected.** The match-by-name review's one high-impact warning came on 2026-10-07: F1, "a less specific item passes the name check", which can put a wrong item's price on a page with no flag. It forced another PRD correction the same day. `add-from-other-shops` changed the name check again on 2026-10-09.
   - **Still open.** At HEAD, 2 match-by-name follow-ups are unchecked: sub-line brands, and query rules on lookups.
   - **Plan reviews.** Hebe's plan review found the only critical finding of the 29 plan-review findings. All 4 reviewed plans went from REVISE to SOUND only after triage.
3. **Price-refresh items deferred again and again** (`evidence`).
   - **The full-history read.** Review F4 of `cheapest-shop-today`, the window's other high-impact warning, found that `latest_price_observations` reads the whole deployment's history on every list view. It was deferred to S-04 on 2026-09-29, and S-04 deferred it again under "What We're NOT Doing" on 2026-10-06, adding only a partial index.
   - **The failing shop.** The cheapest-shop-today review deferred "stop asking a shop that keeps failing". It came back as shop-contracts F1, a warning: "two Rossmann products that always fail stall the list refresh" (2026-10-08). It ended as a partial fix plus accepted edge #18.
4. **Stale or open pages show wrong prices (price-comparison, price-refresh)** (`evidence`). 3 warnings, one in each of three changes started between 2026-09-28 and 2026-10-02, each fixed in its own change:
   - cheapest F1: a promotion stays cheapest after it ends.
   - fix-matches F1: a stale page prices a re-pinned item under the old name.
   - Hebe F1: a shop declined in another tab stays „Najtaniej”.
5. **One production incident, in watchlist, closed by platform** (`evidence`).
   - **What happened.** PR #5 (S-01, 2026-09-27) merged before its migration reached production. Every list and add failed with PGRST205 until the owner pushed the migration.
   - **The remedy.** The same day, a CLAUDE.md rule. Then, 9 days later, an automated migration gate in the checked deploy (#34, 2026-10-06). No other production failure is recorded in any rollout note.
6. **Reviews moved after the merge** (`evidence`; the reading of it is `inference`).
   - **Before.** For the 11 changes from #3 to #30, the implementation review's fixes landed inside the feature PR.
   - **From #32 on.** 4 changes were reviewed after the feature merged, and every merge deploys to production. Their fixes followed in close-out PRs:
     - match-by-name, #32 to #39: 17.3 h (its high-impact F1 was live for that long)
     - good-price, #36 to #39: 1.6 h
     - route seams, #40 to #41: 6.0 h
     - shop contracts, #42 to #43: 3.9 h
   - **Still pending.** add-from-other-shops (#44, merged 2026-10-09) has its fixes in the still-open #45: 10 code files, mostly shop-matching.
   - **Never reviewed.** `testing-deploy-and-production-checks`, which built the deploy gate, has no implementation review on record.
7. **Research corrections (shop-integrations)** (`evidence`). The shop research note has 10 commits in the window.
   - 2 earlier claims corrected: Hebe's "wrong EAN" was a wrong size field, and Super-Pharm's key doesn't rotate.
   - 4 dated re-checks against the live shops, with the owner's approval.

## Planning attention

| Capability        | Changes named for it                                                                                      | Plan lines | Research lines | Plan-review F | Impl-review F   | Follow-up items (deferred + accepted) |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ---------- | -------------- | ------------- | --------------- | ------------------------------------- |
| shop-matching     | shop-matching-first-two-shops, fix-matches-and-watchlist, hebe-, super-pharm-in-comparison, match-by-name | 4,788      | 2,114          | 23            | 40              | 6 + 5                                 |
| price-comparison  | cheapest-shop-today, product-page-ui, etykiety-redesign, good-price-judgement                             | 3,716      | 869            | 0             | 39              | 15 + 4                                |
| shop-integrations | hebe-, super-pharm-in-comparison, testing-shop-answer-contracts, add-from-other-shops (open)              | 3,669      | 2,173          | 17            | 26 (+6 pending) | 1 + 3                                 |
| watchlist         | watchlist-add-by-search, fix-matches-and-watchlist                                                        | 1,766      | 476            | 6             | 16              | 3 + 2                                 |
| price-refresh     | cheapest-shop-today, testing-route-and-database-seams                                                     | 1,671      | 862            | 0             | 18              | 3 + 0                                 |
| platform          | testing-critical-browser-flows, testing-deploy-and-production-checks                                      | 1,489      | 734            | 0             | 10              | 0                                     |
| product-search    | watchlist-add-by-search, add-from-other-shops (open)                                                      | 1,390      | 526            | 0             | 10 (+6 pending) | 0                                     |
| shared            | etykiety-redesign                                                                                         | 1,376      | 0              | 0             | 10              | 4 + 4                                 |
| sign-in           | invite-only-access                                                                                        | 1,006      | 392            | 6             | 6               | 2 + 3                                 |
| shop-gate         | polite-shop-access                                                                                        | 443        | 0              | 0             | 9               | 0                                     |

- **Totals** (`evidence`). 17 changes (16 archived and 1 open), with 14,203 plan lines and 5,484 research lines.
  - 13 changes have a research file. The four of W39 and W40 without one are polite-shop-access, shop-matching-first-two-shops, watchlist-add-by-search and etykiety-redesign.
  - 4 have a plan review and 15 have an implementation review.
  - Of the 15 implementation reviews, 14 ended NEEDS ATTENTION and 1 APPROVED (invite-only-access). None had a critical finding: 42 warnings and 88 observations, with 2 high-impact findings in all.
- **Where attention concentrates** (`evidence`). Shop-matching leads on every planning measure: 5 changes, the most plan lines, 23 of the 29 plan-review findings, 63 review findings by name and the most prose churn. Shop-integrations is second on research (2,173 lines).
- **Recent weight** (`evidence`).
  - W41 (2026-10-05 to 2026-10-09) went to the test rollout, which touched platform, price-refresh and shop-integrations. It also took in add-from-other-shops (product-search, shop-integrations), match-by-name (shop-matching) and good-price-judgement (price-comparison).
  - Sign-in, shop-gate, watchlist and shared had no change named for them in W41.
- **Trend by the change's start week** (`evidence`).

  | Week | Findings per review | Warnings per review |
  | ---- | ------------------- | ------------------- |
  | W39  | 9.7                 | 3.0                 |
  | W40  | 8.8                 | 2.8                 |
  | W41  | 7.8                 | 2.8                 |

  Finding counts are drifting down while warnings hold steady.

- **The product page as a hub** (`evidence`). `src/pages/watchlist/[id].astro` is named in 17 of the 130 findings, 12 of them as the primary location. Most of those findings concern matching rules, shop cost or decision handling written in the page. So attribution by location credits price-comparison with friction that, by change name, belongs to shop-matching and price-refresh. The next most named files:
  - `super-pharm.ts`: 7
  - `price-comparison.ts`: 7
  - `watchlist.astro`: 7
  - `shop-gate.ts`: 5
  - `price-refresh.ts`: 5
- **Team rules** (`evidence`). `lessons.md` has 6 lessons, all seeded on 2026-09-29 from the first four reviews and not touched since. Later reviews cite these lessons again (item 1 under Friction).

## Debt markers

- **In code** (`evidence`). `TODO|FIXME|HACK|XXX` occurs 0 times in the tracked non-noise code and config at HEAD: 54,100 lines in 10 capabilities, so 0.00 per 1,000 lines everywhere.
- **In prose** (`evidence`). Prose has 5 markers in 28,429 lines (0.18 per 1,000): the PRD's 4 TODO placeholders for open targets, and 1 in the roadmap.
- **Where the debt lives instead** (`evidence`):
  - **Follow-ups.** 35 items in 7 change folders: 23 deferred to a later change and 12 "accepted, to revisit". By change name:
    - price-comparison 19
    - shared 16
    - shop-matching 11
    - watchlist 5
    - sign-in 5 (anti-framing headers and non-`httpOnly` session cookies among them, older than S-07)
    - shop-integrations 4
    - price-refresh 3
  - **Accepted edges.** `test-plan.md` §7 holds 28: 4 from the plan's creation on 2026-10-02, 6 from rollout Phase 2, 8 from Phase 3 and 10 from add-from-other-shops on 2026-10-09. By name (`inference`):
    - product-search 7
    - shop-integrations 6
    - shop-matching 5
    - test strategy 4
    - watchlist 3
    - shop-gate 1
    - price-comparison 1
    - price-refresh 1
  - **Open checkboxes at HEAD.** There are 7:
    - 2 match-by-name follow-ups
    - S-06's owner phone check, 5.5
    - add-from-other-shops 5.3 and 5.4
    - 2 optional owner items in the deploy plan
  - **The observability audit** (2026-10-05). 37 findings: 5 critical, 10 high, 17 medium and 5 low. Its fixes were listed out of scope in S-06, and no change folder takes them up. The roadmap still says "no error tracking". By primary path:
    - sign-in 7 (3 critical or high)
    - shop-matching 5 (2)
    - watchlist 5 (1)
    - shop-integrations 4 (3)
    - shop-gate 3, platform 3
    - price-refresh 2, price-comparison 2, shared 2

## Mechanical signals

Each signal below was demoted by the false-signal list. It's kept out of risk, for the reason given.

- **Docs churn**: 504 changes and 172 commits (rule 8). Every phase commit updates its plan, so this is attributed above by change name and not ranked.
- **Review-fix commits**: 14 of the 23 `fix` commits (rules 5 and 12).
  - They are the workflow's own triage, and 14 of the 23 fix commits touch more than 3 capabilities (13 without docs).
  - That spreads them into small capabilities. Sign-in's fix share of 35% (6 of 17 commits) is all review fixes, 5 of the 6 from other changes' reviews that touched `middleware.ts` or `scripts/smoke.mjs`. Shop-gate's 40% is 2 review fixes plus 2 planned contract fixes.
  - The only fixes outside the workflow are 5:
    - `fix(price-track)` #28 (price-comparison)
    - `fix(search)` #31 (product-search)
    - the odd-row fix `7857030`
    - 2 tooling fixes in W39
- **Planned "fix" commits**: the 4 phase commits of `testing-shop-answer-contracts` are labelled `fix` because they fixed D1–D5. They are real defects found by planned tests, not reactive fixes, and are counted apart.
- **CI red runs**: 8 of the 180 Actions runs (rule 5). None is a real failure:
  - 2 on 2026-09-23 (the first deploy's lockfile, by trial and error)
  - 1 on the course-tooling PR #2 (the vendored `.claude` folder tripped ESLint)
  - 4 on 2026-10-05, where four PRs merged within a minute and every job was cancelled, not failed
  - 1 on 2026-10-06: the deploy check's deliberate red test, item 4.5 of its plan
- **PR size and age.** Forge additions are inflated by recorded fixtures and the vendored course files: #44 shows 24,044 added lines on the forge against 7,844 counted lines, and #2, #11 and #27 show 5.5–7.7k against at most 114 counted. Time open (a median of 1.2 h, 3.9 h for feature PRs, at most 36.4 h for #9) measures CI time and the owner's merge timing, since there is no reviewer.
- **Team size** (rule 6). One human author is the baseline, so "no human review" can't be a reviewer bottleneck: no one else exists to review.
- **Growth** (rule 4). Shop-matching and shop-integrations are busy, heavily planned and much discussed partly because Hebe, Super-Pharm, name matching and other-shop products were being built in W40 and W41. That shared cause is counted once. The decision reversals in Friction, items 1 to 3, are not growth.
- **Names.** `fix-matches-and-watchlist` is a planned roadmap slice (S-08), not a bug-fix PR. #31's search wording, which named Rossmann only, was superseded three days later by the four-shop search. That's a change of scope, not friction.

## Unknowns

- **Production errors** (`unknown`). The repo uses no error tracker: the audit says "Error tracker: none" and the roadmap says "no error tracking". Workers Logs (about 7 days of retention, per the audit) weren't read. Production failures beyond the one recorded incident are invisible to this run.
- **Bugs and conversation** (`unknown`). The issue tracker is enabled but unused (0 issues). Bugs and decisions exist only where a plan, review or rollout note recorded them, or as "the owner's call" in the PRD. The owner's sessions with the agent, where much of the discussion happens, aren't in the repo.
- **The reviews themselves** (`unknown`). The in-repo reviews are agent-run and owner-triaged, not independent human review, so how much they miss is unknown. One change (`testing-deploy-and-production-checks`) has no review at all.
- **Attribution limits** (`inference`).
  - Findings were attributed by their Location paths. Plan-review findings, follow-ups and §7 edges were attributed by name.
  - The recurring-class groupings in Friction come from titles, by hand.
  - Workers Builds was read as each merge commit's latest check, so a red build later retried green wouldn't show. The deliberate red test on `4c49096` now reads green.
- **Not counted** (`unknown`). The open PR #45 lies outside HEAD and outside every total: its review has 6 findings, and its fixes touch 10 code files.
- **No installs.** None were needed: `git grep` stood in for `rg`, and `gh` was installed.

## Commands run

- `node context/map/.work/attribute.mjs`, and the same with `commits` (output to `.work/discussion-commits.tsv`)
- `git log --merges` / `rev-list merge^1..merge^2` / `diff --numstat -M -z` (`.work/discussion-prs.mjs`, output to `discussion-prs-mapped.{json,tsv}` and `discussion-direct-commits.tsv`)
- `git log` subject and body greps for revert, hotfix, rollback and fix (`.work/discussion-fixes.txt`)
- `gh pr list --state all --json number,title,createdAt,mergedAt,closedAt,state,reviews,comments,additions,deletions,changedFiles,headRefName,author,isDraft` and `--json number,body,headRefName` (lengths only)
- `gh issue list --state all`, `gh repo view --json hasIssuesEnabled,…`
- `gh run list --json workflowName,headBranch,conclusion,event,createdAt,status,attempt`; `gh run view --json jobs` (job and step names) for the 5 failed runs since 2026-10-05
- `gh api repos/…/commits/<merge sha>/check-runs` with names and conclusions only: once per PR merge commit (44), plus one sample on HEAD
- `git log`/`git diff f087611...chore/close-add-from-other-shops` and `git show <branch>:…/impl-review.md` for the open PR #45
- `.work/discussion-findings.mjs`: implementation-review findings, through `capabilityOf()` on their Location paths
- `.work/discussion-audit.mjs`: the audit's findings, by primary path
- `.work/discussion-markers.mjs`: `git grep -c -E 'TODO|FIXME|HACK|XXX'` and line counts at HEAD, through `capabilityOf()` and `isNoise()`
- `grep`/`awk`/`sed` over review headers, triage lines, follow-ups, `test-plan.md` §7 and its `git log -p`, the PRD's dated updates, `lessons.md` and the change folders' sizes
