# Shop answer contracts (test plan rollout Phase 3) Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md` proves risks #5 and #3 at the adapters, where the research (`research.md`) found the gaps:

- **#5:** a changed shop answer becomes a visible gap or a failed check, never a stored price, "not found" or "missing".
- **#3:** a refused answer stops or pauses that shop, with nothing more asked, on every path.

Unlike rollouts 1 and 2, this phase is not tests only. Five latent defects (D1–D5) store or show a wrong fact today when a shop changes its answer. A test written against today's code would pin each defect, so each gets a small production fix first, then broken copies of the real recordings that prove the fix. Beside them come:

- the owner's call that a refresh stops asking a failing shop;
- per-path refusal tests;
- two database proofs for the gate;
- the docs.

## Current State Analysis

- **Refusals are handled right** (research §1, §3):
  - The gate maps every refusal to `unavailable` (`src/lib/services/shops/shop-outcome.ts:15-34`). Nothing is stored for it (`src/lib/services/shop-matching.ts:375-377`, `src/lib/services/prices.ts:57-75`).
  - On all four paths that reach a shop, a refusal ends that shop's requests.
  - Many refusal kinds are pinned only in the gate's own tests: a 429, a challenge and a 503 with Retry-After on a path, a lookup's name search refused after an EAN miss, and Hebe's search.
- **D1, Rossmann price:** any 404 is `missing` (`src/lib/services/shops/rossmann.ts:105-107`), because the gate discards a non-2xx body and type (`src/lib/services/shop-gate.ts:157-158`). A moved route would add a `missing` row for every due Rossmann item, shared by every watcher, and the refresh would report `done`.
- **D2 and D3, Natura and Hebe:** `isItemHit` (`src/lib/services/shops/luigis-box.ts:202-217`) skips any hit whose `type` isn't the shop's item type as a "query suggestion", silently.
  - On the search (`:128`, guard at `:146-150`), an answer of only such hits reads as "found nothing", and a lookup stores `not_found`.
  - On prices (`:170`; `src/lib/services/shops/pinned-prices.ts:93-141`), such an answer reads as clean, and every asked id is stored as `missing`.
  - `natura.test.ts:269` pins today's reading with a made-up suggestion `{url, attributes: {}}`. The only suggestion ever recorded is Hebe's `type: "query"` (`hebe-name-search.json`).
- **D4, empty search with a count:** the Luigi's Box search ignores `total_hits`, and Super-Pharm's search (`src/lib/services/shops/super-pharm.ts:118-150`) ignores `nbHits` and `page`. So `hits: []` beside a count above 0 reads as "found nothing". Both price paths do check their counts.
- **D5, Rossmann search:** if every item fails its check, the search returns zero candidates and the page says „Brak wyników” (`rossmann.ts:78-86`). The other adapters fail in that case.
- **Silent value changes** (research §2.6), with no log line:
  - Rossmann's or Natura's odd `availability` reads as not orderable.
  - Natura's (`price_old_amount`, `lowest_price`) and Hebe's (`price_omnibus_amount`) unreadable optional prices are dropped.
- **Plain failures keep a refresh going.** `isRefusal` excludes `failed` (`shop-outcome.ts:10-12`). So a hanging shop costs up to its cap in one refresh (`src/lib/services/price-refresh.ts:86-105`, `pinned-prices.ts:71-86`), and an unreachable counter is asked again for every remaining item.
- **Tests:**
  - Hebe and Super-Pharm follow §6.4's broken copies.
  - Natura has no broken-copies block.
  - Rossmann's copies change values but never remove a field (`rossmann.test.ts:63-65`).
  - Rossmann's and Natura's test headers don't date every fixture.
- **`scripts/check-shop-gate-db.mjs`** doesn't prove that a refused reservation inserts no row, or that a shorter report never shortens a longer pause.

## Desired End State

- **No changed answer the research traced stores a wrong fact:**
  - only Rossmann's problem+json 404 is `missing`;
  - any hit that isn't the shop's item and isn't a `type: "query"` suggestion counts as dropped, on Natura's and Hebe's searches and prices;
  - an empty search reads as "found nothing" only when the shop's own count says 0;
  - Rossmann's search fails when every item fails its check.

  Each case is proven by a broken copy of a real recording, served through the real gate, with its expected outcome taken from the owner's calls and the lessons, never from the code.

- **The silent value changes write a log line,** and their values stay as stored today.
- **A refresh stops asking a shop after two failed requests in a row,** an unreachable counter included.
- **Every path pins its refusals through the real gate,** counting the requests served: a lookup, a re-pin choice, the price route and the refresh.
- **The gate's database check proves** that a refused reservation inserts no row, and that a shorter report never shortens a longer pause.
- **Docs:**
  - the test plan's §2 (risk #5), §6.4, §6.6 and §7 match what shipped;
  - §3 marks Phase 3 complete after the owner's review;
  - `CLAUDE.md`'s shop rules say the new reads.

