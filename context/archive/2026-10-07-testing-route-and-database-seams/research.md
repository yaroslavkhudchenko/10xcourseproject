---
date: 2026-10-07T12:44:26+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 4944e630f7357043b267152eccab29732a054e41
branch: feat/testing-route-and-database-seams
repository: yaroslavkhudchenko/10xcourseproject
topic: "Rollout Phase 2 of context/foundation/test-plan.md, route and database seams: where risks #1, #3, #4 and #6 fail in the code, what the tests already prove, and the cheapest test that would catch each gap"
tags:
  [
    research,
    codebase,
    testing,
    rollout-phase-2,
    risk-1,
    risk-3,
    risk-4,
    risk-6,
    prices,
    shop-gate,
    rls,
    watchlist-matches,
  ]
status: complete
last_updated: 2026-10-07
last_updated_by: Claude (claude-opus-5-5)
---

# Research: route and database seams (test plan rollout Phase 2)

**Date**: 2026-10-07T12:44:26+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 4944e630f7357043b267152eccab29732a054e41
**Branch**: feat/testing-route-and-database-seams
**Repository**: yaroslavkhudchenko/10xcourseproject

Four read-only workers investigated one risk each. Their decisive claims were re-read in the code before this was written: the decision write, the update policy, the gate's failed block report, the product page's price wiring, the price route's guards, the test globs, CI's jobs and the end-of-turn hook. Nothing was run: the database, the shops and the browser were never reached. Paths are relative to the repository root.

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` ("Route and database seams", risks #1, #3, #4 and #6) in the code:

- find the real failure path of each risk;
- verify or correct its risk response guidance;
- locate the existing tests;
- name the cheapest test layer that gives a real signal for each gap;
- flag what is speculative or already covered.

## Summary

- **Most of each risk's rule is already proven; the gaps are at the seams the tests never cross.**
  - **No Vitest test runs a page or a route handler.** Two test files mention `src/pages/` in comments, and none imports it (`src/lib/services/matches.test.ts:83`, `src/lib/services/watchlist.test.ts:57`). Only `scripts/smoke.mjs`, over HTTP, and the e2e suite, in a browser, reach them.
  - **No test makes two users meet through a route.** `scripts/smoke.mjs` signs up one user (`scripts/smoke.mjs:25-48`), and the e2e suite one per run (`tests/e2e/auth.setup.ts:33-38`).
  - **No test writes a decision over one that changed, against the real database.**
- **Risk #1, prices:** the list and the product page call the same rule functions (`compareShops`, `verdictOf` in `src/lib/services/price-comparison.ts`), but feed them differently in five places (§1.3). Nothing pins the product page's own wiring of its stored prices into the island (`src/pages/watchlist/[id].astro:116-143`). The only proof that both pages agree is one e2e spec of four fault-free two-shop products (`tests/e2e/price-honesty.spec.ts:39-158`). The database refuses odd price rows (§1.4), so faults can only be stubbed. The cheapest real signal is a Vitest test over both reads with stubbed faults, after the page's wiring moves into a service.
- **Risk #3, shop requests:** the gate's rules and every service's request counts are proven, through a real gate over recorded answers. Not counted anywhere:
  - the search page's and the product page's own wiring;
  - the two price routes as handlers;
  - the landings their redirects open.

  Three code-level findings are for the owner, not for tests: a failed block report leaves the shop switched on (§2.2), `SHOP_HOSTS` admits hosts no adapter calls, and the search characters admit text a firewall might flag. The cheapest signal is Vitest tests that call the routes' exported handlers with a fake context, a real gate and a replayed `fetch`, counting served URLs and reservations.

- **Risk #4, privacy:** the database half is proven with two users for the watchlist, the decisions and the prices (`scripts/check-{watchlist,matches,prices}-db.mjs`). The route half isn't: by the code, another user's id and a missing id get the same answers on every route (§3.3), but only the missing-id side is tested. Nothing would fail on a new table without RLS. The cheapest signals:
  - a two-user HTTP check on the workerd preview in CI's `smoke` job;
  - a catalogue sweep as the local superuser, so a new relation can't slip in unprotected;
  - a few added reads in the existing scripts.
- **Risk #6, decisions:** the compare-and-swap lives only in the app's query (`src/lib/services/matches.ts:334-356`), since RLS lets the owner update a decision in any state (`supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:19-29`). "A stale tab's decision loses" is proven only through a stub that returns a canned empty result (`src/lib/services/matches.test.ts:724-741`). The cheapest real signal is a Vitest test against the local stack that imports the real `recordDecision` and `recordLookup`.
- **Where each kind of test can run:**
  - CI's `ci` job and the end-of-turn hook run the default Vitest suite with no database (`.github/workflows/ci.yml:18-25`, `.claude/hooks/end-of-turn.mjs:70`), as does this machine, which has no Docker.
  - So a test that needs the local stack must sit outside the default include (`vitest.config.ts:11`) and run in the `smoke` job beside the database scripts (`.github/workflows/ci.yml:49-64`).
  - Tests that stub the database run everywhere.

## Detailed Findings

### 1. Risk #1: the list and the product page

#### 1.1 The shared rule

- `priceState` gives `none` without an offer, `missing` whatever the age, and `stale` for a price older than 24 hours or whose promotion ended before today in Poland (`src/lib/services/price-comparison.ts:135-147`).
- A row can be named cheapest only when `state === "fresh" && offer?.available === true` (`price-comparison.ts:311`). A lone priced row is `only` and never marked (`:325-327`).
- `verdictOf` returns `unread` before anything else when the caller says some row is unread (`price-comparison.ts:271-273`).
- A never-checked shop (`latest: null`) has state `none` and ranks last (`:316-321`), so it never holds the mark back.

#### 1.2 Who reads stored prices

- **The list** (`/watchlist`):
  - It reads `listLatestPrices` from `latest_price_observations` and attaches `history: null` (`src/lib/services/prices.ts:145-152`, `:199-223`).
  - It builds its rows with `listRowsOf(…, Date.now())` (`src/pages/watchlist.astro:45-56`). For each row, `listRowOf` sets `unread` when a priced shop's read failed or a decision is unreadable, and its tag from `verdictOf` (`src/lib/services/watchlist-rows.ts:233`, `:242`).
  - It never refetches.
- **The product page** (`/watchlist/<id>`):
  - It reads `readLatestPrices` from `price_summaries` (`prices.ts:157-167`, `:232-253`), after its match steps have run.
  - Its frontmatter turns the read into `{ latest, readFailed }` per shop (`src/pages/watchlist/[id].astro:116-143`). That block is page code, so no test reaches it.
  - The island starts from it (`src/components/watchlist/price-comparison-state.ts:166`), withholds every mark while a row is unread (`:320-329`), and takes the same `verdictOf` (`:340-346`).
- **The selected row beside a product, from lg:**
  - Its first tag is `rowTagOf` over the island's initial rows (`[id].astro:197-206`).
  - `RowTag` recomputes it on each `PRICES_EVENT` at `Date.now()` (`src/components/watchlist/RowTag.tsx:48-53`).
  - Only the tag is swapped into the list's row (`[id].astro:210-212`). Its screen-reader line and its chip counts stay the list's.
- **The live refetch** (`/api/watchlist/prices`):
  - It reads no stored price, only the product and its decisions (`src/lib/services/price-targets.ts:59-101`).
  - The island's `settled` clears a row's unread mark only on the shop's own price or missing answer (`price-comparison-state.ts:249-280`).
- **The list's refresh** (`/api/watchlist/refresh`) renders nothing. It fetches a row whose price couldn't be read as one never checked (`price-targets.ts:113-121`).

#### 1.3 Where the two pages can disagree

The same functions run on different inputs in these places:

| #   | Difference       | The list                                                                                    | The product page                                                                                                                                         | Anchor                                                                     |
| --- | ---------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| a   | Parsing          | prices a row whose history is odd; an odd row naming no item only marks items never checked | the same row is unread (the history must parse too); an odd row naming no item, or an odd row of an unknown shop, makes the whole read null              | `prices.ts:154-166`, `:243-246`; `prices.test.ts:361-373` vs `:466-477`    |
| b   | Decisions        | `listMatchStates` parses the decision's state                                               | `listMatches` also parses `checked_at`, the name, the EANs and the links, so `checked_at: "wczoraj"` makes that shop unreadable on the product page only | `src/lib/services/matches.ts:363-395` vs `:480-491`; `matches.test.ts:894` |
| c   | Read order       | read before the page's match steps; the selected row's summary and chips stay the list's    | prices read after a lookup may have stored a match and its first price                                                                                   | `[id].astro:75-78`, `:99-131`, `:210-212`                                  |
| d   | Clock            | judged on the server's clock                                                                | the island and `RowTag` move to the browser's clock on mount                                                                                             | `watchlist.astro:56`; `PriceComparison.tsx:84-92`; `RowTag.tsx:48-53`      |
| e   | Separate queries | `latest_price_observations` with a 2 s limit                                                | the heavier `price_summaries` can time out on its own, so the page says unread while the list beside it shows prices                                     | `prices.ts:10`; `[id].astro:241`                                           |

`price_summaries` is built on `latest_price_observations` (`supabase/migrations/20261006221608_price_history.sql`), so the latest-check columns have one definition. `check-prices-db.mjs` proves they match for one item (`scripts/check-prices-db.mjs:459-472`).

#### 1.4 How faults reach each page

- **A read that fails:** every read has a 2 s `AbortSignal.timeout`. postgrest-js turns an abort into an `{ error }` result, which becomes `null` (`prices.ts:279-287`). Rows are parsed one by one, and an odd row is logged and kept against its key (`prices.ts:290-302`).
- **The list:**
  - Prices `null` gives the alert „Nie udało się wczytać cen.”, „Błąd odczytu” on every row, and no chips (`src/components/watchlist/ListRows.astro:43-46`, `watchlist-rows.ts:410`).
  - Decisions `null` gives the decisions alert and every row unread (`watchlist-rows.ts:165-170`, `:448-450`).
- **The product page:**
  - Prices `null` gives „Nie udało się wczytać ceny.” on every card, and on the user's own navigation every shop is refetched (`price-comparison-state.ts:748`, `PriceComparison.tsx:103-107`).
  - A decision that can't be read marks that shop `read-failed`, and no lookup runs for it (`src/lib/services/match-step.ts:59-61`).
- **What the database allows:** its checks tie each offer column to the status, require a positive price and require `available` beside a price (`supabase/migrations/20260928011450_price_observations.sql:37-66`). So an odd price row can only be stubbed. The local stack can only produce a whole read failing, by a revoke or a forced timeout, which gives the same `null` the stubs give.

#### 1.5 What the tests pin, and what they don't

- **Pinned:**
  - **The rule:** `price-comparison.test.ts` pins `priceState`'s boundaries and every state in `compareShops` and `verdictOf`.
  - **The list's tag agrees with the live tag on the same rows,** unread and never-checked shops included (`src/lib/services/watchlist-rows.test.ts:239-311`).
  - **Each read, on its own,** in `prices.test.ts`, `matches.test.ts` and `price-targets.test.ts`, with faults.
  - **Both pages agree** in `price-honesty.spec.ts:39-158`, for four fault-free two-shop products.
- **Not pinned:**
  - no single stored state goes through both pages' reads;
  - the product page's wiring (`[id].astro:116-143`, `:197-212`);
  - the differences (a)–(e);
  - mixed states with three or four shops, where an unread shop sits beside stale and never-checked ones;
  - the selected row's live tag in a browser, since the only e2e project is 390 px wide (`playwright.config.ts:46-50`).
- **Speculative or describing the implementation:**
  - **"A shop still loading doesn't hold the mark back":** a pending row is never an input to `compareShops`.
  - **"Ended promotion":** it can only happen for Rossmann, and for Super-Pharm beside a regular price. Natura and Hebe always store `promoEndsOn: null` (`src/lib/services/shops/natura.ts:133`, `hebe.ts:151`).
  - **"A stored price is a current price":** every price is judged at the moment it's shown, with its age. The remaining holes are the browser's clock (d), Natura's and Hebe's sales, whose end only the 24 hours catch, and a refetch answered `saved: false`, which nothing displays (`price-comparison-state.ts:900-908`).
- **Cheapest layer:**
  1. Move the page's wiring into a tested service, per the lesson "Keep decision logic in tested services".
  2. Write a Vitest table that serves one stored state, through one stub keyed by relation, to both the list's rows (`listRowsOf`) and the product page's island, with one fault at a time for (a)–(e). The expected values come from the PRD's guardrail, US-01 and S-03's decision.
  3. No new real-database test is needed for #1.

### 2. Risk #3: every path to a shop

#### 2.1 Entry points and their cost

- **Gates and the network:**
  - Four server files build a gate (`shopGateFor`): `src/pages/watchlist.astro:46`, `src/pages/watchlist/[id].astro:103`, `src/pages/api/watchlist/prices.ts:71`, `src/pages/api/watchlist/refresh.ts:59`.
  - In the inspected adapters, the network calls are `gate.fetch` (`luigis-box.ts:114,159`, `rossmann.ts:64,101`, `super-pharm.ts:119,243`). Apart from the Supabase client, which makes its own requests, the gate's `send` is the only `fetch` the app's server code calls (`src/lib/services/shop-gate.ts:124,198`).
  - The browser's one `fetch` is the island's post to the app's own route (`price-comparison-state.ts:821,833`). There is no cron (`wrangler.jsonc`).
- **The own-navigation guard:** `isOwnNavigation` refuses a prefetch (`Sec-Purpose` or `Purpose`) and accepts `Sec-Fetch-Site` same-origin, none or missing (`src/lib/services/search-query.ts:19-26`).
- **The cost of each path, as read from the code:**

| Path                                          | Shop requests                                                                                                                                                                                                                                               | Anchor                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/watchlist?q=`, own view                     | 1 to Rossmann; a reload repeats it, since `q` stays in the address. None from another site, a prefetch or invalid text                                                                                                                                      | `watchlist.astro:36-46`, `:144-147`                                           |
| Product page, plain own view                  | per undecided shop: Natura and Hebe at most 2 each (an EAN search, then a name search only when that finds nothing), Super-Pharm 1. Then the island refetches each shop checked more than 15 minutes ago, never checked, or with an ended promotion, 1 each | `match-step.ts:58-76`; `shop-matching.ts:62-90`; `PriceComparison.tsx:97-109` |
| Product page from another site, or a prefetch | none: every undecided shop only offers its button, and the island doesn't refetch                                                                                                                                                                           | `match-step.ts:58-76`                                                         |
| `?repin=<shop>` or `?retry=<shop>`            | at most 2 for that shop (Super-Pharm 1). A retry that stored its outcome redirects to the plain page, which is a new own view. Without JavaScript the address keeps `repin` or `retry`, so a reload repeats the searches                                    | `shop-matching.ts:103-149`; `[id].astro:112-115`, `:303-317`                  |
| The island's „Odśwież ceny”                   | 1 per shop, whatever its age; taps while one runs are ignored                                                                                                                                                                                               | `PriceComparison.tsx:126-128`; `RefreshForm.tsx:62`                           |
| `/api/watchlist/prices`                       | 1 per call that passes the JSON guard and names the user's own item. The route checks neither navigation nor freshness, so the guard against repeats is the island's                                                                                        | `src/lib/json-request.ts:17-23`; `api/watchlist/prices.ts:50-74`              |
| `/api/watchlist/refresh`                      | a product's: at most 1 per shop; the list's: its items checked more than 15 minutes ago, Rossmann 1 per product, Luigi's Box 1 per 50, Super-Pharm 1 per 20, the cap cutting the rest; a crafted id or back address: none                                   | `price-targets.ts:122-162`; `refresh.ts:27-42`                                |
| „Dodaj”, a decision, a removal, sign-in       | none themselves, but each lands on a page: „Dodaj” on the new product's page, with every matched shop undecided; sign-in on a return path that drops `repin`, `retry` and `q`                                                                               | `api/watchlist.ts:13-40`; `src/lib/services/return-path.ts:40-61`             |

