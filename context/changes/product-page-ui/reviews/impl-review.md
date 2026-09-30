<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Design-System Contract for the Product Page

- **Plan**: context/changes/product-page-ui/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-09-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Evidence

- **Plan drift** (review agent 1): 42 checks against the phases' Changes Required, the scope guardrails and the Implementation Notes.
  - 41 MATCH, 2 of them documented adaptations.
  - 1 MISSING: the product-page captures, documented as the owner's Phase 4 call.
  - 0 DRIFT, and 0 undocumented additions.
  - `package.json`, the lockfile, the migrations, the API routes, the price rules and the matching services are unchanged.
- **Safety, quality and patterns** (review agent 2):
  - No XSS: no `set:html`, `dangerouslySetInnerHTML` or `innerHTML`, and every text is escaped.
  - `href`s come from host-checked URLs, and both `target="_blank"` links carry `rel="noopener"`.
  - The kitchen sink is injected only under `astro dev`, no production module imports `src/dev`, and `dist/` has no trace of it.
  - No new database or shop calls, and the hidden form inputs are unchanged.
  - `useId` ids match across hydration, and every `aria-describedby` target exists.
- **Success criteria**, re-run on `c04c617`:
  - 596 tests pass.
  - Lint reports 0 problems on the tracked tree.
  - `astro check` reports 0 errors and 0 warnings; its 8 hints are only in the untracked design folders.
  - The build passes, and `dist/` has no kitchen-sink trace.
  - The contrast check prints 60 of 60 PASS.
  - The hardcoded-value scan finds 0 hits in the view's files and in `src/dev`.
  - The dev route answers 200 under `astro dev`.
  - CI `ci` and `smoke` are green on PR #13's head, `c04c617`.
  - Every manual row was confirmed at its gate. 4.5 closed without the product-page captures, as the owner decided.

## Findings

### F1 — A price the page couldn't read still leads to claims

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/prices.ts:146-160; src/pages/watchlist/[id].astro:126-131; src/components/watchlist/price-comparison-state.ts:216-222; src/lib/services/price-comparison.ts (`compareShops`)
- **Detail**: This breaks the lesson "Never read an unreadable answer as missing" and the plan's Desired End State, in two ways.
  - **A dropped row reads as never checked.** `listLatestPrices` drops a row that fails its schema, and counts it in `dropped` (lines 149-154), but never says which wanted shop it belonged to. The page maps that shop to `latest: null` with `readFailed: false`, so `gapText` says "Jeszcze bez ceny", a price never checked, for one that exists but couldn't be read. From a link, with no auto-refresh, the claim stays until the user taps refresh.
  - **A shop is marked cheapest against an unread one.** While one row has `readFailed`, `compareShops` treats it as priceless. So the first shop to answer is marked "Najtaniej", and announced as cheapest, against a shop whose stored price may be lower. The kitchen sink's `read-failed-one-answered` shows this.
- **Fix**: Both halves, with tests (`prices.test.ts`, `price-comparison-state.test.ts`):
  - `listLatestPrices` also returns the wanted keys whose rows it couldn't read, by parsing `shop_id`/`shop_item_id` apart from the rest of the row.
  - The page passes `readFailed` per shop into `PriceComparisonShop`.
  - The island marks no shop cheapest while any row has `readFailed`.
  - Strength: every row then says what the page actually knows; the drop counter already exists at prices.ts:149, and one odd row still hides no other price.
  - Tradeoff: `listLatestPrices`' return type changes, so its callers change with it.
  - Confidence: HIGH — the dropped count is already computed, only not reported.
  - Blind spot: whether a caller other than the product page reads the return value.
- **Decision**: FIXED — readLatestPrices reports unread keys, the page marks those rows readFailed, and compareRows names no shop cheapest while one is unread (tests in prices.test.ts, price-comparison-state.test.ts)

### F2 — Focus is invisible in forced-colors mode on the page's controls

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ui/button.tsx:8 (every Button and every `buttonVariants` link on the product page)
- **Detail**: `buttonVariants` carries `outline-none`, which the build compiles to `outline-style:none`, and draws focus only with a box-shadow ring. In forced-colors mode (Windows High Contrast), box-shadows compute to `none`, so focus disappears; that's WCAG 2.4.7. On main, the page's controls kept the browser's outline. This is a regression for those users, and the headless focus pass at Phase 4 didn't cover forced-colors mode.
- **Fix**: Replace `outline-none` with `outline-hidden` in `buttonVariants` and in the Badge base. Tailwind 4 keeps a transparent outline under `forced-colors: active`, which the system then paints. Record it in `button.tsx`'s header (F10).
- **Decision**: FIXED — focus-visible:outline-hidden on Button and Badge; the build carries the forced-colors outline