Verified by each phase's Success Criteria: the unit suite locally, and CI's `ci`, `smoke` and `e2e` jobs.

### Key Discoveries:

- The gate's failed outcome is `{ kind: "failed"; reason: "timeout" | "network" | "http"; status?: number }` (`src/types.ts:18-23`). It's logged whole, in `ShopGateLogEntry.outcome`.
- Every recorded empty answer carries a zero count: `rossmann-search-empty.json` (`totalCount` 0), `natura-ean-miss.json`, `natura-sku-unknown.json` and `hebe-id-unknown.json` (`total_hits` 0), and `super-pharm-search-empty.json` (`nbHits` 0, `page` 0, `nbPages` 0). So "empty means nothing found only when the count says 0" agrees with every recording.
- The only recorded Rossmann 404 (`rossmann-detail-unknown.json`) is `application/problem+json; charset=utf-8`.
- `fetchPinnedPrices` (`pinned-prices.ts:50-86`) already marks unsendable ids `failed` before any request, and carries a refusal to later batches. Rossmann's loop (`price-refresh.ts:90-105`) does the same one product at a time.
- `readHits` computes `complete` from the raw hits and `total_hits` (`luigis-box.ts:259-267`). Super-Pharm's `requestPrices` computes it from `nbHits`, `page` and `nbPages` (`super-pharm.ts:256-257`).
- The replay supports response `headers` (`rossmann.test.ts:282`). So a 503 with Retry-After, a challenge and a content type can be served without new helpers.

## What We're NOT Doing

