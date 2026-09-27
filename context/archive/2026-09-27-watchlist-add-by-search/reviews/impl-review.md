<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Watchlist: Add a Product by Searching

- **Plan**: context/changes/watchlist-add-by-search/plan.md
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
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Evidence

- **Automated checks**, rerun on `b57c343`:
  - `npm run test`: 92/92 passed
  - `npx astro check`: 0 errors
  - `npm run lint`: clean
  - `node scripts/check-watchlist-db.mjs`: passed, run against the local stack without a reset, so the owner's local account survives
  - CI `ci` and `smoke`: green, including the database checks and the smoke test against the production build
- **Manual checks**:
  - 1.4 and 2.5 were reviewed in the session.
  - 3.6: the owner's local account has "Soft 300 ml" on its list. The second-user step wasn't done; the two-user database check covers its database side.
  - 4.2–4.5 were confirmed by the owner. Production can't be seen from the repository.
- **Plan drift**: nothing is missing and no guardrail is broken. The drifts are documented and sound except for the adapter strictness in F1.

## Findings

### F1 — Some Rossmann results can't be added

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shops/rossmann.ts:94 (form limits in src/lib/services/watchlist.ts:21-35)
- **Detail**:
  - The adapter keeps every well-formed EAN and applies no text limits. `watchlistAddSchema` allows:
    - at most 10 EANs
    - a name up to 300 characters, a brand up to 120, a caption up to 300 and size text up to 40
    - an image URL up to 500 characters
  - A result over any limit shows "Dodaj", and adding it always fails with "nieprawidłowe dane". Real data triggers this: recorded Rossmann item 17420 has 12 EANs.
  - The adapter's item schema is also stricter than intended:
    - A picture with `medium: null` or `type: null`, or a numeric EAN, drops the whole item.
    - A `spellCheckHint` that isn't a string makes the whole search unavailable.
- **Fix**: share the limits between the adapter and the form.
  - The adapter keeps the first 10 EANs, trims or drops over-long text, and reads pictures, EANs and the hint leniently.
  - Add a test that every recorded item passes `parseWatchlistForm` as the page posts it, `recommendedProducts` included.
  - Add tests for the first-picture fallback and for the suppressed hint.
- **Decision**: FIXED: `src/lib/services/product-limits.ts` holds the limits for both the adapter and the form. The adapter keeps the first 10 EANs, cuts or drops over-long text, and reads pictures, EANs and the hint one by one. A test posts every recorded item through `parseWatchlistForm` the way the page does.

### F2 — Thumbnails hide the app's origin from Rossmann's CDN

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/watchlist/ProductSummary.astro:18-27
- **Detail**:
  - `referrerpolicy="no-referrer"` was meant to keep `?q=` away from the shop. The browser's default policy, `strict-origin-when-cross-origin`, already sends only the origin to another site.
  - What it actually adds is hiding the deployment's origin. That would also slip past a Referer-based hotlink filter Rossmann might add, which comes close to the "never circumvent" rule.
  - Either way, every view sends the viewer's IP address and the watched products' image paths (Rossmann item ids) to `pro-fra-s3-productsassets.rossmann.pl`, outside the gate.
- **Fix A ⭐ Recommended**: Drop `referrerpolicy="no-referrer"`, so Rossmann's CDN sees the origin but never the path or query. Record in the plan that viewers' IP addresses and watched items reach the CDN.
  - Strength: Rossmann can see the hotlinking and block it if it wants, which fits "never circumvent". The search text still never leaves the app.
  - Tradeoff: The workers.dev subdomain appears in Rossmann's CDN logs, though not in the public repository.
  - Confidence: HIGH. How the default policy behaves is standard.
  - Blind spot: Whether Rossmann ever filters hotlinks.
