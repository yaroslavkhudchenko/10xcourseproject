# Follow-ups from the implementation review

Found by `/10x-impl-review` on 2026-09-29/30 (`reviews/impl-review.md`) and left out of this change: each predates it, or the plan ruled it out. The ten findings themselves were fixed in the review-fix commit.

## For a later change

- **The list page reads an unreadable price row as "no price yet"** (lesson "Never read an unreadable answer as missing").
  - Where: `src/pages/watchlist.astro`, which reads all prices through `listLatestPrices`.
  - What happens: a row that fails the schema is dropped, so its product shows "Jeszcze bez cen. Otwórz produkt, aby je pobrać." (`NO_PRICES_YET`).
  - This is the same class of problem as F1, which the product page now handles with `readLatestPrices`. It predates this change (S-03).
  - Give the list its own read-failure state, or a keyed read.
- **The page's matched-shop list re-implements `productPriceKeys`** (lessons "Keep decision logic in tested services" and "Define shared constants and helpers once").
  - Where: `src/pages/watchlist/[id].astro`, the block that builds `matched`, and `src/lib/services/price-comparison.ts:285`.
  - It decides which items are read and refetched, and it isn't tested in the page. It predates this change (S-03).
- **The API routes still name the notice parameters themselves.**
  - Where: `src/pages/api/watchlist/matches.ts` and `refresh.ts`, where they redirect with `?matched`, `?error=` and `?prices=`.
  - The page and its script now read the names from one module (F4); the plan ruled out route changes in this change.
  - Import the shared names in the routes.
- **Component variants below 4.5:1 that the contrast check doesn't measure,** because the view doesn't render them:
  - the `destructive` Button and Badge fills (`dark:bg-destructive/60` under white text), at 4.59:1 on the base stop and 4.41:1 on the glow;
  - the Badge `link` variant (`text-primary`, purple-600), at about 3.5:1.

  Fix them, or add their pairs to the check, before a view uses them. The `etykiety-redesign` restyles both.

- **What `tokenConfig` deliberately doesn't cover:** plain hex strings (they'd hit ids and anchors), `style` attributes, and client `<script>` blocks in `.astro` files. Extend it if a cleaned view starts using them.

## For `etykiety-redesign`

- **Exclude the design handoff from ESLint and the tsconfig** once it moves into `context/changes/etykiety-redesign/handoff/`. Its `support.js` gives `eslint .` 3,026 problems and `astro check` 8 hints; the untracked copies in the repo root do so today.
- **Restyle the extracted pieces.** They now exist once: `ShopLink`, `ProductHeader`, the `inline` Button size and the notice module.

## For S-08 (re-pinning)

- **A confirmed Natura match no longer names its item on the page** (by design, C3): the price row shows Natura's price and link, and the section only the note and the size warning. Re-pinning, the redesign's "Zmień", will likely need the item's name back beside the decision.