- **No live shop request.** The recordings stay as they are (the owner's call).
  - Super-Pharm's 403 is pinned with Algolia's documented error body, labelled as documented.
  - The real rejected-key answer and a real 20-id batch stay unrecorded, so the S-06 follow-up stays open in §6.6.
- **No canary or monitoring** for a catalog or index that still answers but empty or re-keyed, or for a renamed `type` on Luigi's Box's filtered price request, which answers 0 hits. No answer-shape check can catch either. Recorded in §7.
- **No change to the matching rule.** A search with a hit dropped can still accept an item by name (Super-Pharm's dropped-rival case). Recorded in §7 (the owner's call).
- **No price-unit cross-check** against Super-Pharm's `default_formated`, and no check for Hebe's renamed sale price, which is undetectable since a missing sale is normal. Both recorded in §7.
- **No new outcome kind for an unreachable counter.** It reads as `failed`, so the two-failure rule stops it after at most two reservation attempts.
- **No relabelling** of Luigi's Box's 404 log line ("tracker id rejected"). Its outcome, `failed`, is right, and the runbook names it.
- **No widening of the fetch lint rule** to `src/components/**/*.tsx`, whose islands fetch only in the browser, or to aliases of `globalThis`.
- **No database proof** of the 900 s default, the 1–86400 s clamp or a pause's expiry. The gate's Node tests pin the first two (the owner's call).
- **No e2e changes,** and no change to the per-shop (not per-host) stop: a Luigi's Box refusal under Hebe's tracker leaves Natura going, as intended and pinned.

## Implementation Approach

- **One shop family per phase,** ordered by what a wrong fact costs:
  - Rossmann first: D1 marks every watcher's item gone, and needs the one gate change.
  - Then Natura and Hebe on the shared client (D2–D4).
  - Then Super-Pharm (D4).
  - Then the paths and loops (risk #3).
  - Then the docs.
- **Within a phase, fix first, then pin.** Each fix's test is a broken copy that goes red on today's code, which is the phase's break check.
- **Expected values** come from:
  - the owner's calls of 2026-10-07 (this plan's Key Decisions);
  - the PRD's guardrail ("never silent");
  - the lesson "Never read an unreadable answer as missing";
  - the recordings' own answers.

  Never from the code under test.

- **Broken copies** follow §6.4: one plausible change to a deep copy of a real recording (`structuredClone`), or a page or empty body where the JSON was, served through `createShopGate` over `vi.fn(createReplayFetch(...))`.
- **Tests assert the requests served and the reservations,** never only the outcome. A request the replay doesn't know reads as `failed/network`.

## Critical Implementation Details

- **Natura's made-up suggestion.** `natura.test.ts:269` ("finds nothing, and logs no drop, when the only hit is a query suggestion") pins the reading the owner replaced. Under the new rule its `{url, attributes: {}}` hit counts as dropped, and the search fails. Update that test's expectation, keep Hebe's recorded `type: "query"` hit skipped, and record both in the Implementation Notes.
- **What counts toward the two-failure stop.** Count a request whose answer is `unavailable` with reason `failed`, the counter's skip included. An id that never becomes a request counts for nothing (an invalid stored id), and neither does a refusal, which already stops the shop. A request that got an answer resets the count, whatever the answer holds: a price, a missing item, or an answer some of whose hits couldn't be read.

## Phase 1: Rossmann's answers (D1, D5)

### Overview

The gate keeps a failed answer's content type, so Rossmann can tell its product-gone 404 from any other. Rossmann's search fails instead of saying „Brak wyników” when its answer can't be read. Odd availability is logged. Broken copies that remove fields, and every refusal kind, are pinned through the real gate.

### Changes Required:

#### 1. The gate keeps a failed answer's content type

**File**: `src/types.ts`, `src/lib/services/shop-gate.ts`, `src/lib/services/shop-gate.test.ts`

**Intent**: An adapter that must tell two answers with the same status apart can read the media type. Today D1 can't, because the body and its type are discarded.

**Contract**:

- `GateOutcome`'s `failed` with `reason: "http"` gains an optional `contentType`: the response's `Content-Type` media type, lowercased, without its parameters, or absent when the response has none.
- The body is still discarded unread.
- The log entry carries it as part of the outcome.
- **Gate test:** a non-2xx answer with and without a `Content-Type` gives the field as stated.

#### 2. Rossmann's 404, its search and its availability

**File**: `src/lib/services/shops/rossmann.ts`

**Intent**: Read the answers the research traced the way the owner decided.

**Contract**:

- **`fetchRossmannPrice`** gives `missing` only for a 404 whose `contentType` is `application/problem+json`, as `rossmann-detail-unknown.json` recorded. Any other 404 is `unavailable/failed` (D1).
- **`searchRossmann`** gives `unavailable/failed` in two cases (D5):
  - its answer holds items but none survives its check; it logs how many items were dropped, never which;
  - `items` is empty while `totalCount` isn't the number 0.

  An empty answer with `totalCount` 0 still gives no candidates.

- **An `availability` that is missing or isn't text** is counted in an "availability unread" log line, on the price check and the search, as Hebe and Super-Pharm do. The offer still reads it as not orderable.

#### 3. Rossmann's tests

**File**: `src/lib/services/shops/rossmann.test.ts`, `src/lib/services/price-refresh.test.ts`

**Intent**: Pin every answer class of research §2.1–§2.2 through the real gate, on broken copies of the recordings.

**Contract**:

- **Behaviour asserted:**
  - The price check, a 404:
    - the recorded problem+json 404 gives `missing`;
    - the same status with `text/html`, `text/plain` or no body gives `unavailable/failed`, and in a refresh no `missing` row (`price-refresh.test.ts`).
  - The search:
    - copies of `rossmann-search-results.json` whose every item lost its `id`, `name` or the shape of `unit` give `unavailable/failed`, with the dropped count logged;
    - `{ items: [], totalCount: 5 }` and a removed `totalCount` give `unavailable/failed`;
    - the recorded empty answer still gives no candidates.
  - Removed fields on the price check: a detail without `id` and one without `price` give `unavailable/failed`. One without `oldPrice`, `lastLowestPrice` or `promotionTo` gives a price without them.
  - Availability: a detail without `availability`, or with a number there, gives a price `available: false` and one log line.
  - Refusals, each with its reservations and served requests counted:
    - on the search: a challenge (`cf-mitigated: challenge` on a 200), a 503 with `Retry-After`, a 502, a 404 and a timeout;
    - on the price check: a challenge, a 429 and a 503 with `Retry-After`.
- **Regression caught:** a moved route marking every Rossmann item gone (D1); a broken search saying „Brak wyników” (D5); a refusal kind read as a plain failure.
- **Research source:** research §2.1, §2.2, §2.6.
- **Edge cases:** a 404 with `application/problem+json` but no body; a 200 with an empty body.
- **Anti-pattern avoided:** copies shaped to what the parser already tolerates; asserting the outcome without the requests served.
- **The header** names each Rossmann fixture's request and recording date, as §6.4 asks.

### Success Criteria:

#### Automated Verification:

- Rossmann's, the gate's and the refresh's tests pass: `npx vitest run src/lib/services/shops/rossmann.test.ts src/lib/services/shop-gate.test.ts src/lib/services/price-refresh.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 2: Natura and Hebe on Luigi's Box (D2, D3, D4)

### Overview

Only a recorded kind of query suggestion is skipped; any other hit that isn't the shop's item counts as dropped, on the search and the prices. An empty search reads as "found nothing" only when its count says 0. Odd availability and unreadable optional prices get log lines. Natura gets its broken-copies block, and Hebe's search its refusal and error tests.

### Changes Required:

#### 1. The shared client

**File**: `src/lib/services/shops/luigis-box.ts`

**Intent**: A changed hit format can't be stored as `not_found` or `missing` (D2, D3), and an empty search that says it found hits can't read as "found nothing" (D4).

**Contract**:

- **A query suggestion** is a hit object whose `type` is `"query"`, and only that. It is skipped as today. Every other hit that isn't the shop's item (`isItemHit` as today) counts as dropped, on both paths.
- **On the search:** a dropped hit is counted in the "hits dropped" log line, and an answer whose non-suggestion hits all dropped gives `unavailable/failed`. An answer with no hits at all reads as "found nothing" only when it is `complete` (`next_page` null and `total_hits` the number 0). Any other empty answer gives `unavailable/failed`.
- **On the prices:** `requestPrices` hands every non-suggestion hit to the shared rules, and `readPriceHit` gives null for a hit that isn't the shop's item. So such a hit counts as dropped, the answer isn't clear, and every unanswered id is `unavailable/failed`, never `missing` (`pinned-prices.ts:131-141`).

#### 2. Natura's and Hebe's log lines

**File**: `src/lib/services/shops/natura.ts`, `src/lib/services/shops/hebe.ts`

**Intent**: A renamed value field shows in the logs; the stored values don't change (the owner's call).

**Contract**:

- **Natura gains `hasOddAvailability`:** an `availability` that isn't the number 0 or 1. It is counted on the search and the prices, as Hebe's `online_flag` is.
- **An optional price that is present but unreadable** is counted in an "offers unread" log line: Natura's `price_old_amount` and `lowest_price`, and Hebe's `price_omnibus_amount`. It is counted on the search and the prices, as Super-Pharm's `logOddOffers` does. A missing one stays normal and unlogged.
- **The log lines** say how many hits, never which.

#### 3. Natura's and Hebe's tests

**File**: `src/lib/services/shops/natura.test.ts`, `src/lib/services/shops/hebe.test.ts`

**Intent**: Give Natura the broken-copies block §6.4 asks for, give Hebe's search its missing refusal and error cases, and pin D2–D4 on both shops.

**Contract**:

- **Behaviour asserted (each through the real gate, with requests and reservations counted):**
  - **Renamed type:** a copy of a recorded search answer whose item hits all carry another `type` (`"Product"` for Natura, `"product"` for Hebe), with attributes intact, gives `unavailable/failed` and logs the dropped count. The same on a price answer gives every unanswered id `unavailable/failed` and no `missing`.
  - **Suggestions:**
    - hits that lost both `type` and attributes give the same;
    - Hebe's recorded `type: "query"` suggestion is still skipped beside the items, with no drop logged;
    - an answer of only that suggestion reads as "found nothing";
    - Natura's made-up `{url, attributes: {}}` test now expects a failed search (the owner's call).
  - **Empty search with a count:** `hits: []` with `total_hits` 15, or with `next_page` set or removed, gives `unavailable/failed`. The recorded empty answers still read as "found nothing".
  - **Natura's broken copies:**
    - on the name search, the EAN search and the price request: a removed `url`, `title` or `price_amount` on every hit;
    - a link where the SKU should be;
    - an HTML page and an empty body with status 200;
    - adapter-level 429, 503 with Retry-After, a challenge, a `stopped` and a `paused` reservation, a network failure and a timeout;
    - an odd `availability` with its log line;
    - an unreadable `price_old_amount` or `lowest_price` with its log line.
  - **Hebe's search:** capped, paused, stopped, 403, 429, 500 and a network failure, each `unavailable` with its reason and the requests served. Also an unreadable `price_omnibus_amount` with its log line.
