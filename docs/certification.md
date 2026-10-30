# Certification submission: Drogeria Radar (10xDevs 4.0)

The owner's write-up for the certification form, with every claim pointed at its evidence in this repository: a path, a pull request number or a date. The repository is public (`github.com/yaroslavkhudchenko/10xcourseproject`), so no collaborator needs adding.

**What to paste where.** The form has one space for the mandatory part and one for each extra block: paste `## Project` and `## 10xBuilder (mandatory)` into the mandatory part, `## 10xArchitect` into the Architect block and `## 10xChampion` into the Champion block. `## Numbers` fits wherever the form asks for a summary. The form is submitted once, with every block that is ready, before 4 November 2026, 23:59 (the first deadline, the only one with a distinction).

**Before submitting, the owner:**

- [ ] merges PR #59 (the AI code review); the Champion block below is written as true once it's merged;
- [ ] checks that production is up: the Supabase Free project pauses after 7 idle days (`context/deployment/deploy-plan.md`, "Free-plan behaviour"), so sign in once a week until 18 November 2026, when the two-week assessment window closes;
- [ ] has the public URL at hand: it is not in this file, by the repository's rule;
- [ ] sets the GitHub repository's description and topics (both empty on 2026-10-21);
- [ ] fills the form once, with Builder, Architect and Champion together.

## Project

Drogeria Radar is a private, invite-only web app for a handful of people who buy the same drugstore products again and again. For each product on a user's watchlist it shows which of four Polish drugstore chains (Rossmann, Hebe, Super-Pharm, Drogerie Natura) sells it cheapest online today, with the regular and promo price, the Omnibus 30-day low, the age of every price and a judgement of whether today's price is a good one. Before it, the owner checked two or three shop sites by hand before every purchase, because comparison sites skip these chains (Rossmann isn't on Ceneo). The prices come from the shops' own public search endpoints, researched and recorded in `docs/research/polish-drugstore-price-apis.md`; dm was dropped on 2026-09-24 because its search refuses traffic from Cloudflare Workers, and the app never works around a shop's bot protection. The stack is Astro 7 SSR with React 19 islands, TypeScript and zod, Tailwind 4 with shadcn/ui, and Supabase (Postgres, Auth, row-level security), deployed to Cloudflare Workers through Workers Builds on every merge to `main`. The interface is in Polish. The project was shaped on 2026-09-19, bootstrapped from the 10x Astro starter on 2026-09-20, first deployed on 2026-09-23, and its two milestones closed on 2026-10-09 (M-1, the usable price radar) and 2026-10-11 (M-2, one guardian for a product's shop decisions).

## 10xBuilder (mandatory)

### Access control

