---
project: Drogeria Radar
version: 1
status: draft # draft | active | locked
created: 2026-09-25
updated: 2026-10-10
prd_version: 1
main_goal: quality
top_blocker: time
milestone_id: decision-guardian
milestone_seq: 2
milestone_status: open # open | done
---

# Roadmap: Drogeria Radar

> Derived from `context/domain/02-invariant-aggregate-refactor.md` and `context/domain/domain-distillation.md`, with the PRD requirements they protect, plus an auto-researched codebase baseline.
> Edit in place; archive when superseded.
> Items are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-2: One guardian for a product's shop decisions** — Status: open

- **Intent:** Every change to a watched product's shop decisions passes one guardian, a single object in the app that is the only place allowed to change them. It refuses by name a decision for a shop outside the product's matched shops, an illegal move and an outdated form, and the database keeps a backstop for the own-shop rule. Nothing changes in what the user sees: a rule that today lives in five layers and eight copies comes to live in one place.
- **Source materials:**
  - the refactor plan, `context/domain/02-invariant-aggregate-refactor.md`;
  - the domain map, `context/domain/domain-distillation.md`, whose #1 candidate the owner picked for this milestone on 2026-10-09;
  - the requirements they protect, from `context/foundation/prd.md` (v1).
- **Done when:** every S-NN below is `done`, and no path, neither a crafted post nor a direct database call, can store a decision in a product's own shop.
- **Scope anchors:**
  - The refactor plan's invariants. The chosen one, I-5, I-8 and I-10, and I-1 to I-4, I-6, I-7, I-9, I-12 and I-13, which move into the guardian or its backstop. I-11 is parked.
  - The domain map's #1 candidate, R-01 to R-18:
    - this milestone moves R-01 to R-10, R-12 and R-14 to R-16 into the guardian or its backstop;
    - it leaves R-13, R-17 and R-18 as they are;
    - it parks R-11.
  - The domain map's drift D-01.
  - The PRD requirements they protect: FR-004, FR-005, FR-006, FR-007, FR-008 and US-02.
  - Out of scope: I-11 and a database guard for the moves between decisions (see `## Parked`).

## Vision recap

A shopper who buys the same drugstore products again and again checks two or three shop sites by hand before every purchase, because comparison sites skip these chains. Drogeria Radar gives them one private view of the exact product in the exact shops they use. The view shows the regular and promo price, the Omnibus 30-day low and the age of every price. The Omnibus 30-day low is the lowest price a shop charged during the 30-day window before a promotion, which EU rules require the shop to show next to it. The product is the same item in each shop, the item the user confirmed there, so every comparison stands on those per-shop decisions.

## North star

**S-01: Decisions posted from a product's page pass one guardian.** Today the decision route answers "saved" for a decision in the product's own shop, a write that does nothing and tells no one. This slice makes the guardian refuse such a post, and the other illegal or outdated ones, on the path every user decision takes. The quality goal puts the closing of that silent failure first.

> "North star" here means the smallest end-to-end flow that, once it works, proves the milestone is worth doing. It sits as early as its prerequisites allow, because everything else in the milestone only matters if this works.

## At a glance

In PRD refs, FR-NNN and US-NN are the PRD's, I-NN the refactor plan's invariants, and R-NN and D-NN the domain map's rules and drift.

| ID   | Change ID                     | Outcome (user can …)                                                                                     | Prerequisites | PRD refs                                                                                                      | Status      |
| ---- | ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- | ----------- |
| S-01 | decision-route-guardian       | post decisions as before, and a post the guardian refuses stores nothing; a matched shop's card says why | —             | FR-004, FR-006, FR-007, US-02, I-2, I-5, I-7, I-8, I-10, R-02, R-05, R-07, R-08, R-10                         | in-progress |
| S-02 | decision-store-backstop       | rely on the database to refuse a decision in a product's own shop, and on each decision saving at once   | S-01          | FR-005, FR-007, US-02, I-1, I-3, I-5, I-8, R-01, R-03, R-05, R-08, R-16                                       | proposed    |
| S-03 | page-lookups-through-guardian | open a product whose lookups and decisions go through the same guardian, with the same results           | S-01          | FR-006, FR-007, FR-008, US-02, I-4, I-6, I-8, I-9, I-12, I-13, R-04, R-06, R-08, R-09, R-12, R-14, R-15, D-01 | proposed    |

## Baseline

What is already in place in the codebase as of `2026-10-09` (auto-researched and user-confirmed). No foundation is needed: every layer this milestone touches is present.

