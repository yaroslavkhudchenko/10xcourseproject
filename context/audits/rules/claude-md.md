---
type: rule-review
date: 2026-10-10
mode: review
file: CLAUDE.md
commit: 5eefce2
branch: docs/m4-course-lessons
dirty_tree: true # only this run's AGENTS.md; CLAUDE.md is byte-identical to 5eefce2
skill: /10x-rule-review
scope: the whole file; the 10x CLI block (lines 75-99) is counted but excluded from every fix
reorder: not applied # Check 5d's question had no one to answer it, so its default, "leave the suggestion in the report", was taken
previous_report: null
verdicts: { ok: 1, warn: 1, fail: 3 }
---

# Rule Review — CLAUDE.md

**Overall:** Precise and front-loaded, but heavy: 11,134 words on 76 long lines (plus 14,402 imported), 58% of them in three Architecture paragraphs that partly restate the imported documents, and three critical rules buried near the end; it needs a split.

## Scorecard

| #   | Check               | Verdict | Score                                                                                 |
| --- | ------------------- | ------- | ------------------------------------------------------------------------------------- |
| 1   | Length              | FAIL    | 76 non-blank lines, 669 at 120 columns (11,134 words, plus 14,402 imported)           |
| 2   | Direct snippets     | OK      | 0 flagged blocks                                                                      |
| 3   | Precise language    | WARN    | 3 vague phrases                                                                       |
| 4   | Redundant knowledge | FAIL    | 18 redundant rules                                                                    |
| 5   | Rule ordering       | FAIL    | Non-negotiables lead, but three critical rules sit at 120-column lines 560–645 of 669 |

## Findings

### 1. Length — FAIL

- 99 lines, 76 of them non-blank: 59 above the 10x CLI block and 17 inside it (`CLAUDE.md:75-99`). By the line count alone that would be OK.
- The line count hides the length, because every bullet is one physical line, the longest 3,041 words long. Wrapped at the repository's 120 columns (`printWidth`, `.prettierrc.json:5`; `CLAUDE.md` itself is in `.prettierignore:5`), the non-blank lines come to 669, 645 of them above the course block: past the FAIL line of 501. The file is 11,134 words and 72,671 bytes. The verdict uses the wrapped count, since the check measures the context every session pays for.
- Words by section: Project 155, Non-negotiables 706, Commands 2,318, Architecture 7,105 (64%), Tooling and repository conventions 570, the 10x CLI block 263, the title and its sentence 17.
- The longest paragraphs, with their lines at 120 columns:
  - `CLAUDE.md:59` "**Shops and matching**: `PRICED_SHOPS` in…": 3,041 words, 166 lines.
  - `CLAUDE.md:58` "**UI**: `/watchlist` is the main screen…": 2,551 words, 152 lines.
  - `CLAUDE.md:60` "**Data**: migrations go in `supabase/migrations/`…": 881 words, 49 lines.
  - `CLAUDE.md:21` "Every shop request goes through `gate.fetch`…": 256 words, 14 lines.
  - `CLAUDE.md:46` "`npx playwright test` — the Playwright e2e suite…": 248 words, 14 lines.
  - `CLAUDE.md:56` "**Sign-in and links**: the auth pages…": 248 words, 16 lines.
  - `CLAUDE.md:48` "`SUPABASE_URL=<project URL> APP_URL=<app origin> node scripts/owner-link.mjs`…": 223 words, 13 lines.
- The imports add more. Claude Code reads an `@path` outside code spans in `CLAUDE.md` as an import, so `CLAUDE.md:11-13` load four more files into every session: `context/foundation/prd.md` (6,248 words), `docs/research/polish-drugstore-price-apis.md` (6,738), `context/foundation/tech-stack.md` (224) and `README.md` (1,192), 14,402 words beyond the file's own.
- Split the per-area paragraphs into nested files next to their code, and replace restated documents with pointers (Top 3 actions 1 and 2).

### 2. Direct snippets — OK

- None flagged: the only fenced block (`CLAUDE.md:81-83`) is the course block's one-line flow diagram, and the inline code is commands and one-line patterns.

### 3. Precise language — WARN

