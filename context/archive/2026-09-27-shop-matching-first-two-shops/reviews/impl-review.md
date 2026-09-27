<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Shop Matching in the First Two Shops

- **Plan**: context/changes/shop-matching-first-two-shops/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 8 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Evidence

- **Automated checks**, rerun on `3f92b52`:
  - `npm run test`: 264/264
  - `npx astro check`: 0 errors
  - `npm run lint` and `npm run build`: clean
  - `npx supabase migration up --local`: nothing pending
  - `node scripts/check-matches-db.mjs`: 29 PASS lines
  - `node scripts/check-watchlist-db.mjs`: passes
  - `npx supabase migration list --linked`: all four migrations have a remote version
  - CI `ci` and `smoke`: green
- **Manual checks:** the owner confirmed 1.5, 2.5, 3.6 and 4.3–4.5 in the session, and 4.3 is also verified by `migration list --linked`.
- **Plan drift:**
  - Every planned change is present.
  - Every difference from the phase blocks is recorded in the plan's Implementation Notes: the owner-inclusive unique key, `{NULL}`-safe EAN checks, sizes that round-trip, the Rossmann link and its migration, `rel="noopener"`, `listMatches` returning null, `gone`, the 503.
  - No "What We're NOT Doing" item was breached: no stored prices, no brand warning, no delete path, no page read for the tracker id.
- **Checked and fine:**
  - CSRF: Astro's `checkOrigin` is on by default for server output.
  - No open redirects: both routes build their targets from UUIDs.
  - No `set:html`, and every link and image is https on an allowed host.
  - Queries use only `.eq` with UUIDs or fixed values.
  - Every Natura call goes through `gate.fetch`.
  - A double submit ends as "decided", never as a second decision.
  - The composite key and the owner-inclusive unique key hold against cross-user probes.

## Findings

### F1 — A match row that doesn't parse makes a decided product look undecided

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist/[id].astro:123-134 (with src/lib/services/matches.ts:279-292)
- **Detail**:
  - `listMatches` drops rows its schema rejects and returns the rest. Examples: a state a later migration adds before the code knows it (S-08), or a `checked_at` of `infinity`.
  - The page then finds no Natura decision and looks the product up on every visit, 1–2 Natura requests each time.
  - `recordLookup` gets `23505`, the update filtered to `not_found` changes nothing, and the page shows "Ten produkt ma już zapisaną decyzję". Its reload link repeats the loop, and the list shows "do dopasowania".
  - A failed read (null) is already guarded; a dropped row isn't.
- **Fix**: When reading one product's decisions, treat any dropped row as a failed read (return null), so the page shows "Nie udało się wczytać dopasowania" and makes no lookup. Add a test.
- **Decision**: FIXED: one product's `listMatches` returns null when a row doesn't parse, so the page shows its read-failed text and makes no lookup. A test covers both modes, and the break-check went red.

### F2 — A Luigi's Box format change would be stored as "not found"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shops/natura.ts:78-83
- **Detail**:
  - Hits that fail the hit schema are dropped silently, with no count and no log line.
  - If Luigi's Box changes a field so that every hit fails, each search looks empty. Examples: `price_amount` sent as text, or `url` switching from the SKU to a URL.
  - The lookup logs only its generic "nothing found" line. The page stores `not_found` for every product opened meanwhile and shows "Nie znaleziono w Naturze" as a checked fact. It should show a gap, not a wrong statement (PRD guardrail: never silent).
- **Fix**: Count and log dropped hits. When Luigi's Box returned hits but none survived, return `unavailable`/`failed`, so nothing is stored and the page says the search is unavailable. Add a test.
- **Decision**: FIXED: dropped product hits are counted and logged. When hits came back but none survived, the search is `unavailable`/`failed` and nothing is stored. Pseudo-hits don't count. Tests and the break-check went red.

### F3 — Some page views still spend Natura requests they don't need

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist/[id].astro:117-160; src/lib/services/search-query.ts:15-18
- **Detail**:
  - **Undecided products:** only `accepted` and `not-found` are stored, so every view of an undecided product costs up to 2 Natura requests. That includes reloads, tab restores and the confirm route's error redirects.
  - **Retry links:** a `?retry=1` left in the address bar repeats the lookup on every reload.
  - **Prerender:** Chrome's omnibox prerender sends `Sec-Fetch-Site: none` with `Sec-Purpose: prefetch;prerender`, which `isOwnNavigation` accepts. A page the user never opens can then spend requests and store a decision.
  - **Plan note:** the Performance note "made once per product because decisions are stored" doesn't hold for undecided products.