- **Regression caught:** a format change stored as "not found" or "missing" for every product (D2, D3); an empty answer that says it found hits read as nothing found (D4); a silent renamed value.
- **Research source:** research §2.3, §2.5, §2.6.
- **Edge cases:** a `type` that differs only in case; a suggestion beside items; an answer of only a suggestion.
- **Anti-pattern avoided:** replaying only the happy recording; copies shaped to what the parser tolerates; asserting the outcome without the requests served.
- **Both headers** name each fixture's request and recording date.

### Success Criteria:

#### Automated Verification:

- Natura's and Hebe's tests pass: `npx vitest run src/lib/services/shops/natura.test.ts src/lib/services/shops/hebe.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 3: Super-Pharm's answers (D4)

### Overview

An empty search reads as "found nothing" only when its counts say 0. Super-Pharm's 403 is pinned on both request kinds with Algolia's documented error body. Every other refusal kind is pinned on both kinds.

### Changes Required:

#### 1. The search's counts

**File**: `src/lib/services/shops/super-pharm.ts`

**Intent**: An empty search that says it found hits can't be stored as `not_found` (D4).

**Contract**:

- An answer with no hits gives "found nothing" only when `nbHits` is the number 0 and `page` the number 0, as `super-pharm-search-empty.json` recorded. Any other empty answer gives `unavailable/failed` with a log line.
- A search with hits doesn't compare its count, as today, since more hits than asked for is normal.

#### 2. Super-Pharm's tests

**File**: `src/lib/services/shops/super-pharm.test.ts`

**Intent**: Pin D4, the 403 and the refusal kinds that only the gate's own tests cover today.

**Contract**:

- **Behaviour asserted (through the real gate, with requests, POST bodies and reservations counted):**
  - **D4:** copies of the empty recording with `nbHits` 5, with `page` 1, and with both counts removed each give `unavailable/failed`. The recording itself still gives no candidates.
  - **The 403:** on the search and the price request, a 403 whose body is Algolia's documented error JSON gives `stopped`. The block is reported with its arguments, and nothing more is asked. The test names the body as documented, not recorded.
  - **Other refusals:** a 429 and a 503 with `Retry-After` give `paused` until then. A challenge gives `stopped`. A `stopped` reservation and an unreachable counter ask nothing. All on both kinds.
  - **Prices:** a removed `objectID` on every hit, an empty body, and hits as an object each give every id `unavailable/failed`.
- **Regression caught:** an empty search with a count stored as "not found"; a refusal kind read as a plain failure on Super-Pharm.
- **Research source:** research §2.4.
- **Edge cases:** `nbHits` below the hits held on the price path, which gives `unavailable/failed`.
- **Anti-pattern avoided:** a made-up 403 body passed off as recorded; asserting the status without the bodies served.

### Success Criteria:

#### Automated Verification:

- Super-Pharm's tests pass: `npx vitest run src/lib/services/shops/super-pharm.test.ts`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`

