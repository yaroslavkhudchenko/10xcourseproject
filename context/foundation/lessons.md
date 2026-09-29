# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Record every adaptation in the plan in the same commit

- **Context**: `/10x-implement` phases whenever the code differs from a phase contract: a moved file, a changed status code, an extra rule or an owner's call made mid-phase.
- **Problem**: Reviews compare the diff with the plan, so an unrecorded adaptation reads as drift and the plan stops being the source of truth. Each of the four reviews so far found one (F-01 F8, S-01 F9, S-02 F10, S-03 F10).
- **Rule**: Before a phase's commit, add one line per adaptation to the plan's Implementation Notes, naming the contract it changes and why.
- **Applies to**: implement, impl-review

## Bound what each page view and action costs every shop

- **Context**: Any code path that can reach a shop: pages, API routes, islands and refreshes.
- **Problem**: The per-shop cap is shared by the whole deployment, and one 403 stops a shop for everyone. Earlier paths fired on another site's link, spent requests a view didn't need, sent bursts, or kept asking after a refusal (F-01 F1, S-01 F5, S-02 F3, S-03 F3).
- **Rule**: Let only the user's own navigation or an explicit action reach a shop. Send one request at a time per shop, stop asking a shop once it refuses, and state in the plan how many requests each page view and action costs.
- **Applies to**: plan, plan-review, implement, impl-review

## Never read an unreadable answer as missing

- **Context**: Shop adapters and services that parse shop answers or database rows.
- **Problem**: A shape change or one odd row silently changed meaning: a decided product looked undecided (S-02 F1), a Luigi's Box format change would have been stored as "not found" (S-02 F2), and one odd row emptied the whole list (S-01 F8).
- **Rule**: Parse each row or hit on its own, dropping and logging only the odd ones. An answer that can't be read is `unavailable/failed`, never `missing`, `not_found` or an empty list.
- **Applies to**: plan, implement, impl-review

## Keep decision logic in tested services

- **Context**: Rules that decide what to fetch, what to store, or who may see what.
- **Problem**: Logic written inside `.astro` pages and API routes had no unit tests, so its boundaries were checked only by hand: when to look Natura up (S-02 F4), and which shop item a price route fetches (S-03 F8).
- **Rule**: Put every such decision in a function under `src/lib/services/`, with unit tests at its boundaries. Pages and routes only call it and map its result.
- **Applies to**: plan, implement, impl-review

## Check what a direct database call allows, not only the UI

- **Context**: Every migration that adds a table, a grant, a policy or an RPC.
- **Problem**: A signed-in user can call PostgREST with their own token, and the grants allowed more than the UI does. Any user could stop a shop through a direct RPC (F-01 F2), users could write more to their own rows than the app does (S-02 F5), and self-service watching lets a fake price reach any item (S-03 F6).
- **Rule**: For each table and function, list what a signed-in user can do with a direct PostgREST call. Grant only the columns the app writes, and prove each refusal in the database check script.
- **Applies to**: plan, plan-review, implement, impl-review

## Define shared constants and helpers once

- **Context**: Constants and helpers used by more than one module, especially across the browser and server boundary.
- **Problem**: Copies drift. Shop ids were repeated by hand (S-01 F8), two form helpers were duplicated (S-02 F8), and a copy made to keep a server import out of the island was a trap for the next well-meant dedupe (S-03 F9).
- **Rule**: Define each shared constant or helper in one module. Put what the island needs in a browser-safe module, and import it from the server side too, never the other way round.
- **Applies to**: implement, impl-review
