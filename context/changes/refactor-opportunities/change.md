---
change_id: refactor-opportunities
title: Refactor opportunities from the refresh flow analysis
status: new
created: 2026-10-10
updated: 2026-10-10
archived_at: null
---

## Notes

Intent (course module 4, lesson 4): we have an analysis of this repository that documents technical debt and structural risks, `context/changes/price-refresh-flow-analysis/research.md`. This change answers the question that analysis deliberately left open: WHICH of those problems are worth fixing, in what target shape and in what order.

We explore each recorded problem in the code and in the history, then order them as refactor opportunities. The change runs in stages: exploration, then decision and plan, then implementation. The exploration stage changes no code and decides nothing. Its output is this change's `research.md`, ending with a ranking of the options and their trade-offs.

The owner reads the report first. The decision about what to deliver is made at the planning stage, and a refactor starts only by the accepted plan.
