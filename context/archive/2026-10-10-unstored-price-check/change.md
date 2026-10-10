---
change_id: unstored-price-check
title: Say when a refreshed price couldn't be saved
status: archived
created: 2026-10-10
updated: 2026-10-10
archived_at: 2026-10-10T16:43:51Z
---

## Notes

Source:

- TD-02 of the refresh flow analysis, on branch `docs/m4-course-lessons`: `context/changes/price-refresh-flow-analysis/research.md`, "TD-02: the island drops `saved`, so a check that wasn't stored shows as fresh and stored".
- P6 of the observability audit: `context/audits/observability/2026-10-05_1626-prices-sign-in-watchlist-writes.md:97`, fix order item 8 at `:165`.

The defect: the product page's island refetches a shop's price through `POST /api/watchlist/prices`. When the price is fetched but its insert into `price_observations` fails, the route answers `saved: false`, which the island parses and never reads. So the card looks exactly like a stored check: „cena online · przed chwilą”, possibly „Najtaniej”, the same announcement, and the selected list row's tag following through `PRICES_EVENT`. The list and the next view show the older stored price, and the next view asks the shop again when that price is more than 15 minutes old.

The owner's calls (2026-10-10):

- **The fix is option A:** the island keeps the fetched price, and its card adds one line, which the screen-reader announcement carries too.
- **The line:** „Nie udało się zapisać tej ceny, więc lista jej nie pokaże.”

No roadmap item traces to this change.