- **Fix**:
  - `isOwnNavigation` returns false when `Sec-Purpose` or `Purpose` mentions `prefetch`.
  - After a retry whose outcome was stored, redirect to the plain product URL.
  - Correct the plan's Performance note.
- **Decision**: FIXED: `isOwnNavigation` refuses `Sec-Purpose`/`Purpose` prefetch, and a stored retry redirects to the plain URL. The Performance note is corrected. The top-level redirect needed `no-misused-promises`' `returns` check off for `.astro` files, since it crashed on it.

### F4 — The rule for when to look Natura up lives in the page and has no test

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/pages/watchlist/[id].astro:117-162
- **Detail**:
  - The decision "show the stored decision, look it up, or only prompt" is made inline in the page: a stored decision wins, `?retry=1` acts only on `not_found`, and so on. So is what `decided` and a failed write mean.
  - This goes against CLAUDE.md's "business logic in src/lib/services/", and nothing tests it:
    - Vitest can't reach the page.
    - The smoke test covers only the redirect and the 404s.
    - The database check proves a decided row can't change, not that no request is spent on it.
  - The politeness guarantee therefore rests only on the manual walk-through.
- **Fix A ⭐ Recommended**: Move that decision into a pure function in `src/lib/services/` that says what the Natura section should do next (show the stored decision, look it up, prompt, or read failed). The page calls it. Table-test it: `matched` and `unmatched` never trigger a lookup, not even with `?retry=1`; a link from another site only prompts.
  - Strength: The guarantee that decided products cost no requests gets a unit test, and S-03, which reworks this page, starts from a tested seam.
  - Tradeoff: It touches the page just after the walk-through, so it needs a short re-check on the dev server.
  - Confidence: HIGH — the branch is small and has no I/O once its inputs are passed in.
  - Blind spot: The page's rendering itself stays untested.
- **Fix B**: Leave it for S-03, which rebuilds the product page for prices, and record the gap in the plan.
  - Strength: No change now, right after the walk-through.
  - Tradeoff: The guarantee stays untested until S-03, and S-03 has to carve out the seam anyway.
  - Confidence: MED — depends on S-03 remembering it.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A): `decideMatchStep` (`src/lib/services/match-step.ts`) decides the Natura section's next step, and the page calls it. Table tests pin that `matched` and `unmatched` never trigger a lookup, not even with `?retry=1`, and three break-checks went red.

### F5 — The next migration should tighten what a user can write to their own rows

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260927184936_watchlist_matches.sql:16-18, 63-67, 91-92
- **Detail**:
  - Privacy holds. But with their own session, through the Data API, a user can shape their own rows in ways the app never does:
    - the EAN checks accept an element containing a comma (`{"12345678,87654321"}`) and a 2-D array
    - `grant update` covers every column, so a `not_found` row can be re-pointed to another of the user's products or shops, or its `id` rewritten
    - `shop_item_id` accepts `.` and `..`
  - S-03 will put stored item ids and EANs into shop URLs, and one 403 stops a shop for everyone.
  - Both migrations are on production and frozen.
- **Fix**: Record it for S-03 in the plan's Implementation Notes. S-03's migration adds a no-comma and one-dimension condition to both EAN checks and limits the update grant to the decision columns. S-03 treats stored ids as user input: letter or digit required, no dot segments, encoded.
- **Decision**: FIXED: recorded for S-03 in plan.md, Implementation Notes: tighter EAN checks, a column-level update grant, and stored ids treated as user input.

### F6 — The product page waits longer than it needs to

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist/[id].astro:19, 123; src/pages/watchlist.astro:27
- **Detail**:
  - The product read and the matches read run one after the other, though both need only the id.
  - In the worst case the page then waits for two Natura searches (4 s each) and two writes (2 s each), about 16 s. The plan's "about 8 s" counted Natura only.
  - The list page reads all 14 columns of every match, but uses only the state of Natura's.