Each action costs a small, fixed number of requests. Repeating one is bounded only by the deployment's per-shop cap, since there is no per-user limit.

#### 2.2 The gate as implemented

- **Before reserving:** the URL must be plain https on the default port, with no credentials, and its host must be in `SHOP_HOSTS[shop]`. Anything else throws (`shop-gate.ts:86-92`).
- **Reserving:** the reservation comes before the request, and a counter call that fails or answers oddly fails closed as `skipped/unavailable` (`:98-117`, `:202-215`).
- **The SQL** (`supabase/migrations/20260926112205_polite_shop_access.sql:48-84`):
  - `reserve_shop_request` takes a row lock;
  - it answers `stopped` or `paused` before inserting anything;
  - it prunes rows older than 60 seconds;
  - it answers `capped` at `cap_per_minute`, 30 by default.
- **The request:** the gate's User-Agent, `redirect: "manual"`, and an 8 s timeout that covers the body (`shop-gate.ts:18`, `:119-130`).
- **A refusal:**
  - A 403, or `cf-mitigated: challenge`, reports a block that switches the shop off (`:136-143`; SQL `:108-114`).
  - A 429, or a 503 with Retry-After, pauses it (`:144-150`).
- **Counted and sent:**
  - A request that is counted but fails to send over-counts, which is the safe direction.
  - A signed-in user can call `reserve_shop_request` or `report_shop_block` directly. That spends the cap or stops a shop for everyone; it is the accepted direct-call stop (`context/archive/2026-09-26-polite-shop-access/reviews/impl-review.md`, F2).
  - The inspected code has no path that sends a request without counting it.
