# Watchlist: Add a Product by Searching — Plan Brief

> Full plan: `context/changes/watchlist-add-by-search/plan.md`

## What & Why

A signed-in user searches Rossmann's product search by name (and size), picks one result, and finds that product on their private watchlist. This is roadmap slice S-01 (FR-003, FR-004 and the add half of FR-005). It's the first time the app calls a shop and the first time it stores personal data. Every later slice starts from a watched product, so S-01 opens the path to the north star, S-03.

## Starting Point

- **Pages:** only auth and the starter's placeholder pages exist. Sign-in lands on `/`, and `/dashboard` is the only protected page.
- **The gate:** F-01's gate is live and its migration is on production, but nothing calls it yet.
- **The Supabase client:** the middleware builds one per request, but the routes build a second one, and `@supabase/ssr`'s cache headers are dropped.

## Desired End State

- **Landing:** sign-in lands on `/watchlist`, a Polish page with a search box and your list.
- **Search:** a search shows up to 24 Rossmann results, each with a thumbnail, brand, name, description and size. A misspelling offers "Czy chodziło Ci o…?".
- **Adding:** "Dodaj" puts the product on your list, and no one else can see it.
- **Caching:** signed-in pages are never cached.

## Key Decisions Made

| Decision         | Choice                                                                      | Why (1 sentence)                                                                    | Source             |
| ---------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| Search source    | Rossmann only, with a clear "unavailable" message                           | It's the research note's name-and-size resolver, with no key read from a shop page  | Plan (research §6) |
| When search runs | On submit, with "Czy chodziło Ci o…?" from Rossmann's hint                  | Easy on the shared cap and works without JavaScript; answers PRD Open Question 3    | Plan               |
| Size input       | One search box; each result shows its size                                  | One field on a phone, and picking fixes the exact size                              | Plan               |
| Results show     | Brand, name, description, size and a thumbnail                              | The picture tells variants apart; prices wait for S-03                              | Plan               |
| Storage          | Private per-user rows that carry the product's identity                     | Nothing is shared, so nothing can be inferred, and the RLS is the simplest possible | Plan               |
| UI language      | Polish                                                                      | Polish shops, products and users                                                    | Plan               |
| Placement        | New `/watchlist`, where sign-in lands                                       | Opens on what you use at the shelf; the front door stays with S-07                  | Plan               |
| Adding           | The chosen result's fields are posted and validated; no second shop call    | Tampering only affects your own row, and it saves a request                         | Plan               |
| Cache headers    | One client per request, and `private, no-store` on every signed-in response | The deploy plan's trigger was "before the first page with user data"                | Deploy plan        |
| Fixtures         | Three real responses, recorded once with curl                               | Tests follow Rossmann's real shape and never reach a live shop                      | F-01               |
| Rollout          | Workers Paid and `db push`, both before the merge                           | The first shop-calling feature needs CPU headroom, and the page needs its table     | Deploy plan / F-01 |

## Scope

**In scope:**

- the `watchlist_items` table with per-user RLS, and its two-user database check
- the Rossmann adapter, size parsing and search-text validation, with recorded fixtures
- the `/watchlist` page, the add route and the cache headers
- the sign-in landing, the top-bar link and new smoke steps
- CLAUDE.md rules
- your Workers Paid switch and `db push`

**Out of scope:**

- removing entries (S-08), shop matching (S-02) and prices (S-03)
- other shops' search, search as you type, pagination and a size filter
- search caching and new bindings
- a shared products table
- front-door changes beyond the landing (S-07)
- image proxying

## Architecture / Approach

1. `/watchlist?q=…` validates the search text with zod.
2. `searchRossmann(shopGateFor(locals.supabase), q)` runs. The gate reserves a slot and calls Rossmann.
3. The page renders the candidates, each with a "Dodaj" form.
4. `POST /api/watchlist` validates the form and inserts through the user's own client, and RLS keeps the row private.
5. The route redirects back to the list.

The middleware owns the request's single Supabase client and marks every signed-in response `private, no-store`.

## Phases at a Glance

| Phase                          | What it delivers                                                                  | Key risk                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. Watchlist data contract     | Private table, RLS, grants, and a two-user check in CI                            | A policy or grant gap; the check against production-like grants catches it                   |
| 2. Rossmann search             | Fixtures, the adapter, size and text rules, and replay tests                      | Rossmann's real response differs from the research note; recording fixtures first catches it |
| 3. Watchlist page and add flow | The Polish page, the add route, one shared client, the cache headers, smoke steps | Losing the cache headers through a second client                                             |
| 4. Docs and production rollout | CLAUDE.md, plus your Workers Paid switch and `db push`                            | Merging before `db push` would deploy a page without its table                               |

**Prerequisites:**

- Docker, for the local database check (CI runs it anyway)
- the Supabase link from F-01, for `db push`
- access to the Cloudflare billing settings

**Estimated effort:** about 2–3 sessions across 4 phases. Phase 4 is mostly your steps.

## Open Risks & Assumptions

- **Unrecorded shapes:** the shapes of Rossmann's `pictures[]` and `spellCheckHint` aren't recorded yet. The fixtures settle them; without a usable image URL, a result just has no thumbnail.
- **Size words in the query** may not narrow Rossmann's results. That's untested, but the result list shows every variant's size either way.
- **Search is down** whenever Rossmann is paused, stopped or capped. That's accepted with the Rossmann-only choice.
- **Thumbnails load from Rossmann's CDN** in the browser, outside the gate. They're ordinary image loads, with no referrer.
- **Search text appears in the page URL,** so it also appears in the Worker's request logs, which only the account owner can read.
- **Duplicate copies:** two users watching the same product store it twice. That's accepted with per-user rows.

## Success Criteria (Summary)

- On your phone, you sign in, search "nivea soft", tap "Dodaj", and see the product at the top of your list.
- Another signed-in user can't see, infer or change your list. CI proves this with two users.
- Every Rossmann call goes through the gate with validated text, and CI never calls a live shop.
