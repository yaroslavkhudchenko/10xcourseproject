---
project: Drogeria Radar
version: 1
status: draft # draft | active | locked
created: 2026-09-25
updated: 2026-09-27
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: usable-price-radar
milestone_seq: 1
milestone_status: open # open | done
---

# Roadmap: Drogeria Radar

> Derived from `context/foundation/prd.md` (v1) plus an auto-researched codebase baseline.
> Edit in place; archive when superseded.
> Items are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: Usable price radar** — Status: open

- **Intent:** The owner puts their repeat-purchase products on a private watchlist and matches them in Rossmann, Hebe, Super-Pharm and Drogerie Natura. The owner, and the few people they add, can then see at the shelf which shop is cheapest today, with an honest age on every price and a judgement on whether the price is good.
- **Source materials:** `context/foundation/prd.md` (v1).
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** every must-have requirement (FR-001 to FR-008, FR-010 to FR-013), US-01 and US-02, and the PRD's non-functional requirements. The nice-to-haves (FR-009, FR-014, FR-015) are in `## Parked`.

## Vision recap

A shopper who buys the same drugstore products again and again checks two or three shop sites by hand before every purchase, because comparison sites skip these chains. Drogeria Radar gives them one private view of the exact product in the exact shops they use. The view shows the regular and promo price, the Omnibus 30-day low and the age of every price. The Omnibus 30-day low is the lowest price a shop charged during the 30-day window before a promotion, which EU rules require the shop to show next to it. The app serves a handful of people on one private deployment.

## North star

**S-03: See which shop is cheapest today.** This is the first slice where the product does what it promises: the owner opens a watched product at the shelf and gets a trustworthy answer, with every price's source and age. The speed goal puts it as early as its prerequisites allow.

> "North star" here means the smallest end-to-end flow that, once it works, proves the product is worth building. It sits as early as its prerequisites allow, because everything else only matters if this works.

## At a glance

| ID   | Change ID                     | Outcome (user can …)                                                        | Prerequisites | PRD refs                                                                                                               | Status      |
| ---- | ----------------------------- | --------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------- |
| F-01 | polite-shop-access            | (foundation) every shop call obeys a deployment-wide cap and stops on block | —             | NFR polite to the shops                                                                                                | done        |
| S-01 | watchlist-add-by-search       | search a product by name and size and add it to their private watchlist     | F-01          | FR-003, FR-004, FR-005, NFR private watchlists                                                                         | in-progress |
| S-02 | shop-matching-first-two-shops | confirm the matching item in the first two shops once                       | S-01          | US-02, FR-006, FR-013                                                                                                  | proposed    |
| S-03 | cheapest-shop-today           | open a watched product and see which shop is cheapest today                 | S-02          | US-01, FR-008, FR-010, FR-011, NFR per-shop feedback, NFR price age, NFR phone-usable, Guardrail failed prices visible | proposed    |
| S-04 | good-price-judgement          | see whether today's price is a good one                                     | S-03          | FR-012                                                                                                                 | blocked     |
| S-05 | hebe-in-comparison            | match their products in Hebe and see Hebe in the comparison                 | S-03, F-01    | US-02, FR-006, FR-013                                                                                                  | proposed    |
| S-06 | super-pharm-in-comparison     | match their products in Super-Pharm and see it in the comparison            | S-03, F-01    | US-02, FR-006, FR-013                                                                                                  | proposed    |
| S-07 | invite-only-access            | sign in with an owner-added account; nobody can register themselves         | —             | FR-001, FR-002                                                                                                         | ready       |
| S-08 | fix-matches-and-watchlist     | re-pin or remove a wrong match and remove a product safely                  | S-02          | FR-007, FR-005                                                                                                         | proposed    |

## Streams

Navigation aid: groups items that share a Prerequisites chain. The canonical order is the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme              | Chain                                                                                                             | Note                                                                                      |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A      | Price comparison   | `F-01` → `S-01` → `S-02` → `S-03` → `S-04` / `S-05` / `S-06` (in parallel); `S-08` also follows the matching step | The shortest path to the north star, per the speed goal; everything else branches off it. |
| B      | Invite-only access | `S-07`                                                                                                            | Standalone: no prerequisites, so it can run in parallel with anything.                    |

## Baseline

What is already in place in the codebase as of `2026-09-25` (auto-researched and user-confirmed). The foundation below assumes these are present and does NOT re-scaffold them.