- **Code gaps for the owner, not for tests:**
  - **A failed block report:** `report()` catches its error, and the caller still gets `blocked` (`shop-gate.ts:74-82`). But the database leaves the shop switched on, so other paths and users can send again after a 403.
  - **`SHOP_HOSTS`** admits page hosts that no adapter calls: www.hebe.pl, scripts.luigisbox.com, www.drogerienatura.pl and www.superpharm.pl (`shop-gate.ts:9-14`).
- **The shared host:** `live.luigisbox.com` serves Hebe and Natura. Each request is charged to its shop, because `createLuigisBoxClient` binds a shop to its tracker (`src/lib/services/shops/luigis-box.ts:96-113`, `:186-196`).

#### 2.3 Search text

- **The schema:** `searchQuerySchema` allows 2–80 characters from letters, digits and ` .,%&'+/()-` (`search-query.ts:29-32`).
- **Where it applies:** to `?q=` before Rossmann (`watchlist.astro:37-39`), and through `toShopQuery` to the lookups' name search (`shop-matching.ts:164-166`). The lookups' name comes from the product a user added, whose name and brand are only trimmed and length-checked (`src/lib/services/watchlist.ts:44-54`).
- **What it lets through:** the characters admit text such as `../../etc/passwd` or `union select password from users`. Whether any shop's firewall flags that is unknown, and must not be probed. The tests reject markup, NUL, `;` and bad lengths (`search-query.test.ts:43-52`).
- **The adapters** take a plain `string` and don't check it themselves, so a new caller passing raw text still compiles.

