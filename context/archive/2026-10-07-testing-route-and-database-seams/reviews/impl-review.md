<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Route and database seams (test plan rollout Phase 2)

- **Plan**: context/changes/testing-route-and-database-seams/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

**Success criteria:**

- Every automated criterion that runs locally passes again: the seam table (9 tests), the price read and island tests (189), the route tests (17), the gate and search tests (78), `node --check` on both new scripts (run one file at a time, see F8), ESLint on the scripts, Prettier on the documents, `npm run lint`, `npx astro check` (0 errors), and `npm run test` (2375 tests, with the database test left out).
- The CI criteria (3.3, 4.3, 5.3) passed on their commits. The merge commit's checked deploy passed too.
- 5.4 was ticked on the owner's merge of #40, after a request to review the docs. There was no separate confirmation.

## Findings

### F1 — The two-user check can run without holding any shop

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/check-two-users.mjs:299-322 (the hold), :271 (A's price request)
- **Detail**: `stopShops("two-users")` holds only the shops that are enabled at that moment. Unlike `tests/e2e/auth.setup.ts`, which refuses while `e2eHolds()` isn't empty, the script doesn't refuse while another run or a manual `stop` holds the shops. It prints "no shop was enabled" and carries on. If that holder switches its shops back on mid-run, A's negative-control price request goes through the gate to the live Natura search, with a made-up SKU that Natura's id check accepts. That breaks the script's own "never a live shop request" rule. The holder name is also fixed, so two runs at once would release each other's hold. Only SIGINT is handled, so SIGTERM leaves the shops held.
- **Fix**: Refuse to start while `e2eHolds()` isn't empty, as `auth.setup.ts` does. Check `enabledShops()` is empty before A's requests. Let go of the hold on SIGTERM as on SIGINT.
- **Decision**: FIXED — the check refuses while e2eHolds() is not empty, checks enabledShops() is empty before either user's requests, and lets go on SIGTERM too.

### F2 — The fetch lint rule misses server code in `.astro` components and layouts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: eslint.config.js:209
- **Detail**: `serverFetchConfig` covers `src/lib/**/*.ts`, `src/pages/**/*.{ts,astro}` and `src/middleware.ts`. The frontmatter of `src/components/**/*.astro` and `src/layouts/**/*.astro` also runs on the server, but isn't covered: a probe lint of a component with `await fetch("https://www.hebe.pl/")` in its frontmatter passed. `CLAUDE.md` now says "ESLint refuses the global `fetch` in server code outside the gate". No component calls `fetch` today.
- **Fix**: Add `src/components/**/*.astro` and `src/layouts/**/*.astro` to the rule's files, and lint to confirm nothing is flagged. Record that the island's modules under `src/lib` are covered on purpose, since none of them may call a shop.
- **Decision**: FIXED — the rule also covers `src/components/**/*.astro` and `src/layouts/**/*.astro`; a probe of each is refused, and a component's browser script posting to the app stays allowed.

### F3 — The route tests accept a refresh whose shops weren't all answered

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/price-routes.test.ts:149-151, :307-317, :319-338, :255-264
- **Detail**: `served()` lists every request made, including one the replay doesn't know, which the gate turns into `failed/network`. The product refresh test checks the four URLs sent but accepts any `?prices=` code, and never checks Super-Pharm's POST body. So a body that drifted from its recording would still pass. `CLAUDE.md` asks every lookup test to assert, for a POST, the body the replay served. Three weaker spots:
  - the list refresh accepts any `?list-prices=` code, and has only one Rossmann product due, so "one request per product" is shown for one;
  - the valid price call doesn't check the price, which the plan's contract names;
  - the 403 cases don't count reservations.
- **Fix**:
  - Assert `?prices=done` and `?list-prices=done`, which only every shop answering and being stored gives.
  - Assert Super-Pharm's body is its recording's.
  - Check the valid call's price, and the 403 cases' reservations.
  - Give the list refresh a second Rossmann product due.
- **Decision**: FIXED — done codes, Super-Pharm's body, the offer, the 403 reservations, and a list refresh with two Rossmann products due beside a fresh one.

### F4 — The two-user check has controls that can't fail

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/check-two-users.mjs:176-180, :231-253, :281-296
- **Detail**:
  - **"A's rows are as they were" checks only that the two readings match.** `before` is never checked to hold A's product, 3 decisions and 2 prices, so the same error read twice, or an empty answer twice, would pass.
  - **The forms' Location comparison would pass if both redirected to sign-in after a lost session,** although other checks would then fail the run.
  - **The three forms have no control on A's side,** despite the script's header and `CLAUDE.md` saying the comparison must differ for A.
  - **The request-log mark can't move while the shops are held,** since a reservation for a stopped shop inserts nothing. So it proves the hold lasted, not that no request was tried.
- **Fix**:
  - Assert that `before` holds A's 1 product, 3 decisions and 2 prices.
  - Require each form's Location to stay under `/watchlist`.
  - Add a refresh control as A: `failed`, since every shop is held, against `none` for the missing product.
  - Name the mark check for what it proves.
- **Decision**: FIXED — A's rows are checked before the requests, the forms must stay under /watchlist, A's refresh is a control (failed against none), and the mark check is named for what it shows.

### F5 — The seam table repeats the page's composition instead of calling it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/pages/watchlist/[id].astro:113-127; src/lib/services/price-pages.test.ts:189-196
- **Detail**: The page turns its match steps into the matched items, the price keys and the "Zobacz w sklepie" lookup in its frontmatter. `price-pages.test.ts` copies those lines, and the Phase 1 notes record the copy. So a change to the page's wiring wouldn't show in the seam table. That goes against the lesson "Keep decision logic in tested services", the reason Phase 1 moved `priceShopsOf` and `selectedRowTagOf` out of the page.
- **Fix A ⭐ Recommended**: Move the composition into one service, such as `priceKeysOfSteps(product, steps)`. It would give the keys and the product URL of each shop. The page and the seam table both call it.
  - Strength: The seam table then runs the page's own wiring end to end, as its header claims, at the cost of about 15 lines moved.
  - Tradeoff: Touches the product page, so it ships with a deploy, and its output must stay the same.
  - Confidence: HIGH — the lines are pure: they map steps to keys, as `priceShopsOf` maps a read to shops.
  - Blind spot: None significant; the page's tests and the e2e specs cover its output.
- **Fix B**: Leave it as the recorded adaptation.
  - Strength: No production change, so no deploy.
  - Tradeoff: The seam table and the page can drift apart without a failing test.
  - Confidence: MEDIUM — the copied lines are short and rarely changed.
  - Blind spot: A later change to how the page builds its keys.
- **Decision**: FIXED via Fix A — productPricesOf in prices.ts, which the page and the seam table both call, with two tests of its own.

### F6 — A server service imports the island's prop type

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/services/prices.ts:3
- **Detail**: `priceShopsOf` returns `PriceComparisonShop`, which `src/components/watchlist/price-comparison-state.ts:50` defines. That makes it the only import from `src/lib` into `src/components`. `CLAUDE.md` puts shared types in `src/types.ts`. The import is type-only, so it has no bundle effect.
- **Fix**: Move `PriceComparisonShop` to `src/types.ts`, and import it from there in both places.
- **Decision**: FIXED, in src/lib/services/price-comparison.ts rather than src/types.ts: the type needs PricedShop, which lives there, and src/types.ts imports nothing, so moving it there would add a circular type import.

### F7 — The two-user check copies smoke's cookie jar

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/check-two-users.mjs:66-93; scripts/smoke.mjs:50-61
- **Detail**: The Set-Cookie jar, its `Max-Age=0` deletion included, is a copy of smoke's. That goes against the lesson "Define shared constants and helpers once".
- **Fix**: Move the jar and its request helper into one script module that both import. It is a local file, so smoke stays free of dependencies.
- **Decision**: FIXED — scripts/cookie-jar.mjs, shared by smoke and the two-user check.

### F8 — The plan's records are out of step with the code in a few places

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-route-and-database-seams/plan.md (Implementation Notes, Phase 3's criteria); CLAUDE.md:45
- **Detail**:
  - **Four adaptations aren't in the Implementation Notes:**
    - the stand-in has no `not` filter, which the contract lists and no service uses, and has `order` and `limit` instead;
    - the fetch rule also covers the island's modules under `src/lib`, although the plan said "outside the island's files";
    - a refresh with a crafted id is expected to go to `/watchlist`, as the route does, not to `?prices=none`, as the contract says.
  - **The Phase 5 note is wrong:** it says §7 records the first CI run's finding, but only §6.6 and `CLAUDE.md` do.
  - **3.1's command checks only its first file:** `node --check a b` checks only `a` (verified). Both files were checked one at a time during the phase.
  - **`CLAUDE.md`'s two-user entry** doesn't say that `.env` and `.dev.vars` must name the local stack, which the hold's helper requires.
- **Fix**:
  - Add the four adaptations and the 3.1 note to the Implementation Notes.
  - Correct the Phase 5 note.
  - Add the prerequisite to `CLAUDE.md`'s two-user entry.
- **Decision**: FIXED — the plan's notes record the three adaptations and the 3.1 quirk, the Phase 5 note is corrected, and CLAUDE.md's two-user entry names its prerequisites.