---

## Phase 4: Paths and refresh loops (risk #3)

### Overview

A refresh stops asking a shop after two failed requests in a row. Every path pins its refusals and changed answers through the real gate. The gate's database check gains two proofs.

### Changes Required:

#### 1. The two-failure stop

**File**: `src/lib/services/price-refresh.ts`, `src/lib/services/shops/pinned-prices.ts`, `src/lib/services/shops/rossmann.ts`

**Intent**: Bound what a failing shop costs one refresh at two requests, as the research note (§7) and the lesson on bounding cost ask (the owner's call).

**Contract**:

- **Rossmann's loop and `fetchPinnedPrices`** stop asking a shop once two of its requests in a row answered `unavailable` with reason `failed` (the counter's skip included). The shop's later ids get `unavailable/failed` with no reservation and no request.
- **What resets and what counts:**
  - A request that got an answer resets the count.
  - An id that is never sent counts for nothing. Rossmann's loop tells it apart before asking, by an exported id check, as `isNaturaItemId` is.
- **A refusal still stops at once,** as today.

#### 2. The paths' tests

**File**: `src/lib/services/shop-matching.test.ts`, `src/lib/services/price-refresh.test.ts`, `src/lib/services/price-routes.test.ts`

**Intent**: Prove refusals and changed answers on the paths, where the research found only the gate pinning them (§3).

**Contract**:

- **Behaviour asserted (through the real gate, with reservations and served requests counted):**
  - **A first lookup** (Natura and Hebe) whose EAN search found nothing and whose name search is then refused (403, 429, `stopped`) or fails (500) stores nothing (no `recordLookup`), with the two requests counted.
  - **Changed answers on a lookup** store no `not_found`: Natura's renamed `type`, and Super-Pharm's empty search with a count.
  - **A refresh:**
    - stops a shop on a 429, a challenge or a 503 with Retry-After mid-loop, and asks the other shops on;
    - stops after two failed requests in a row (500, then timeout), but not after one failure followed by a price;
    - stops an unreachable counter after two reservation attempts;
    - stores no `missing` row from Natura's or Hebe's renamed-type price answer, nor from Rossmann's HTML 404.
  - **The price route:** a 429 and a capped reservation each give one reservation and nothing more (`price-routes.test.ts`).
- **Regression caught:** a path that asks again after a refusal or spends the cap on a failing shop; a refusal or changed answer stored as a fact.
- **Research source:** research §3.
- **Edge cases:** the failure count crossing a batch boundary in `fetchPinnedPrices`.
- **Anti-pattern avoided:** mocking the gate; asserting the final status instead of the requests served.

#### 3. The gate's database proofs

**File**: `scripts/check-shop-gate-db.mjs`

**Intent**: Prove at the database the two gate rules that guard the shared cap and pause (the owner's call).

**Contract**:

- **A refused reservation inserts no request row.** A `capped`, a `paused` and a `stopped` answer each leave `requestLogMark()` (`scripts/e2e-local-db.mjs`) unmoved. That makes the script need the local stack's database container, `.env` and `.dev.vars`, so it calls `assertLocalSupabase` first, as `check-prices-db.mjs` does.
- **A `rate_limited` report shorter than the current pause** leaves the pause where it was.

### Success Criteria:

#### Automated Verification:

- The paths' tests pass: `npx vitest run src/lib/services/shop-matching.test.ts src/lib/services/price-refresh.test.ts src/lib/services/price-routes.test.ts`
- The gate script passes Node's syntax check and lint: `node --check scripts/check-shop-gate-db.mjs`, `npx eslint scripts/check-shop-gate-db.mjs`
- Lint, type check and the whole unit suite pass: `npm run lint`, `npx astro check`, `npm run test`
- CI's `smoke` job passes with the extended gate check (its first run)

---

## Phase 5: Docs and rollout

### Overview

Record what the phase shipped and decided, in the test plan and `CLAUDE.md`.

### Changes Required:

#### 1. The test plan

**File**: `context/foundation/test-plan.md`

**Intent**: The plan matches what's tested and decided, with no file anchors in §2 (the owner's call to backport).

**Contract**:

