# Architect report: Drogeria Radar

The module 4 work on this repository, for the 10xArchitect block, built with lesson M4L5's report prompt. Numbers come from the four artifacts below; what followed them, from the roadmap and the archived plans.

## 1. The project and the inputs

One repository, Drogeria Radar (`github.com/yaroslavkhudchenko/10xcourseproject`): a private, invite-only web app that names which of four Polish drugstore chains sells a watched product cheapest today. Astro 7 SSR with React 19 islands, Supabase (Postgres with RLS, Auth) and Cloudflare Workers. Scale at the map's date: eight business capabilities, 172 non-test files and 179 commits in three weeks, by one person with an AI agent.

All four inputs come from it: L2, `context/map/repo-map.md`; L3 and L4, the research notes `price-refresh-flow-analysis` and `refactor-opportunities` in `context/archive/`, with **no plan made from L4's ranking**; L5, `context/domain/`, the distillation with its glossary and the plans `02-invariant-aggregate-refactor.md` and `03-anti-corruption-layer.md`.

## 2. The project map (L2)

- **Risk zones:** shop matching, the most revised rule set, on which 45 files in 6 capabilities depend; the shop adapters, the only rising capability, where one defect class, an unreadable answer stored or shown as a fact, came back after a written lesson and then as five defects in merged code; the product page, `[id].astro`, the most-changed code file and the composition root, reaching 73 of 102 app files with no unit test.
- **Structure:** no file-level cycles and an exact browser boundary, but shared contracts filed inside features tie seven capabilities into one loop on paper, and the sign-in middleware's imports reach every shop adapter.
- **Unknowns:** production errors beyond the one incident; the full-history price read on every list view, deferred twice, at scale; drift between the TypeScript and the SQL, which nothing compares; who maintains the app after the MVP.

## 3. The flow analysis (L3)

- **The flow:** a price refresh, from the shop through the shop gate into `price_observations` and back to the screen. It crosses all eight capabilities and the map's risk zones 2 and 3.
- **Overview:** the user's „Odśwież ceny”, or the product page finding a price older than 15 minutes, starts it, and both routes take the shop items from the user's own rows. One pipeline, `refreshPrices`, asks every shop at once, each request first reserving a slot under the shop's request cap, and stores each shop's checks with one insert, `recordPriceChecks`. They come back through two views under RLS to the product page's cards and the list.
- **Technical debt:** 27 items, and 45 structural claims checked with ast-grep (36 confirmed, 8 refined, 1 refuted). The three worst form one chain:
  - TD-03: the schema has no compiler. The client is untyped, and its tables and columns are strings.
  - TD-18: no test runs the app's own insert against a database, so a drift fails first in production.
  - TD-02: the island then hides it, showing a check that wasn't stored as fresh and stored. ast-grep confirmed that no island code reads `saved`, and that `recordPriceChecks` is the only insert into `price_observations`, with two production callers.

## 4. The refactor plan (L4)

- **The ranking:** 15 of the 27 problems are refactor candidates. Three are ranked, on 56 structural claims checked with ast-grep (50 confirmed, 6 refined, 0 refuted). No `/10x-plan` was made from it, so what follows is its proposal.
- **Option 1, TD-03 starting with TD-18:** the real write and reads run against the local database in CI, and a schema type generated from the migrations types the client, so a name they lack fails the type check. Steps, all verified automatically:
  1. a database test of the real write and reads, which a deliberately renamed column must turn red;
  2. the generated type, tracked, with a CI step that regenerates it and fails on a difference;
  3. the client factory and `App.Locals` typed;
  4. the data-access modules typed one per commit, or inside the ACL plan's Phase 4.
- **Next:** TD-12, one wire contract for the island's price route; TD-06, one stop-asking loop for the shops.
- **Not doing:** the other 12 candidates, each with a reason: TD-05 (M-2's S-03 plans it), TD-09 (the ACL plan's Phase 4 designs it) and TD-15 (its cost is unknown until measured).

## 5. The domain, by DDD (L5)

- **Ubiquitous language:** 71 Core and Supporting terms. The load-bearing ones: a **watched product** with its **own shop** and **matched shops**; one **decision** per matched shop (a **match**, a **decline** or **not found**); **price observations** shared by a shop item's **watchers**; the **shop gate** and its **request cap**. 14 words carry two meanings, such as "match": any stored decision, or only a pairing.
- **Drift:** no documented rule is contradicted. D-01: the PRD's „Do sprawdzenia” holds only matching problems, while the code also holds products whose price isn't fresh. D-02: the code acted on three PRD questions the owner hadn't closed.
- **Invariant #1:** "A watched product holds decisions only for its matched shops, at most one each. Each decision moves only along the legal moves, and only from the state its writer saw." Its aggregate is **WatchedProduct**. The own-shop rule was re-derived in eight places on read and checked nowhere on write. Planned in 5 phases with 20 test cases, it shipped as milestone M-2, closed on 2026-10-11: one guardian admits every change, the database refuses an own-shop decision, and the e2e suite ran unchanged as the proof.
- **Anti-corruption layer:** the Supabase client SDK leaks. One client per request, built in the middleware, crosses five layers, and 25 app files know it or its types. The plan puts it behind a `Backend` port with an adapter in `src/lib/supabase/`, in five phases, done when a grep for the package in `src/` finds only that directory (22 files today). Not started.

## 6. Decisions that belong to me

Out of the five problem areas the domain map found, I picked a product's shop decisions for the next milestone, because the app could save a decision that did nothing and tell nobody, and quality is my main goal. When the agent's plan wanted the new guard to throw errors, I had it return a plain result instead, the way the rest of my code reports failures. For the database it proposed a new column with a check; I chose a trigger, so the version already running in production keeps working while the migration goes out, and I had the old wrong rows counted and deleted instead of left behind. After the first review I corrected the plan in one place: a confirmation re-sent from an old browser tab is just an outdated form, not a forged request. For the bug where a price that failed to save still looked saved, I chose to keep the price on screen with one honest line, „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”, because the price itself was real and only the silence was wrong.
