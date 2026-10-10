---
date: 2026-10-10T14:08:14+02:00
researcher: Claude (claude-opus-5-5)
git_commit: 5eefce2da9741d6d12a3c2af2b8c63fddabcf72f
branch: fix/unstored-price-check
repository: yaroslavkhudchenko/10xcourseproject
topic: "TD-02 and audit P6: what the product page shows when a refreshed price was fetched but its price observation couldn't be stored, which states and texts the app already has for that, the three ways to fix it, and the owner's choice"
tags: [research, codebase, td-02, price-refresh, price-observations, price-island, shop-card, screen-reader]
status: complete
last_updated: 2026-10-10
last_updated_by: Claude (claude-opus-5-5)
---

# Research: say when a refreshed price couldn't be saved (TD-02, audit P6)

**Date**: 2026-10-10T14:08:14+02:00
**Researcher**: Claude (claude-opus-5-5)
**Git Commit**: 5eefce2 (`main` after PR #46)
**Branch**: fix/unstored-price-check
**Repository**: yaroslavkhudchenko/10xcourseproject

## Research Question

Two documents describe one defect: a price the product page's island refetched, whose price observation couldn't be stored, shows as if it were stored. They are TD-02 of the refresh flow analysis (`context/changes/price-refresh-flow-analysis/research.md:438-445`, on branch `docs/m4-course-lessons`) and P6 of the observability audit (`context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:97`). This research answers:

1. What does the user see today when that happens, on the island and on the form path?
2. Which states and texts already exist for a failed save, a stale price and a gap?
3. Which fixes are possible, with which files, tests and size?
4. What did the owner choose, and what does the choice settle in the details?

Method:

- The starting point is an options analysis prepared for the owner on 2026-10-10, on branch `docs/m4-course-lessons` at `2fbd621`. No file under `src/`, `scripts/`, `tests/` or `supabase/` differs between that commit and `5eefce2`. Every anchor it gives was re-read at `5eefce2` and holds; the findings below cite this commit.
- Nothing was run: no shop, no Supabase, no server, no test.
- Labels: **E** evidence read at the cited lines, **I** inference, **U** unknown.
- Terms follow `context/domain/glossary.md`; `unavailable` appears only as the code's identifier.

## Summary

1. **The defect (E).** The route answers `saved: false` when a price or missing check was fetched and its one insert failed (`src/pages/api/watchlist/prices.ts:71-74`; `src/lib/services/prices.ts:89-97`). The island's parser requires `saved` and passes it on (`src/components/watchlist/price-comparison-state.ts:901-909`). Nothing in `src/components` reads it after that, so a stored and an unstored answer give the same row and the same announcement (`:203-265`).
2. **What the user sees today (E/I).**
   - On the island, an unstored price looks exactly like a stored one: „cena online · przed chwilą”, „Najtaniej” when it wins, the announcement, the hero and, from lg, the selected list row's tag.
   - The list and the next view show the older stored check. The next view on own navigation asks the shop again when that check is more than 15 minutes old.
   - The form path shows only stored checks, with „Nie wszystkie ceny udało się odświeżyć…” (`src/lib/notices.ts:323-326`).
3. **No existing text says "fetched but not saved" for a price check (E).** The closest is the lookup's not-saved alert, private to a matched shop's card (`src/components/watchlist/match-card.ts:104-107`).
4. **Three options (I):**
   - **A:** keep the fetched price and flag its row; one sentence on the card and in the announcement.
   - **B:** show the stored check, as the form path does.
   - **C:** the route answers an unstored check as a failed one.
5. **The owner's calls (2026-10-10):** option A, and the line „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”
6. **What those words settle (E/I), beyond the options analysis:**
   - The sentence names a price, so it is true only while the card shows a price that wasn't stored. After an unstored missing answer that follows a stored price, the card keeps a price the list does show, so the sentence would be false there.
   - The flag belongs to the price the row shows. Cleared when a refetch starts, as the analysis proposed, it would drop the line while that price stays on the card, for good after a refetch that gets no answer.
   - From lg, the selected list row beside the product follows the unstored price live, under an edge the test plan accepts (`context/foundation/test-plan.md:412`).
   - An insert that timed out may still have committed, which would make the line a false alarm (audit W6).
   - The card's line can be pinned in Node with `react-dom/server`, though the analysis said it couldn't.
7. **Cost (E/I):** none of the options needs a shop request, a migration or a new recording.

## Detailed Findings

### The defect at this commit

- E: The route refreshes the one shop item with `refreshPrices` and answers `answerFor(check, refresh.saved === "saved")` (`src/pages/api/watchlist/prices.ts:71-74`).
  - A price answer is `{ kind: "price", offer, checkedAt, saved }`, and a missing one `{ kind: "missing", checkedAt, saved }` (`:16-22`).
  - The type documents `saved` as "whether the check was stored" (`src/types.ts:267-275`).
- E: For a price or a missing check, `saved` is false exactly when that shop's one insert failed.
  - `observationRow` builds a row for every price and every missing check (`src/lib/services/prices.ts:56-73`), so `recordPriceChecks` answers `saved`, or `failed` when the insert returned an error (`:89-97`).
  - The other priced shops, asked for no item, send no insert and answer `none` (`:89-91`), which `overall` doesn't count as a failure (`src/lib/services/price-refresh.ts:95-101`).
- E: The island's parser refuses an answer without a boolean `saved` (`src/components/watchlist/price-comparison-state.ts:901-903`) and passes it on (`:906`, `:909`).
  - Outside the parser, a grep for `saved` in `src/components` finds only comments and the separate `unsaved` field of a lookup's outcome.
  - So `settled` (`:234-265`) and `announcement` (`:203-226`) give a stored and an unstored answer the same row and the same message.
- E: `saved` has been on the wire since S-03, whose plan defined the answer and no island behaviour for it (`context/archive/2026-09-28-cheapest-shop-today/plan.md:494-497`; commit `61d1e5b`).
- E: A failed insert leaves one warn line, `{"event":"price-observations","reason":"insert failed","detail":<code>}`, naming neither the shop nor the row count (`prices.ts:94`, `:411-414`).
- E: The lookup stores a price the same way, as an accepted candidate's first price, and ignores the result: "A failed insert is logged, and the island then asks" (`src/lib/services/shop-matching.ts:390-393`).
  - The page reads its prices after the lookups (`src/pages/watchlist/[id].astro:111-116`), so a failed first price reads as no price.
  - The island refetches an item with no check on own navigation (`needsRefetch` on `null`, `src/lib/services/price-comparison.ts:121-124`). If that refetch's insert fails too, the user meets TD-02.

### What the user sees today

#### The island (JavaScript on: the automatic refetch and the product's button)

**(a) The check was stored (`saved: true`)**

- E: `settled` makes the answer the row's latest check: `lastCheckedAt` and `pricedAt` become the server's `checkedAt`, and `notice` and `readFailed` are cleared (`price-comparison-state.ts:238-246`).
- E: The shop's card shows:
  - the price;
  - „cena online · przed chwilą” (`src/components/watchlist/ShopCard.tsx:112`; `ageText` under a minute, `price-comparison.ts:490-491`);
  - the declared 30-day low, when there is one (`ShopCard.tsx:111`);
  - „Najtaniej” when the price is fresh, orderable online and the lowest of two or more shops (`ShopCard.tsx:79-82`; `price-comparison.ts:227-240`, `:321`).
- E: The rest of the product area follows:
  - screen readers hear „Natura: 16,99 zł, najtaniej” (`price-comparison-state.ts:214-216`);
  - the hero says „Najtaniej dziś w Naturze … sprawdzono przed chwilą” (`:463-474`);
  - the caption counts the check in its oldest-check rule (`:760-788`).
- E: From lg, the selected list row beside the product follows too.
  - The island sends `PRICES_EVENT` after each change of its rows (`src/components/watchlist/PriceComparison.tsx:117-120`).
  - The row's tag recomputes by the list's own rule (`src/components/watchlist/RowTag.tsx:44-58`; `src/lib/services/watchlist-rows.ts:274-301`, `:313-322`), with „Natura · przed chwilą” (pinned by `price-comparison-state.test.ts:1714-1719`).
- I: The list, the next view and the item's other watchers then read the new observation, and the next view on own navigation asks no shop for 15 minutes (`price-comparison.ts:121-138`).
- E: A stored missing answer keeps the older price with its own age (`price-comparison-state.ts:247-254`). Its card says „Nieaktualna” and „Sklep nie zwraca już tego produktu. Cena może być nieaktualna.” (`ShopCard.tsx:83-89`, `:116-118`; `src/lib/shop-messages.ts:65-69`).

**(b) The price was fetched, but its insert failed (`saved: false`)**

- E: The route still answers 200, with the offer and `saved: false` (`src/pages/api/watchlist/prices.ts:74`), and the server writes the warn line above.
- E: The island renders exactly case (a), and nothing says the check wasn't stored: the price with „przed chwilą”, „Najtaniej” if it wins, the announcement with „najtaniej”, the hero's „sprawdzono przed chwilą” and the selected row's tag following.
- I: What happens afterwards:
  - The list shows stored prices only (`CLAUDE.md:58`): the older price with its older age, or „Bez ceny” (`watchlist-rows.ts:293-294`).
  - A reload or the next view shows the older stored check. When that check is more than 15 minutes old, the island asks the shop again on own navigation (`PriceComparison.tsx:100-112`; `price-comparison.ts:121-138`). That spends the request cap again, on every such view while the cause lasts.
  - When the older check is under 15 minutes old, as after a tap on „Odśwież ceny” soon after a stored check, the next view asks nothing. It shows that older check as fresh, so it may be named cheapest. After an unstored missing answer, this brings back, for up to 15 minutes, a price the shop had just said it no longer returns.
  - No other watcher of the item gets the observation (`context/domain/glossary.md:54`). The history behind the good-price judgement gains no day (`glossary.md:60`, `:72`); today's own checks never count anyway (`context/foundation/prd.md:162`).
- I: At the moment of display, the price is the shop's current answer with its true fetch time and its source. So `prd.md:49` ("never a wrong number presented as current") and `CLAUDE.md:19` hold. What is silent is that the refresh didn't stick, as the flow analysis reads it (`research.md:442` on `docs/m4-course-lessons`).

**(c) The fetch failed (the check is unread)**

- E: The route answers `{ kind: "unavailable", reason, until? }`, with no `saved` (`src/pages/api/watchlist/prices.ts:23-24`).
- E: `settled` keeps the row's latest check and sets a notice (`price-comparison-state.ts:255-260`). So the card keeps the last known price with its age, or shows the gap, and adds the reason's text (`ShopCard.tsx:119-123`; `shop-messages.ts:39-59`):
  - „Sklep Natura jest teraz zajęty. Pokazujemy ostatnią znaną cenę.”;
  - the pause, with its end;
  - „Odświeżanie cen w sklepie Natura jest wyłączone, bo sklep zablokował zapytania.”;
  - or „Nie udało się pobrać ceny ze sklepu Natura.”.
  - Without a price, the busy and paused texts promise none (`shop-messages.ts:47`, `:52`).
- E: The marks are judged on the stored price, so one under 24 hours old can stay „Najtaniej” (`price-comparison.ts:145-157`).
- E: These outcomes, among others, read as `failed` too, with the same „Nie udało się pobrać ceny ze sklepu …” (`price-comparison-state.ts:813`, `:843-844`, `:866-871`, `:881`): an error status other than 409, an error page in place of JSON, a network error and the island's 20-second timeout.
- E: Two answers have alerts of their own, a 409 `changed` and an ended session (`:861-863`, `:878-879`; `src/components/watchlist/PriceComparisonView.tsx:77-113`).

#### The form path (the product's button without JavaScript; the list's button always)

- E: The form route refreshes and redirects with one code, and the page then reads the stored prices again (`src/pages/api/watchlist/refresh.ts:55-60`; `[id].astro:115-116`).
- E: `done` needs every item answered with a price or a missing check and every insert stored (`price-refresh.ts:139-149`). The page then shows „Ceny odświeżone.” as a status (`notices.ts:322`), on the product's page (`[id].astro:234-238`) and on the list (`src/components/watchlist/ListHead.astro:73-77`).
- E: A failed insert gives `partial` whenever at least one item answered (`price-refresh.ts:148`; tested at `src/lib/services/price-refresh.test.ts:1322-1326`).
  - The page shows a warning alert, „Nie wszystkie ceny udało się odświeżyć. Tam, gdzie się nie udało, widać ostatnią znaną cenę i jej wiek.” (`notices.ts:323-326`).
  - The cards show the older stored checks with their ages: „Nieaktualna” and „Stara cena” for a check more than 24 hours old, and „Jeszcze bez ceny” for an item never stored.
- I: The alert names no shop and no cause, so it reads like a shop that didn't answer (TD-07). When every insert failed but every shop answered, it still says „Nie wszystkie…” (`price-refresh.ts:144-148`). The cards' ages tell the truth either way.
- E: With no item answered, the code is `failed`: „Nie udało się odświeżyć cen. Spróbuj ponownie za chwilę.” (`notices.ts:327-330`), with the stored prices and their ages.

#### Both paths on one screen

- I: The list's „Odśwież ceny” beside a product, with JavaScript on, asks the shop twice for an item whose insert failed:
  - The page comes back to `/watchlist/<id>?list-prices=partial` (`ListHead.astro:63-65`; `price-refresh.ts:189-191`), a load on own navigation (`[id].astro:48`, `:119-122`).
  - The island then asks again at once for each such item whose stored check is still more than 15 minutes old: a second request for the same item within seconds.
  - If that insert fails again, the card says „przed chwilą” under the list's „Nie wszystkie ceny udało się odświeżyć”.

#### Unknown

- U: How often inserts fail in production: there is no error tracker, and Workers Logs weren't read.
- U: Whether supabase-js answers `{ error }` or throws when the insert's 2-second abort fires (`prices.ts:92`; `research.md:421`, `:809` on `docs/m4-course-lessons`). A throw would turn a slow insert into a 500, which the island shows as „Nie udało się pobrać ceny ze sklepu …” (TD-10), not as case (b).

### Existing states and texts for a failed save, a stale price and a gap

| State or text          | Where                                                                                                  | What it says                                                                                                                 | Fits "fetched but not saved"?                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The lookup's alert     | `src/components/watchlist/match-card.ts:104-107`, `:141-142`: a warning alert on a matched shop's card | „Nie udało się zapisać wyniku. Przy następnym otwarciu produktu sklep {name} zostanie sprawdzony ponownie.”                  | Half. The first sentence fits. The second is true only when the next view refetches: the stored check is more than 15 minutes old or absent, and the view is own navigation (`price-comparison.ts:121-138`; `[id].astro:119-122`). The function is private to `match-card.ts`, and its alert belongs to a matched shop's card; the own shop's card is a plain `ShopCard` (`PriceComparisonView.tsx:172`). |
| The form's partial     | `notices.ts:323-326`, exported as `PRICES_NOTICES.partial` (`:348-353`): a page alert                  | „Nie wszystkie ceny udało się odświeżyć. Tam, gdzie się nie udało, widać ostatnią znaną cenę i jej wiek.”                    | Only if the island shows the stored check in place of the fetched one (option B). It names no shop.                                                                                                                                                                                                                                                                                                       |
| The failed fetch       | `shop-messages.ts:56-57`: a card line                                                                  | „Nie udało się pobrać ceny ze sklepu {name}.”                                                                                | No: the price was fetched, and this text blames the shop (TD-07).                                                                                                                                                                                                                                                                                                                                         |
| Keeping the last price | `shop-messages.ts:9`, private                                                                          | „Pokazujemy ostatnią znaną cenę.”                                                                                            | Only as option B's second sentence, and loosely: the latest known price is the one not shown.                                                                                                                                                                                                                                                                                                             |
| Not refreshed          | `notices.ts:327-330`                                                                                   | „Nie udało się odświeżyć cen. Spróbuj ponownie za chwilę.”                                                                   | No: it's page-wide and says nothing was refreshed.                                                                                                                                                                                                                                                                                                                                                        |
| Unread                 | `price-comparison.ts:696`; `price-comparison-state.ts:749`                                             | „Nie udało się wczytać ceny.”, „nie udało się wczytać”                                                                       | No: a read failed, not a write.                                                                                                                                                                                                                                                                                                                                                                           |
| Stale                  | `ShopCard.tsx:83-89`; `price-comparison-state.ts:493-501`, `:738-739`; `watchlist-rows.ts:289-290`     | „Nieaktualna”, „Ostatnia znana cena … cena może być nieaktualna”, „Stara cena”, „Odśwież ceny, aby sprawdzić aktualną cenę.” | No: the fetched price is current. These apply by themselves to an old stored check.                                                                                                                                                                                                                                                                                                                       |
| Missing                | `shop-messages.ts:65-69`                                                                               | „Sklep nie zwraca już tego produktu. Cena może być nieaktualna.”                                                             | No: it's another state.                                                                                                                                                                                                                                                                                                                                                                                   |
| Gap                    | `price-comparison-state.ts:284-292`                                                                    | „Jeszcze bez ceny”, „Brak ceny online w {site}”, or the unread text                                                          | Only for option B with nothing stored, while the app holds a price.                                                                                                                                                                                                                                                                                                                                       |

- E: Two rules constrain any fix (`CLAUDE.md:58`):
  - freshness and the cheapest shop are decided only in `price-comparison.ts`: stale after 24 hours, and only fresh prices orderable online can win;
  - "the list shows stored prices only and asks no shop".
- E: The test plan accepts that, from lg, the selected row's tag follows the island's live prices, while its screen-reader line and the chips' counts stay the list's own read (`context/foundation/test-plan.md:412`).
- **Answer:** among the nine states and texts above, none says "fetched but not saved" for a price check.
  - Option A needs one new sentence.
  - Option B can reuse `PRICES_NOTICES.partial` as it stands, as an alert on the island.
  - Option C reuses „Nie udało się pobrać ceny…”, which names the wrong cause.

### The three options

The sizes below are the options analysis's estimates (I).

#### Option A: keep the fetched price and flag its row

- **Changes:**
  - `price-comparison-state.ts`: `ShopRow` gains a flag, false in `initialState`. `settled` sets it from `saved`, and `announcement` appends a sentence while it is set. The marks, the verdict, the hero, the caption and `PRICES_EVENT` stay as they are.
  - `shop-messages.ts` gains the sentence. The module is already in `islandConfig` (`eslint.config.js:99`).
  - `ShopCard.tsx` gains one warning-coloured line beside the notice line (`:119-123`). So it shows on the own shop's card and on a matched shop's price card, which renders `ShopCard` (`src/components/watchlist/MatchCard.tsx:53-57`).
  - `src/dev/fixtures.ts` gains a state in `PRICE_STATES` (`:410`), since the kitchen sinks change with the views (`CLAUDE.md:58`).
  - Untouched: the route, the wire contract (`saved` is already sent and parsed), the database and the form path.
- **What the user sees:** the shop's current price with „cena online · przed chwilą”, the sentence under it in the warning colour, and „Najtaniej” when the price wins. Screen readers hear the price and the sentence. After a reload, the older stored check with its age, as today.
- **Guardrails:**
  - Never silent (`prd.md:49`): the failure shows on the shop's own card and is announced, named as the app's failure, not the shop's.
  - The price keeps its source and its true fetch time (`prd.md:63-64`, `:151`, `:190`; `CLAUDE.md:19`).
  - S-03's cheapest rule stays the only one, and being stored isn't part of it.
  - The selected row's tag follows the unstored price, which falls under the accepted edge (`test-plan.md:412`).
- **Inside A, the analysis left three calls to the owner:** the wording; whether an unstored price may be named cheapest (A: yes; withholding the mark would be a new rule, as `compareRows` does for `readFailed`, `price-comparison-state.ts:305-314`); and whether the selected row's tag follows it (A: yes; keeping the list strictly on stored checks would need each row to keep its stored check beside the fetched one).
- **Tests:** the state module's (`src/components/watchlist/price-comparison-state.test.ts`), the sentence's (`src/lib/shop-messages.test.ts`), and a route test of `saved: false` after a failed insert (`src/lib/services/price-routes.test.ts`, where only `saved: true` is asserted today, `:307-311`, `:395`).
- **Size:** about 35-50 lines of code in 4 files, and 100-140 lines of tests in 3 files.

#### Option B: show the stored check, as the form path does

- **Changes:**
  - In `settled`, an unstored price or missing answer keeps `latest` and `readFailed` and sets a notice, like the `unavailable` branch (`price-comparison-state.ts:255-260`), with a reason local to the island on `RefreshNotice` (`:53-56`).
  - The text: a new card line, which needs a variant without a stored price as `priceUnavailableText` has (`shop-messages.ts:39-59`); or no new text, with an island alert like `matchChanged`'s (`PriceComparisonView.tsx:97-113`) showing `PRICES_NOTICES.partial.text`, which names no shop.
  - `ShopCard.tsx` (the notice line) and the kitchen sink.
- **What the user sees:** the last stored price with its age; „Jeszcze bez ceny” when nothing was stored, or „Nie udało się wczytać ceny.” for a row the page couldn't read; the marks judged on those; and the notice. The price the shop just gave never appears.
- **For it:** never silent; one truth on every screen; `CLAUDE.md:58` holds strictly.
- **Against it (I):**
  - The user doesn't see a current price the app holds (US-01; `prd.md:63`).
  - A stored check more than 24 hours old turns the card „Nieaktualna” and „Stara cena”.
  - A shop whose first price after a lookup wasn't stored shows no price at all while inserts fail (`shop-matching.ts:390-393`).
  - The stored price can stay „Najtaniej” after the shop has just answered a higher price, or said it no longer returns the item.
- **Size:** about 40-60 lines of code in 4-5 files, and 100-140 lines of tests.

#### Option C: the route answers an unstored check as a failed one

- **Changes:** `answerFor` (`src/pages/api/watchlist/prices.ts:16-26`) answers `{ kind: "unavailable", reason: "failed" }` for an unstored price or missing check. `saved` is then true wherever it appears:
  - kept as a dead field in the hand-kept contract (TD-12);
  - or removed from `PriceRefreshAnswer` (`types.ts:272-275`) and the parser (`price-comparison-state.ts:901-909`). That edits 21 `saved:` literals, 12 in `price-comparison-state.test.ts`, 7 in `src/dev/fixtures.ts` and 2 in `price-routes.test.ts`, and drops the parser's "no saved flag" case (`price-comparison-state.test.ts:688`).
- **What the user sees:** the last known price with its age and „Nie udało się pobrać ceny ze sklepu Natura.”, as for any failed fetch.
- **Against it (I):**
  - The text names the wrong cause, since the shop did answer, which deepens TD-07.
  - The current price is thrown away.
  - As in B, a stored price can stay „Najtaniej” after the shop said otherwise.
  - A user told the shop failed may tap again, and each tap asks the shop and fails to store again while the cause lasts.
- **Size:** about 5 lines of code and 20 lines of tests, plus about 30 lines if `saved` is removed.

#### Side by side

|                                                               | A: flag the row, keep the price          | B: show the stored check           | C: the route says "failed" |
| ------------------------------------------------------------- | ---------------------------------------- | ---------------------------------- | -------------------------- |
| The user sees the current price                               | yes                                      | no                                 | no                         |
| Cause named                                                   | storage                                  | storage                            | the shop (wrong)           |
| A price the shop just withdrew or raised can stay „Najtaniej” | no                                       | yes                                | yes                        |
| The island and the form agree on                              | the claim                                | the claim and the number           | the number, not the cause  |
| The list shows stored prices only                             | the selected row follows (accepted edge) | yes                                | yes                        |
| New text                                                      | one sentence                             | one, or none with the form's alert | none                       |
| Wire contract                                                 | unchanged                                | unchanged                          | changed, or a dead field   |
| Rough size, code + tests                                      | ~45 + ~120 lines                         | ~50 + ~120                         | ~5 + ~20                   |

The analysis recommended A: the defect is the silence, not the price; A names the failure as the app's own and promises nothing that isn't always true; it is local and small; B trades the current price for agreement with the form, and C names the wrong cause and invites retries that spend the cap.

### The owner's choice (2026-10-10)

- **Option A** (the owner's call): the island keeps the fetched price, and its card adds one line, which the screen-reader announcement carries too.
- **The line** (the owner's call): „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”
- By choosing A, the owner keeps A's answers to the two other calls: an unstored price may be named cheapest, and the selected row's tag follows it.
- The audit's fix direction for P6 is the same, "Show the row as 'not saved'" (audit `:97`; fix order item 8, `:165`). Its other half, logging the failure at error level with the shop and the row count, doesn't change what the user sees, and today's warn line names neither (`prices.ts:94`, `:411-414`).

### What the owner's words settle in the details

Five findings at this commit that the options analysis didn't carry, or carried otherwise.

1. **The sentence names a price, so it holds only while the card shows a price that wasn't stored.**
   - E: An unstored `price` answer puts that price on the card (`price-comparison-state.ts:238-246`), and the list reads only stored observations (`CLAUDE.md:58`), so "lista jej nie pokaże" holds.
   - E: A `missing` answer keeps the row's older price (`:247-254`). When that older price was stored and the missing answer wasn't, the list does show that price, only without the missing mark.
   - I: There the sentence would be false. The analysis's flag covered a missing answer too, with a draft sentence („wyniku … go”) that fit both kinds of answer; the owner's words („tej ceny … jej”) fit only a price.
   - I: So an unstored missing answer after a stored price can't take the owner's line. Its residual is the one case (b) describes: for up to 15 minutes, the list and the next view may show the older price as fresh while the shop has said it no longer returns the item.
2. **The flag belongs to the price the row shows, not to the last attempt.**
   - E: `start` clears `notice`, since "a new attempt clears what the last one said" (`price-comparison-state.ts:169-174`), while the price stays on the card during the refetch, faded (`ShopCard.tsx:60-61`).
   - E: An `unavailable` answer keeps the row's latest check (`:255-260`), and a `missing` answer keeps its offer (`:253`).
   - I: A flag cleared by `start`, as the analysis proposed, would drop the line while the card still shows the unstored price: during the refetch, and for good after a refetch that gets no answer. The line stays true as long as that price is on the card: set by the price's own answer, kept through `start` and every answer without a new price, and replaced by the next price answer.
3. **From lg, the list beside the product shows the unstored price live.**
   - E: `rowShopsOfIsland` sends each row's shop, latest check and read state (`price-comparison-state.ts:367-375`), "and nothing else of the row" (`price-comparison-state.test.ts:1660-1670`), and the selected row's tag follows it (`RowTag.tsx:44-58`).
   - I: So while the card says „lista jej nie pokaże”, the selected row beside it shows that price, under the edge `test-plan.md:412` accepts. The sentence holds for the list as it loads, on this device or for the item's other watchers.
4. **An insert that timed out may still have committed.**
   - E: The insert gives up after 2 seconds (`prices.ts:27`, `:92`). The audit notes that an aborted write may have committed though it is reported as failed (W6, audit `:126`).
   - I: Then the line is a false alarm, and the list does show the price. How often that happens is unknown (U).
5. **The card's line can be pinned in Node.** The analysis said it couldn't: the suite runs in Node (`vitest.config.ts:15`), and there is no Testing Library.
   - E: `ShopCard` keeps no state, "so it renders the same in the island and in the kitchen sink" (`ShopCard.tsx:61-62`). Its pieces (`Price.tsx`, `ShopLink.tsx`, `src/components/ui/card.tsx`, `src/components/ui/badge.tsx`) touch no `window` or `document` (grep).
   - E: `react-dom` and `@types/react-dom` are dependencies (`package.json:30`, `:36`; 19.3.0 installed). In Node, `react-dom/server` resolves to `server.node.js`, which exports `renderToStaticMarkup`.
   - E: The suite includes only `src/**/*.test.ts` (`vitest.config.ts:11`), so a card test writes no JSX and uses `createElement`. The `.tsx` it imports is transformed by Vite 8.3.0 under Vitest 5.0.2. Vite's oxc transform reads the file's `tsconfig.json`, whose `"jsx": "react-jsx"` and `"jsxImportSource": "react"` compile JSX for React's automatic runtime.
   - I: So `renderToStaticMarkup(createElement(ShopCard, { row, now }))` renders the card with no DOM and no new dependency. No test in the repository renders a component yet (grep for `react-dom/server` in `src`, `scripts` and `tests`).

### Shop requests, migrations and recordings

- E: None of the options needs a shop request, a migration or a new recording.
  - The route already sends `saved` (`src/pages/api/watchlist/prices.ts:74`), and the island already parses it (`price-comparison-state.ts:901-909`).
  - No column, grant, policy or view changes, so nothing goes into `supabase/migrations/`.
- E: The tests need nothing recorded:
  - the state tests build answers by hand;
  - a route test serves the existing recording `RECORDINGS.soft` (`natura-sku.json`; `price-routes.test.ts:9`, `:55`) through `createReplayFetch`;
  - the stand-in database answers every query of a relation given as an error with that error, an insert included (`src/lib/services/testing/stub-supabase.ts:6`, `:145-147`), and the route's own reads touch only `watchlist_items` and `watchlist_matches` (`src/lib/services/price-targets.ts:80-101`);
  - the suite's warn spy already silences the insert's log line (`price-routes.test.ts:234`).
- I: No option adds a request at runtime. None asks the shop again after an unstored answer, and the 15-minute rule and the own-navigation guard stay as they are. Case (b)'s extra requests come from the missing observation, and only a stored check stops them.

## Code References

- `src/pages/api/watchlist/prices.ts:16-26`, `:71-74` — the answer builder, and `saved` from the refresh's insert result
- `src/types.ts:267-275` — `PriceRefreshAnswer`, with `saved` documented as "whether the check was stored"
- `src/lib/services/prices.ts:27`, `:56-73`, `:81-98`, `:411-414` — the 2-second limit, the row a check adds, the one insert and its warn line
- `src/lib/services/price-refresh.ts:84-101`, `:139-149` — each shop's insert, `overall`, the form's codes
- `src/lib/services/shop-matching.ts:390-393` — the lookup's first price, its result ignored
- `src/components/watchlist/price-comparison-state.ts:53-76`, `:132-159`, `:166-177`, `:203-265`, `:367-375`, `:886-910` — the row, `initialState`, `start`, `announcement` and `settled`, `rowShopsOfIsland`, the parser
- `src/components/watchlist/PriceComparison.tsx:100-120` — the automatic refetch and `PRICES_EVENT`
- `src/components/watchlist/ShopCard.tsx:57-127` — the card and its warning lines
- `src/components/watchlist/PriceComparisonView.tsx:124-128`, `:156-185` — the live region and the shops' cards
- `src/components/watchlist/MatchCard.tsx:53-57` — a matched shop's price card renders `ShopCard`
- `src/lib/shop-messages.ts:1-69` — the card's texts about a shop's price
- `src/components/watchlist/match-card.ts:104-107`, `:141-142` — the lookup's not-saved alert
- `src/lib/notices.ts:315-353` — the form's refresh notices
- `src/dev/fixtures.ts:186-200`, `:410-561` — the kitchen sink's island builders and price states
- `src/components/watchlist/price-comparison-state.test.ts:116-130`, `:132-148`, `:234-255`, `:488-607`, `:1659-1690` — the helpers, `initialState`'s test, the notice test, what screen readers hear, `rowShopsOfIsland`
- `src/lib/services/price-routes.test.ts:52-64`, `:166-176`, `:231-236`, `:300-314` — the recordings, the route's world, the clock and the warn spy, the stored-price case
- `src/lib/services/testing/stub-supabase.ts:1-16`, `:141-151` — a relation given as an error answers every query with it; otherwise an insert succeeds

## Architecture Insights

- **One reducer turns an answer into a row.** `settled` is the only place a refetch answer changes a row (`price-comparison-state.ts:179`, `:234-265`), and the view only renders the state (`PriceComparisonView.tsx:55-61`). A flag on the row reaches the card and the announcement, and nothing else unless it is passed on.
- **The card and the live region share their texts.** Both take their sentences about a shop's price from `shop-messages.ts` (`ShopCard.tsx:9`; `price-comparison-state.ts:26`), which `islandConfig` admits (`eslint.config.js:99`). One sentence there serves both.
- **`PRICES_EVENT` carries a narrow shape.** The selected row recomputes its tag from each shop's `{ shop, latest, readFailed }` only (`price-comparison-state.ts:367-375`), so a row flag stays off the list unless that shape grows.
- **The two paths keep two truths.** The form path shows only stored checks and words a failed insert as `partial`; the island shows the shop's answer. Option A keeps that split and makes the island say it.

## Historical Context (from prior changes)

- `context/archive/2026-09-28-cheapest-shop-today/plan.md:494-497` — S-03 defines the JSON route's answer with `saved`, and no island behaviour for it; `:863`, the form's `partial` includes answers that couldn't be stored.
- `context/archive/2026-09-27-shop-matching-first-two-shops/plan.md:627` — the lookup's own not-saved alert, „Nie udało się zapisać wyniku…”, whose first sentence the analysis's draft echoed.
- `context/foundation/test-plan.md:410-412` — the selected row's tag following the island's live prices, an edge the owner accepted on 2026-10-07 (from `context/archive/2026-10-07-testing-route-and-database-seams/research.md`).
- `context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:97`, `:165` — P6 and fix order item 8, written at `71e375b`, where the parser stood at `price-comparison-state.ts:774-782`, the insert at `prices.ts:76-79` and the lookup's price at `shop-matching.ts:337`.
- `context/changes/price-refresh-flow-analysis/research.md:438-445` on branch `docs/m4-course-lessons` — TD-02, beside TD-01 (one write, two callers), TD-07 (the reasons flatten), TD-12 (the hand-kept wire contract), TD-18 (no database test of the insert) and TD-19 (e2e reaches only the `stopped` answer).

## Related Research

- `context/changes/price-refresh-flow-analysis/research.md` on branch `docs/m4-course-lessons` — the refresh flow analysis this change comes from.
- `context/archive/2026-10-07-testing-route-and-database-seams/research.md` — the accepted edges, the selected row's tag among them.
- `context/archive/2026-09-28-cheapest-shop-today/research.md` — the island's first design.

## Open Questions

None blocks the plan: the owner's two calls settle the fix and its words, and the details above follow from them. For the owner, later:

1. An unstored missing answer after a stored price stays silent under the owner's line (finding 1). Should it get a sentence of its own?
2. Should the selected row beside the product keep the stored check while the card says the list won't show the fetched price (finding 3)?
3. P6's other half: logging a failed insert at error level with the shop and the row count, which the audit's fix order item 1 would do through one shared failure reporter.
4. TD-18: a database test of the app's own insert, which would stop an insert drift before production.