- **Frontend:** present (framework only). Astro 7 SSR, React 19 islands, Tailwind 4 and one shadcn component (`src/components/ui/button.tsx`). The pages are the starter's placeholders (`src/pages/index.astro`, `dashboard.astro`, `auth/*`); there are no product views.
- **Backend / API:** partial. API routes exist only for auth (`src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts`), plus `src/middleware.ts`. There are no product, watchlist or shop endpoints and no shop adapters.
- **Data:** absent. The hosted Supabase project in Frankfurt exists, with the Data API on, new tables not exposed automatically and automatic RLS on. It has no tables; there is no `supabase/migrations/`, no `src/types.ts` and no `src/lib/services/`.
- **Auth:** present. Supabase email and password sign-in through `@supabase/ssr` (`src/lib/supabase.ts`, `PROTECTED_ROUTES` in the middleware). Production refuses sign-ups (verified), and the owner creates accounts in the Supabase dashboard. The starter's `/auth/signup` page still exists.
- **Deploy / infra:** present. The Worker `drogeria-radar` runs on workers.dev; Workers Builds deploys `main`; GitHub Actions runs lint, check, build and the smoke test; a ruleset makes `main` PR-only; secrets are wired (`context/deployment/deploy-plan.md`).
- **Observability:** partial. Workers Logs are on (`wrangler.jsonc`), and `wrangler tail` works. There is no app logging, no error tracking and no shop-adapter health checks.
- **Testing:** partial. CI has only the auth smoke test (`scripts/smoke.mjs`); there is no test runner and there are no recorded shop responses.
- **Shop access:** verified on 2026-09-23. Rossmann, Hebe, Super-Pharm and Drogerie Natura answer traffic from the Worker; dm refuses it and is out of the MVP (research note §9).

## Foundations

### F-01: Polite shop access

- **Outcome:** (foundation) Every request the deployment sends to a shop passes one gate. The gate enforces a per-shop request cap across the whole deployment and stops calling a shop that blocks or asks. Shop lookups can be exercised against recorded shop responses, never live shops, in the automated checks.
- **Change ID:** polite-shop-access
- **PRD refs:** NFR polite to the shops
- **Unlocks:** S-01, S-02, S-03, S-05, S-06 (each calls a shop through the gate). It also unlocks the verification path "recorded-response checks for every shop lookup", which the shaping notes require so tests never hit live shops.
- **Prerequisites:** —
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:**
  - What is the request cap per shop per minute for the whole deployment? (PRD Open Question 6) — Owner: user. Block: no. A conservative default can be planned and tuned later.
- **Risk:** Sequenced first because every shop-calling slice needs it and politeness to the shops is a hard project rule. The danger is building more gate than the first lookup needs, so it stays at the cap, the stop, and replaying recorded responses.
- **Status:** done

## Slices

### S-01: Add a product to the watchlist by searching for it

- **Outcome:** user can search a product by name and size, pick the right one from the results, and find it on their private watchlist.
- **Change ID:** watchlist-add-by-search
- **PRD refs:** FR-003, FR-004, FR-005, NFR private watchlists
- **Prerequisites:** F-01
- **Parallel with:** S-07
- **Blockers:** The owner switches the hosting to its paid plan before this first shop-calling feature ships. The starter pages alone already use up to 12 ms of CPU per request, against the free plan's 10 ms (`context/deployment/deploy-plan.md`).
- **Unknowns:**
  - How are misspelled product names handled, and does search run live as you type or on submit? (PRD Open Question 3) — Owner: user. Block: no. Plan a default and confirm it during planning.
- **Risk:** This is the first slice that stores personal data, so watchlist privacy has to hold from its very first row.
- **Status:** in-progress

### S-02: Match the product in the first two shops

- **Outcome:** user can confirm, once per product, the matching item in the first two shops.
  - A candidate whose EAN and size match exactly is accepted automatically.
  - A size mismatch is flagged before confirmation.
  - A shop that finds nothing shows as unmatched, not as an error.
- **Change ID:** shop-matching-first-two-shops
- **PRD refs:** US-02, FR-006, FR-013
- **Prerequisites:** S-01
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:**
  - Which of the shops does the owner actually buy from, and in which order should they be added? (PRD Open Question 2) — Owner: user. Block: no. Defaults to Rossmann and Drogerie Natura, the two shops with clean EAN lookups; swap them if you buy elsewhere.
- **Risk:** Matching is where wrong data can enter unnoticed. Starting with the two shops whose EAN lookups are clean keeps the first matches trustworthy.
- **Status:** proposed