- `CLAUDE.md:21` — "Callers read an `ok` body promptly" → "Read an `ok` answer's body (`json()` or `text()`) before awaiting any other request: the gate's 8 s timeout (`DEFAULT_TIMEOUT_MS`, `src/lib/services/shop-gate.ts:21`) covers the body."
- `CLAUDE.md:46` — "Give the command a timeout of several minutes" → "Run `npx playwright test` in the background or with a timeout of at least 10 minutes **(assumed)**: its `webServer` build and preview alone may take 180 s (`playwright.config.ts:63`)."
- `CLAUDE.md:58` — "Astro components for static markup, React only where interactivity is needed" → "A new `.tsx` component is either a shadcn component in `src/components/ui/` or a module of an island hydrated with `client:*` and listed in `islandConfig` (`eslint.config.js:94`); all other markup is `.astro`."

### 4. Redundant knowledge — FAIL

The documents `CLAUDE.md:11-13` import are in the session already, so a passage restating them is read twice; `CLAUDE.md:9` itself says not to restate them.

- `CLAUDE.md:3` — the `/init` sentence ("This file provides guidance to Claude Code…") tells the agent what the file is → delete.
- `CLAUDE.md:33` — the lint and format scripts restate `package.json:10-12` → replace with `@package.json`.
- `CLAUDE.md:35` — the smoke test's contract restates `README.md:168-179` → replace with `@README.md`, keeping "refuses any Supabase but the local stack".
- `CLAUDE.md:46` — how a run holds the shops, refuses an occupied port and needs Docker restates `context/foundation/test-plan.md:161-189` (§6.3) and `playwright.config.ts:53-70` → replace with the §6.3 pointer, keeping "Never pass `--no-deps`" and the `restore` after a killed run.
- `CLAUDE.md:47` — the local stack's ports and Studio are the Supabase CLI's defaults, written down in `README.md:78-113` → delete them, keeping the `migration up --local` and `--linked` rule.
- `CLAUDE.md:48` — the owner's link procedure, 223 words for a script only the owner runs with a key no agent may hold, restates `context/deployment/deploy-plan.md:392-438` ("Accounts and links (S-07)") → replace with that pointer.
- `CLAUDE.md:49` — the deploy pipeline restates `context/deployment/deploy-plan.md:308-391` ("Checked deploys (rollout Phase 4)") and `README.md:155-166` → replace with the pointer, keeping "A manual `npx wrangler deploy` is for emergencies only".
- `CLAUDE.md:53` — "`output: "server"`, so every page and API route renders on demand" is what the option at `astro.config.mjs:28` means → delete the clause.
- `CLAUDE.md:55` — "export uppercase handlers (`export const POST: APIRoute`)" is Astro's endpoint convention → delete the clause.
- `CLAUDE.md:57` — short-lived requests and Cron Triggers are platform knowledge, `nodejs_compat` is `wrangler.jsonc:6`, and the FR-015 note restates `context/foundation/tech-stack.md` → replace with `@wrangler.jsonc`.
- `CLAUDE.md:58` — "Tailwind 4 through the Vite plugin with no `tailwind.config`", "In `.astro` files these React components render as static HTML without `client:*`" and "Path alias `@/*` maps to `src/*`" (`tsconfig.json:8-10`) are framework defaults and config → delete.
- `CLAUDE.md:58` — the good-price comparison ("The comparison is the cheapest shops' declared 30-day low until…") restates PRD FR-012 (`context/foundation/prd.md:158-169`) → replace with an FR-012 pointer.
- `CLAUDE.md:59` — the shops' fields restate the research document: Hebe's legal-name size, sets and `online_flag` (`docs/research/polish-drugstore-price-apis.md:122-135`), Super-Pharm's `capacity`, `in_stock` and `inStoreOnly`, 20-id batches and `enableRules=false` (`:186-203`), and the rejected tracker id (`:327`) → replace with section pointers (§2.1–§2.5), keeping only the code's names.
- `CLAUDE.md:59` — the matching rule's owner calls ("Dr Irena Eris", "Cosmic Black", "SPF15", the caption-less products) restate PRD FR-006 and FR-007 (`context/foundation/prd.md:117-138`), and "Two edges of the gate and the search are accepted" restates `context/foundation/test-plan.md:413-414` → replace with pointers.
- `CLAUDE.md:60` — "Accepted risks, to revisit before inviting more people" restates `context/foundation/test-plan.md:415-416` (the ABA case, the id probe) → replace with the §7 pointer, once the fake-price risk, which §7 lacks (only `context/foundation/lessons.md:36` and the archived S-03 plan mention it), has moved into §7.
- `CLAUDE.md:64` — the pre-commit globs restate `package.json:63-70` and `.husky/pre-commit` → replace with `@package.json`, keeping "a lint error blocks the commit".
- `CLAUDE.md:66` — "Prettier uses 120 columns and sorts Tailwind classes" restates `.prettierrc.json:5-7` → replace with `@.prettierrc.json`, keeping "let it reorder them".
- `CLAUDE.md:68` — the job-by-job CI list restates `.github/workflows/ci.yml` and `README.md:181-189` → replace with `@.github/workflows/ci.yml`, keeping "keep Cloudflare tokens and Supabase keys out of GitHub" and the `Deploy check` workflow.

