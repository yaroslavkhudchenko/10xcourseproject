# Review follow-ups: decision-route-guardian

Deferred by the implementation review of 2026-10-10 (`../reviews/impl-review.md`), by the owner's calls of 2026-10-10, to the next two slices of milestone M-2.

- [ ] **F3, what the route hands the store (S-02, `decision-store-backstop`):** no route test reaches the store's update, so the form's own `replaces` that the route hands `recordDecision`, and its mapping of `decided`, `gone` and `failed`, are pinned only in `matches.test.ts` and `matches.db.test.ts`.
  - Once S-02 makes the write one database function call, which `stubSupabase` records (`rpc`), its route tests assert that call's arguments and each outcome.
- [ ] **F4, a race and direct calls (S-02):** the compare-and-swap checks the state and `shop_item_id`, not `decided_by`.
  - So an automatic match that becomes the user's between the guardian's read and the write can be rewritten with the same decision.
  - A direct database call bypasses every rule of the guardian, on the caller's own list only.
  - S-02's research lists what a direct call allows (lesson "Check what a direct database call allows"), and its plan decides whether the write also checks `decided_by`.
- [ ] **F5, one reading rule (S-03, `page-lookups-through-guardian`):** "an unreadable shop first, then that shop's decision" exists in `standingFrom`, `decideMatchStep` and `itemInRows`.
  - A missing product against a failed read has two precedences: `gone` in `loadWatchedProduct` and on the product page, `failed` in `productTargets`.
  - S-03 routes the read side through `watchedProductOf` and `loadWatchedProduct`, with one precedence.
