---
change_id: testing-critical-browser-flows
title: Critical flows in a real browser (e2e tests for test-plan Phase 1)
status: implemented
created: 2026-10-02
updated: 2026-10-02
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Critical flows in a real browser".
Risks covered: #7 (a browser-only regression breaks the phone flow), #1 (a stale or unread price shown as current, or the wrong shop marked cheapest), #2 (a deploy breaks production: breakage only on Workers). Test types planned: e2e (Playwright: /10x-e2e-setup, then /10x-e2e).
Risk response intent:

- #7: on a phone-sized viewport and the production build, a signed-in user opens the list and a product, sees each shop's price with its age, refreshes, removes a product through the confirm and re-pins a match, with no live shops, no sideways scroll and visible focus.
- #1: the rendered page marks no shop cheapest unless its price is fresh and orderable, every price shows its shop and age, and an unread shop shows a gap.
- #2: the flows run on the workerd production preview, so breakage that happens only on Workers fails before a merge.

Branch: start from main after PR #19 is merged, on a new feat/testing-critical-browser-flows branch.
After creating the folder, follow the downstream continuation rule.