- **§2, risk #5:**
  - "a 404 means gone" is a live defect this phase fixed;
  - the cheapest layer is broken copies after small production guards;
  - an index or catalog that answers empty, and a renamed type on a filtered request, belong to monitoring.
- **§6.4:**
  - Rossmann's and Natura's broken copies;
  - the per-fixture header dates;
  - what counts as a query suggestion;
  - an empty search's count rule;
  - the documented 403 body.
- **§6.6:**
  - this phase's entry;
  - the S-05 suggestion follow-up, widened and closed;
  - the S-06 follow-up left open.
- **§7, the accepted edges:**
  - a route renamed inside Rossmann's API that answers problem+json;
  - an empty-but-answering index, and a renamed type on the filtered price request;
  - Super-Pharm's dropped rival and price unit;
  - Hebe's renamed sale price;
  - the unrecorded rejected key and 20-id batch.
- **§3:** Phase 3's status kept current.

#### 2. CLAUDE.md, project rules only

**File**: `CLAUDE.md`

**Intent**: The new reads, where future work looks for them.

**Contract**:

- **"Shops and matching"** gains:
  - Rossmann's 404 rule;
  - the suggestion rule;
  - the empty-search count rule for all three search providers;
  - the log lines;
  - the two-failure stop beside `refreshPrices`.
- **The gate's non-negotiable** says a failed answer carries its content type.
- **The `check-shop-gate-db.mjs` entry** names its new prerequisites.

### Success Criteria:

#### Automated Verification:

- Prettier leaves the edited documents as they are: `npx prettier --check context/foundation/test-plan.md context/changes/testing-shop-answer-contracts/plan.md`
- Lint and the whole unit suite pass: `npm run lint`, `npm run test`
- CI's `ci`, `smoke` and `e2e` pass on the PR

#### Manual Verification:

- The owner reviews the test plan's §2, §6 and §7 updates and the `CLAUDE.md` changes

---

## Testing Strategy

### Unit Tests:

- Each adapter's broken copies and refusal kinds, through `createShopGate` over the replay, counting requests, bodies and reservations (Phases 1–3).
- The two-failure stop and the paths' refusals and changed answers (Phase 4).

### Integration Tests:

- The gate's database proofs in CI's `smoke` job (Phase 4).

### Manual Testing Steps:

1. Phase 5: the owner reads the test plan's corrected §2, its §6.4 and §6.6 updates and §7's edges, and the `CLAUDE.md` changes.

## Performance Considerations

The two-failure stop lowers a failing shop's cost per refresh from up to its cap to two requests. Nothing else changes a request count.

## Migration Notes

No migration. `GateOutcome`'s new field is optional, so existing callers and tests keep compiling.

## Implementation Notes

One line per adaptation, added in the phase's commit (`context/foundation/lessons.md`, "Record every adaptation in the plan in the same commit").

### Phase 1

- **"availability unread" is the price check's line only,** not the search's too: Rossmann's search builds candidates without an offer and never reads `availability`. A text other than "available" is Rossmann's own "not orderable" and isn't counted.
- **An item without `name` is dropped** (`itemSchema.name` is required now, though it may be empty or null). Its `fallbackName` is a generic description, such as "Krem uniwersalny" beside the name "Soft ", so a renamed `name` would otherwise show that description as every product's name, and the plan's "lost its `name`" copy couldn't fail.
- **"items dropped" is logged for any drop,** not only when every item drops, as the other adapters do (lesson "Never read an unreadable answer as missing"). So "drops an item whose id can't go into the form" now puts the bad item beside a good one, since one bad item alone now fails the search (D5), and "drops a malformed item" asserts its line.
- **An empty answer with a count other than 0** logs "unexpected empty answer" with the count or its kind only (`0 items, totalCount 5`, `missing`, `string`).
- **A problem+json 404 without a body is `missing`:** the gate never reads a failed answer's body, so its status and media type decide (the plan named this edge case without its outcome).
- **Super-Pharm's four gate-log assertions** (the 400 and the 404, on the search and the prices) now carry `contentType: "text/plain"`, which the replay's empty text body gets by default.
- **The unit-shape copy** splits each item's own size text into `{ value, unit }`, rather than giving every item one fixed object.
- **Cases beyond the plan's list:**
  - the search's count sent as text "0", and an empty 200 body on the search and the price check;
  - on the price check, availability `null`, a 502, a 410, an unfollowed 301 and a timeout;
  - in the gate's test, a 503 without Retry-After as mixed-case HTML, and a blank Content-Type;
  - the existing refusal and failure cases now count their reservations and reported blocks;
  - the refresh test also asserts the code `partial`, which D1 had turned into `done`.
- **The test header** names curl only for the search recordings: it says the detail recordings come from the research requests of 2026-09-28, as S-03's plan does.
- **Breaks** (each restored from the staged file), with the tests that went red:
  - the 404 rule without the media type: 5 (three Rossmann, two refresh);
  - the all-dropped guard removed: 3;
  - the empty answer's count unchecked: 3;
  - `name` optional again: 1;
  - the availability line removed: 3;
  - the gate without `contentType`: 11 (gate, Rossmann, Super-Pharm).

