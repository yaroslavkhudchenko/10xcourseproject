# Hebe in the Comparison (S-05) — Plan Brief

> Full plan: `context/changes/hebe-in-comparison/plan.md`
> Research: `context/changes/hebe-in-comparison/research.md`

## What & Why

Hebe joins the price comparison as the second matched shop beside Drogerie Natura (roadmap S-05; PRD US-02, FR-006, FR-013). The owner chose on 2026-10-02 to add the new shops first, Hebe first. The matching and price code is rebuilt per shop on the way, so Super-Pharm (S-06) can follow as an adapter plus labels.

## Starting Point

- **Ready already:** the shop gate, the database and its RLS take Hebe: the hosts, the seeded `hebe` row, and shop-agnostic matches and prices. No migration is needed.
- **Natura-only:** everything above them assumes one matched shop, Natura. That covers the lookups, the decision form, `?repin=1`, the notices, one card and choice section, the island's `natura` prop, and the list's Natura state.
- **Hebe's Luigi's Box**, from 7 probes on 2026-10-02:
  - Pinned prices come back by `ID`, but only for items Hebe sells online.
  - Its size field is unreliable, while the legal name carries the right size.

## Desired End State

**Product page:** one card per shop (Rossmann, Natura, Hebe). Each matched shop has its own matching actions and its own choice section. "Najtaniej" marks the cheapest fresh, orderable price among the three, and nothing while a shop's decision can't be read.

**Watchlist:** rows name the cheapest of the three, the screen-reader line states each shop's matching, and the list's refresh includes Hebe.

**Requests:** nothing asks Hebe beyond the user's own navigation or an explicit action. A changed or unreadable Hebe answer is a visible gap.

## Key Decisions Made

| Decision              | Choice                                                                                         | Why (1 sentence)                                                                                           | Source          |
| --------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------- |
| Hebe's size           | The trailing size of the legal name, else the description; `Pojemność` ignored                 | Right with its unit in all 5 inspected items, while `Pojemność` read 237 ml for 300 ml and 100 g as litres | Research / Plan |
| Items not sold online | Left out: only `searchable` items are offered; `online_flag` decides whether one can win       | A refresh by id can't see them, and the comparison is of online prices                                     | Research / Plan |
| Automatic matching    | Natura's rule: one candidate with a shared EAN, the same size and an agreeing brand            | One rule for every shop; the "wrong EAN" example was a wrong size field                                    | Plan            |
| First lookup          | Natura's flow: the name search only when the EAN search finds nothing                          | 1 request in the common case; the re-pin choice runs both searches                                         | Plan            |
| Structure             | Per-shop matching, built with Natura alone first and Hebe switched on last                     | One tested path, S-06 ready, the S-08 follow-ups closed; Natura's e2e specs guard the rewrite              | Plan            |
| "Do sprawdzenia"      | An undecided Hebe counts, like an undecided Natura                                             | The chip lists exactly the products still to match                                                         | Plan            |
| Hebe's colour         | Pink `oklch(0.885 0.07 350)` (#FEC7E0), light and dark                                         | Matches the other two shops' lightness and Hebe's brand                                                    | Plan            |
| Tests                 | Probe fixtures, broken-copy contract tests, unit tables on real candidates, a three-shop e2e   | Covers risks #5, #6 and #7 at the cheapest layers and fills test-plan §6.4                                 | Plan            |
| Concurrency           | The shops' lookups run in parallel after the page's reads; one request at a time within a shop | A render peaks at its 5 reads, and lookups add at most 2, under Workers' 6                                 | Research / Plan |
| Tracker id            | `HEBE_TRACKER_ID` as a constant; each Luigi's Box client is bound to its shop                  | As Natura's; the binding stops a Hebe URL being charged to Natura                                          | Research / Plan |

## Scope

**In scope:**

- Hebe's adapter on a shared Luigi's Box client.
- Per-shop matching services, price keys, targets and refresh.
- Per-shop product page, island and list.
- Hebe's label and colour.
- Kitchen-sink states.
- Fixtures and contract tests.
- e2e helpers and an updated suite, plus a new three-shop spec.
- Doc corrections and rollout.