- **Frontend:** present. Astro 7 SSR, React 19 islands and Tailwind 4 (per `context/foundation/tech-stack.md`). It has the list, the product page and the Polish sign-in pages (`src/pages/`).
- **Backend / API:** present. Form routes and one JSON route under `src/pages/api/`, the middleware (`src/middleware.ts`), and the services in `src/lib/services/`, with the four shop adapters behind the shop gate.
- **Data:** present. Supabase Postgres with 8 migrations (`supabase/migrations/`), RLS and column grants on every table. A decision is written in two statements (`src/lib/services/matches.ts`), and nothing in the database ties a decision to its product's own shop.
- **Auth:** present. Supabase email and password, invite-only through the owner's links (per `context/foundation/tech-stack.md`; `src/middleware.ts`).
- **Deploy / infra:** present. Workers Builds runs the checked deploy, which refuses code whose migration production lacks. GitHub Actions runs `ci`, `smoke` and `e2e`, and `main` takes pull requests only.
- **Observability:** partial. Workers observability is on (`wrangler.jsonc`), with one JSON log line per failure, 14 event names. There is no error tracking and no alerting.
- **Testing:** present. 36 Vitest files, a test against the real database (`src/lib/services/matches.db.test.ts`), 5 database check scripts and 10 Playwright specs.

## Foundations

None. Every layer M-2 touches is present (`## Baseline`), and the guardian arrives in S-01, the first slice that uses it.

## Slices

### S-01: Decisions posted from a product's page pass one guardian