### Phase 2

- **Odd values log Super-Pharm's reasons,** one line per field, not the plan's single "offers unread" line, so one reason reads the same in every shop:
  - Natura's `lowest_price` is "30-day low unread" and its `price_old_amount` "regular price unread";
  - Hebe's `price_omnibus_amount` is "30-day low unread".

  A value counts when it's there (not left out, null, false, blank or an empty list) and doesn't read as an amount. One that reads but can't be stored, such as 0, isn't counted.

- **Shared helpers** (lesson "Define shared constants and helpers once"):
  - `logOddValues` and its `OddValue` type, in `pinned-prices.ts`, now used by `logOddAvailability`, by the Luigi's Box client (through `LuigisBoxShop.oddValues`) and by Super-Pharm's `logOddOffers`;
  - `isNone`, moved unchanged from `super-pharm.ts`, and `kindOf`, moved unchanged from `rossmann.ts`, both now in `shop-values.ts`;
  - `isUnreadAmount`, beside `amountOf`.

  Rossmann's and Super-Pharm's tests pass unchanged.

- **An answer without hits** finds nothing only when `next_page` is null and `total_hits` is exactly the number 0; the plan's `complete` would also let a negative count through. Its line, "unexpected empty answer", gives the count or its kind and whether there's a next page, never the next page's address, which carries the search.
- **On the prices, the odd-value lines** are logged in the client's `requestPrices`, as Super-Pharm's are, so they come before the shared rules' lines.
- **Natura's made-up suggestions:**
  - "finds nothing … when the only hit is a query suggestion" used an untyped `{url, attributes: {}}`. It's now "gives up, rather than finding nothing, when the only hit is no product and no query suggestion", expecting a failed search and "hits dropped" 1 of 1 (the owner's call).
  - A new test finds nothing for a hit shaped like Hebe's recorded suggestion, with `type: "query"`.
  - "drops pseudo-hits…" gives its suggestion `type: "query"`, as recorded, so its count stays 3 of 6.
- **Existing tests that now log:** both shops' "drops only the offer of a price that can't be stored…" assert "30-day low unread". Hebe's price rows for a 30-day low of 0 and of "brak" moved into one `OMNIBUS` table, which runs on the search and the prices.
- **Natura's tests are restructured,** nothing lost:
  - the search's unreadable-hit copies run on both recorded searches (`describe.each`);
  - the prices' broken copies and unreadable answers sit in one block;
  - the odd availability and optional prices are shared tables, run on both paths.
- **Hebe has no recorded empty search,** so its empty-answer copies use `hebe-id-unknown.json`, which has the same shape, served for a search. Another copy is the recorded name search with its hits emptied ("total_hits 58, next_page set").
- **Natura's header** names what each empty recording asked for, as the answers' own query and filters echo: 5901234123457 and ZZ00000000, rather than "served here for".
- **Cases beyond the plan's list:**
  - Natura's empty answer with `total_hits` removed or sent as text;
  - a counter that can't be read, on both searches and on Natura's prices;
  - on Hebe's search, a challenge, a 503 with Retry-After and a timeout;
  - a Hebe type that differs only in case ("Item"), on both paths;
  - the EAN-search copies for both shops;
  - Natura availability `null`, "1", `[1]` and `true`;
  - optional prices that are left out, null, `[]`, blank, 0 or equal to the price, which aren't counted.
- **Accepted, not pinned:**
  - An answer whose only hits are query suggestions, or items Hebe doesn't sell online, finds nothing whatever its `total_hits` says.
  - A hit with no `type` but with attributes still counts as an item on both paths (`isItemHit` as before).
- **Breaks,** with the tests that went red:
  - other types read as suggestions again on the search: 10;
  - other types filtered out again on the prices: 5;
  - any empty answer finding nothing: 9;
  - unread optional prices not counted: 16;
  - Natura's odd availability not counted: 10.

### Phase 3

- **The empty search's line** is "unexpected empty answer" with `nbHits` and `page`, each as its number or its kind (`countOf`). `nbPages` isn't read.
- **`readSize` calls `isNone`** for an unset `capacity`, in place of its inline copy of the same check (lesson "Define shared constants and helpers once"). Every size test passes unchanged.
- **`countOf`,** a count as a log line shows it, moved into `shop-values.ts`. It replaced the same inline expression in Rossmann's and Luigi's Box's empty-answer lines, with no change in behaviour.
- **`ALGOLIA_403` replaces the two empty-body 403s,** on the search and on the prices' first batch. It's Algolia's documented answer to the query endpoint's 403 ("Method not allowed with this API key."), an `ErrorBase` body with its own example message, labelled as documented, never as recorded. The log-hygiene test keeps its empty-body 403.
- **The prices' unreachable counter is tested on one batch.** It isn't a refusal, so a second batch would be reserved again until Phase 4's stop.
- **One `FAILURES` table runs on the search and on one price request,** replacing the two 400 tests: a 400, a 500 without a body, a network error and a timeout. It checks the reserved shop instead of the gate entry's `shopId`.
- **Cases beyond the plan's list:**
  - a D4 copy with `nbHits` as text;
  - the search's stopped and paused rows also check the gate's outcome, and that the adapter logs nothing;
  - the refusal tables check the shop reserved and the blocks reported;
  - the incomplete and unreadable price answers check the body sent and one reservation.