**Out of scope:**

- A migration.
- Super-Pharm.
- `Pojemność`.
- Items not sold online.
- A stricter rule or a name comparison for Hebe.
- An extra name search on the first lookup.
- Back-compat for `?repin=1`.
- The test plan's §1–§2, whose risk #6 correction is a follow-up.
- Contract tests for Rossmann and Natura (test-plan rollout Phase 3).
- Live Hebe in any automated test.

## Architecture / Approach

Natura's adapter splits into a shared Luigi's Box client plus a per-shop mapping, and `hebe.ts` is the second mapping. The shops the code knows (`MATCHABLE_SHOPS = ["natura", "hebe"]`) key the labels, a registry of adapters and the price fetchers from Phase 2. `MATCHED_SHOPS`, the shops switched on, is the only switch (browser-safe, beside `PRICED_SHOPS`). Services, page, island and list loop over a shop list that defaults to it, so unit tests run Natura and Hebe together before Hebe is live. With `["natura"]` through Phases 2–5, behaviour and texts are unchanged and the e2e suite stays green. Phase 6 sets `["natura", "hebe"]`.

## Phases at a Glance

| Phase                                | What it delivers                                                                           | Key risk                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 1. Hebe's adapter on a shared client | `luigis-box.ts`, `hebe.ts`, fixtures, broken-copy contract tests, test-plan §6.4           | The split changes Natura's behaviour (guard: `natura.test.ts` passes unedited) |
| 2. Matching services per shop        | Registry, labels, lookups, form, `?repin=<shop>`/`?retry=<shop>`, notices, per-row reads   | A renamed text changes Natura's wording (guard: the six e2e specs unedited)    |
| 3. Prices per shop                   | Price keys, targets, a fetcher table in `refreshPrices`                                    | Refresh concurrency or refusal stops drift (guard: two-shop unit cases)        |
| 4. Product page and island per shop  | Steps per shop in parallel, cards and choices per shop, "Najtaniej" withheld, plural texts | The largest UI diff; the sink and e2e must show no change                      |
| 5. The list per shop                 | Per-shop states, status lines, "Do sprawdzenia", alert, footer                             | A second shop's odd row hides the first one's state (guard: unit cases)        |
| 6. Hebe switched on                  | Hebe matched and priced, the pink token, sink states, flipped tests, e2e updates and spec  | Many expected texts change at once; a local live check on an owner budget      |
| 7. Docs and rollout                  | CLAUDE.md, PRD, research note, roadmap, test-plan notes; PR and phone check                | Production's `hebe` row must be enabled before the merge                       |

**Prerequisites:**

- Docker and the local Supabase stack for e2e, smoke and the DB checks.
- The owner's OK for at most 2 new Hebe recordings (Phase 1) and at most 10 live Hebe requests (Phase 6).

**Estimated effort:** about 4–6 sessions across 7 phases. Phases 2, 4 and 6 are the largest.

## Open Risks & Assumptions

- **Untested batch size:** batching by `ID` was proven with 2 ids. Batches of 50 are untested, and the adapter assumes Luigi's Box accepts them, as it does for Natura.
- **Probe sample:** the legal-name size and the online filter rest on 5 items from 2 searches. Phase 6's live check widens that sample.
- **The automatic rule's blind spot:** a wrong EAN on a same-size, same-brand Hebe item would be accepted automatically. "Zmień" and the suspicious count are the remedy.
- **Shared host:** the two caps let 60 requests a minute reach Luigi's Box. Whether it limits per tracker or per client IP is unknown.

## Success Criteria (Summary)

- On a phone, a product shows Rossmann's, Natura's and Hebe's prices with their ages, and "Najtaniej" on the right shop. Hebe can be matched, changed or declined in its own card.
- The watchlist names the cheapest of the three and counts an undecided Hebe in "Do sprawdzenia".
- The unit suite, the updated e2e suite with the new three-shop spec, and CI are green. No automated test ever reaches a live shop.