### S-03: See which shop is cheapest today

- **Outcome:** user can open a watched product and see its matched shops ordered by today's price, with the cheapest marked.
  - Each shop shows its regular and promo price, the Omnibus 30-day low, the price's source and its age, and online prices are labelled as online.
  - Prices appear shop by shop as they arrive.
  - A shop that fails shows its last known price with its age, or a clear gap.
- **Change ID:** cheapest-shop-today
- **PRD refs:** US-01, FR-008, FR-010, FR-011, NFR per-shop feedback, NFR price age, NFR phone-usable, Guardrail failed prices visible
- **Prerequisites:** S-02
- **Parallel with:** S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - After how long is a displayed price marked stale? (PRD Open Question 5) — Owner: user. Block: no. Plan a configurable limit.
  - Which devices and browsers must the phone view cover? (PRD Open Question 8) — Owner: user. Block: no. Plan for current mobile browsers.
- **Risk:** Every open fans out to all matched shops at once. This is where CPU time and the per-shop cap first meet real use, and it's the slice the product is judged by.
- **Status:** proposed

### S-04: Know whether today's price is a good one

- **Outcome:** user can see whether today's cheapest price is a good one. The judgement uses the product's own price history once enough exists, and the shop's 30-day low until then, labelled with which comparison was made.
- **Change ID:** good-price-judgement
- **PRD refs:** FR-012
- **Prerequisites:** S-03
- **Parallel with:** S-05, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - How much history and which threshold define a good price? (PRD Open Question 4) — Owner: user. Block: yes.
- **Risk:** An untuned threshold shows false confidence, so the judgement waits for the owner's call on history length and threshold.
- **Status:** blocked

### S-05: Add Hebe to the comparison

- **Outcome:** user can match their products in Hebe and see Hebe's prices in the comparison. A Hebe candidate whose size doesn't match is flagged, not trusted on its EAN.
- **Change ID:** hebe-in-comparison
- **PRD refs:** US-02, FR-006, FR-013
- **Prerequisites:** S-03, F-01
- **Parallel with:** S-04, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - Is Hebe one of the shops the owner buys from, and should it come before Super-Pharm? (PRD Open Question 2) — Owner: user. Block: no.
- **Risk:** Hebe returned a wrong EAN for at least one product, so matching here must rely on size and name, not the EAN alone.
- **Status:** proposed

### S-06: Add Super-Pharm to the comparison

- **Outcome:** user can match their products in Super-Pharm and see its prices in the comparison, even though Super-Pharm's search index carries no EAN.
- **Change ID:** super-pharm-in-comparison
- **PRD refs:** US-02, FR-006, FR-013
- **Prerequisites:** S-03, F-01
- **Parallel with:** S-04, S-05, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - Is Super-Pharm one of the shops the owner buys from? (PRD Open Question 2) — Owner: user. Block: no.
- **Risk:** With no EAN in its index and a search key that must be read from the shop's own page, Super-Pharm is the most fragile shop. It comes after the first comparison so a breakage can't hold that up.
- **Status:** proposed

### S-07: Invite-only front door

- **Outcome:** user can sign in with an account the owner created or an invite link the owner handed out, with no email sent by the app, and land in the app. Nobody can register themselves.
- **Change ID:** invite-only-access
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** —
- **Parallel with:** F-01, S-01, S-02, S-03, S-04, S-05, S-06, S-08
- **Blockers:** —
- **Unknowns:**
  - What does an unauthenticated visitor see when opening a gated page? (PRD Open Question 1) — Owner: user. Block: no. Today gated pages send visitors to sign-in.
- **Risk:** Low. Sign-in already works and the auth service already refuses self-registration; the work is replacing the starter's sign-up and demo pages so the front door matches the invite-only rule.
- **Status:** ready

### S-08: Fix a wrong match and remove a product