#### 2.4 What the tests pin, and what they don't

- **Pinned:**
  - **The gate's unit tests:** no request when capped, paused or stopped; failing closed; the stop and pause rules; the URL guards; no redirect followed; a failed block report keeping its outcome (`shop-gate.test.ts:81-356`).
  - **The cap in the database:** 30 allowed and the 31st capped, and 40 parallel reservations allowing exactly 30 (`scripts/check-shop-gate-db.mjs:44-102`).
  - **A real gate over `vi.fn(createReplayFetch)`,** counting the served URLs and the reservations:
    - the lookups, including no second search after a refusal (`shop-matching.test.ts:80-407`);
    - the shops run at once (`:901-977`);
    - no request from another site (`:1136-1158`), for a re-pin or for a retry (`:1033-1108`);
    - the price refresh stopping after a 403 (`price-refresh.test.ts:403-421`, `:682-706`).
  - **e2e:** each spec compares the request-log mark (`scripts/e2e-local-db.mjs:191-195`). Fresh prices give no refetch (`phone-refresh.spec.ts:105`), and only old ones are asked (`price-honesty.spec.ts:154`).
- **Not counted anywhere:**
  - the search page's wiring;
  - the product page's wiring, since every e2e navigation is the user's own;
  - `prices.ts` and `refresh.ts` as handlers;
  - the landings their redirects open;
  - the gate joined to the real database.