### F3 — The palette lint rule misses whole classes of literals

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: eslint.config.js:128-148; CLAUDE.md:49
- **Detail**: Probed with the repo's own `tokenConfig`, the rule catches `text-white/80`, `bg-black/50`, `placeholder:text-gray-400` and `p-[13px]`. These pass:
  - `ring-offset-white` and `border-t-white/10`;
  - `decoration-*`, `caret-*` and `accent-*` colours;
  - Tailwind 4.3's new palettes: `mauve`, `mist`, `olive` and `taupe`;
  - arbitrary colours such as `bg-[#0a0e1a]` and `text-[oklch(…)]`;
  - `placeholder-white/40`, which `watchlist.astro:150`, the next view to clean, already uses.

  Its comment, "The patterns are the /10x-ui scan's", overstates it: the scan's hex and colour-function alternatives were dropped.

- **Fix**:
  - Widen the prefixes to `border(-[trblxyse])?`, `ring(-offset)?`, `outline`, `decoration`, `caret`, `accent` and `placeholder`.
  - Add the four palettes, and a third pattern for arbitrary colours, `-\[(#|rgba?\(|hsla?\(|oklch\()`, which needs no "/".
  - Correct the comment and CLAUDE.md's wording.
  - Prove each new family with a deliberate break.
- **Decision**: FIXED — tokenConfig widened (prefixes, 4.3 palettes, arbitrary colours); 3 new families proven by a deliberate break

### F4 — The same texts and markup are copied across files

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/watchlist/NaturaSection.astro:37, 131-141; src/components/watchlist/PriceComparisonView.tsx:155-165; src/pages/watchlist/[id].astro:144-149, 170, 182-190, 224; src/dev/fixtures.ts:328; src/dev/product-page.astro:162-170
- **Detail**: This goes against the lesson "Define shared constants and helpers once". The copies:
  - The "Zobacz w sklepie" external link (text, sr-only new-tab cue, `aria-describedby`, classes) exists twice, and the copies already differ: `rel="noopener"` against `rel="noopener noreferrer"`.
  - The text-link recipe `cn(buttonVariants({ … size: "touch" }), "…px-0")` appears 3 times.
  - The decision-notice texts sit in the page and again in the section and the fixtures.
  - The header card's markup sits in the page and in the kitchen sink.
  - The notice parameter names sit in the frontmatter and in the address-bar script's `NOTICE_CODES`.

  Phase 4's notes record two of these copies, but recording them doesn't satisfy the lesson.

- **Fix A ⭐ Recommended**: Extract them now:
  - a `ShopLink` React component used by the section and the island, with one `rel`;
  - a text-link size in `button.tsx`;
  - a tested decision-notice builder in `natura-view.ts`, used by the page and the fixtures;
  - a `ProductHeader.astro`.

  Also share the notice codes between the frontmatter and the script.
  - Strength: satisfies the lesson now; the redesign then restyles each piece in one place.
  - Tradeoff: touches about 6 files after the gates; the kitchen sink and the checks re-run.
  - Confidence: HIGH — every copy is identified with file:line.
  - Blind spot: the redesign may reshape these components, so some of the extraction may be redone.

- **Fix B**: Unify the `rel` now, and record the other extractions in the follow-ups as `etykiety-redesign`'s first step.
  - Strength: the least churn right before the redesign rewrites these views.
  - Tradeoff: the copies ship to production in the meantime, and the plan of the next change must pick them up.
  - Confidence: MEDIUM — depends on the redesign plan carrying it.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A — ShopLink, the inline size, src/lib/notices.ts with a tested decisionNotice, ProductHeader, productFullName

### F5 — An automatic match that couldn't be saved shows no Natura item

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/watchlist/[id].astro:77-95; src/lib/services/natura-view.ts:68-75
- **Detail**: When `recordLookup` returns `failed` or `gone` for an accepted candidate, `naturaItem` stays null, so there's no Natura price row. The section still says "Dopasowano automatycznie: ten sam EAN i rozmiar.", next to the unsaved warning. So the page names no Natura item, price or link at all. On main, the section showed the candidate's summary and its link in this state. The plan's C3 trim assumed a match always has a price row, and neither the contract nor the kitchen sink covers this case.
- **Fix**: While the lookup's match isn't saved, the section shows the candidate's summary and its link, and says it isn't saved yet. The matched view carries the item only in that case, with a test in `natura-view.test.ts` and the state in the kitchen sink.
  - Strength: restores what main showed, only where the price row can't.
  - Tradeoff: a third shape for the matched view.
  - Confidence: HIGH — the case is local to the page's accepted branch.
  - Blind spot: none significant.
