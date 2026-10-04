<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Hebe in the Comparison (S-05)

- **Plan**: context/changes/hebe-in-comparison/plan.md
- **Mode**: Deep
- **Date**: 2026-10-04
- **Verdict**: REVISE → SOUND after triage (2026-10-04)
- **Findings**: 1 critical, 3 warnings, 5 observations
- **Triage**: all 9 fixed in the plan: F1 (Fix A), F2 (Fix A), F3, F4, F5, F6, F7, F8, F9. Progress still matches (43 criteria, 43 rows, 7 phases).

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | FAIL    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

32/32 paths ✓, 25/25 symbols ✓, brief↔plan ✓, Progress 43/43 rows ✓ (7 phase headings matched, no checkboxes in the phase bodies). No `docs/reference/contract-surfaces.md`, so that check was skipped.

Also verified and not findings:

- Every recorded Hebe value passes the planned URL checks and the database bounds: `web_url` (69–103 characters) and `image_link` (151–221 characters) are both on `https://www.hebe.pl`, the legal names (41–51 characters) end with the right size, and the hit `url` equals `ID[0]` (18 digits).
- `price_sale_amount` appears only on the items on sale, always below `price_amount`. `SearchableFlag: [true]` appears even on the offline item, so the filter must read `searchable`, as the plan says.
- `scripts/smoke.mjs` opens product pages only for missing ids, and its decision post expects 403 from the cross-site check, so `shop=` on redirects doesn't touch it.
- The `--shop-*` fills are aria-hidden dots with no text, so `--shop-hebe` needs no contrast pair.
- No adapter registry or trailing-size helper exists yet, so neither new module duplicates one.

## Findings

### F1 — Hebe's label, adapter and fetcher don't exist for Phases 2–5's two-shop tests

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Implementation Approach §2; the tests and break-checks of Phases 2–5; Phase 6 §1
- **Detail**: The rewrite's safety net is "every function that loops over matched shops takes the list as a parameter, defaulting to `MATCHED_SHOPS`. Unit tests can then run two shops before Hebe is switched on." But a list parameter only reaches loops. Everything else about a shop is a module constant keyed by `PricedShop` or `MatchedShop`, and both stay Natura-only until Phase 6:
  - `SHOP_LABELS` (`price-comparison.ts:38`) is read directly, never passed in, by `namesOf`, `heroOf`, `announcement` and the list's status lines. `price-comparison-state.ts:398` and `watchlist-rows.ts:121-137` hard-code `SHOP_LABELS.natura`.
  - `decisionFields.shop: z.enum(MATCHED_SHOPS)` refuses `hebe`, and the registry holds Natura only.
  - `PRICE_FETCHERS: Record<PricedShop, …>` has no Hebe entry.
  - `astro check` type-checks the tests too (`tsconfig.json` includes `**/*`). A `"hebe"` literal where `PricedShop` or `MatchedShop` is expected fails with TS2322, and at runtime `SHOP_LABELS.hebe` is undefined.

  So these tests can't be written as specified, and the break-checks behind them can never go red:
  - a Hebe decision checked with Hebe's URL checks (2.1/2.5);
  - two shops refreshed in parallel, and one shop's refusal (3.1/3.5);
  - "Natura i Hebe" waiting, and `match-changed` naming Hebe (4.1/4.6);
  - Hebe's status lines and "Do sprawdzenia" (5.1/5.5).