- **The request-log mark's limit:** a reservation for a stopped shop inserts nothing (SQL `:65-67`). So the mark can't tell "tried a stopped shop" from "never tried", and a gate bypass on the preview would reach a live shop without moving it.
- **Speculative:**
  - firewall-tripping text, which has no evidence and must not be probed;
  - a block of the whole Luigi's Box host;
  - how `Sec-Fetch-Site` behaves on reload or back.
- **Cheapest layer:**
  1. Vitest tests of the two price routes' handlers:
     - call the exported `POST` with a fake context (`request`, `url`, `locals.supabase`, `redirect`);
     - use the real `shopGateFor` over a stub client that answers both `from` and `rpc`;
     - stub `globalThis.fetch` with `createReplayFetch`.

     Assert the served URLs and the reservations: a refusal, 400, 404, 409 or 503 asks no shop; a valid price call asks exactly 1; a crafted refresh asks none; a product's refresh asks 1 per item. No route module imports an `astro:*` module, but calling one this way is untried in this repository.

  2. Move the pages' remaining decisions into services, and unit-test them: the search step from its headers and query, and the product page's inputs.
  3. Guard against a bypass:
     - an ESLint rule refusing `fetch` in server code outside `shop-gate.ts`;
     - a Vitest setup that makes the global `fetch` reject unless a test stubs it.

### 3. Risk #4: two users

#### 3.1 The database's rules

- **`shops` and `shop_requests`:** RLS is on, there are no policies, and all privileges are revoked. A direct call gets 42501, and only the two RPCs reach them (`20260926112205_polite_shop_access.sql:31-38`).
- **`watchlist_items`:** a user may select, insert and delete their own rows, and may update none (`20260927145051_watchlist_items.sql:31-42`; `20261001182905_watchlist_removal_and_repin.sql:9-13`).
- **`watchlist_matches`:**
  - a user may select and insert their own decisions, and update their own in any state;
  - the update grant covers only the decision's columns;
  - nothing may delete one, since a decision goes only with its product's cascade;
  - the composite foreign key ties each decision to its owner's product.

  Anchors: `20260927184936_watchlist_matches.sql:87-136`; `20261001182905:19-29`; `20260928011450_price_observations.sql:27-31`.

- **`price_observations`:** only an item's watchers select and insert. Its column grants keep `recorded_by` unreadable, and nothing may update or delete a row (`20260928011450:87-138`).
- **`latest_price_observations` and `price_summaries`** are `security_invoker` views, selectable by authenticated users only (`20260928011450:144-178`; `20261006221608_price_history.sql:97-138`).
- **`applied_migrations()`** is executable by anon only (`20261006183345_applied_migrations.sql:46-59`).
- **Allowed by design, so a test can't expect a refusal:** anyone can become a watcher of any item, read its history and other people's check times, and add a plausible fake price (`CLAUDE.md`, "Data", accepted risks).

#### 3.2 What the database scripts prove with two users

- **`check-watchlist-db.mjs`:** B lists none of A's rows and reads none by id. B can't insert in A's name, update, or delete A's rows. Anon is refused.
- **`check-matches-db.mjs`:**
  - B lists and reads only its own decisions.
  - Attaching to A's product gets 23503, whether or not that shop has a decision, which closes the inference probe (`scripts/check-matches-db.mjs:134-144`).
  - B's updates change nothing, and the owner can't move a decision to another product, user or shop.
  - A delete is refused, and a removal cascades only to the owner's decisions.
- **`check-prices-db.mjs`:**
  - A non-watcher's insert is refused.
  - A non-watcher reads no row of the table or of either view, and anon is refused.
  - Nothing can update or delete a row.
  - A re-pin opens the new item, and a removal ends the remover's access.
- **`check-shop-gate-db.mjs`** uses one user only.
- **Gaps:**
  - **G1:** a non-watcher's unfiltered list or `count=exact` read of the prices is never tried while someone else holds rows. RLS ignores filters, so this is low value, but it is the exact read the list makes (`prices.ts:199-200`, `:275-277`).
  - **G2:** nobody tests anon calling `report_shop_block`, a direct write on `shops` or `shop_requests`, or an authenticated call of `applied_migrations()`.
  - **G3:** no check fails on a new public table without RLS, a view without `security_invoker`, a grant to anon, or a function that PUBLIC may execute. The scripts name their tables. Locally, `auto_expose_new_tables = false` withholds grants but turns nothing on (`supabase/config.toml:20`).
  - **G4:** that re-pinning away ends access to the old item is never shown, since the old item never gets an observation.

#### 3.3 Routes and pages

- **Scoping:** all scoping is RLS on the request's single client (`src/middleware.ts:14-16`). No service filters by user explicitly.
- **Cache headers:** every signed-in response gets `Cache-Control: private, no-store` (`src/middleware.ts:36-42`).
- **Another user's id against a missing one, by the code:**