- **Breaks:**
  - any empty search finding nothing: 4 red;
  - every refusal read as a plain failure: 14;
  - a null, false or blank capacity no longer read as none: 3.

### Phase 4

- **One counting rule, shared by both loops** (lesson "Define shared constants and helpers once"): `failuresAfter` in `pinned-prices.ts`, beside `FAILED_REQUESTS_BEFORE_STOP` (2) and `logRequestsStopped`.
  - A batch request counts when its answer is `unavailable/failed`: the gate's failures, the counter's skip and an unreadable body. Any readable answer resets the count, one whose hits all dropped included.
  - Rossmann's check is its request's answer, so an unreadable or unexpected detail counts too.
- **The stop's line, "requests stopped",** counts the ids not asked out of every id given: `checks.size` for the batched shops, as their "invalid SKUs" line does, and `ids.length` for Rossmann. The ids not asked stay `unavailable/failed`.
- **The adapters' doc comments name the stop too** (`fetchPrices` on Luigi's Box, `fetchNaturaPrices`, `fetchHebePrices`, `fetchSuperPharmPrices`), though the phase's contract listed only the three production files.
- **"A failure, then a price" needs a fourth request to show the reset:**
  - Rossmann runs 500, price, 500, price;
  - Natura's batch tests use four batches (151 SKUs), so its "500, 500" case leaves two batches unasked.
- **The 429 and 503 rows stop the clock** (`vi.useFakeTimers({ toFake: ["Date"] })`), so a pause ends exactly 120 s ahead.
- **Cases beyond the plan's list:**
  - a stopped reservation partway through Rossmann's products;
  - an invalid id between two 500s, which neither counts nor resets;
  - Natura's counter unreachable across batches, answering null and rejecting;
  - all four refusal rows run through `runMatchSteps` for both shops;
  - the route's capped case also asserts no block report.
- **`ServedAnswer`** names the new answer type in `shop-matching.test.ts`, whose `Answer` interface already exists for its stand-in client.
- **The database script** reads the request log's mark through `logMark()`, which fails the run when the database container can't be reached, as `check-prices-db.mjs` does. The proofs add three PASS/FAIL lines (capped, paused, stopped) and one for the shorter report. The script can't run here (no Docker), so its first run is CI's `smoke` job (4.4).
- **Breaks:**
  - the stop disabled: 7 red;
  - an answer no longer resetting the count: 2;
  - Rossmann counting ids it never sends: 1;
  - a refused name search read as not found: 21.

## References

- Research: `context/changes/testing-shop-answer-contracts/research.md`
- The test plan's risks and guidance: `context/foundation/test-plan.md` §2, §6.4, §6.6
- The adapters: `src/lib/services/shops/rossmann.ts`, `luigis-box.ts`, `natura.ts`, `hebe.ts`, `super-pharm.ts`, `pinned-prices.ts`
- The gate: `src/lib/services/shop-gate.ts`, `src/lib/services/shops/shop-outcome.ts`
- The research note: `docs/research/polish-drugstore-price-apis.md` §2, §7

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rossmann's answers (D1, D5)

#### Automated

- [x] 1.1 Rossmann's, the gate's and the refresh's tests pass — 5861475
- [x] 1.2 Lint, type check and the whole unit suite pass — 5861475

### Phase 2: Natura and Hebe on Luigi's Box (D2, D3, D4)

#### Automated

- [x] 2.1 Natura's and Hebe's tests pass — 4eb3a95
- [x] 2.2 Lint, type check and the whole unit suite pass — 4eb3a95

### Phase 3: Super-Pharm's answers (D4)

#### Automated

- [x] 3.1 Super-Pharm's tests pass — ffe03dd
- [x] 3.2 Lint, type check and the whole unit suite pass — ffe03dd

### Phase 4: Paths and refresh loops (risk #3)

#### Automated

- [x] 4.1 The paths' tests pass
- [x] 4.2 The gate script passes Node's syntax check and lint
- [x] 4.3 Lint, type check and the whole unit suite pass
- [ ] 4.4 CI's `smoke` job passes with the extended gate check

### Phase 5: Docs and rollout

#### Automated

- [ ] 5.1 Prettier leaves the edited documents as they are
- [ ] 5.2 Lint and the whole unit suite pass
- [ ] 5.3 CI's `ci`, `smoke` and `e2e` pass on the PR

#### Manual

- [ ] 5.4 The owner reviews the test plan's §2, §6 and §7 updates and the `CLAUDE.md` changes