- **Fix B**: Keep `no-referrer`, and record the reason, keeping the subdomain out of third-party logs, as an accepted choice.
  - Strength: Nothing about the deployment reaches Rossmann's logs.
  - Tradeoff: It looks like evasion if Rossmann ever adds a hotlink filter.
  - Confidence: MED. It depends on how the rule is read.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A): `referrerpolicy="no-referrer"` is gone. That viewers' IP addresses and watched items reach Rossmann's CDN is recorded in plan.md, Implementation Notes.

### F3 — Every search failure says "try again shortly"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist.astro:96-100 (`ProductSearch` in src/types.ts)
- **Detail**:
  - Every gate outcome other than `ok` becomes `unavailable`, which the page shows as "chwilowo niedostępna. Spróbuj za chwilę."
  - After a 403 the shop stays stopped until the owner re-enables it, and a pause can last 24 h.
  - So users are told to retry something that won't come back by itself, and the owner only finds out from the logs.
- **Fix**: Carry the gate's reason inside `unavailable`. Word `stopped` and `paused` (with its end time) differently from a failed call.
- **Decision**: FIXED: `unavailable` carries `busy`, `paused` (with its end), `stopped` or `failed`, and the page words each one. A stopped shop says that the owner has to re-enable it.

### F4 — The middleware's header handling has two gaps

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:22-35
- **Detail**:
  - **Early redirect:** the redirect to sign-in (`:24`) returns before the collected `setAll` headers are applied. A session cleared during `getUser()` therefore goes out without them.
  - **Read-only headers:** headers are set in place on the response from `next()`. A future `Response.redirect()` or proxied `fetch()` has read-only headers, which would throw and give every signed-in user a 500.
  - Both are harmless today.
- **Fix**: Apply the collected headers to the early redirect too. Set headers through a helper that rebuilds the response (`new Response(response.body, response)`) when its headers are read-only.
- **Decision**: FIXED: the early redirect gets the collected headers too, and `withHeaders` copies a response whose headers are read-only. Tests cover both paths.

### F5 — A link on another site can make a signed-in browser search Rossmann

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist.astro:13-19
- **Detail**:
  - The GET search runs on any top-level navigation, and the session cookie is `Lax`.
  - A hostile page could therefore drive a signed-in user's browser to use up the shared 30-per-minute cap.
  - It could also send allowlisted text that a firewall might flag, such as `' or sleep(5)`, and one 403 stops Rossmann for everyone.
  - Likelihood is low: the URL isn't published, and there are few users.
- **Fix**: Search Rossmann only when `Sec-Fetch-Site` is `same-origin` or `none`, or the header is absent. Otherwise show the form filled in, without searching.
- **Decision**: FIXED: the page searches only when `Sec-Fetch-Site` is `same-origin` or `none`, or absent. A cross-site link shows the form filled in; checked against the local build.

### F6 — A slow answer keeps the page blank for up to about 10 s

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist.astro:18-21, src/lib/services/watchlist.ts:98-102
- **Detail**:
  - The page sends nothing until the search finishes: up to 2 s for the reservation, plus 8 s for the fetch and body.
  - Users resubmit, and every resubmit costs a slot under the cap.
  - `listWatchlist` has no time limit at all, unlike the gate's 2 s database calls.
- **Fix**: Give the interactive search a 5 s limit through `init.signal`, and add `.abortSignal(AbortSignal.timeout(2000))` to the list query.
- **Decision**: FIXED: the search has a 5 s limit through `init.signal`, and both watchlist queries a 2 s `abortSignal`. Tests check that each call gets a signal.

### F7 — The page shows any text from `?error=`, and the add route returns 500 for a non-form body

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/watchlist.astro:29, :86-90; src/pages/api/watchlist.ts:15
- **Detail**:
  - **Free-text errors:** the page shows free text from `?error=` as an alert, so any link can put its own message into the signed-in page. That's content spoofing: the text is escaped, so it isn't XSS. The route only ever sends three fixed messages.
  - **Unwrapped form parsing:** `formData()` isn't wrapped, so a same-origin request whose body isn't a form gets a 500 instead of the error redirect.