- Email and password sign-in through Supabase Auth, in Polish, on plain forms that work without JavaScript: `src/pages/auth/signin.astro`, `src/pages/api/auth/signin.ts`, rules in `src/lib/services/auth.ts`.
- Invite-only (PRD FR-001): the app has no sign-up page and sends no email. The owner creates accounts in the Supabase dashboard or makes one-time invite and recovery links with `scripts/owner-link.mjs`, which the pages `src/pages/auth/confirm.astro` and `src/pages/auth/set-password.astro` consume (S-07 `invite-only-access`, PR #25, 2026-10-05; archived in `context/archive/2026-10-04-invite-only-access/`).
- `src/middleware.ts` builds the request's Supabase client and redirects a signed-out request on any `PROTECTED_ROUTES` path to sign-in, with the list or the product as the way back.
- Privacy is enforced in the database, not only in queries: every table in `supabase/migrations/` has RLS and explicit per-role grants. Watchlists and shop decisions are private per user; price observations are shared only by the users who watch the same shop item (`20260928011450_price_observations.sql`).
- Proven by `scripts/check-watchlist-db.mjs`, `check-matches-db.mjs` and `check-prices-db.mjs` (two throwaway users against the RLS policies and grants), `check-catalog-db.mjs` (every table has RLS and every function its reviewed protection), `scripts/check-two-users.mjs` (a second user through every route over HTTP) and `scripts/check-production.mjs`, which after each deploy proves, signed out, that production still refuses sign-up.

### CRUD, as the domain needs it

- Create: the list's search (`src/pages/watchlist.astro`, `src/lib/services/product-search.ts`) asks all four shops at once; "Dodaj" posts to `src/pages/api/watchlist.ts` and stores the product in `watchlist_items` (S-01 `watchlist-add-by-search`, PR #5; `add-from-other-shops`, PR #44).
- Read: the list (`/watchlist`) reads stored prices through the view `latest_price_observations`; a product's page (`src/pages/watchlist/[id].astro`) reads `price_summaries`, with the price history for the judgement.
- Update: each product is matched once in each other shop, and the user confirms, declines, re-pins or retries a match through `src/pages/api/watchlist/matches.ts`; the decision is saved in one atomic statement, `record_decision` (`20261010190000_decision_store_backstop.sql`). Prices are refreshed on demand through `src/pages/api/watchlist/prices.ts` and `refresh.ts`, which append to the append-only `price_observations`.
- Delete: `src/pages/api/watchlist/remove.ts`, behind a confirm that works without JavaScript, deletes the user's own product and, through the cascade, their decisions for it, never a shared price observation (PRD FR-005; S-08, PR #17).
- 9 migrations in `supabase/migrations/`, each with RLS, grants and bounds that mirror `src/lib/services/product-limits.ts`.

### Business logic

- The cheapest shop and the freshness rules live in one pure, tested module, `src/lib/services/price-comparison.ts` (`verdictOf`): a price is stale after 24 hours, and only a fresh price orderable online can be named cheapest; a failed fetch shows the last price with its age or a gap, never a blank or a zero (PRD FR-010, FR-011; S-03 `cheapest-shop-today`, PR #9).
- The good-price judgement (`judgementOf`, PRD FR-012): "Dobra cena!" or "Zwykła cena" against the cheapest shop's declared 30-day low, or, once the product has 30 days on the list with prices on 5 days, against its own history (S-04 `good-price-judgement`, PR #36).
- Cross-shop matching in `src/lib/services/matching.ts` (`pickMatch`): a single candidate with the same EAN and size and a brand that doesn't differ is accepted automatically; where EANs can't decide, as for Super-Pharm, a strict name check may; the user decides the rest and a suspicious match is flagged (PRD FR-006, FR-007; PRs #7, #23, #30, #32).
- Polite shop access in `src/lib/services/shop-gate.ts`: every shop request goes through one gate with a per-shop cap for the whole deployment (30 requests in any 60 seconds), kept in Postgres, which pauses a shop after a 429 and stops it after a 403 or a bot challenge (F-01 `polite-shop-access`, PR #3).
- Four shop adapters in `src/lib/services/shops/`, tested against 45 recorded answers in `fixtures/`; no test ever reaches a live shop.
- Not built, by the PRD's own priorities: manual price entry (FR-009), the shop status page (FR-014) and the daily automatic refresh (FR-015) are nice-to-have and outside the MVP; the other 12 requirements are delivered.

### Context documents

- `context/foundation/shape-notes.md` (2026-09-19), `prd.md` (15 functional requirements with the owner's dated decisions), `tech-stack.md`, `infrastructure.md` (platform comparison, risk register), `roadmap.md` (milestones M-1 and M-2 with their slices), `test-plan.md`, `test-stack.md`, `lessons.md`.
- `context/deployment/deploy-plan.md`: the deployment runbooks, from the first deploy to the checked deploys and the owner's links.
- `docs/research/polish-drugstore-price-apis.md`: the shop endpoints, response shapes, quirks and dead ends, with every live probe dated.
- `context/archive/`: 23 archived changes: 21 shipped (2026-09-26 to 2026-10-10), each with its `change.md` and `plan.md`, and the two Module 4 research notes (the flow analysis and the refactor ranking); 19 with a `research.md`, 20 with `reviews/impl-review.md` and 6 with a `reviews/plan-review.md`.
- `CLAUDE.md`: the rules and architecture an agent reads before any change; `README.md` describes the product, setup, testing and deployment.

### Tests from the user's perspective

- 10 Playwright specs in `tests/e2e/`, each one user flow on a phone-sized Chromium (390 × 844, touch) against the production build on the Cloudflare runtime, with a local Supabase and every shop held so no live shop is reached: for example `seed.spec.ts` (a signed-in shopper reaches their own list), `price-honesty.spec.ts` (only a fresh price sold online is marked cheapest, every price shows its shop and age), `phone-refresh.spec.ts`, `phone-remove-product.spec.ts`, `phone-decline-match.spec.ts`, `good-price.spec.ts`. Each run signs a throwaway user up and in through the real sign-in form (`auth.setup.ts`).
- `scripts/smoke.mjs` walks the auth flow over HTTP; `scripts/check-two-users.mjs` proves one user gets nothing of another's through any route.
- 3,004 unit and integration tests in 45 Vitest files (`npm run test`), plus 15 cases against the real local database (`npm run test:db`).
- CI (`.github/workflows/ci.yml`) runs all of it in three jobs, `ci`, `smoke` and `e2e`, which the `preventFailedDeploy` ruleset requires before a merge.

### Public URL

The public URL (the owner adds it in the form). Production runs on Cloudflare Workers since 2026-09-23 and deploys from every merge to `main` through a checked deploy (`scripts/deploy-checked.mjs`), which refuses code whose migration production lacks and checks production after the deploy.

### How AI was used in the process

- The whole project followed the 10xDevs AI Toolkit workflow with Claude Code: `/10x-shape` → `/10x-prd` → `/10x-tech-stack-selector` → `/10x-bootstrapper` (`context/changes/bootstrap-verification/verification.md`, 2026-09-20) → `/10x-infra-research` → `/10x-roadmap`, then for each change `/10x-new` → `/10x-research` → `/10x-plan` (with `/10x-plan-review` on the riskier ones) → `/10x-implement` or `/10x-tdd` → `/10x-impl-review` → `/10x-archive`. The 21 archived folders are that record.
- `CLAUDE.md` is the rules file: the non-negotiables (invite-only, RLS, honest prices, the shop gate, no secret key anywhere), the commands and the architecture, grown with every change and reviewed by `/10x-rule-review` (`context/audits/rules/claude-md.md`).
- Claude Code hooks (`.claude/settings.json`, `.claude/hooks/`) lint every edited file and, at the end of each turn, run ESLint, the whole Vitest suite and `astro check` on the agent's changes, in every git worktree the session touched (PR #22, PR #58; `scripts/agent-hooks.test.mjs`).
- Independent changes ran as parallel agents in sibling git worktrees, each on its own branch and pull request; the hooks were taught to follow them there (PR #58).
- The UI was brought under a design-system contract with `/10x-ui` (`product-page-ui`, PR #13, 2026-09-30) and then redesigned from a Claude Design handoff (`etykiety-redesign`, PR #15, with the handoff kept in `context/archive/2026-09-30-etykiety-redesign/handoff/`): tokens in `src/styles/global.css`, ESLint rules that refuse palette classes and arbitrary values in the views (`tokenConfig` in `eslint.config.js`), and `scripts/check-token-contrast.mjs` in CI.
- `context/foundation/lessons.md` keeps six recurring rules distilled from the implementation reviews, which later research, plans and reviews re-read.
- Shop recordings and live probes were made one at a time with `curl`, with the owner's approval and dated in the research note; no test or CI run reaches a live shop.

## 10xArchitect

Modules 3 and 4, applied to this project after M-1's first slices.

- **Risk-first test plan and its four rollout phases** (`context/foundation/test-plan.md`, PR #19, 2026-10-02): 7 risk scenarios, each with what would prove protection and the cheapest layer. Phase 1, critical flows in a real browser (Playwright, PR #20, 2026-10-02); Phase 4, deploy and production checks (the migration gate, the signed-out production check and the `Deploy check` workflow that emails a red deploy, PR #34, 2026-10-06); Phase 2, route and database seams (the two-user check, the catalogue check, the database tests, PR #40, 2026-10-07); Phase 3, shop answer contracts (deliberately broken copies of the recordings, which found five defects in merged code, PR #42, 2026-10-08). Each phase is an archived change under `context/archive/2026-10-0*-testing-*/`.
- **Agent hooks** (`/10x-configure-hook`, PR #22, 2026-10-02; worktrees in PR #58, 2026-10-18): per-edit lint and an end-of-turn sweep, as described above.
- **E2E setup** (`/10x-e2e-setup`, then `/10x-e2e`): `playwright.config.ts` builds and serves the production preview itself, refuses any Supabase but the local stack, and holds every shop for the run (`scripts/e2e-local-db.mjs`); `context/foundation/test-stack.md` records it. The `e2e` job became a required check on 2026-10-02.
- **Observability audit** (`/10x-observability-audit`, `context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md`, PR #29): 37 findings (5 critical, 10 high, 17 medium, 5 low) across prices, sign-in and watchlist writes, with a ten-step fix order. Its finding P6, a refreshed price shown as stored when its save failed, shipped as `unstored-price-check` (PR #51, archived PR #53, 2026-10-10). The rest is recorded, not yet done.
- **Rule review** (`/10x-rule-review`, `context/audits/rules/`, PR #48, 2026-10-10): `CLAUDE.md` scored 1 OK, 1 warning, 3 fails (11,134 words, 18 redundant rules, three critical rules buried near the end), with three actions proposed; an `AGENTS.md` draft from `/10x-agents-md` scored 4 OK, 1 warning. The owner kept `AGENTS.md` as a one-line pointer to `CLAUDE.md`, and the proposed split of `CLAUDE.md` into nested files is recorded, not applied.
- **Repository map** (`/10x-repo-map`, `context/map/repo-map.md` with `evidence/`, PR #46, 2026-10-09): eight business capabilities ranked by criticality and buzz from git history, pull request discussion, the import graph (TypeScript and Astro compilers) and people; five risk zones and a first-day reading list.
- **Flow analysis with ast-grep** (`context/archive/2026-10-10-price-refresh-flow-analysis/research.md`, PR #48, 2026-10-10): a price refresh traced from the shop through the gate and `price_observations` to the screen, 27 technical-debt items, and every structural claim checked with ast-grep 0.50.
- **Refactor opportunities** (`context/archive/2026-10-10-refactor-opportunities/research.md`, PR #48): the 27 items classified (15 structural candidates), three ranked opportunities with target shapes and sequencing against M-2, and 56 claims re-verified with ast-grep (50 confirmed, 6 refined, 0 refuted). The ranking is a proposal for a later planning session; of the list, the defect TD-02 is what shipped as `unstored-price-check`.
- **Domain distillation and glossary** (`/10x-domain-distillation`, `context/domain/domain-distillation.md`, `glossary.md`, `evidence/`, PR #46, 2026-10-09): 71 Core and Supporting terms with their sources in the documents and the code, two Core subdomains, 18 rules of the watched product with where each is enforced, one documented drift (D-01, what „Do sprawdzenia” holds) and a ranking of five candidates. The glossary's terms are used in the code and plans since.
- **Invariant-aggregate refactor, implemented as milestone M-2** (`context/domain/02-invariant-aggregate-refactor.md`, 2026-10-09; `context/foundation/roadmap.md`): the plan lists 13 invariants of a product's shop decisions, finds the own-shop rule re-derived in eight places on read and checked nowhere on write, and designs one guardian. M-2 shipped it in three slices: S-01, decisions posted from a product's page pass the guardian (`admitDecision` in `src/lib/services/watched-product.ts`, PR #47, 2026-10-10); S-03, the page's lookups go through the same guardian from one loaded product (`admitLookup`, `loadWatchedProduct`, PR #52); S-02, the database backstop, a trigger that refuses a decision in the product's own shop and `record_decision`, which saves every decision in one statement (`supabase/migrations/20261010190000_decision_store_backstop.sql`, PR #55; milestone closed 2026-10-11, PR #56). Nothing the user sees changed; the e2e suite ran unchanged as the proof.
- **Anti-corruption layer plan** (`context/domain/03-anti-corruption-layer.md`, 2026-10-10): a five-phase plan to put the Supabase client SDK behind a `Backend` port with an adapter in `src/lib/supabase/`. Written, reviewed for sequencing against M-2, and not implemented: its progress list is empty and `src/lib/supabase/` doesn't exist.

## 10xChampion

Module 5, lessons 2 and 3: an AI code review in CI, built as a full 10x change (`context/changes/ci-cd-code-review/`: `change.md`, `requirements.md`, `research.md` of 2026-10-16, `plan.md`, `plan-brief.md`, `reviews/plan-review.md` of 2026-10-17 with 1 critical and 4 warnings, all fixed in the plan). It is PR #59, opened 2026-10-18. [Owner: confirm PR #59 is merged before pasting this block.]

- **What it does.** `.github/workflows/ai-review.yml` reviews every pull request to `main` once it is ready for review, and on each later push. The reviewer reads the title, description and diff, scores six criteria from 1 to 10 (correctness, idiomaticity, complexity, test and risk coverage, documentation, security), gives a binding `pass`/`fail` verdict and a summary, keeps one comment per pull request up to date, labels it `ai-cr:passed` or `ai-cr:failed`, and fails the `review` check on `fail`. Adding `ai-cr:review` runs it again. A pull request that changes only documents or recorded answers passes with "Nothing to review" and no model call.
- **How it is built.** A composite action, `.github/actions/ai-reviewer/`, with its own package and lockfile: AI SDK 7's `ToolLoopAgent` with a zod schema as structured output (`src/reviewer.ts`, `src/review-schema.ts`), through OpenRouter, run by Node 24's type stripping with no build step. Its decisions are pure, tested modules: the diff filter and size limit (`src/diff.ts`), the prompt, the answer check and the comment. 131 tests (`node --test`) drive it with a mock model and a stub fetch, and CI's `ci` job runs its install, tests and type check.
- **Cost and safety decisions.** The check is advisory, outside the `preventFailedDeploy` ruleset, so a missing key or a provider outage never blocks a merge or a deploy; the runbook says what has to change before it becomes required. Drafts are skipped (about 1.1 reviews per pull request instead of 3.3). One repository secret, `OPENROUTER_API_KEY`, a dedicated key with a small credit limit; before it, CI had none. Requests go only to endpoints that support structured output and don't collect prompts (`require_parameters`, `data_collection: "deny"`). Each call is bounded at 8,000 output tokens and 120 seconds, with one retry for an invalid answer and a 10-minute job. Actions are pinned by commit SHA, the checkout token isn't persisted, `GH_TOKEN` reaches only the steps that call `gh`, the reviewer's dependencies install with `--ignore-scripts`, and untrusted pull request text enters scripts only through the environment. Plans, research, the 10x CLI's files, recorded shop answers and lockfiles are left out of the diff, which cuts a typical review from about 33k to 7k tokens.
- **The eval.** `eval/promptfooconfig.yaml` runs the real reviewer on three models and four planted diffs (a React 16 → 19 migration with three bugs, a SQL injection, a bypass of the shop gate, and a clean refactor that must pass), graded with `is-json`, a hard check of the verdict and an LLM rubric, through pinned promptfoo with telemetry off, locally with the owner's key. The default model stays the lesson's until the eval decides.
- **The runbook.** `context/deployment/deploy-plan.md`, "AI review (ci-cd-code-review)": the key's creation and rotation, what a red `review` means, how to switch it off and how to make it required.
- **Scope note.** Lessons 1, 4 and 5 of module 5 weren't applied to this project; publishing the reviewer as a package of its own (lesson 4's territory) was explicitly left out of the plan.

## Numbers

Counted on 2026-10-22 at `main` (cb9d42a) with the pre-submission housekeeping pull request included (the LICENSE, the error pages and the two archived research notes); the commands are at the end of this file.

| What                       | Count                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Merged pull requests       | 58 (#1 on 2026-09-24 to #58 on 2026-10-18); PR #59 is the AI review                                              |
| Archived changes           | 23 (21 shipped, 2 research-only), with 21 plans, 19 research notes, 20 implementation reviews and 6 plan reviews |
| Database migrations        | 9                                                                                                                |
| Functional requirements    | 12 of the PRD's 15 delivered; the 3 nice-to-have ones (FR-009, FR-014, FR-015) are outside the MVP               |
| Unit and integration tests | 3,004 in 45 Vitest files, plus 15 cases against the local database and 131 tests of the AI reviewer              |
| E2E specs                  | 10 Playwright specs, one user flow each, plus the sign-in setup and the shops' teardown                          |
| Check scripts              | 10 `scripts/check-*.mjs` (5 database contracts, two users, production, migrations, fonts, contrast)              |
| CI jobs                    | 3 required (`ci`, `smoke`, `e2e`), the `Deploy check` workflow, and the advisory `review` (PR #59)               |
| Recorded shop answers      | 45 fixtures, no live shop in any test                                                                            |
| Commits on `main`          | 294, merges included, on 20 days                                                                                 |
| Days from the first commit | 32 to this write-up (2026-10-22); 45 to the first deadline (2026-11-04)                                          |

<!-- how the numbers were counted (Git Bash, at the repository root; PR #59's counts in its branch's worktree)
gh pr list --state merged --limit 100 --json number,mergedAt --jq 'length'          # 58
ls -d context/archive/*/ | wc -l                                                    # 23
ls context/archive/*/plan.md | wc -l; ls context/archive/*/research.md | wc -l      # 21, 19
ls context/archive/*/reviews/impl-review.md | wc -l                                 # 20
ls context/archive/*/reviews/plan-review.md | wc -l                                 # 6
ls supabase/migrations/*.sql | wc -l                                                # 9
npx vitest run --reporter=dot                                                       # 45 files, 3004 tests
grep -c '^\s*it(' src/lib/services/matches.db.test.ts                               # 15
cd .github/actions/ai-reviewer && node --test                                       # 131 (PR #59)
ls tests/e2e/*.spec.ts | wc -l                                                      # 10
ls scripts/check-*.mjs | grep -v '\.test\.mjs' | wc -l                              # 10
ls src/lib/services/shops/fixtures | wc -l                                          # 45
git log --oneline | wc -l; git log --format=%ad --date=short | sort -u | wc -l      # 294, 20
git log --reverse --format=%ad --date=short | head -1                               # 2026-09-20
-->