### 5. Rule ordering — FAIL

Current order (5a):

1. `# CLAUDE.md` (line 1)
2. `## Project` (line 5)
3. `## Non-negotiables` (line 15)
4. `## Commands` (line 26)
5. `## Architecture` (line 51)
6. `## Tooling and repository conventions` (line 62)
7. `## 10xDevs AI Toolkit - Module 4, Lesson 1 (Context at Scale)` (line 77, inside the 10x CLI block, lines 75–99)

Comments (5b):

1. `# CLAUDE.md` — INTRO: one `/init` sentence (`:3`), no rule.
2. `## Project` — USEFUL and REFERENCE: an 85-word frame (`:7`) and the four canonical documents (`:11-13`), which load as imports.
3. `## Non-negotiables` — CRITICAL: eight rules in 706 words; `:21` spends 256 words of gate mechanics on a one-line rule.
4. `## Commands` — USEFUL, 2,318 words, with CRITICAL tripwires inside: `:38` (tests never reach live shops; fixtures are never recorded from CI), `:40` (a reset deletes every local user: say so first), `:46` (never `--no-deps`) and `:47` (never `migration up --linked`). REDUNDANT at `:33`, `:35` and `:46-49`.
5. `## Architecture` — USEFUL, 7,105 words (64%), with CRITICAL rules inside `:60` (RLS and explicit grants on every table, `PUBLIC` execute revoked, only the owner runs `npx supabase db push`, never `supabase config push`) and `:59` (a stored id is user input). REDUNDANT at `:53`, `:55` and `:57-60`; VAGUE at `:58`.
6. `## Tooling and repository conventions` — USEFUL, closing with two CRITICAL rules: `:72` (changes reach `main` only through pull requests the owner merges, since every merge deploys) and `:73` (a public repository: no account ids, emails, workers.dev subdomain or keys). REDUNDANT at `:64`, `:66` and `:68`.
7. The 10x CLI block — REFERENCE: course scaffolding the CLI owns, excluded from every fix.

The head of the file is right: past one intro sentence, the frame and the Non-negotiables put the highest-stakes rules in its first 57 lines at 120 columns. The trouble is what follows: 9,423 words of Commands and Architecture (`:26-60`), with four tripwires inside command bullets, then the grants inside `:60` (lines 560–608 of 669 at 120 columns), and the pull-request and public-repository rules only at 641–645, just before the course block. An agent changing one view reads the 6,473 words of the UI, Shops and Data paragraphs before it reaches those two.

Proposed order (5c):

1. `## Project` (was line 5) ← kept; `:3` removed, and the canonical documents written as plain paths if they are meant to be read on demand (Top 3 action 1).
2. `## Non-negotiables` (was line 15) ← kept first among the rules, `:21` cut to its rule, and it gains the tripwires from `:38`, `:40`, `:46`, `:47`, `:60`, `:72` and `:73`.
3. `## Commands` (was line 26) ← kept for the commands an agent runs; `:36-37` and `:40-45` move to `scripts/CLAUDE.md`, `:46`'s details to `tests/e2e/CLAUDE.md`, and `:48-49` become pointers.
4. `## Architecture` (was line 51) ← kept for the cross-cutting `:53-57`; `:58`, `:59` and `:60` each become a pointer to a nested file.
5. `## Tooling and repository conventions` (was line 62) ← kept without `:72-73`, which move up, and with `:64`, `:66` and `:68` as pointers.
6. The 10x CLI block (was lines 75–99) ← unchanged; the CLI owns it.

Question (5d), which this run had no one to answer: "Reorder `CLAUDE.md` as proposed?", with "Yes, reorder the file now", "Only move the critical rules to the top", "No, just leave the suggestion in the report" and "Show me the diff first". Taken: **No, just leave the suggestion in the report**. `CLAUDE.md` was not edited.

