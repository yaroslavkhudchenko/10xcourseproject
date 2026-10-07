---
change_id: testing-route-and-database-seams
title: Route and database seams (test plan rollout Phase 2)
status: implementing
created: 2026-10-07
updated: 2026-10-07
archived_at: null
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Route and database seams". Risks covered: #1 (a stale, ended-promotion or unread price shown as current, or the wrong shop marked cheapest), #3 (a shop blocked for everyone because some path spends the shared per-shop cap or bypasses the gate), #4 (a signed-in user reads, infers or changes another user's rows through a route or a direct database call), #6 (the comparison uses the wrong product, or a stale tab's decision overwrites a newer one). Test types planned: integration + database contract. Risk response intent: #1 — with shops in mixed states, the list and the product page agree: no shop is marked cheapest unless its own price is fresh and orderable, every price shows its shop and age, and an unread shop shows a gap, proven over the stored-price reads with database faults; #3 — no path (page view, cross-site link, reload or back, list refresh, retry, a refused shop) sends a shop more requests than its cap or any request after a 403, proven through the real gate by counting the URLs the replay served; #4 — with two real users, neither can read, list, infer, change or delete the other's rows through any route or a direct database call, proven by two-user route tests beside the existing database contract checks; #6 — a stale tab's decision can't overwrite a newer one, proven by the conditional decision write against the real database (today only stubbed). After creating the folder, follow the downstream continuation rule.