| Route                    | Another user's id, or a missing id                                                     | Anchor                                                             |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/watchlist/<id>`        | no product row: 404 „Nie znaleziono produktu.”, and no shop step runs                  | `[id].astro:64-111`                                                |
| `/api/watchlist/matches` | the insert gets 23503 either way: `gone`, and the 404 product page                     | `matches.ts:317-327`; `api/watchlist/matches.ts:33-41`             |
| `/api/watchlist/prices`  | the target comes from the user's own rows: 404 `{"error":"gone"}` before any gate call | `price-targets.ts:59-71`; `api/watchlist/prices.ts:61-67`          |
| `/api/watchlist/refresh` | no target: `?prices=none`, and no shop request                                         | `price-targets.ts:158-160`; `price-refresh.ts:162-166`, `:220-222` |
| `/api/watchlist/remove`  | `delete … select("id")` comes back empty: `?removed=gone`                              | `watchlist.ts:267-301`                                             |
| `/api/watchlist`         | takes no id from the request                                                           | `watchlist.ts:128-131`                                             |

- **What smoke tests:**
  - only the missing-id side: the product page's 404, the prices route's 404 with no-store, the removal's `gone` and the list refresh's way back (`scripts/smoke.mjs:262-325`);
  - the decisions route only for its cross-site 403 (`:252-261`);
  - no-store only on `/watchlist` and the prices 404 (`:246-250`, `:275-279`).

  No route test uses a second user, or an id another user holds.

- **What a harness can reuse:**
  - `signUpUser()` in the database scripts gives a supabase-js session per user, which can seed A's rows without opening A's page and so without a shop lookup (`scripts/check-watchlist-db.mjs:35-42`);
  - smoke's `request()` and cookie jar can drive B;
  - `requestLogMark()` shows no reservation (`scripts/e2e-local-db.mjs:191-195`);
  - the `smoke` job already serves the workerd preview against the stack (`.github/workflows/ci.yml:86-91`).
- **Speculative:** the primary-key oracle. The table-wide insert grants let a caller choose `id`, so someone who already knows a product's UUID, from a shared link, could learn whether it exists through a 23505. No route posts an id for an insert. Closing it would take a column-level insert grant in a migration.
- **Cheapest layer:**
  1. **A two-user HTTP check on the workerd preview, beside `smoke.mjs` in the `smoke` job:**
     - seed A's product, a Natura decision and a price through supabase-js;
     - sign B in through the form;
     - for each route, compare A's id with a random UUID: the status, the `Location` with the id swapped, the JSON body, and `private, no-store`;
     - then, as A, check that the rows and decisions are unchanged, that no observation was added, and that the request-log mark hasn't moved.

     Vitest tests of the handlers would skip the middleware, `checkOrigin` and the headers.

  2. **A catalogue sweep as the local superuser,** in a database script. It fails on a public relation outside a reviewed list, a table without RLS, a view without `security_invoker`, any anon privilege beyond `applied_migrations()`, or a function that PUBLIC may execute. It answers "a new table inherits the rules".
  3. **A few lines in the existing scripts** for G1, G2 and G4.

### 4. Risk #6: the decision write

#### 4.1 How decisions are written

- **The writer:** `record` writes `watchlist_matches` (`src/lib/services/matches.ts:310-356`); the file's other queries are reads.
  - It inserts first. That gives `saved`, or 23503 gives `gone`, and any error other than 23505 gives `failed`.
  - On 23505 it updates the row by product and shop, narrowed by the state it expects to replace: `not_found` without `replaces`, `matched` with the replaced item, or `unmatched`.
  - It selects the updated ids, and an empty result is `decided` (`:334-356`).
  - The update has no `user_id`, which RLS adds, and no `decided_by` or `checked_at`.
- **The callers:**
  - `recordLookup` writes over `not_found` only (`:272-283`).
  - `recordDecision` writes the user's pick or decline (`:289-301`). Its `replaces` comes from the form's field, which is checked to belong to the posted shop (`:52-65`, `:99-104`, `:159`).
- **The answers:**
  - `decided` lands on that shop's card with „Ten produkt ma już zapisaną decyzję.” (`api/watchlist/matches.ts:38-39`; `src/lib/notices.ts:25`).
  - A lookup that gets `decided` stores no price, and shows the decision another tab stored (`shop-matching.ts:338-372`).
- **The database doesn't narrow by state:** RLS lets the owner update a decision in any state (`20261001182905:19-29`). So the compare-and-swap exists only in the app's query.

#### 4.2 What the tests prove

- **The stub:**
  - `stubClient` records every builder call and returns canned answers in order (`matches.test.ts:133-168`).
  - The tests compare the whole call list, so dropping a filter fails them.
  - The stub never applies a filter to a row, so "a stale tab gets `decided`" comes from a canned `[]` (`:724-741`).
  - `shop-matching.test.ts` has no lookup that gets `decided`, `gone` or `failed`.
- **The database script:**
  - `check-matches-db.mjs` shows 23505 on a second decision and 23503 on another user's product.
  - Its owner's updates are unconditional, by `id`, and it never imports `record`.
- **Another hand copy:** `check-prices-db.mjs:378-396` copies one narrowed update that succeeds: the winning path only, without the insert first.
- **e2e:** posts „Żaden z nich” through the real route and `record` over a seeded match, which saves (`tests/e2e/phone-decline-match.spec.ts:55-62`).
- **So:** "a stale tab's decision loses" is proven nowhere against the real database.