- **Decision**: FIXED — an unsaved automatic match carries and shows its item (test and kitchen-sink state)

### F6 — The contrast check's list of pairs has drifted from the page

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/check-token-contrast.mjs:103-164; CLAUDE.md:49
- **Detail**: The maths is right: an independent conversion reproduces Tailwind's hex values. The list of pairs isn't:
  - A pair is missing: the warning Badge on the canvas, which is the matched size warning. It passes at 11.77:1, but nothing guards it.
  - Two pairs measure things the page doesn't render. `link on warning alert` doesn't match the sign-in link, which inherits `warning-foreground/90` (already measured). `destructive on canvas` has nothing to match, since no bare error text remains.
  - The surface opacities are copied by hand from `alert.tsx`, `badge.tsx` and `button.tsx`.
  - CLAUDE.md says the script checks "every" pair.
- **Fix**:
  - Add the canvas warning-Badge pair, and drop or retarget the two dead pairs.
  - Comment each variant's opacity as mirrored in the script.
  - Soften CLAUDE.md to "the pairs listed in the script".
- **Decision**: FIXED — canvas warning-Badge pair added, two dead pairs dropped, opacities cross-referenced, wording softened (58 pairs)

### F7 — Submit-once guards only the form that was sent

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/SubmitOnce.astro:11-16; src/components/watchlist/NaturaSection.astro:114, 147
- **Detail**: The Natura section has one decision form per candidate plus "Żaden z nich". A quick tap on a second candidate, or on "Żaden z nich", still posts a second decision, which comes back as "Ten produkt ma już zapisaną decyzję.". That's C4.4's symptom through another button. The server stays consistent.
- **Fix**: Let `SubmitOnce` read a group value: `data-submit-once="natura-decision"` disables every form in the group on one submit. The Natura forms use it, and the list's form keeps working as it does.
- **Decision**: FIXED — SubmitOnce groups; the Natura decision forms share natura-decision

### F8 — The island's import guard doesn't cover its new imports

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: eslint.config.js:89-96
- **Detail**: The price island now imports `src/components/ui/{alert,badge,button,card}.tsx` and, as before, `src/lib/utils.ts`. None of them is in `islandConfig.files`: `calculateConfigForFile` shows no `no-restricted-imports` for `badge.tsx`. A server-only import added there would pass lint and ship to the browser.
- **Fix**: Add the four components and `src/lib/utils.ts` to `islandConfig.files`.
- **Decision**: FIXED — the ui components, lib/utils, ShopLink and notices joined islandConfig

### F9 — Badges don't wrap and can overflow a phone's column

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ui/badge.tsx:10; src/components/watchlist/NaturaSection.astro:70, 107
- **Detail**: The Badge is `w-fit shrink-0 whitespace-nowrap`. A size text can be up to 40 characters (`product-limits.ts:8`), so "Inny rozmiar: X zamiast Y" can reach about 100 characters, roughly 600 px at `text-xs`. The column at 390 px is 358 px wide, so the page would scroll sideways; main's `<p>` and `<li>` wrapped.
- **Fix**: Pass `className="whitespace-normal"` to the size-warning Badge and the candidates' flag Badges.
- **Decision**: FIXED — whitespace-normal on the size-warning and flag Badges

### F10 — Loose ends in documentation and patterns

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/button.tsx:1; CLAUDE.md:49; context/changes/product-page-ui/plan.md (Performance Considerations); src/pages/watchlist/[id].astro:103, 113-119
- **Detail**:
  - `button.tsx` now differs from the registry (`touch`, `link` reading `text-link`, `underlined`), but lacks the header comment that CLAUDE.md now requires of copied components.
  - CLAUDE.md's shorthand `src/components/watchlist/*` and `src/dev/*` is broader than the lint globs (`**/*.{astro,tsx}` and `**/*.{astro,ts}`).
  - The plan's performance note estimates the island's growth as a few hundred bytes. It's about 2–3 KB gzipped, because the island now loads the Button and Badge chunk with Radix Slot and cva.
  - Two inline bits predate this change: the matched-shop list at `[id].astro:113-119` re-implements `productPriceKeys`, and line 103 passes the literal "Natura".
- **Fix**: Add `button.tsx`'s registry header, listing its deviations and F2's. Correct CLAUDE.md's shorthand and the plan's performance note, and record the two inline bits as a follow-up.
- **Decision**: FIXED — button.tsx header, CLAUDE.md shorthand and shared pieces, SHOP_LABELS instead of "Natura", the plan's size note; the productPriceKeys copy went to follow-ups