- **Fix**: Redirect with error codes (`invalid`, `failed`, `config`) that the page maps to Polish text, and treat a failed `formData()` as invalid.
- **Decision**: FIXED: the route redirects with `invalid`, `failed` or `config`, and the page shows only its own text for those codes. A body that isn't a form counts as invalid.

### F8 — Shop ids are repeated by hand, and one odd row empties the list

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/watchlist.ts:85
- **Detail**:
  - `rowSchema.source` is a fourth hand-kept copy of the shop ids, next to `ShopId`, `SHOP_HOSTS` and the seed rows.
  - The rows are parsed as one array, so a single row from a newly added shop blanks the whole list. The adapter, by contrast, checks items one at a time.
- **Fix**: Take the shop ids from one constant that `ShopId`, `SHOP_HOSTS` and `rowSchema` all use. Parse rows one at a time, and drop and log any that don't fit.
- **Decision**: FIXED: `SHOP_IDS` in `src/types.ts` feeds `ShopId`, `SHOP_HOSTS` and `rowSchema`. Rows are parsed one at a time, and odd ones are dropped and logged.

### F9 — The plan and the deploy plan don't match what shipped

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/watchlist-add-by-search/plan.md; context/deployment/deploy-plan.md (Deferred)
- **Detail**:
  - **`plan.md`** still describes the contract from before the adaptations:
    - a `q` field in the add form
    - "the first valid picture"
    - a trimmed name with no fallback
    - the plain hint rule
  - The additions (`ProductSummary`, `WatchlistItem`, the CLAUDE.md notes) are recorded only in commit messages and this session.
  - **The deploy plan's Deferred list** still shows Workers Paid and the anti-caching headers as pending. This change closed both, and CLAUDE.md sends readers to that file for what is live.
- **Fix**: Add an "Implementation Notes" section to `plan.md`, before Progress. In the deploy plan, mark Workers Paid (active since 2026-09-27) and the anti-caching headers (done in S-01) as done.
- **Decision**: FIXED: plan.md has an Implementation Notes section. The deploy plan marks Workers Paid (since 2026-09-27) and the anti-caching headers as done, and its record shows the Paid plan.

### F10 — Notes for S-02 and later

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260927145051_watchlist_items.sql:9, :18-19; src/pages/watchlist.astro:51
- **Detail**:
  1. **Database bounds:** only `name` is bounded in the database.
     - `source_item_id`, `image_url`, `eans` and the text columns rely on the route's zod check.
     - The page shows `image_url` from the database without checking it again.
     - S-02 will build Rossmann URLs from `source_item_id`.
  2. **Search text in logs:** search text sits in `/watchlist?q=…`, so Workers Logs keeps it for days (observability is on). The plan brief already accepted this.
- **Fix**: Record both in the plan's Implementation Notes for S-02:
  - Validate and encode `source_item_id` wherever it goes into a URL.
  - Add database checks in S-02's migration: length caps, `image_url ~ '^https://'` and `cardinality(eans) <= 10`.
  - Keep the logging of search text as an accepted risk.
- **Decision**: FIXED: recorded for S-02 in plan.md, Implementation Notes: encode `source_item_id` in URLs, add the database checks in S-02's migration, and keep search text in logs as an accepted risk.

## Triage (2026-09-27)

- **Fixed:** F1, F2 (Fix A), F3, F4, F5, F6, F7, F8, F9, F10
- **Accepted risks, recorded in plan.md:** viewers' IP addresses and watched items reach Rossmann's CDN (F2); search text stays in Workers Logs (F10).
- **Verification:**
  - 122/122 unit tests
  - each new or changed test went red on deliberately broken code (23 breaks)
  - lint, `astro check` and build pass
  - the local smoke test passes 10/10 against the production build
  - against the same build, a cross-site link to a search only fills in the form, and a crafted `?error=` text isn't shown