- **Outcome:** user can post decisions from a product's page as before: „To ten produkt”, „Żaden z nich” and a re-pin's pick. A post the guardian refuses stores nothing and comes back with a code, which a matched shop's card shows; one for the product's own shop, which only a crafted post sends, shows nothing (the owner's call, 2026-10-09). It refuses four kinds of post:
  - one for a shop outside the product's matched shops, the product's own shop included;
  - an illegal move: a decline over a decline;
  - one from an outdated form, shown before the stored decision changed, such as a confirmation posted a second time (the owner's call, 2026-10-10);
  - one for a shop whose stored decision couldn't be read.
- **Change ID:** decision-route-guardian
- **PRD refs:** FR-004, FR-006, FR-007, US-02, I-2, I-5, I-7, I-8, I-10, R-02, R-05, R-07, R-08, R-10
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Does an illegal move get a code of its own, or the `invalid` that a crafted post gets today? — Owner: user. Block: no. Plan `invalid`, since only a crafted post can send one.
- **Risk:** The route now reads the product and its decisions before every write. Each refusal must leave every post the page's own forms send working as before, which the route tests and the e2e specs pin.
- **Status:** in-progress

### S-02: The database refuses an own-shop decision, and every decision saves at once

- **Outcome:** user can rely on the database itself to refuse a decision in a product's own shop, even from a direct call. Every decision is saved in one atomic step, so a product removed during a save reads as gone, not as decided.
- **Change ID:** decision-store-backstop
- **PRD refs:** FR-005, FR-007, US-02, I-1, I-3, I-5, I-8, R-01, R-03, R-05, R-08, R-16
- **Prerequisites:** S-01
- **Parallel with:** S-03
- **Blockers:** The owner pushes this slice's migration to production from its pull request's branch before it merges. The checked deploy refuses code whose migration production lacks.
- **Unknowns:**
  - What happens to old decisions stored in a product's own shop: delete them in the migration, or count them first and enforce the rule on new rows only? — Owner: user. Block: no. Plan to count first; no page reads such rows.
- **Risk:** This adds the project's first write function on a user's own table, and about 17 direct inserts in the database checks and the e2e seed must change with it. The database checks must prove that RLS still binds the new write path and that nothing new can be updated, as the recorded lesson "Check what a direct database call allows" (`context/foundation/lessons.md`) requires.
- **Status:** proposed

### S-03: A product's page looks shops up and shows decisions through the guardian

- **Outcome:** user can open a product whose page looks shops up and shows their decisions through the same guardian, with the same results.
  - A lookup never overwrites a settled decision.
  - The product's matched shops, its per-shop steps and its price keys come from one loaded product, instead of eight separate derivations.
  - The PRD says what „Do sprawdzenia” holds, including a price that isn't fresh (the domain map's D-01).
- **Change ID:** page-lookups-through-guardian
- **PRD refs:** FR-006, FR-007, FR-008, US-02, I-4, I-6, I-8, I-9, I-12, I-13, R-04, R-06, R-08, R-09, R-12, R-14, R-15, D-01
- **Prerequisites:** S-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** It touches the product page, the module that composes the most others, and every reader of decisions. The unit suites and the e2e specs must stay green with their assertions unchanged: that is the proof that nothing the user sees moved.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                     | Suggested issue title                                                       | Ready for `/10x-plan` | Notes                                                        |
| ---------- | ----------------------------- | --------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| S-01       | decision-route-guardian       | Decisions posted from a product's page pass one guardian                    | yes                   | Run `/10x-plan decision-route-guardian`; the north star.     |
| S-02       | decision-store-backstop       | The database refuses an own-shop decision, and every decision saves at once | no                    | After S-01; the owner pushes its migration before the merge. |
| S-03       | page-lookups-through-guardian | A product's page looks shops up and shows decisions through the guardian    | no                    | After S-01; parallel with S-02.                              |

## Open Roadmap Questions

None of these blocks M-2. The PRD's Open Questions 3, 5 and 6 were answered on 2026-10-09.

1. **What request volume and data volume should the product be sized for (target_scale.qps, target_scale.data_volume)?** Not captured during shaping; the PRD frontmatter carries TODO placeholders. — Owner: user. Block: none at a handful of users (PRD Open Question 7).
2. **Which devices and browsers must the phone-usable requirement cover?** Not captured during shaping. — Owner: user. Block: none (PRD Open Question 8).
3. **How should a person's access end?** Deleting the account in the Supabase dashboard deletes their list and decisions and keeps the prices they recorded. — Owner: user, as the operator. Block: none (domain map Q-02).
4. **Should a Super-Pharm price's age be when the app fetched it, or when Super-Pharm last indexed the record?** — Owner: user. Block: none (domain map Q-03).
5. **Does production still refuse sign-up, with each deploy's production check passing its settings group?** — Owner: user, as the operator. Block: none (domain map Q-04).
6. **Should old price checks ever be deleted?** — Owner: user. Block: none (domain map Q-05).

## Parked

- **Checking a confirmed item against what the shop offered** (the refactor plan's I-11) — Why parked: it costs a shop request or a stored offer per confirmation, for a gap that affects only the poster's own list; the owner's call.
- **A database guard for the moves between decisions** — Why parked: a direct call that changes the owner's own decision is an accepted risk that changes only their own list (`CLAUDE.md`, Data).
- **One guardian per product on the list** — Why parked: it would multiply the list's reads; the list keeps its single read and the one definition of a product's matched shops.
- **Renaming the decisions' table and type to "decision"** — Why parked: the glossary leaves renaming old code to a separate decision.
- **The domain map's other candidates** — Why parked: they are candidates for later milestones. #2 (shared price checks) and #3 (polite shop access) are accepted risks "to revisit before inviting more people".
  - #2: shared price checks.
  - #3: polite shop access.
  - #4: invite-only access.
  - #5: the list date behind the good-price judgement.
- **App-wide hardening from S-07's implementation review (F6)** — Why parked: it is older than M-2 and wants its own change, with its own smoke and e2e checks.
  - an anti-framing header on every response;
  - `httpOnly` session cookies.
- **Manual price entry (FR-009)** — Why parked: nice-to-have, outside the MVP (PRD §Non-Goals); fetched prices are the only source.
- **Shop health status page (FR-014)** — Why parked: nice-to-have, outside the MVP (PRD §Non-Goals); stale and missing prices stay visible inline.
- **Daily automatic refresh (FR-015)** — Why parked: nice-to-have, outside the MVP (PRD §Non-Goals); on-demand refresh covers the MVP.
- **dm** — Why parked: its search refuses traffic from the hosting (research note §9), and routing around that would conflict with the no-circumvention rule; it returns only through an official route (PRD FR-013 update, 2026-09-24).
- **Perfumeries (Sephora, Douglas, Notino)** — Why parked: blocked by bot protection; only through official routes such as an affiliate feed (PRD §Non-Goals).
- **Alerts, reminders and run-out prediction** — Why parked: the MVP shopper opens the app to look and nothing is pushed (PRD §Non-Goals).
- **Price per unit** — Why parked: dropped from the MVP view; it is redundant while every shop is matched to the same product and size (PRD FR-011 resolution).
- **Demo account seeded from recorded shop data** — Why parked: an idea from the shaping notes, not a PRD requirement; revisit if the app must be shown working without live shop traffic.
- **Open sign-up, shared household watchlists, shelf and store-level prices** — Why parked: permanent non-goals of the product (PRD §Non-Goals).

## Milestone History

- **M-1: Usable price radar** (`usable-price-radar`) — closed 2026-10-09. Every foundation and slice, F-01 and S-01 to S-08, is done: the owner and the few people they add keep a private list of their products, matched in Rossmann, Drogerie Natura, Hebe and Super-Pharm, and see at the shelf which shop is cheapest today, with every price's age and a judgement of whether it's good; beside the slices, `match-by-name` and `add-from-other-shops` (a product added from any of the four shops) shipped too.

## Done

(Empty for this milestone so far. `/10x-archive` appends an entry here, and flips the item's `Status` to `done`, when a change with a matching `Change ID` is archived.)