#### 4.3 Stale-tab scenarios

| Scenario                                             | What the code does                                                                                                      | Tested                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Two tabs re-pin the same shop from X                 | the first saves; the second finds the item isn't X anymore: `decided`                                                   | stub only                |
| The product removed and added again                  | the stale form's insert gets 23503: `gone`, and the 404 page                                                            | stub only                |
| A lookup after the user's pick                       | the update over `not_found` misses: `decided`, and no price stored                                                      | not at the step level    |
| A decline over a match that changed                  | `matched:X` against a stored Y: `decided`                                                                               | stub only (as a confirm) |
| The product removed between the 23505 and the update | the update gets no row: `decided`, so the user lands on the 404 page with no reason shown, and nothing wrong is written | no                       |

- **Gaps in the code itself, for the owner:**
  - **ABA by design:** the swap compares the state and the item, not who decided or when (`matches.ts:42-46`). A stale form shown with an automatic X still lands after another tab confirmed X, and a decline lands after decline, re-pin, decline. The content is the same, but a newer decision is overwritten.
  - **The insert ignores `replaces`:** that is safe only while no decision can be deleted (`20261001182905:22-23`, which `check-matches-db.mjs:318-319` pins).

#### 4.4 "A suspicious match stays flagged"

- `matchDifferences` flags the size only when both sizes are known and differ, and the brand only when the brands don't agree (`src/lib/services/matching.ts:287-300`).
- An automatic match accepted today can't differ, since it needs the size and a brand that doesn't differ. So the flag guards older rows, rule changes and direct writes.
- **On the card:** the warnings show whoever decided (`match-view.ts:199-223`).
- **On the list:** only an automatic match's differences count toward „Do sprawdzenia” (`watchlist-rows.ts:191-207`, `:459-462`). „To ten produkt” is the way out (`match-view.ts:339-361`).
- **Tests:** confirmed and automatic matches are told apart in unit tests (`watchlist-rows.test.ts:716-742`, `:931-965`; `match-view.test.ts:100-125`, `:473-489`). This part is covered.

#### 4.5 The cheapest layer

- **A Vitest test against the local stack that imports the real `recordDecision` and `recordLookup`:**
  - Users: throwaway sign-ups that refuse any stack but the local one, as the database scripts do.
  - Cases:
    - a stale `matched:X` after X→Y gives `decided`, and Y stays;
    - the same for a decline;
    - a lookup after the user's pick gives `decided`;
    - a first choice over `not_found` gives `saved`;
    - a removed product gives `gone`;
    - two re-pins from X at once give exactly one `saved`;
    - a confirm over an existing row proves its payload fits the column grant, which a stub can't.
  - It needs its own Vitest config or glob, and a step in the `smoke` job.
  - It would fill the test plan's empty §6.2 slot, and its harness can serve #4 too.
- **Fallback:** a section in `check-matches-db.mjs` that copies `record`'s query by hand. A copy drifts from the code (lesson "Define shared constants and helpers once"), as `check-prices-db.mjs:382-389` already shows.
- **Not worth it:** forcing interleavings with locks, since the swap is already deterministic under `Promise.all`; a browser stale-tab e2e, which duplicates the cheaper layer; and the ABA cases, unless the owner decides they should lose, which would be a code change.

### 5. Where each kind of test can run

- **CI's `ci` job** runs lint, the contrast check, `astro check`, `npm run test` and the build, with no Supabase (`.github/workflows/ci.yml:10-25`).
- **The `smoke` job** starts the local stack and runs the four database scripts and the deploy gate. It then builds, and runs `smoke.mjs` and the production check against the preview (`.github/workflows/ci.yml:27-107`).
- **The `e2e` job** runs Playwright on the preview with its own stack (`.github/workflows/ci.yml:109-146`).
- **Vitest's default include** is `src/**/*.test.ts` and `scripts/**/*.test.mjs` in Node (`vitest.config.ts:9-12`). The end-of-turn hook runs `vitest run` with it (`.claude/hooks/end-of-turn.mjs:70`). So a test that needs the stack would fail there, in the `ci` job, and on this machine, which has no Docker.
- **Stubs:** there is no shared Supabase stub. Each test file builds its own `stubClient` (`prices.test.ts:79-106`, `price-targets.test.ts:117-146`, `matches.test.ts:137-167`, `shop-matching.test.ts:793-825`, `shop-gate.test.ts:41-49`).
- **Rendering a page in Vitest** would need Astro's Container API, which is unused here. `Layout` pulls in `astro:env/server` (`src/lib/config-status.ts:1`).

## Code References