- **Outcome:** user can re-pin or remove a shop match that turned out wrong, is warned about suspicious matches (size or brand mismatch), and can remove a product from their watchlist without deleting shared price history.
- **Change ID:** fix-matches-and-watchlist
- **PRD refs:** FR-007, FR-005
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Removal must hide, never delete, because price history is shared. A wrong delete would silently erase other users' data.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                     | Suggested issue title                                                        | Ready for `/10x-plan` | Notes                                                        |
| ---------- | ----------------------------- | ---------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| F-01       | polite-shop-access            | Polite shop access: deployment-wide cap, stop on block, recorded responses   | yes                   | Run `/10x-plan polite-shop-access`; unlocks S-01.            |
| S-01       | watchlist-add-by-search       | Search a product by name and size and add it to your watchlist               | no                    | After F-01; switch hosting to the paid plan before it ships. |
| S-02       | shop-matching-first-two-shops | Match a product in the first two shops once                                  | no                    | After S-01.                                                  |
| S-03       | cheapest-shop-today           | See which shop is cheapest today                                             | no                    | After S-02; the north star.                                  |
| S-04       | good-price-judgement          | Show whether today's price is a good one                                     | no                    | Blocked on PRD Open Question 4.                              |
| S-05       | hebe-in-comparison            | Add Hebe to matching and the comparison                                      | no                    | After S-03.                                                  |
| S-06       | super-pharm-in-comparison     | Add Super-Pharm to matching and the comparison                               | no                    | After S-03.                                                  |
| S-07       | invite-only-access            | Invite-only front door: owner-added accounts, no self-registration           | yes                   | Run `/10x-plan invite-only-access`; parallel with anything.  |
| S-08       | fix-matches-and-watchlist     | Re-pin or remove wrong matches; remove products without losing price history | no                    | After S-02.                                                  |

## Open Roadmap Questions

1. **What does an unauthenticated visitor see when opening a gated page?** — Owner: user. Block: none (S-07 plans a default: sign-in redirect, today's behaviour).
2. **Which of the five shops does the owner actually buy from, and in which order should they be added?** dm is out of the MVP; see FR-013. — Owner: user. Block: none (S-02 defaults to Rossmann and Drogerie Natura; S-05 and S-06 follow).
3. **How are misspelled product names handled, and does search run live as you type or on submit?** Rossmann's search returns a spelling hint; its suggestion feature is untested. — Owner: user. Block: none (S-01 plans a default).
4. **How much history and which threshold define a good price (FR-012)?** — Owner: user. Block: S-04.
5. **After how long is a displayed price marked stale?** — Owner: user. Block: none (S-03 plans a configurable limit).
6. **What is the request cap per shop per minute for the whole deployment?** — Owner: user. Block: none (F-01 plans a conservative default).
7. **What request volume and data volume should the product be sized for (target_scale.qps, target_scale.data_volume)?** Not captured during shaping; the PRD frontmatter carries TODO placeholders. — Owner: user. Block: roadmap-wide, but not blocking at a handful of users.
8. **Which devices and browsers must the phone-usable requirement cover?** Not captured during shaping. — Owner: user. Block: none (S-03 plans for current mobile browsers).

## Parked

- **Manual price entry (FR-009)** — Why parked: nice-to-have, outside the MVP (PRD §Non-Goals); fetched prices are the only source.
- **Shop health status page (FR-014)** — Why parked: nice-to-have, outside the MVP (PRD §Non-Goals); stale and missing prices stay visible inline through S-03.
- **Daily automatic refresh (FR-015)** — Why parked: nice-to-have, outside the MVP (PRD §Non-Goals); on-demand refresh (S-03) covers the MVP.
- **dm** — Why parked: its search refuses traffic from the hosting (research note §9), and routing around that would conflict with the no-circumvention rule; it returns only through an official route (PRD FR-013 update, 2026-09-24).
- **Perfumeries (Sephora, Douglas, Notino)** — Why parked: blocked by bot protection; only through official routes such as an affiliate feed (PRD §Non-Goals).
- **Alerts, reminders and run-out prediction** — Why parked: the MVP shopper opens the app to look and nothing is pushed (PRD §Non-Goals).
- **Price per unit** — Why parked: dropped from the MVP view; it is redundant while every shop is matched to the same product and size (PRD FR-011 resolution).
- **Demo account seeded from recorded shop data** — Why parked: an idea from the shaping notes, not a PRD requirement; revisit if the app must be shown working without live shop traffic.
- **Open sign-up, shared household watchlists, shelf and store-level prices** — Why parked: permanent non-goals of the product (PRD §Non-Goals).

## Milestone History

(Empty: this is the first milestone.)

## Done

(Empty on first generation. `/10x-archive` appends an entry here, and flips the item's `Status` to `done`, when a change with a matching `Change ID` is archived.)

- **F-01: (foundation) Every request the deployment sends to a shop passes one gate. The gate enforces a per-shop request cap across the whole deployment and stops calling a shop that blocks or asks. Shop lookups can be exercised against recorded shop responses, never live shops, in the automated checks.** — Archived 2026-09-27 → `context/archive/2026-09-26-polite-shop-access/`. Lesson: —.