- **Fix**: Run the two reads with `Promise.all`, give the list a query that reads only what it shows, and correct the plan's Performance note.
- **Decision**: FIXED: the product and its matches are read with `Promise.all`, and the list uses `listMatchStates` (three columns). The Performance note is corrected (about 14 s worst case).

### F7 — The database check and the smoke test miss a few cases

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/check-matches-db.mjs:174-221; scripts/smoke.mjs:29
- **Detail**:
  - The only update path isn't tested against:
    - A pointing their `not_found` row at B's product (expect `23503`)
    - A handing the row to B (expect `42501`)
    - the `{NULL}` EAN case the `'*'` null string exists for
  - Every smoke request sends the app's own `Origin`, so nothing pins Astro's `checkOrigin`, the new POST route's only CSRF defence.
- **Fix**: Add the three database assertions, and a smoke step that posts to `/api/watchlist/matches` with a foreign `Origin` and expects 403.
- **Decision**: FIXED: the database check refuses re-pointing (`23503`), handing over (`42501`) and a null EAN (`23514`), each red on its own schema break. Handing over needed all three layers broken: update check, select policy and owner key. A smoke step expects 403 for a foreign `Origin`, and went red with `checkOrigin` off.

### F8 — Rossmann logs more than Natura, and two form helpers are duplicated

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/shops/rossmann.ts:56-63, 173-177; src/lib/services/matches.ts:15-30
- **Detail**:
  - Natura logs only a parse error's name and a shape error's issue paths, because a parse error quotes the body, which can echo the user's search. Rossmann still logs `error.message`, e.g. `Unexpected token '<', "<html>Prze"...`.
  - `optionalText` and `optionalUrl` are copied word for word in `matches.ts` and `watchlist.ts`, and both have to stay in step with `PRODUCT_LIMITS` and the database checks.
- **Fix**: Apply Natura's logging to Rossmann, and move the two helpers into one shared module.
- **Decision**: FIXED: Rossmann logs only error names and issue paths, with a test that the search text stays out. `optionalText` and `optionalUrl` now live in `src/lib/services/form-fields.ts`.

### F9 — A crafted decision post can show the "Dodaj" error on the list

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/watchlist/matches.ts:11-13, 23, 33
- **Detail**: Without a valid `itemId`, the confirm route falls back to `/watchlist?error=invalid`. The list maps that to "Nie udało się dodać produktu: nieprawidłowe dane.", which is the add form's message. Only crafted posts reach it, because the page always posts a valid id.
- **Fix**: Redirect to `/watchlist` without an error code in that case.
- **Decision**: FIXED: a decision post without a valid product id returns to `/watchlist` without an error text.

### F10 — A few small additions and plan notes aren't accurate yet

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/watchlist/[id].astro:111-112, 120, 139, 410-417; src/pages/watchlist.astro:199-203; CLAUDE.md:57; plan.md Implementation Notes
- **Detail**:
  - Four small additions aren't in the Implementation Notes:
    - the product page's "Nie udało się zapisać wyniku…" alert
    - the list's alert when matches can't be read
    - the CI bullet in CLAUDE.md
    - a "Brak ceny online" label that no Natura candidate can reach, since the adapter requires a positive price
  - The note "B's own match is visible only to B" overstates its check: the script proves B sees exactly its own row, not that A can't see it.
- **Fix**: Record the additions in the plan's notes, reword the overstated note, and keep the price label as the fallback for shops whose prices can be missing (say so in a comment).
- **Decision**: FIXED: the additions are recorded in the plan notes, the overstated note is reworded, and the "Brak ceny online" fallback has a comment.

## Triage (2026-09-28)

- **Fixed:** F1, F2, F3, F4 (Fix A), F5 (recorded for S-03), F6, F7, F8, F9, F10
- **Verification:**
  - 295/295 unit tests; `astro check`, lint and build clean
  - `check-matches-db.mjs` and `check-watchlist-db.mjs` pass
  - the smoke test passes 14/14 against the production build, with the CSRF step
  - every new test went red on deliberately broken code or schema: 9 code breaks, 3 schema breaks plus the combined hand-over break, and the `checkOrigin` break