- **Fix A ⭐ Recommended**: Separate the shops the code knows from the shops that are switched on. From Phase 2, `MATCHABLE_SHOPS = ["natura", "hebe"]` keys `SHOP_LABELS`, the registry (Hebe's Phase 1 adapter included) and the price fetchers. The fetchers are derived from the registry, not kept as a second hand-written table. `MATCHED_SHOPS = ["natura"]` stays the only switch for the pages, routes, schemas and list. Phase 6 then flips the switch and adds the colour, the sinks and the e2e changes.
  - Strength: Every two-shop test and break-check runs on Hebe's real label and adapter, so Phase 6's texts are proven before it starts. Each per-shop table has one source.
  - Tradeoff: Hebe's label and adapter sit in the code three phases before they're live. The decision schema is built from `MATCHED_SHOPS`, so Phase 2's Hebe-decision test passes an explicit shop list.
  - Confidence: HIGH — every blocker the verification found is a constant keyed by a Natura-only type, and widening the key removes it.
  - Blind spot: `SHOP_FILLS` stays Natura-only until Phase 6, so only rule-level tests can run Hebe early, not a rendered Hebe card.
- **Fix B**: Move the two-shop cases and their break-checks to Phase 6, and let Phases 2–5 prove Natura-only behaviour with the reshaped unit tests and the unedited e2e specs.
  - Strength: No type changes beyond the plan, and the code is exactly as wide as what's live.
  - Tradeoff: The per-shop logic first meets a second shop in Phase 6, already the largest phase, so a per-shop bug written in Phase 2 shows up three phases later.
  - Confidence: MEDIUM — workable, but it removes the plan's stated reason for the list parameter.
  - Blind spot: How much per-shop branching a single shop exercises at all.
- **Decision**: FIXED (Fix A). The plan now has `MATCHABLE_SHOPS` and `SHOP_ADAPTERS` keyed by the known shops in Phase 2 §1–§2, `decisionFieldsFor(shops)` in Phase 2 §4, fetchers derived from the registry and a `refreshPrices` shop list in Phase 3 §3, and Phase 6 §1 reduced to the switch. The Approach §2–§3 and the brief's Architecture paragraph were updated to match.

### F2 — Re-pin and retry views would also look up an undecided Hebe

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details (the cost table); Phase 2 §5
- **Detail**: The cost table says a `?repin=<shop>` view costs "2 searches for that shop; 0 for the others". But for a shop with no stored decision, `decideMatchStep` ignores the re-pin and retry flags and returns `lookup` on the user's own navigation (`match-step.ts:40-51`; test `match-step.test.ts:178-188`). Per-shop flags don't change that, so `?repin=natura` or `?retry=natura` also runs an undecided Hebe's first lookup: 1–2 more searches. Right after Phase 6 nearly every product has Hebe undecided, so most re-pin views would cost up to 4 Luigi's Box requests instead of the 2 that S-08 promised (`autoRefreshOf`'s comment, `match-step.ts:59-63`). When Hebe's lookup ends in a choice, the decision's redirect to the plain page runs it again.
- **Fix A ⭐ Recommended**: Keep the table. On a view opened with `repin=<shop>` or `retry=<shop>`, an undecided other shop gets `prompt`, decided in `decideMatchStep` with a unit case and a break-check.
  - Strength: The view costs what the table and S-08 promised, and Hebe's lookup runs once, on the plain page the decision redirects to. The `prompt` state already exists for requests that aren't the user's own navigation (`match-step.ts:48-49`).
  - Tradeoff: One more rule in `decideMatchStep`, and on those views Hebe's card shows its button instead of a result.
  - Confidence: HIGH — a small change to a pure, tested function.
  - Blind spot: How the prompt card reads beside an open re-pin choice (a sink check).
- **Fix B**: Let each shop follow its own step, and correct the two table rows: "others: a shop without a decision looks up as on a plain view, 1–2 searches".
  - Strength: No new rule; every shop behaves the same on every view.
  - Tradeoff: Up to 2 more Hebe searches per re-pin or retry view, repeated after the redirect when Hebe's lookup ends in a choice.
  - Confidence: HIGH — it's what the code does today.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A). Phase 2 §5 has the rule: on a `repin=`/`retry=` view, an undecided other shop gets `prompt`. Phase 2 §9 has its unit cases, criterion and Progress row 2.5 a break-check for it, the cost table spells out both rows, and Phase 6 §4's sink shows Hebe's button beside Natura's open re-pin choice.

### F3 — The per-row decision reads leave most odd-row cases undecided

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §4 (`matches.ts`)
- **Detail**: Phase 2 decides one case: "a row whose shop can't be read makes every matched shop of the product unreadable". Today's two reads already behave differently:
  - `listMatches` fails the whole product on any odd row of any shop (`matches.ts:359-361`).
  - `listMatchStates` marks the product unread on an odd row of a known shop, without recording which shop, so an odd Hebe row would hide Natura. It skips an unknown shop's odd row (`:427-429`). When a row can't be tied to a product, it treats every product without a readable Natura decision as unreadable (`watchlist-rows.ts:346`).

  The plan doesn't decide:
  - what a readable row of a shop outside `MATCHED_SHOPS` does: every stored Hebe decision after a revert, and Super-Pharm's in S-06;
  - whether an odd Hebe row may hide Natura;
  - how the unattributed count becomes per shop.

  `lessons.md` records this class of bug three times (S-01 F8, S-02 F1, S-02 F2).

- **Fix**: Write four rules into Phase 2 §4, each with a unit case in `matches.test.ts` or `watchlist-rows.test.ts`:
  1. a row of a shop outside `MATCHED_SHOPS`, whether known or unknown, readable or odd, is ignored;
  2. an odd row of a matched shop makes only that shop unreadable;
  3. a row whose shop field can't be read makes every matched shop of its product unreadable;
  4. a row whose product can't be read affects its own matched shop, or every matched shop when its shop can't be read either.
  - Strength: Per-shop isolation becomes a tested contract, and the revert in F8 rests on rule 1.
  - Tradeoff: About four more unit cases.
  - Confidence: HIGH — each rule narrows an existing behaviour to one shop.
  - Blind spot: Rule 3 only guards against a changed row format, since the column can't hold an unknown shop today.
- **Decision**: FIXED. The four rules are in Phase 2 §4, with `listMatches` taking the shop list. Phase 2 §9 lists their cases, and criterion and Progress row 2.5 add a break-check for rule 1.

### F4 — Phase 2 breaks files it doesn't name, so its own gates fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §8–§9; Phase 6 §3; What We're NOT Doing
- **Detail**: Phase 2 renames `natura-view.ts` and `NaturaChoices`, reshapes `listMatches` and keys `unread` by shop. These files break too, so 2.2's `astro check` fails and check 2.6 has no kitchen sink to look at:
  - `natura-card.ts:2`, `natura-card.test.ts:9`, `NaturaCard.tsx:16` and `NaturaSection.astro:20`;
  - `src/dev/fixtures.ts:27-37, 46, 453-470` and `src/dev/product-page.astro`;
  - `price-targets.ts:51-56, 105-113` and its test;
  - `watchlist-rows.ts:337, 358, 381`, called from `watchlist.astro:46` and `[id].astro:256`, plus its test and `src/dev/watchlist-fixtures.ts`.

  Phase 6 §3 misses `price-comparison-state.test.ts:119`, whose `Record<PricedShop, RefreshResult>` fails with TS2741 once Hebe joins.

  Separately, `plan.md:86` says the address bar forgets `?retry=1`, but `NOTICE_PARAMS` holds only `repin` (`notices.ts:104-111`). The conclusion holds anyway: an ignored `retry=1` just shows the plain page.

- **Fix**: Add those files to Phase 2 §8–§9 and the test to Phase 6 §3, and correct the reason at `plan.md:86`.
- **Decision**: FIXED. Phase 2 §8 is now "The callers, adapted mechanically", naming the extra modules and kitchen sinks. Phase 2 §9 names their tests, and Phase 6 §3 adds `price-comparison-state.test.ts:119`, noting that the line numbers move. The no-backward-compatibility bullet now states what really happens to `?retry=1`.

### F5 — The shared client's config omits what `natura.test.ts` pins

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 (Contract)
- **Detail**: `natura.test.ts` pins the following, and the replay matches the exact href:
  - log lines checked with `toEqual`: `{event: "natura-search" | "natura-prices", reason, detail}`, with wording like "1 of 3 product hits" and "5 of 6 SKUs not sent";
  - exact URLs: the parameter order, `%20`, `f[]=type:product` first, and the order of `hit_fields`;
  - the 4 s `AbortSignal.timeout`, passed unwrapped as `init.signal`.

  The config's eight fields carry no event names and no word for the id, so Hebe would log "natura-…" and "SKU", or the config grows mid-phase. The unedited test catches it, so the cost is a detour.

- **Fix**: Add the event names and the id's word ("SKU" or "ID") to the config. State that the URL order and the 4 s search timeout stay as `natura.test.ts` pins them.
- **Decision**: FIXED. Phase 1 §1's contract now names the log events, the id's word, the pinned URL order and encoding, and the 4 s search timeout.

### F6 — One shop's exception would take the whole product page down

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1
- **Detail**: Ordinary failures settle into values:
  - the lookups never throw (`natura.ts:55-58`, `shop-matching.ts:24, 62`);
  - the gate turns reserve and network failures into outcomes (`shop-gate.ts:99-134`);
  - the writes resolve with `{error}`.

  A programming error does throw, though. Examples are the gate's TypeError for a host outside `SHOP_HOSTS` (`shop-gate.ts:86-92`) and a bug in the new Hebe mapping meeting an unseen shape. `Promise.all` then rejects, and the page answers 500, losing Natura's and Rossmann's prices too. The end state asks for a visible gap instead.

- **Fix**: Settle each shop's work on its own, with `Promise.allSettled` or a per-shop catch that logs the error and shows the shop as unavailable. Put this orchestration in a tested service, as the lesson "Keep decision logic in tested services" asks, with a case where one shop throws.
- **Decision**: FIXED. Phase 4 §1 now settles each shop on its own and moves the orchestration into a service (for example `runMatchSteps` in `shop-matching.ts`). Phase 4 §8 has the throwing-shop case, and criterion and Progress row 4.6 have its break-check.

### F7 — Hebe's probe bodies exist only in an old session's temp folder

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §5
- **Detail**: Phase 1 builds its fixtures from "the session scratchpad `probes/hebe/`" without naming the session. The bodies are under `%TEMP%\claude\…\f95837fd-…\scratchpad\probes\hebe\`, and they were still there on 2026-10-04. Temp isn't durable, though, and that morning's crash already cost a file (`.git/config`). If they vanish, Phase 1 needs 4 live Hebe requests beyond its budget of 2.
- **Fix**: Copy bodies 2, 3, 4 and 6 into the change folder now and name that path in Phase 1 §5. Delete the copies once Phase 1 has trimmed them into fixtures, so no raw body is committed.
- **Decision**: FIXED. On 2026-10-04 the four bodies were copied byte-identical (checked with `cmp`) to `context/changes/hebe-in-comparison/probes/`, about 33 KB of Luigi's Box JSON. Phase 1 §5 names them and deletes the folder before its commit.

### F8 — There is no written way back after the merge

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 7 §6
- **Detail**: Phase 7 confirms that production's `hebe` row is enabled before the merge, but names no off-switch. Setting `enabled = false` on that row stops every Hebe request at once, without a deploy, and the cards show the gap. A revert is a PR that needs green `ci`, `smoke` and `e2e`. After a revert, the stored Hebe decisions remain and must be ignored (F3, rule 1).
- **Fix**: Add a rollback line to Phase 7 §6: the `hebe` row as the instant switch, a revert PR as the full rollback, and the stored Hebe decisions that the reads then ignore.
- **Decision**: FIXED. Phase 7 §6 now has "The way back": the `hebe` row as the instant switch, a revert PR as the full rollback, and the stored decisions ignored under Phase 2 §4's rule 1.

### F9 — Phase 4 says Natura's texts stay the same, but changes two of them

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach §2; Phase 4 Overview and 4.7
- **Detail**: Phase 4 §2 and §5 change two texts a Natura user sees:
  - "…Natura zostanie sprawdzona ponownie." becomes "…sklep Natura zostanie sprawdzony ponownie.";
  - the removal confirm becomes "…razem z Twoimi wyborami w sklepach.".

  The Approach ("byte-identical"), the Overview ("every rendered text stays as it is") and check 4.7 ("as before") say otherwise. No e2e spec asserts either text (`tests/e2e` has no "sprawdzon" or "wyborem"), so the e2e gate holds, but whoever runs 4.7 would read the change as a regression.

- **Fix**: Name the two deliberate changes in the Approach, in Phase 4's Overview and in 4.7.
- **Decision**: FIXED. Phase 4's Overview names both rewritten texts, the Approach points to them, and criterion and Progress row 4.7 and Manual Testing step 1 now say "apart from the two rewritten texts".