- `src/lib/services/price-comparison.ts:135-147,271-273,311-327` — the freshness, unread and cheapest rules both pages share
- `src/lib/services/prices.ts:10,145-167,199-302` — the two stored-price reads, their views, parsing and timeouts
- `src/pages/watchlist/[id].astro:116-143,197-212` — the product page's untested price wiring and its selected row's tag
- `src/lib/services/watchlist-rows.ts:233-247,402-412` — the list row's verdict and its unread mark
- `src/lib/services/matches.ts:310-356,363-395,480-491` — the decision write's compare-and-swap, and the two decision reads
- `supabase/migrations/20261001182905_watchlist_removal_and_repin.sql:19-29` — the update policy that allows any state
- `src/lib/services/shop-gate.ts:9-14,74-82,86-155` — the gate's hosts, its block report and its rules
- `src/lib/services/search-query.ts:19-45` — the own-navigation guard and the search schema
- `src/pages/api/watchlist/prices.ts:50-74`, `src/pages/api/watchlist/refresh.ts:27-59` — the two routes that reach a shop
- `src/middleware.ts:14-16,36-42` — the request's single client and its cache headers
- `scripts/smoke.mjs:25-48,246-325` — one user, and the routes' missing-id answers
- `scripts/check-{watchlist,matches,prices,shop-gate}-db.mjs` — the two-user database proofs
- `tests/e2e/price-honesty.spec.ts:39-158` — the one proof that both pages agree
- `vitest.config.ts:9-12`, `.github/workflows/ci.yml:10-146`, `.claude/hooks/end-of-turn.mjs:70` — where each kind of test can run

## Architecture Insights

- **The code follows "Keep decision logic in tested services" except in the pages' frontmatter.** The search guard's wiring, the product page's price wiring and its selected row's tag stay in `.astro` files. That is exactly where risks #1 and #3 have no test.
- **Privacy is RLS on one client per request.** That makes the database scripts the strong layer, and leaves the routes' half to an HTTP test with a second real user.
- **The decision write's protection is in the app's query, not the database's policy.** So only a test that runs that query against Postgres can prove it.
- **Two new seams would cover all four risks:**
  - stubbed-database Vitest tests of services and route handlers, with a real gate and replayed shop answers, that run everywhere;
  - tests against the local stack that run in the `smoke` job only.

## Historical Context (from prior changes)

- `context/archive/2026-09-26-polite-shop-access/reviews/impl-review.md`, F1 and F2: the cap and the gate, and the accepted direct-call stop.
- `context/archive/2026-09-28-cheapest-shop-today/reviews/impl-review.md`, F1: an ended promotion stayed cheapest. F3: a path that spent the cap.
- `context/archive/2026-09-29-product-page-ui/reviews/impl-review.md`, F1, and `context/archive/2026-09-30-etykiety-redesign/reviews/impl-review.md`, F1–F2: unread prices read as "not checked". F7 of the latter: a refresh's landing is a new own view.
- `context/archive/2026-10-01-fix-matches-and-watchlist/reviews/impl-review.md`, F1: a stale page priced a re-pinned item under the old name, which led to the compare-and-swap and its `replaces` field.
- `context/archive/2026-10-02-hebe-in-comparison/plan.md:122`: a retry's redirect to the plain page costs a new own view, as documented.
- `context/foundation/test-plan.md:115-117`: §6.2's integration pattern is still to be written. This phase is its first entry.

## Related Research

- `context/archive/2026-10-02-testing-critical-browser-flows/research.md` — rollout Phase 1, which added the e2e layer and the request-log mark.
- `context/archive/2026-10-06-testing-deploy-and-production-checks/research.md` — rollout Phase 4, which added the production checks.

## Corrections to the test plan's §2 (backport candidates)

- **#1's cheapest layer:** "integration over the stored-price reads (read failures need database faults)". The database refuses odd price rows (§1.4), so faults are stubbed. The gap is the product page's wiring and the five ways the pages feed the rule, so a stubbed Vitest test over both reads gives the signal, and #1 needs no new real-database test.
- **#3's cheapest layer:** "integration through the real gate, counting the URLs the replay served". This is confirmed, and it exists for every service. It is missing for the route handlers and the page wiring. The request-log mark can't see a request to a stopped shop.
- **#4's cheapest layer:** "two-user route tests". This is confirmed missing. The cheapest form is HTTP on the preview in the `smoke` job, not handler tests. A catalogue sweep answers its "a new table inherits the rules".
- **#6's cheapest layer:** "the decision write against the real database (today only stubbed)". This is confirmed. The cheapest form is a Vitest test against the local stack that imports the real `record`, run in the `smoke` job.

## Open Questions

These are for the owner, since they decide what the tests should expect.

1. **The two pages' differences (§1.3 a–e):** are they intended, with each page honest in its own way, or should the pages agree exactly? For example, a history that can't be read makes the product page say unread while the list prices the shop.
2. **The selected row beside a product:** should its screen-reader line and the chips follow the island, as its tag does?
3. **The gate:** should a failed block report fail closed, and should `SHOP_HOSTS` be narrowed to the hosts the adapters call (§2.2)?
4. **Search text:** should it refuse path-traversal or SQL-keyword sequences, while "L'Oréal" still passes (§2.3)?
5. **Decisions:** should a stale form lose even when its content matches the newer decision, the ABA case? That would need a version token in `replaces` (§4.3).
6. **The primary-key oracle:** is it worth a column-level insert grant, which needs a migration (§3.3)?
7. **Structure, for `/10x-plan`:** where the tests that need the database live, for example a separate Vitest config run in the `smoke` job, and whether the pages' remaining decisions move into services first.