> **Test each change in your next agent session.** Reordering a rules file is a context-shape change — its effect on agent behavior only shows up the next time you run a real task. Apply changes one at a time (atomic): reorder, then run a representative task, then move on to the next change (split, dedupe, rewrite). Bundling multiple structural changes makes it impossible to attribute a behavior shift to a specific edit.

Verdict: scored on the original order and on Check 1's 120-column count, CRITICAL rules sit after line 200 (`:60` at 560–608, `:72` at 641–643, `:73` at 644–645). On the literal line numbers, all under 100, the same structure would be a WARN: critical rules at the top, others buried.

## Top 3 actions

1. **Stop loading and restating the canonical documents.** `CLAUDE.md:9` says to read them, and `:11-13` write them as `@` imports, so all four (14,402 words) enter every session, while `:35`, `:47`, `:49`, `:57-59` and `:68` restate parts of them, and `:46`, `:48` and `:60` parts of the test and deploy plans. If they are meant to be read on demand, write the four paths without `@`. Either way, replace each restated passage listed under Check 4 with a pointer to its section: research §2.1–§2.5; PRD FR-006, FR-007 and FR-012; test plan §6.3 and §7; the deploy plan's "Accounts and links (S-07)" and "Checked deploys (rollout Phase 4)"; README's "Smoke test" and "CI". No rule is lost if each passage goes only once its document holds every fact it states: the fake-price risk in `:60`, for one, is missing from test plan §7 and moves there first, and a code-level detail with no document goes to the nested files of action 2.
2. **Move the three area paragraphs and the script details next to the code they govern**, leaving one pointer line each. Claude Code loads a nested `CLAUDE.md` only when it reads files under it, and the course block names this signal itself: one area's conventions crowd out the rest (`:97`), and a rule is moved, not copied (`:95`).
   - "**UI**: `/watchlist` is the main screen…" (`:58`, 2,551 words): its view rules (tokens, theme, fonts, `cn()`, `hit-area`, the focus ring, shadcn copies, `cva` variants, the Astro and React pitfalls, `tokenConfig`, `islandConfig`, the kitchen sinks) go to `src/components/CLAUDE.md`, and the page decisions it names (`watchlist-rows.ts`, `match-step.ts`, the notices, the refresh's way back) to `src/lib/services/CLAUDE.md`.
   - "**Shops and matching**: `PRICED_SHOPS` in…" (`:59`, 3,041 words): the adapters' rules (Luigi's Box, Algolia, Rossmann, sizes, availability, log reasons, pinned batches, id checks), with `:21`'s gate mechanics, go to `src/lib/services/shops/CLAUDE.md`; matching, the search's entries, lookups, decisions and the refresh go to `src/lib/services/CLAUDE.md`.
   - "**Data**: migrations go in `supabase/migrations/`…" (`:60`, 881 words) goes to `supabase/CLAUDE.md`.
   - "`node scripts/check-shop-gate-db.mjs` — checks the shop gate's SQL…" through "`node scripts/check-two-users.mjs` — against a running server…" (`:40-45`, 822 words), with "`npm run check:production`…" and "`node scripts/check-migrations-applied.mjs`…" (`:36-37`, 212 words), go to `scripts/CLAUDE.md`; "`npx playwright test` — the Playwright e2e suite…" (`:46`, 248 words) goes to `tests/e2e/CLAUDE.md`.
   - With action 1, the root comes to roughly 3,000 words and about 200 lines at 120 columns, from 11,134 and 669.
3. **Keep the Non-negotiables first and make them hold every tripwire.** Leave `:17-24` at the top: "Sign-up is invite-only…", "Watchlists are private per user…", "Every displayed price shows its source…", "Shop fetches run server-side…", "Every shop request goes through `gate.fetch`…" (cut to its rule), "The confirmed per-shop item is the anchor…", "Read `SUPABASE_URL`…" and "The HTML-comment-delimited lesson block…". Lift into them, one line each: "Changes reach `main` only through pull requests…" (`:72`), "The default branch is `main` of a public GitHub repository…" (`:73`), "Never run `migration up --linked`" (`:47`), RLS with explicit grants, `PUBLIC` execute revoked and "only the owner runs `npx supabase db push`; never `supabase config push`" (`:60`), "Tests never reach live shops" with fixtures "never from CI" (`:38`), "Never pass `--no-deps`" (`:46`) and "say so before" a reset (`:40`). It is the smallest of the three edits, so it can go first, as its own atomic change.
