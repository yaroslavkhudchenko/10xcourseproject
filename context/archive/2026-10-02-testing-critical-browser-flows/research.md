---
date: 2026-10-02T14:33:21+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 5a8c7de33c4bb46ec48ee49688a55493a1837d67
branch: feat/testing-critical-browser-flows
repository: yaroslavkhudchenko/10xcourseproject
topic: "Test-plan Phase 1, critical flows in a real browser: grounding risks #7, #1 and #2 for Playwright e2e on the workerd production preview without live shops"
tags: [research, codebase, test-plan, e2e, playwright, shop-gate, price-comparison, watchlist, ci, workerd]
status: complete
last_updated: 2026-10-02
last_updated_by: Claude (claude-opus-5-5)
---

# Research: Test-plan Phase 1, critical flows in a real browser (risks #7, #1, #2)

**Date**: 2026-10-02T14:33:21+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 5a8c7de33c4bb46ec48ee49688a55493a1837d67 (`main` after PR #19; this change folder is uncommitted)
**Branch**: feat/testing-critical-browser-flows
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

> Ground rollout Phase 1 of context/foundation/test-plan.md.
>
> Risks to verify: #7 (a browser-only regression breaks the phone flow), #1 (a stale, ended-promotion or unread price shown as current, or the wrong shop marked cheapest), #2 (a deploy breaks production: breakage only on Workers).
> Risk response guidance to verify, not blindly accept:
>
> - #7: prove that on a phone-sized viewport and the production build a signed-in user opens the list and a product, sees each shop's price with its age, refreshes, removes a product through the confirm and re-pins a match, with no live shops, no sideways scroll and visible focus; challenge "server HTML that looks right means the page works", "the dev server behaves like the production build" and "mocking the browser's requests keeps the shops out" (the app calls the shops from the server, so that would only fake the app's own routes); ground which flows cross auth, routing, API and database, how tests sign in once, how shops stay out (recorded answers or shops disabled) and the preview build versus the dev server; avoid e2e for what a unit test covers, fixed waits instead of waiting for state, tests sharing data and pixel snapshots (§7).
> - #1: prove that the rendered page marks no shop cheapest unless its price is fresh and orderable, every price shows its shop and age, and an unread shop shows a gap; challenge "the list and the product page read prices the same way" and "a stored price is a current price"; ground every reader of stored prices (list, product page, live refresh), what each does with an unread row, and how a test can put a shop into each state (fresh, older than 24 h, ended promotion, not orderable, unreadable, still loading); avoid expected values copied from the rule under test (take them from the PRD guardrail and FR-011) and an all-fresh happy path.
> - #2: prove that the flows run on the workerd production preview, so breakage that happens only on Workers fails before a merge; challenge "green Node tests mean it works on Workers"; ground what CI's smoke job runs on, what Workers Builds runs, and how an e2e job gets the local Supabase and the preview without secrets in GitHub; avoid a check that needs production secrets in GitHub or writes to production, and a smoke that asserts only status 200.
>
> Hot-spot directories that raised these risks (likelihood evidence — NOT anchors): src/pages/watchlist (16 commits/30d), src/styles (9 commits/30d), src/lib/services (27 commits/30d), src/components/watchlist (19 commits/30d).
> Stack: Vitest 5.0.2 in Node, not workerd; shop answers only as recordings through createReplayFetch; four database contract scripts and scripts/smoke.mjs against the local Supabase (CLI 2.117.0) in CI's smoke job, the smoke on the workerd production preview; no e2e yet (Phase 1 adds Playwright through /10x-e2e-setup, then /10x-e2e), to run on the production preview with the local Supabase and no live shops; Playwright CLI (@playwright/cli) for exploring the running app, checked: 2026-10-02.

**Method.** Four read-only workers (flows and shop calls; stored-price readers and seeding; CI, preview and auth; phone UI), plus the parent's own reads of Astro's preview CLI, the Cloudflare adapter's preview entry and Vite plugin types, and re-reads of every decisive section cited in the Summary (the own-navigation check, the gate's reservation path, the shops migration, the observation grants, the refresh codes, the re-pin view, the cheapest-mark rule, the CI workflow, the auth settings). Nothing was run: no build, server, browser or database connection. Statements about Playwright's own behaviour are marked as inference.

## Summary

