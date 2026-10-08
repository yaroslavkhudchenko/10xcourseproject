---
change_id: testing-shop-answer-contracts
title: Shop answer contracts (test plan rollout Phase 3)
status: impl_reviewed
created: 2026-10-07
updated: 2026-10-08
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Shop answer contracts". Risks covered: #5 (a shop changes its answer and the app shows a wrong price, "not found" or "missing" instead of a visible gap), #3 (a shop blocked for everyone because some path keeps asking after a refusal or spends the shared per-shop cap). Test types planned: contract + unit. Risk response intent: #5 — a changed answer (a missing field, a string for a number, HTML instead of JSON, a moved route, empty hits) becomes a visible gap or a failed check, never a price, "not found" or "missing", and is never stored as a price, proven by contract tests on deliberately broken copies of the recordings, never only the happy recording and never copies shaped to what the parser already tolerates; #3 — a refused shop answer (a 403, a challenge, a 429, a 503 with Retry-After) stops or pauses that shop and nothing more is asked of it, proven through the real gate by counting the requests the replay served, never by mocking the gate. Follow-ups the guide carries for this phase (§6.6): broken copies for Rossmann's and Natura's recordings (S-05); a Luigi's Box hit with neither a type nor attributes reads as a query suggestion, so an answer whose hits all lost both would read as "found nothing" instead of a gap, for Natura and Hebe alike (S-05); Algolia's answer to a rejected key was never recorded, so a Super-Pharm 403 is pinned only by the gate's own rule, and live price batches are untested beyond four ids (S-06). After creating the folder, follow the downstream continuation rule.
