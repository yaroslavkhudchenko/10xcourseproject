# Follow-ups from the implementation review

Found by `/10x-impl-review` on 2026-09-30 (`reviews/impl-review.md`) and by the manual verification (`plan.md`, "Manual verification"), and left out of this change. The review-fix commit fixed nine of the ten findings; F8 is recorded below, as its fix proposed, and so are the trade-offs the review accepted.

## For S-08 (re-pinning)

- **The product page's own actions drop the list's filter** (F8).
  - `?f=` survives the chips, the rows, the back link and the list refresh.
  - Natura's prompt and retry links (`src/lib/services/natura-view.ts`), the decision posts' redirects (`src/lib/services/matches.ts`) and the product's no-JavaScript refresh (`src/pages/api/watchlist/refresh.ts`) drop it, so the aside falls back to "Wszystkie".
  - The plan never promised it, and S-08 reworks those Natura actions anyway. The roadmap's S-08 carry-over records it.

## For S-07 (the pinned pages)

- **The pinned pages don't pad the safe-area insets** (F6). `Layout.astro`'s viewport has `viewport-fit=cover` on every page, and only `WatchlistShell.astro` pads the insets, so `/`, `/dashboard` and `/auth/*` can reach under a phone's notch. The roadmap's S-07 carry-over records it beside the restyle.

## For the next change to the price rules (`price-comparison.ts`)

The manual verification found these in rules that predate this change, which it didn't alter:

- **Rossmann is "Najtaniej" while Natura's price is still loading.** Only a shop with a price can win, so the hero and the Rossmann card say "Najtaniej" until Natura answers. The live region then ends naming both shops "najtaniej", as it has since S-03. Consider withholding the mark while a shop is pending.
- **An ended promotion reads three ways.** A price that's stale only because its promotion ended reads "CENA SPRZED 24 MIN" in the track and "cena może być nieaktualna" in the hero, while its card still shows "promocja do 28.09" (ShopCard's rule).

## Accepted, to revisit

- **The product page's reads** (F9): every product view runs the list's three reads, on phones too, so the page makes 5 subrequests at once, close to Workers' 6 simultaneous connections per request. The plan accepted it. Revisit before a change adds another read to the product page.
- **The selected row's tag hydrates only from `lg`** (F9, `client:media="(min-width: 64rem)"`). A window that is narrower when the product's island refreshes, and wider afterwards (a tablet turned to landscape), shows the page's tag and line until the island's next `PRICES_EVENT`, which it sends only when its rows change. Both show their own ages, so nothing is silently wrong. A fix would be a request event: `RowTag` asks on hydrating, and the island answers.
- **The list page's tab order at `lg`** (F10): Tab goes from the chips to the results on the right and back to the rows on the left, because the DOM order is chosen for phones.
- **The sticker's rotated box at 1024 px** overlaps the caption's box, with only its transparent corner; the drawn starburst clears the caption by at least 10.9 px.
