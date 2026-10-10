---
type: rule-review
date: 2026-10-10
mode: review
file: context/audits/rules/agents-md-draft.md
commit: 5eefce2
branch: docs/m4-course-lessons
dirty_tree: true # the draft that /10x-agents-md wrote over the root AGENTS.md pointer, uncommitted on top of 5eefce2; the owner kept the pointer, so the draft is kept as agents-md-draft.md
skill: /10x-rule-review
scope: the whole file, reviewed by the same run that wrote it
reorder: none proposed # Check 5 found the order sound, so no question was asked
previous_report: null
verdicts: { ok: 4, warn: 1, fail: 0 }
---

# Rule Review — AGENTS.md

**Overall:** Lean, precise and front-loaded: 30 non-blank lines and 399 words with the hard rules first; its one real redundancy is deliberate, the hard rules it shares with CLAUDE.md.

## Scorecard

| #   | Check               | Verdict | Score                                             |
| --- | ------------------- | ------- | ------------------------------------------------- |
| 1   | Length              | OK      | 30 non-blank lines, 41 at 120 columns (399 words) |
| 2   | Direct snippets     | OK      | 0 flagged blocks                                  |
| 3   | Precise language    | OK      | 0 vague phrases                                   |
| 4   | Redundant knowledge | WARN    | 2 redundant rules                                 |
| 5   | Rule ordering       | OK      | Hard rules first, commands next, references last  |

## Findings

### 1. Length — OK

- 30 non-blank lines of 43, and 41 at 120 columns; 399 words after the title, 362 without headings and list markers, inside the 200–400 that /10x-agents-md sets.

### 2. Direct snippets — OK

- No fenced block; the inline code is commands, paths and names.

### 3. Precise language — OK

- No vague phrase: each rule names a file, a command, a constant or a shop.

### 4. Redundant knowledge — WARN

- `agents-md-draft.md:7-15` — every hard rule restates CLAUDE.md (`CLAUDE.md:17-24`, `:38`, `:47`, `:60` and `:72-73`). Claude Code loads only CLAUDE.md and Codex only AGENTS.md, so each reads one copy, but a harness that loads both reads the rules twice, and two copies can drift; the course block says not to repeat a rule at several levels (`CLAUDE.md:95`) → keep the short form, and give it one source (Top 3 action 1).
- `agents-md-draft.md:34` — "Tests sit beside their source (`*.test.ts`" can be read from the tree and from `vitest.config.ts:11` → delete the clause, keeping "`*.db.test.ts` need the database".

### 5. Rule ordering — OK

Current order (5a):

1. `# Repository Guidelines` (line 1)
2. `## Hard rules` (line 5)
3. `## Commands` (line 17)
4. `## Structure` (line 24)
5. `## Conventions` (line 30)
6. `## Commits and PRs` (line 36)
7. `## Further Reading` (line 41)

Comments (5b):

1. `# Repository Guidelines` — USEFUL: one sentence of frame (`:3`) and the pointer to CLAUDE.md.
2. `## Hard rules` — CRITICAL: nine rules, on invite-only access, secret keys, RLS, the shop gate, bot protection, honest prices, pull requests, the course block and the public repository.
3. `## Commands` — USEFUL: setup, CI's `ci` job, the dev server under an agent, and what needs Docker.
4. `## Structure` — USEFUL: where decision rules, gated pages, components and catalogue entries go.
5. `## Conventions` — USEFUL and REFERENCE: the lint guards by name, Polish text, `astro/zod` and where tests go.
6. `## Commits and PRs` — USEFUL: the subject form `git log` shows and the required checks.
7. `## Further Reading` — REFERENCE.

Order is sound: CRITICAL first, the commands next, references last, and no INTRO. The hard rules take words 32–190 of 399, so the commands start at word 191, just past the first third; moving them up would put commands above the rules the file exists for.

Proposed order (5c): Order is sound; no reshuffle needed.

Question (5d): none, since 5c proposed nothing. The review did not edit AGENTS.md.

> **Test each change in your next agent session.** Reordering a rules file is a context-shape change — its effect on agent behavior only shows up the next time you run a real task. Apply changes one at a time (atomic): reorder, then run a representative task, then move on to the next change (split, dedupe, rewrite). Bundling multiple structural changes makes it impossible to attribute a behavior shift to a specific edit.

Verdict: scored on the order as written; the top is dense with CRITICAL rules under clear headings.

## Top 3 actions

1. **Give the shared hard rules one source.** Either make AGENTS.md the source and have CLAUDE.md import it with an `@AGENTS.md` line in place of `CLAUDE.md:17-24` and `:72-73`, or keep both copies and change them in the same commit. Before any import, write AGENTS.md's ten `@` paths as plain paths: Claude Code imports recursively, so they would bring `context/foundation/test-plan.md` (13,653 words), `eslint.config.js` and the CI workflow into every session.
2. **Drop the layout clause at `agents-md-draft.md:34`** and keep the body under 400 words as rules arrive: at 399 there is no room left, so a new rule replaces one here or goes to CLAUDE.md.
3. **Prove the file in a harness that reads only AGENTS.md.** In a fresh Codex or Cursor session, give a task that touches a shop adapter or a migration, and check that the agent sends shop requests through `gate.fetch`, writes RLS with explicit grants and leaves the merge to the owner without opening CLAUDE.md; add a rule here only for what it misses.

## Disposition (2026-10-10)

The owner kept the root `AGENTS.md` as its one-line pointer to `CLAUDE.md` (the owner's call, 2026-10-10), so no second rules file has to be kept in sync. This review's draft is kept as `agents-md-draft.md`, the lesson's output. After the review, its migration rule (`agents-md-draft.md:13`) was corrected: it said never to run `supabase db push`, while `CLAUDE.md` says only the owner runs it. The draft is then 400 words after the title.