1. **The browser can't stand in for the shops, and nothing in the built app can point them elsewhere.** In the inspected server code, shop requests leave the Worker only through `gate.fetch`: `src/pages` and `src/lib` contain no other `fetch(` call, and the gate's four callers are `watchlist.astro`, `[id].astro` and the prices and refresh routes. `gate.fetch` accepts only plain https on the default port to the shop's own hosts (`src/lib/services/shop-gate.ts:86-92`). The built app has no env, var or binding that redirects them (`astro.config.mjs:64-69`, `wrangler.jsonc:4-15`), and the Cloudflare Vite plugin that runs the preview takes no outbound-fetch option (`node_modules/@cloudflare/vite-plugin/dist/index.d.mts:69-150`). Playwright's request interception sees only the browser's requests, here the island's `POST /api/watchlist/prices` and the page loads. The guidance's challenge "mocking the browser's requests keeps the shops out" is confirmed false, and its option "recorded answers" is not available to the production build.
2. **The seam that works is the gate's own stop switch, plus seeded data.** `report_shop_block(<shop>, 'blocked')`, which any signed-in user may execute, sets `public.shops.enabled = false` (`supabase/migrations/20260926112205_polite_shop_access.sql:108-114,129-130`). `reserve_shop_request` then answers `stopped` before counting (`:65-67`), and the gate settles `skipped` without sending (`shop-gate.ts:98-117`). With Rossmann and Natura stopped, each of the 12 flows in section 2 costs 0 shop requests. The stopped notice, which appears only when the gate refused, is the observable proof. The archive used the same approach for its agent-run checks (`context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:935`).
3. **Playwright's page loads, same-origin link clicks and form submits count as the user's own navigation** (inference about Chromium's Fetch Metadata headers; not captured). `isOwnNavigation` returns false when `Sec-Purpose` or `Purpose` names a prefetch. Otherwise it returns true for a `Sec-Fetch-Site` of `none` or `same-origin`, or when the header is absent, and false for any other value (`src/lib/services/search-query.ts:19-26`). Prefetch is off. So with shops enabled, a product view with no stored Natura decision would run a 1–2 request Natura lookup, and the island would refetch each shop last checked more than 15 minutes ago. The stop switch (or a stored decision plus prices younger than 15 minutes) is required, not optional.
4. **What the four #7 flows can prove with shops stopped:**
   - **List and product:** fully, with seeded prices and ages.
   - **Refresh:** only as the refused path. The island keeps each shop's last price with its age and shows "Odświeżanie cen w sklepie … jest wyłączone, bo sklep zablokował zapytania." (`src/lib/shop-messages.ts:55`). Without JavaScript the page returns with `?prices=failed`, because no shop answered (`src/lib/services/price-refresh.ts:128-137`).
   - **Removal:** fully; it asks no shop.
   - **Re-pin:** only as removing a wrong match. "Zmień" opens the choice, which with Natura stopped shows the warning, "Żaden z nich" (from a match) and "Anuluj", and "Żaden z nich" completes a decline (`src/lib/services/natura-view.ts:299-300,337-338`; `src/components/watchlist/NaturaSection.astro:136-153`). Choosing another candidate ("To ten produkt") needs Natura's answer, so it can't be reached without a test-only shop seam.
5. **#1: what the decided rule actually is.**
   - Only fresh (≤ 24 h, promotion not ended) and orderable prices can win (`src/lib/services/price-comparison.ts:250-261`), a lone shop is never marked, and an unread (read-failed) row withholds every mark.
   - A fresh, orderable shop **is** marked cheapest beside a shop that is never checked, stale, missing, not orderable, or still being asked (`price-comparison.ts:164-177`; unit test `price-comparison.test.ts:394-400`). An open follow-up asks whether to withhold the mark while a shop is pending (`context/archive/2026-09-30-etykiety-redesign/follow-ups/review-fixes.md:20`).
   - So an e2e assertion "nothing is marked while a shop loads" would fail against the rule as built and decided.
   - The rules are unit-tested at length, but no rendering is: there are no `*.test.tsx` files. Phase 1's signal is that both rendered pages carry the rule's outcome for a few mixed, seeded states.
6. **The list and the product page read prices differently in three inspected ways.** They differ on an odd row without a key, on an odd decision row, and on the selected row's screen-reader line (see section 3). The first two show only with database-level faults, so they belong to Phase 2's integration layer. The third shows only from 1024 px, outside Phase 1's phone flows.
7. **#2: what Phase 1 can and can't catch.**
   - The e2e runs on the same workerd preview the smoke job uses (`node_modules/@astrojs/cloudflare/dist/entrypoints/preview.js:21-47`; `.github/workflows/ci.yml:65-70`). It would catch Workers-only breakage in the rendered flows: hydration of the production island, the JSON route, the no-JavaScript posts.
   - It would have caught none of the three incidents the test plan cites for #2. The "Illegal invocation" had no live caller; the migration merged before production had it; production sign-up stayed open.
   - Those stay with Phase 4's gates.
8. **Setup facts `/10x-e2e-setup` and `/10x-plan` need:**
   - **Background preview under an agent:** `astro preview` moves itself into a background process when run by an agent (Claude Code sets `CLAUDECODE`) unless `ASTRO_PREVIEW_BACKGROUND=1` is set (`node_modules/astro/dist/cli/preview/index.js:45-50,87-89`). The setup template already sets it.
   - **Hydration wait:** the template's Astro wait, "no `astro-island[ssr]` left", never resolves on a phone-width product page. The selected row's tag is `client:media="(min-width: 64rem)"` (`src/components/watchlist/WatchlistRow.astro:88`), so it stays unhydrated below 1024 px.
   - **CI shop state:** CI's shop-gate check pauses Natura and stops Hebe earlier in the same job (`scripts/check-shop-gate-db.mjs:73-95`).
   - **Sign-in budget:** local auth allows 30 sign-ins and sign-ups per 5 minutes per IP (`supabase/config.toml:192`).
   - **Lint and type-check:** they cover a new `tests/` folder (`tsconfig.json:3`; `eslint.config.js:16-58`), and the hooks rule treats a call named `use` as a React hook.
   - **Local-only guard:** the e2e must refuse a non-local Supabase, because the block RPC exists in production too.
9. **Hot-spot evidence reproduces and is not misleading:** 16, 9, 27 and 19 commits in the last 30 days for the four directories (git log, 2026-10-02).

## Detailed Findings

### 1. The shop boundary: why the browser can't fake shops, and what keeps them out

- **In the inspected code, the gate is the only way out.** `gate.fetch` throws for any target that isn't plain https on the default port to a host in `SHOP_HOSTS[shopId]` (`src/lib/services/shop-gate.ts:86-92`). It reserves a slot before touching the network and returns `skipped` for `unknown_shop`, `paused` and every outcome other than `allowed` (`:98-117`); only then does it send (`:124`). The adapters' URLs are constants (`src/lib/services/shops/rossmann.ts:10,13`, `natura.ts:11,16`, as reported by the flows worker).
- **No runtime seam in the built app.**
  - The env schema declares only `SUPABASE_URL` and `SUPABASE_KEY` (`astro.config.mjs:64-69`), and `wrangler.jsonc` declares no vars (`:4-15`).
  - The gate's four callers (`watchlist.astro`, `[id].astro`, `api/watchlist/prices.ts`, `api/watchlist/refresh.ts`) build it only as `shopGateFor(supabase)`, whose `fetch` reads `globalThis.fetch` on every call (`shop-gate.ts:165-172,196-197`). Outside tests, `createShopGate(` appears only in `shop-gate.ts`, and only test files import `replay-fetch`.
  - That per-call lookup is the stub point unit tests use (`vi.stubGlobal`, or `createShopGate({ fetch: createReplayFetch(...) })`, `shop-gate.test.ts:311-319`). A browser test can't reach it.
- **The preview is the built Worker on workerd.**
  - `astro preview` exits unless the build wrote `.wrangler/deploy/config.json` (`node_modules/@astrojs/cloudflare/dist/entrypoints/preview.js:21-24`). It then runs Vite's `preview()` with `@cloudflare/vite-plugin` (`:28-47`).
  - The plugin's options in 1.54.8 are a Wrangler-config customizer, auxiliary Workers, `persistState`, `inspectorPort`, `remoteBindings`, `tunnel` and `experimental` (`node_modules/@cloudflare/vite-plugin/dist/index.d.mts:69-83,141-150`).
  - Miniflare has an `outboundService` option (`node_modules/miniflare/dist/src/index.d.ts:355`), but none of those options passes it through. The inference is that outgoing `fetch` can't be redirected by configuration; this was not tried.
- **Playwright's interception sees only the browser.** On these pages the browser's own requests are page loads, form posts and the island's `POST /api/watchlist/prices` (`src/components/watchlist/price-comparison-state.ts:647-673`). Fulfilling that route with a canned answer would skip the server path that #2 wants exercised. Holding it and then continuing it changes only the timing, which is how a test can observe "still loading".
- **The stop switch.**
  - `report_shop_block(p_shop_id, 'blocked')` sets `enabled = false` (`supabase/migrations/20260926112205_polite_shop_access.sql:108-114`), and `authenticated` may execute it (`:129-130`).
  - `reserve_shop_request` returns `stopped` for a disabled shop before pruning, counting or inserting (`:65-67`). So a stopped shop makes no network request and leaves no `shop_requests` row.
  - The migration seeds four rows: rossmann, hebe, super-pharm and natura (`:40-44`).
  - API roles have no grants on `shops` (`:37-38`). Turning a shop back on therefore needs superuser SQL, or a `db reset`, which deletes every local user (CLAUDE.md).
- **What the user sees for a stopped shop:**
  - Price refresh: "Odświeżanie cen w sklepie {shop} jest wyłączone, bo sklep zablokował zapytania." (`src/lib/shop-messages.ts:55`).
  - Search or lookup: "Wyszukiwanie w sklepie {shop} jest wyłączone, bo sklep zablokował zapytania. Właściciel musi je ponownie włączyć." (`:27`).
  - A pause (`rate_limited`, clamped to 1–86 400 s, `polite_shop_access.sql:99-107`) gives clock-dependent text (`shop-messages.ts:23-24,51`), so it suits assertions less well.
- **Weaker alternatives** (reported by the flows worker):
  - Sending `Purpose: prefetch` makes every page view "not own" (`search-query.ts:20-23`). That swaps the path under test: prompt cards instead of lookups, and no automatic refetch. It doesn't affect POST routes.
  - Filling the cap makes reservations answer `capped` (the gate skips the request) for at most 60 s (`polite_shop_access.sql:46-47`).
  - Shop rows can't be deleted, because of the foreign keys.
- **Safety: refuse non-local Supabase.**
  - The block RPC is granted in production too, so an e2e pointed at production would stop shops for everyone.
  - The database scripts refuse any `SUPABASE_URL` host other than `127.0.0.1` or `localhost` (`scripts/check-prices-db.mjs:17-22`). The e2e setup needs the same guard.
  - Production also refuses sign-up, so a test can't sign a user up there.
- **CI leaves shop state behind.**
  - The shop-gate check runs earlier in the same `smoke` job (`.github/workflows/ci.yml:49-52`). It pauses Natura for about 120 s and stops Hebe (`scripts/check-shop-gate-db.mjs:73-95`). The pause ends by itself; Hebe stays stopped, because nothing turns it back on.
  - An e2e run has to put Rossmann and Natura into `stopped` itself, not rely on whatever state is left.
  - On a developer's machine the stop persists in the local stack after the run.
- **Images.** A seeded `image_url` would make the browser load a picture from the shop's host, so seeds should leave it null (stored-price worker).

### 2. What each critical flow costs every shop, under Playwright

- **Own navigation.**
  - In Chromium, `page.goto` sends `Sec-Fetch-Site: none`; same-origin link clicks and form submits send `same-origin`. This is inference from the Fetch Metadata rules; no headers were captured.
  - Astro sends no prefetch purpose. `astro.config.mjs` has no `prefetch` key, and Astro injects its prefetch script only when that key is set (`node_modules/astro/dist/prefetch/vite-plugin-prefetch.js:6-13`).
  - So for these three kinds of navigation, `isOwnNavigation` (`search-query.ts:19-26`) returns true.
- **Costs per flow** (rows 2, 4, 6, 8, 9 and 12 come from the flows worker; the refresh codes and the re-pin view were re-read by the parent):

| #   | Flow                                                                 | Shop requests, shops enabled                                                 | Shops stopped | What the user sees with shops stopped                                                                                                                                        | Anchors                                                                              |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `GET /watchlist`                                                     | 0                                                                            | 0             | stored prices only                                                                                                                                                           | `src/pages/watchlist.astro:35-46`                                                    |
| 2   | `GET /watchlist?q=…`                                                 | 1 Rossmann (own navigation, valid query)                                     | 0             | the stopped search text                                                                                                                                                      | `watchlist.astro:31,36`; `rossmann.ts:62-67`                                         |
| 3   | `POST /api/watchlist` ("Dodaj")                                      | 0: it stores the posted, schema-checked fields                               | 0             | 302 to `/watchlist/<id>`                                                                                                                                                     | `src/pages/api/watchlist.ts:13-44`; `watchlist.ts:44-68`                             |
| 4   | `GET /watchlist/<id>`, no stored Natura decision                     | Natura lookup 1–2, plus island refetch 1 per shop that needs one             | 0             | Natura's card with the stopped text                                                                                                                                          | `src/pages/watchlist/[id].astro:119,137`; `shop-matching.ts:26-53`                   |
| 5   | `GET /watchlist/<id>`, decision stored, every check < 15 min old     | 0                                                                            | 0             | stored prices                                                                                                                                                                | `match-step.ts:36-52,64-66`; `price-comparison.ts:61-78`                             |
| 6   | as 5, one check > 15 min old, never made, or a promotion ended since | island: 1 per such shop                                                      | 0             | that card keeps its last price and age, plus the stopped notice                                                                                                              | `PriceComparison.tsx:96-107`; `price-comparison.ts:61-78`                            |
| 7   | product "Odśwież ceny", island hydrated                              | 1 per shop row, regardless of age                                            | 0             | per card: the stopped notice beside the last price and age                                                                                                                   | `RefreshForm.tsx:56-77`; `src/pages/api/watchlist/prices.ts:59-74`                   |
| 8   | product "Odśwież ceny", no JavaScript                                | ≤ 1 Rossmann + ≤ 1 Natura (every item, any age)                              | 0             | `?prices=failed`, the product page's failure notice                                                                                                                          | `price-targets.ts:104-114`; `price-refresh.ts:128-137`; `src/lib/notices.ts:143-174` |
| 9   | list "Odśwież ceny"                                                  | Rossmann 1 per stale item, one at a time; Natura 1 per 50 SKUs               | 0             | `none` when nothing is stale ("Nic do odświeżenia: ceny sprawdzono w ciągu ostatnich 15 minut."), else `failed` ("Nie udało się odświeżyć cen. Spróbuj ponownie za chwilę.") | `price-targets.ts:87-97`; `price-refresh.ts:128-137`; `notices.ts:149,160`           |
| 10  | removal ("Usuń z listy")                                             | 0                                                                            | 0             | `/watchlist?removed=done`, "Usunięto produkt z listy."                                                                                                                       | `src/pages/api/watchlist/remove.ts:30-31`; `watchlist.ts:267-310`; `notices.ts:49`   |
| 11  | `?repin=1` ("Zmień", "Dopasuj ponownie")                             | Natura EAN search, then name search (≤ 2), nothing stored, no island refetch | 0             | the warning with the stopped text; "Żaden z nich" from a match; "Anuluj"                                                                                                     | `[id].astro:127-132`; `natura-view.ts:292-339`; `NaturaSection.astro:136-153`        |
| 12  | `POST /api/watchlist/matches`                                        | 0; after a confirm the next view fetches the new item's price (1 Natura)     | 0             | `?declined=1` or `?matched=1`                                                                                                                                                | `src/pages/api/watchlist/matches.ts:6-8`                                             |

- **Consequences:**
  - With Rossmann and Natura stopped, each of the 12 rows costs 0 shop requests.
  - Not reachable without a shop answer: the refresh codes `done` and `partial`, re-pin candidates (so "To ten produkt" can't appear in the UI), and any freshly fetched price.
  - A direct `POST /api/watchlist/matches` with the candidate fields and a matching `Origin` stores a match without a lookup. Astro's `checkOrigin` refuses a form post without one (`node_modules/astro/dist/core/app/origin-check.js:15-21`). That's a seeding path, not the user's flow.
- **Hydration race.** Clicking the product's "Odśwież ceny" before the island hydrates posts the no-JavaScript form, which runs a server-side refresh (row 8 instead of row 7, as reported by the flows worker). A test must wait for hydration before that click, or test row 8 on purpose with JavaScript off.

### 3. Who reads stored prices, and what the rendered page shows (#1)

- **The shared rule.** The four readers in the table below all use `price-comparison.ts`:
  - `priceState` gives `missing` when the last check found the item gone; `stale` when the price is more than 24 h old, or its promotion ended before today in Europe/Warsaw; otherwise `fresh` (`:85-111`, reported).
  - Eligible to win means `state === "fresh" && offer?.available === true` (`:258`).
  - With more than one row, `compareShops` marks every eligible row at the lowest price, and a lone row is never marked (`:164-177`, the lone-row rule at `:167`).
  - `verdictOf` checks, in order: unread, cheapest, only, unavailable, stale or missing, none (`:206-236`, reported).
  - The island's `compareRows` clears every mark while any row is unread (`src/components/watchlist/price-comparison-state.ts:270-279`, reported).
- **Correction to the guidance's "still loading".**
  - A fresh, orderable shop is marked cheapest beside one that is never checked, stale, missing or not orderable. The unit test "names the only fresh price cheapest beside a shop never checked" asserts this (`price-comparison.test.ts:394-400`).
  - A pending refresh doesn't change the verdict, so a stored fresh price stays marked while its shop is asked again (stored-price worker).
  - The redesign review recorded "Rossmann is 'Najtaniej' while Natura's price is still loading … Consider withholding the mark while a shop is pending." (`context/archive/2026-09-30-etykiety-redesign/follow-ups/review-fixes.md:20`; `plan.md:1227`). It is deferred, not decided.
- **The readers** (stored-price worker; the parent re-read the selected-row replacement at `[id].astro:256-258` and the screen-reader text at `price-comparison.ts:536-538`):

| Reader                                   | How it reads                                                                                                                                                             | What it does with an unread row                                                                                                                                                                                                                                                                   | Anchors                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| List page                                | `listLatestPrices`: one view read with no key filter. An odd row with a key goes into `unread[]`; one without a key counts in `unattributed`; a query error gives `null` | Tag "Błąd odczytu" and screen-reader line "Nie udało się wczytać ceny."; a whole failed read adds the alert "Nie udało się wczytać cen. Odśwież stronę."                                                                                                                                          | `src/lib/services/prices.ts:159-183`; `watchlist-rows.ts:155-233,317-327`; `ListRows.astro:43-47`    |
| Product page                             | `readLatestPrices(keys)`, keyed, after the Natura step, so a match stored during this render arrives with its price                                                      | An odd row with a key marks only that shop unread. One without a key, or a query error, fails the whole read and marks every row unread                                                                                                                                                           | `prices.ts:186-253`; `[id].astro:177-201`; `price-comparison-state.ts:142`                           |
| Island                                   | Stored rows, then `/api/watchlist/prices` answers                                                                                                                        | A price replaces the offer; `missing` keeps the price and sets the status; a network error, 20 s timeout, error status or HTML gives `unavailable/failed`, keeps the last price and says "Nie udało się pobrać ceny ze sklepu {shop}."; 409 shows the alert "Dopasowanie w Naturze się zmieniło…" | `price-comparison-state.ts:216-232,647-707`; `shop-messages.ts:57`; `PriceComparisonView.tsx:86-101` |
| Selected row's live tag (1024 px and up) | `PRICES_EVENT` from the island                                                                                                                                           | Recomputes the tag only. The row's screen-reader line and the chips keep the list's reads                                                                                                                                                                                                         | `RowTag.tsx:44-58`; `[id].astro:256-258`                                                             |

- **The list and the product page differ.** The first two items need database faults and fit Phase 2; the last two show only from 1024 px or over time:
  - An odd row that can't say whose it is: the list marks only the products without a readable row; the product page fails the whole read.
  - An odd decision row: the product page fails its whole decision read, while the list keeps every row that parses (`src/lib/services/matches.ts:346-349`).
  - The selected row's screen-reader line doesn't follow the island.
  - The list is judged once, at render; the island's clock moves every 60 s.
- **What the DOM shows, for role and text assertions:**
  - **Product cards:** each card is a list item in the "Ceny" region, with the shop name as an `<h3>` and the line "cena online · {age}" (`src/components/watchlist/ShopCard.tsx:112`).
    - Badges: "Najtaniej" (`:81`), "Nieaktualna" (`:86`), "niedostępny online" (`:106`).
    - "Odświeżam…" shows while the shop is asked (`:39`); with no price the card says "Jeszcze bez ceny" (`price-comparison-state.ts:255`).
    - The hero's eyebrow says "Najtaniej dziś" (`price-comparison-state.ts:381`).
  - **Prices:** the readable price is a screen-reader-only span with a no-break space (U+00A0) before "zł", and the digits are `aria-hidden` (`Price.tsx:68`, reported).
  - **List rows:**
    - The tag and its meta line, such as "Rossmann · 2 dni temu", are `aria-hidden`. The row link's screen-reader line carries "Najtaniej: …" (`WatchlistRow.astro:96`, reported).
    - The footer says "Ceny online z {sites}" (`src/components/watchlist/ListFooter.astro:9`).
    - Labels are uppercased by CSS; the DOM text is mixed case.
  - **Screen-reader gap** (an observation; the test plan doesn't cover it yet): for a row with two shops and no current price, the screen-reader line is "Ceny nieaktualne. Odśwież ceny lub otwórz produkt.", with no price, shop or age (`price-comparison.ts:536-538`). The visible tag does show them.

### 4. Putting a shop into each state on the local stack

- **The table's rules** (`supabase/migrations/20260928011450_price_observations.sql`):
  - Users may insert 8 columns only: `shop_id`, `shop_item_id`, `status`, `price`, `regular_price`, `lowest_price_30d`, `promo_ends_on`, `available` (`:137`).
  - The database sets `source` (default `'fetch'`), `observed_at` (default `now()`) and `recorded_by` (default `auth.uid()`) (`:51-56`).
  - Select covers every column except `recorded_by` (`:133-135`), so an insert must not ask for its rows back.
  - RLS lets only watchers read and insert: a `watchlist_items` row with `source = shop_id` and `source_item_id = shop_item_id`, or a `matched` `watchlist_matches` row for that item (`:89-127`).
- **Each state, and what it takes** (reported by the stored-price worker unless re-read):

| State                    | How                                                                                                                                                                                          | Whose rights                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Fresh and orderable      | a `status: 'price'` row with `available: true`: fresh for 24 h, and no automatic refetch for 15 min                                                                                          | the test user's own token                                                                                  |
| Not orderable            | the same with `available: false`                                                                                                                                                             | own token                                                                                                  |
| Ended promotion          | `promo_ends_on` = yesterday **in Europe/Warsaw**. The check counts as made after the end, so the island doesn't refetch at once (`price-comparison.ts:73-77`)                                | own token                                                                                                  |
| Missing after a price    | the price row, then a `missing` row **in a separate request**: rows from one insert share `now()`, and the view's `distinct on` could pick either                                            | own token                                                                                                  |
| Never checked            | no rows. The island then refetches on its own (refused while the shop is stopped)                                                                                                            | none needed                                                                                                |
| Older than 24 h          | `update … set observed_at = now() - interval '25 hours'`, or an insert that also names `recorded_by`                                                                                         | superuser on the local database (port 54322, `supabase/config.toml:31`); no script connects that way today |
| Unread (read failure)    | **inferred, not run:** a price row with `promo_ends_on = 'infinity'`, which Postgres accepts and the reader's date parse rejects (`prices.ts:113`); or revoking select on the view           | own token / superuser                                                                                      |
| Still loading            | hold the island's `/api/watchlist/prices` request in Playwright and continue it later. Only the timing changes, not the answer                                                               | n/a                                                                                                        |
| A stored Natura decision | a `watchlist_matches` row: `state: 'matched'` with the item fields; `'unmatched'` with `decided_by: 'user'`; or `'not_found'`. It stops the lookup during the render (`match-step.ts:36-52`) | own token                                                                                                  |

- **Data isolation.**
  - Observations are shared by everyone watching the item and can't be deleted (append-only). A rerun that reuses a shop item id would therefore read the previous run's prices.
  - Use fresh item ids each run, as `check-prices-db.mjs` does (CLAUDE.md Commands).
  - The app accepts Rossmann ids of 1–12 digits only (`watchlist.ts:44-68`; `rossmann.ts:95-100`); the database accepts `^[A-Za-z0-9._-]{1,40}$`.
- **Seeding paths:**
  - **supabase-js signed in as the test user**, as the database scripts do (`check-prices-db.mjs:57-67,110-125`). Each such sign-in spends the auth rate limit.
  - **The app's own routes**, with `Origin` set: `POST /api/watchlist` adds a product and `POST /api/watchlist/matches` stores a decision. None of the inspected routes writes an observation without a shop answer.
  - **Superuser SQL:** among the inspected paths, the only way to store a price older than 24 h without waiting, since users can neither insert `observed_at` nor update rows.
- **Where the expected values come from** (so tests don't copy them from the rule under test):
  - PRD: the guardrail (`context/foundation/prd.md:49`), the online label (`:51`), US-01's criteria "the gap and the last known price with its age, never a blank or a zero" and "Each price shows its source" (`:63-64`), FR-011 (`:121`), and the non-functional age requirement (`:145`).
  - The PRD's Open Question 5, the stale limit, is still open (`:192`).
  - The numbers come from the S-03 decision record: "Only fresh (≤ 24 h) and orderable prices can win; tied shops are all marked", "Refetch after 15 minutes; stale after 24 hours" and "Not orderable online … can't win" (`context/archive/2026-09-28-cheapest-shop-today/plan-brief.md:32-33,39`).
  - The ended-promotion rule comes from that change's review fix F1, which makes the end day itself still fresh (`plan.md:879-881`).

### 5. The production preview, CI, and what Phase 1 can prove for #2

- **The CI smoke job** (`.github/workflows/ci.yml:27-72`, re-read in full):
  - It runs on `ubuntu-latest` with Node from `.nvmrc`.
  - `supabase start` excludes 10 services; `supabase status -o env` keeps `API_URL` and `ANON_KEY` (`:40-43`), and the step writes them into `.env` and `.dev.vars` (`:44-48`). No GitHub secrets are involved.
  - The four database checks run (`:49-64`), then `npm run build` (`:65`).
  - It then starts `npm run preview -- --port 4321 &`, waits on `/` with a curl loop (60 tries, 1 s apart), and runs `BASE_URL=http://localhost:4321 npm run smoke` (`:66-70`).
  - `supabase stop --no-backup` always runs at the end (`:71-72`). No step stops the preview.
- **What smoke checks:**
  - It asserts status, `location` and `cache-control` only (`scripts/smoke.mjs:178-185`), and never reads a body.
  - Covered (worker count: 28 steps): the auth flow, protected redirects, route refusals, an empty-list refresh, removing a product that doesn't exist.
  - Not covered: an existing product, prices, matching, a real removal, any rendered DOM or hydration.
  - `/` answers 200 even without Supabase values, because the page then shows a banner (`context/deployment/deploy-plan.md:179-181`, reported). So the e2e's signed-in assertions would be the first CI check that the preview's secrets are actually bound.
- **Production.** Workers Builds runs `npm run build` and `npx wrangler deploy` on `main` (`deploy-plan.md:268-275`, reported). Differences that remain between the CI preview and production:
  - Worker secrets instead of `.dev.vars`.
  - Sign-up off in production, on locally (`config.toml:171,206`).
  - Migrations reach production only after the owner's `db push`.
  - The Cloudflare edge instead of local workerd.
- **The historical #2 incidents, one by one:**
  - `2026-09-26-polite-shop-access` review F4, "Illegal invocation" on workerd while the Node tests stayed green (`reviews/impl-review.md:109-121`): a real Workers-only failure. **Not** caught by this e2e: no live path had the fault, and shops are out of the run.
  - `2026-09-27-watchlist-add-by-search/plan.md:570-573`, merged before its migration reached production: **not** caught, because `supabase start` applies every migration locally.
  - `deploy-plan.md:216-219`, production sign-up left open: **not** caught, because local sign-up is on by design.
  - Partly catchable: local grants drifting from production's, now mirrored (`config.toml:19-20`), if a flow touches the table. Workers' connection and subrequest limits (`2026-09-28-cheapest-shop-today/reviews/impl-review.md:76`): whether local workerd enforces them is unverified.
  - Dev-server-only faults, such as the stale Vite cache with no island hydrated (`2026-09-30-etykiety-redesign/plan.md:1137`), don't occur on the preview. A real hydration regression in the production build would show there.
- **Verdict for #2's Phase 1 share.** The e2e proves the rendered flows work on the production build in workerd: server-rendered pages, the `client:load` island hydrating, the JSON route, the no-JavaScript posts. It doesn't protect against the three cited incidents; those stay with Phase 4's migration gate and signed-out production smoke (test plan §5).
- **Two previews at once.** A foreground `astro preview` refuses to start while another preview's lock names a live process ("Another astro preview server is already running.", `node_modules/astro/dist/cli/preview/index.js:115-126`), unless `--force` or `--ignore-lock` is given. The smoke step's preview keeps running (`ci.yml:68`). An e2e step in the same job must either reuse it or run on another port with `--ignore-lock`.

### 6. Starting the app, signing in once, and tooling constraints

- **The preview under an agent.**
  - `astro preview` goes to the background when `am-i-vibing` detects an agent and `ASTRO_PREVIEW_BACKGROUND` is unset (`node_modules/astro/dist/cli/preview/index.js:45-50,87-89`). Claude Code is detected by `CLAUDECODE` (`node_modules/am-i-vibing/dist/detector-Boc_-HQ9.mjs:26-29`), which this session sets.
  - In the background, it spawns a detached child, waits up to 30 s for that child's lock and returns (`node_modules/astro/dist/cli/server.js:111-169`). A live background server that's already running is reused without warning (`:117-121`).
  - The e2e-setup template already sets `env: { ASTRO_PREVIEW_BACKGROUND: '1' }` on the server entry (`.claude/skills/10x-e2e-setup/references/playwright-setup-templates.md:73-89`). `ci.yml` doesn't set `CLAUDECODE`.
- **Waiting for hydration.**
  - The template's Astro wait, "no `astro-island[ssr]` left" (`playwright-setup-templates.md:163-166`), never resolves on a product page narrower than 1024 px:
    - the selected row's `RowTag` is `client:media="(min-width: 64rem)"` (`src/components/watchlist/WatchlistRow.astro:88`), inside the list aside that's hidden below lg (`src/layouts/WatchlistShell.astro:89`; `[id].astro:282-288`);
    - the media directive hydrates only once its query matches (`node_modules/astro/dist/runtime/client/media.js`);
    - Astro removes `ssr` only after hydrating (`node_modules/astro/dist/runtime/server/astro-island.js:187`).
  - Wait for the `client:load` island (`PriceComparison`, `[id].astro:322`) instead.
  - `/watchlist` has no React island. The sign-in form is a `client:load` island (`src/pages/auth/signin.astro:14`).
- **Sign-in.**
  - `SignInForm.tsx` posts to `/api/auth/signin`. The labels are "Email" and "Password" (`:47,60`) and the button is "Sign in" (`:83`).
  - The password toggle is named "Show password" or "Hide password" (`PasswordToggle.tsx:14`), so `getByLabel("Password")` needs `exact: true`.
  - Success lands on `/watchlist` (`src/pages/api/auth/signin.ts:19`, reported).
  - The inputs are controlled, so text typed before hydration can be lost (CI worker's inference). The template's retry covers this.
  - The session lives only in cookies, through `@supabase/ssr` (`src/lib/supabase.ts:13-28`), with no browser-side client. Replaying `storageState` matches what `smoke.mjs` already does with a cookie jar (`:13-21`, reported). JWT expiry is 3600 s (`config.toml:160`).
- **Users.**
  - Locally, sign-up is on and confirmation is off (`config.toml:171,206,211`).
  - The limit is 30 sign-ins and sign-ups per 5 minutes per IP (`:192`). The smoke job's earlier steps already make about 10 (CI worker's count).
  - Production refuses sign-up.
- **Middleware.** `PROTECTED_ROUTES` is `["/dashboard", "/watchlist", "/api/watchlist"]`, matched by prefix. An anonymous request gets a 302 to `/auth/signin` with no return URL. Signed-in responses carry `Cache-Control: private, no-store` (`src/middleware.ts:5,23-33`, reported).
- **Tooling.**
  - Vitest collects only `src/**/*.test.ts` (`vitest.config.ts:10`), so `tests/e2e/*.spec.ts` won't be picked up.
  - `tsconfig.json` includes `**/*` (`:3`), so `astro check` type-checks `tests/**` and `playwright.config.ts`.
  - ESLint's type-checked base has no `files` filter (`eslint.config.js:16-40`), and react-hooks `recommended-latest` covers `**/*.{js,jsx,ts,tsx}` (`:42-58`).
  - The hooks plugin treats `s === 'use' || /^use[A-Z0-9]/.test(s)` as a hook name (`node_modules/eslint-plugin-react-hooks/cjs/eslint-plugin-react-hooks.development.js:54894-54895`). A Playwright fixture's `await use(…)` would most likely be reported (inference; not linted). The only test-specific relaxation covers `**/*.test.ts` (`eslint.config.js:195-198`).
  - `.gitignore` lists none of Playwright's paths.
  - Install `@playwright/test` with npm 11.16, as `.nvmrc` pins: a lockfile written by npm 11.6.2 once broke `npm ci` (`deploy-plan.md:166-173`, reported).
  - The build fetches the web fonts, so it needs network access (`scripts/check-built-fonts.mjs`).

### 7. Phone-width behaviour only a browser shows (#7)

- **Islands and scripts** (the UI worker's grep of `client:` over `src`):
  - Four islands: `PriceComparison client:load` (`[id].astro:322`), the selected row's `RowTag client:media` (`WatchlistRow.astro:88`), and the sign-in and sign-up forms.
  - Plain-script behaviour that runs on phones too: `SubmitOnce.astro:9-36`, `AccountMenu.astro:45-81`, `ThemeToggle.astro:26-58`, `SearchForm.astro:72-102`, `FilterChips.astro:58-68`, the address-bar clean-up (`watchlist.astro:126-138`, `[id].astro:347-361`) and the theme script in the head (`Layout.astro:29-63`).
  - The product area is server-rendered as well, so its HTML alone proves no hydration.
- **Phone structures** (UI worker; texts re-checked by the parent):
  - **Bottom bar:** fixed, hidden from lg (`RefreshBar.tsx:28-52`). Its button reads "Odśwież ceny" with a screen-reader-only " tego produktu" (`RefreshForm.tsx:77`) and is `aria-disabled` while a refresh runs (`:73`).
  - **Removal:** a `<details id="remove">` whose summary and submit both read "Usuń z listy" (`RemoveProduct.astro:48`). It works fully without JavaScript. Success goes to `/watchlist?removed=done`; failure to `?removal=failed#remove`.
  - **Account menu:** only on the list below lg (`AppHeader.astro:57-62`). A phone's product page has no sign-out (`AppHeader.astro:30`).
  - **Skip link:** "Przejdź do listy" or "Przejdź do produktu" (`WatchlistShell.astro:63`), `sr-only` until focused. `toBeVisible` can't tell its two states apart, so check its box size.
  - **Back to the list:** the link "Moja lista" (`[id].astro:292-303`).
- **Layout.**
  - `overflow-x-clip` is on the main pane only (`WatchlistShell.astro:51`). Row names shrink and wrap (`WatchlistRow.astro:57-71`).
  - Below lg the chips row scrolls sideways on purpose (`FilterChips.astro:35`). So a "no sideways scroll" check belongs on the document (`scrollWidth` against `clientWidth`), not on every element.
  - The product's content keeps clear of the bar through `pb-28` and the bar's `scroll-padding-bottom` (`global.css:423`).
- **Focus.**
  - `:focus-visible` draws a 2 px `--ring` outline at a 2 px offset (`global.css:415-418`). It matches keyboard focus only, so a test must press Tab.
  - There's no forced-colors rule. The base layer relies on a real outline, which also shows in forced-colors mode (comment at `global.css:412-414`). That was the fix for an earlier review finding of focus invisible in that mode (`2026-09-29-product-page-ui/reviews/impl-review.md:68-76`). Playwright can emulate forced colors if the plan wants that checked.
  - `hit-area` gives a 44 px tap target (`global.css:359-375`).
- **Earlier browser-only bugs** (verified against the archive by the UI and CI workers):
  - Zero hydration passed SSR and unit checks (`2026-09-30-etykiety-redesign/plan.md:1137`).
  - Layout and tap-target bugs at 1024–1279 px and 390 px, including the last chip's outline cut off at 390 px (`:1186-1197`).
  - `RowTag` hydrated on phones (review F9, `reviews/impl-review.md:193-203`).
  - No skip link, and the account menu stayed open (review F4, `:109-130`).
  - The no-JavaScript confirm and the bar were checked by hand at 390 px with shops disabled locally (`2026-10-01-fix-matches-and-watchlist/plan.md:936-941`).
  - No phone-check script is in the repository. The three changes inspected were verified with uncommitted headless-Chrome scripts and the owner's phone.

### 8. Existing tests: what's covered, what isn't

- **Unit-tested in Node, without a DOM** (names and lines in the stored-price worker's report):
  - Freshness at 24 h, e.g. "is fresh at exactly 24 hours, and stale 1 ms later" (`price-comparison.test.ts:133`).
  - The 15-minute refetch (`price-comparison.test.ts:90-125`; `match-step.test.ts:197-215`).
  - Ended promotions, e.g. "ends a promotion's last day at midnight in Poland, not in UTC" (`:150`).
  - Orderability, ties, missing rows and unread or unattributed reads (`prices.test.ts:286-419`; `watchlist-rows.test.ts`; `price-comparison-state.test.ts`).
  - Verdicts and the island's answers (`price-comparison.test.ts:334-488`; `price-targets.test.ts:157-208`).
- **Not covered by any test:**
  - All rendering: there are no `*.test.tsx` files, so ShopCard's badges, "cena online", the hero, RowTag and the row's screen-reader line are untested.
  - How the two pages put their reads together (`[id].astro:177-258`).
  - The island's effects: which shops it refetches, `PRICES_EVENT`, and hydration only from lg.
  - The real view read through the zod parsers: `prices.test.ts` uses a stub client.
  - Every phone structure in section 7.
- **So:** Phase 1 shouldn't re-assert the rule tables in a browser. Its signal is that the rendered pages show the rule's outcome for a few mixed, seeded states.

## Code References

- `src/lib/services/search-query.ts:19-26` - `isOwnNavigation`: the prefetch purpose and `Sec-Fetch-Site` check
- `src/lib/services/shop-gate.ts:86-92` - host allow-list: plain https, default port, `SHOP_HOSTS`
- `src/lib/services/shop-gate.ts:98-117` - reserve before the network; skipped outcomes
- `src/lib/services/shop-gate.ts:165-172,196-197` - `shopGateFor`: no client means skip; `globalThis.fetch` looked up per call
- `supabase/migrations/20260926112205_polite_shop_access.sql:5-15,40-44,65-67,99-114,129-130` - the shops table, seeded rows, `stopped` before counting, pause and block, grants
- `supabase/migrations/20260928011450_price_observations.sql:51-56,89-127,133-137` - database-set columns, watcher-only RLS, column grants
- `src/lib/services/price-comparison.ts:61-78` - `needsRefetch` (15 min, ended promotion)
- `src/lib/services/price-comparison.ts:164-177,258` - `compareShops` and eligibility (fresh and orderable; lone row never marked)
- `src/lib/services/price-comparison.ts:536-538` - list screen-reader line for a stale two-shop row
- `src/lib/services/price-refresh.ts:128-137` - `refreshCodeOf`: none, failed, done, partial
- `src/lib/services/natura-view.ts:292-339` - `repinView`: unavailable gives no options, a warning, and a decline from a match
- `src/components/watchlist/NaturaSection.astro:136-153` - the "Żaden z nich" form and the "Anuluj" link
- `src/lib/shop-messages.ts:23-27,51-57` - texts for paused, stopped and failed shops
- `src/lib/notices.ts:49,143,149,160,172` - texts for removal and refresh outcomes
- `src/components/watchlist/ShopCard.tsx:39,81,86,106,112` - "Odświeżam…", "Najtaniej", "Nieaktualna", "niedostępny online", "cena online · {age}"
- `src/components/watchlist/WatchlistRow.astro:88` - `RowTag client:media="(min-width: 64rem)"`
- `src/pages/watchlist/[id].astro:119,130,137,322` - Natura step, re-pin lookup, first lookup, `PriceComparison client:load`
- `src/layouts/WatchlistShell.astro:51,63,89` - main pane clip, skip link, list aside hidden below lg
- `src/styles/global.css:359,415-418,423` - `hit-area`, focus ring, the bar's scroll padding
- `.github/workflows/ci.yml:40-48,49-64,65-72` - local Supabase into `.env` and `.dev.vars`, database checks, build, preview, smoke
- `scripts/check-shop-gate-db.mjs:73-95` - pauses Natura and stops Hebe in CI
- `scripts/check-prices-db.mjs:17-22` - local-only guard pattern
- `supabase/config.toml:160,171,192,206,211` - JWT expiry, sign-up on, rate limit, email sign-up, no confirmations
- `node_modules/astro/dist/cli/preview/index.js:45-50,87-89,115-126` - agent backgrounding; refusal of a second preview
- `node_modules/astro/dist/cli/server.js:111-169` - background start and reuse
- `node_modules/@astrojs/cloudflare/dist/entrypoints/preview.js:21-47` - preview = Vite preview + Cloudflare plugin over the build
- `node_modules/@cloudflare/vite-plugin/dist/index.d.mts:69-83,141-150` - plugin options (no outbound-fetch hook)
- `node_modules/eslint-plugin-react-hooks/cjs/eslint-plugin-react-hooks.development.js:54894-54895` - `use` counts as a hook name

## Architecture Insights

- **"No live shops" is a state of the environment, not a mock.** In the inspected code, the deployment's own politeness switch (`shops.enabled`) is the only lever. Because the switch applies to the whole deployment, any test that flips it must be bound to the local stack.
- **Prices are judged on the server's clock at render.** The island re-judges every 60 s, and refetches on its own only after the user's own navigation. So seeded ages set at insert time stay stable for the length of a test, and prices younger than 15 minutes make a page view cost nothing.
- **The state decisions inspected here live in browser-safe services** that the pages and the island share (`price-comparison.ts`, `watchlist-rows.ts`, `price-comparison-state.ts`). The browser's job is to show that the rendered pages carry those decisions and that the island and no-JavaScript paths deliver them, not to re-decide them.
- **Decisions are written conditionally** (`replaces` compare-and-swap). Seeding a decision through the route needs the current decision named; seeding through the table needs only the owner's token.

## Historical Context (from prior changes)

- `context/archive/2026-09-28-cheapest-shop-today/plan-brief.md:32-33,39` - the decision record for 24 h, 15 min, "only fresh orderable can win", ties
- `context/archive/2026-09-28-cheapest-shop-today/plan.md:879-881` - review F1: an ended promotion is stale, and its end day stays fresh
- `context/archive/2026-09-30-etykiety-redesign/follow-ups/review-fixes.md:20` - deferred: withhold "Najtaniej" while a shop is pending
- `context/archive/2026-09-30-etykiety-redesign/plan.md:1137,1186-1197,1213,1220` - zero hydration passing SSR checks; layout and tap bugs; agent page loads with `Purpose: prefetch`
- `context/archive/2026-10-01-fix-matches-and-watchlist/plan.md:935-941,958-962` - agent-run browser checks with Rossmann and Natura disabled locally (the precedent for this phase)
- `context/archive/2026-09-29-product-page-ui/reviews/impl-review.md:68-76` - focus invisible in forced-colors mode (F2)
- `context/archive/2026-09-26-polite-shop-access/reviews/impl-review.md:109-121` - F4, "Illegal invocation" on workerd
- `context/archive/2026-09-27-watchlist-add-by-search/plan.md:570-573` - merged before its migration reached production
- `context/deployment/deploy-plan.md:216-219` - production sign-up open until the setting was saved

## Related Research

- `context/archive/2026-09-28-cheapest-shop-today/research.md` - shop price fields, refetching, shared storage, the cap
- `context/archive/2026-10-01-fix-matches-and-watchlist/research.md` - removal, re-pinning, row-level rules on decisions

## Risk response guidance: verdicts (input for `/10x-plan` and the test plan's backport check)

| Risk | Guidance item                                                                                         | Verdict                                                                                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #7   | prove: list, product, price with age, refresh, remove, re-pin; phone; production build; no live shops | **Narrowed.** "Re-pins a match" can be proved without a shop answer only as removing a wrong match ("Zmień", then "Żaden z nich") and "Anuluj". Refresh can be proved only as the refused path: last price kept with its age, the stopped notice, `?prices=failed` without JavaScript. |
| #7   | challenge "server HTML that looks right means the page works"                                         | **Confirmed.** The product area is server-rendered and then hydrated (`[id].astro:322`), and zero hydration once passed SSR and unit checks (`etykiety-redesign/plan.md:1137`).                                                                                                        |
| #7   | challenge "the dev server behaves like the production build"                                          | **Confirmed.** The preview runs the built Worker on workerd; dev-only faults (Vite cache) and dev-only routes (`/dev/*`) differ.                                                                                                                                                       |
| #7   | challenge "mocking the browser's requests keeps the shops out"                                        | **Confirmed false.** Shops are called from the Worker; the browser's only price request is the app's own JSON route (section 1).                                                                                                                                                       |
| #7   | ground "how shops stay out (recorded answers or shops disabled)"                                      | **Corrected.** Recorded answers can't reach the production build. Stop Rossmann and Natura in the local `public.shops` and seed the data.                                                                                                                                              |
| #7   | avoid (unit-covered e2e, fixed waits, shared data, pixel snapshots)                                   | **Holds.** Add: waiting for "no `astro-island[ssr]`" on a phone-width product page never resolves; reusing shop item ids leaks earlier runs' prices.                                                                                                                                   |
| #1   | prove "no shop is marked cheapest unless its price is fresh and orderable"                            | **Holds for each marked shop; corrected for "still loading".** A fresh, orderable shop is marked beside a loading, never-checked or stale one, by decision (follow-up open). Only an unread row withholds every mark.                                                                  |
| #1   | prove "every price shows its shop and age"                                                            | **Holds visually on both pages.** The list's screen-reader line for a stale two-shop row drops price, shop and age (`price-comparison.ts:536-538`).                                                                                                                                    |
| #1   | prove "an unread shop shows a gap"                                                                    | **Partly reachable.** A read failure can't be made by normal seeding; the inferred `'infinity'` row is unverified. The cheap rendered gaps are "Jeszcze bez ceny" and the refused refresh. Read-failure gaps fit Phase 2.                                                              |
| #1   | challenge "the list and the product page read prices the same way"                                    | **Confirmed false** in three inspected ways (section 3). Two need database faults and fit Phase 2; the third shows only from 1024 px.                                                                                                                                                  |
| #1   | challenge "a stored price is a current price"                                                         | **Holds.** Freshness is judged at render; the list page asks no shop; the island refetches on its own only after the user's own navigation, and only for checks older than 15 min.                                                                                                     |
| #1   | cheapest layer "unit + integration; one rendered check in Phase 1"                                    | **Confirmed.** The rules are unit-tested; rendering isn't.                                                                                                                                                                                                                             |
| #1   | avoid "expected values copied from the rule"                                                          | **Holds.** Take them from the PRD and the S-03 plan brief. Add: computing an ended promotion's "yesterday" in UTC.                                                                                                                                                                     |
| #2   | prove "Workers-only breakage fails before a merge"                                                    | **Narrowed.** True for the rendered flows on the CI preview. None of the three cited incidents would have been caught; Phase 4 stays their protection.                                                                                                                                 |
| #2   | challenge "green Node tests mean it works on Workers"                                                 | **Confirmed** by F4 (Node green, workerd threw), though that path had no live caller.                                                                                                                                                                                                  |
| #2   | avoid "production secrets or writes to production"; "a smoke that asserts only status 200"            | **Holds, with a concrete guard.** Refuse non-local Supabase, because the block RPC would stop production shops. `/` answers 200 without secrets, so assert a signed-in state.                                                                                                          |

**Cheapest useful layer, confirmed per risk:**

- **#7:** e2e on the preview at phone width, 2–3 flows. No cheaper layer renders the island, the no-JavaScript posts, `<details>`, the layout or focus.
- **#1:** unit tests (exist), plus Phase 2's integration for the read seams, plus one rendered check on both pages in Phase 1.
- **#2:** smoke (exists), plus the e2e on the same preview, plus Phase 4 for failures that happen only in production.

**Test-plan backport candidates** (§2 Risk Response Guidance only, no anchors):

- **#7:** re-pin intent narrowed to "removes a wrong match through the re-pin choice"; "how shops stay out" corrected to "shops stopped in the local database plus seeded data; recorded answers can't reach the production build".
- **#1:** "still loading" removed from the states that may not be marked, or the rule changed first (owner's call). "Unread" reachable only through database faults (Phase 2).
- **#2:** Phase 1 catches rendered-flow breakage on workerd only; the cited incidents need Phase 4.
- **Hot-spot evidence:** reproduced and not misleading.

## Open Questions

Decisions for `/10x-plan` and the owner:

1. **Re-pinning to another candidate.**
   - Option A: keep the e2e's re-pin flow as "Zmień" → "Żaden z nich" or "Anuluj", with Natura stopped, and leave candidate choice to the existing unit tests (`natura-view`) and the route's schema.
   - Option B: add a test-only shop seam, for example an environment-gated mock host. That's a production code change to a security-sensitive host allow-list (`shop-gate.ts:86-92`).
   - Option C (live Natura) is ruled out by test plan §7.
2. **Prices older than 24 hours.** Superuser SQL on the local database (new to the repo; local only), or leave the stale state to unit tests and seed only states the user's own token can create: fresh, not orderable, ended promotion, missing, never checked.
3. **The cheapest mark while a shop is loading.** Keep the S-03 rule, so the e2e asserts that a fresh shop is marked while the other loads, or change the product first (the open follow-up). This is a product decision outside Phase 1's test scope.
4. **CI wiring.** The test plan's §5 makes "e2e on critical flows" required after Phase 1, and `/10x-e2e-setup` won't touch CI.
   - Option A: a step in the `smoke` job. It shares the stack, but inherits the shop state left by the gate check and the sign-in budget already spent, and must reuse or avoid the running preview.
   - Option B: a separate job. It needs its own `supabase start` and build (the extra time wasn't measured here).
5. **Turning shops back on locally** after a run. Superuser SQL in teardown, a documented manual step, or leave them stopped on the developer's stack. `db reset` deletes local users.
6. **Users per run** within 30 sign-ins and sign-ups per 5 minutes per IP: one user per spec file through the UI, or supabase-js sign-ups in a setup step. The e2e's own seeding via supabase-js costs one sign-in per user.
7. **The screen-reader line for a stale two-shop row**, which has no price, shop or age. Report it to the owner as an accessibility finding (S-07?) or make it a Phase 1 assertion.
8. **Unverified runtime facts** to check during setup:
   - whether `promo_ends_on = 'infinity'` really produces an unread row;
   - how Playwright text matching treats U+00A0;
   - whether `aria-disabled` counts as disabled for Playwright's actionability checks;
   - the role Playwright gives `<summary>`;
   - whether local workerd enforces Workers' connection and subrequest limits.
