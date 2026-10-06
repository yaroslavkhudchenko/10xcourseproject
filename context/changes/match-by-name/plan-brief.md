# Automatic matches by name, Super-Pharm first: Plan Brief

> Full plan: `context/changes/match-by-name/plan.md`
> Research: `context/changes/match-by-name/research.md`

## What & Why

The owner wants Super-Pharm matched with no tap: "I want it to be done automatically, its basically same product … which can be changed". Super-Pharm's index has no EAN, so today no Super-Pharm item is ever accepted on its own, and the user must tap „Dopasuj w Super-Pharmie” and pick. This change adds a strict name check for items or products without an EAN, and looks Super-Pharm up when the product opens.

## Starting Point

- **One function accepts matches.** `pickMatch` accepts only on a shared EAN, an equal size and a brand that doesn't differ (`src/lib/services/matching.ts:80-98`).
- **Super-Pharm is "on request".** It's looked up only from its button, by name, and read in four places (`MATCH_MODES`).
- **Rossmann's caption holds the shade or scent**, and the lookup doesn't read it.
- **Super-Pharm's size field is empty for 27 of 47 recorded items.**

## Desired End State

- **Opening a product with no Super-Pharm decision searches Super-Pharm once.**
  - **When one item clearly fits by name,** it becomes the match. Its card names the item, says „Dopasowano automatycznie po nazwie.” and offers „Zmień”.
  - **Otherwise** the choice shows the best name fit first.
- **Natura and Hebe behave as today.**
- **On all 15 recorded Super-Pharm cases:** 10 accepted correctly, 3 left with the right item first, 2 correctly not accepted, 0 wrong.

## Key Decisions Made

| Decision                  | Choice                                                                                                                                                                      | Why (1 sentence)                                                                         | Source   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- |
| Order of work             | Its own change, before add-from-other-shops                                                                                                                                 | It ships sooner and helps every listed product; the search reuses the rule.              | Research |
| When Super-Pharm is asked | On the user's own navigation to a product with no Super-Pharm decision, like Natura and Hebe                                                                                | The owner asked for no action.                                                           | Research |
| How it shows              | „Dopasowano automatycznie po nazwie.” with „Zmień”; leaves „Do sprawdzenia”                                                                                                 | Like any match, with the reason named.                                                   | Research |
| Where the check applies   | Only for an item or a product without an EAN                                                                                                                                | Natura and Hebe stay as tested; no recording shows one product under two EANs.           | Plan     |
| Strictness                | Every word of the item's name is the product's, with brand, sizes, small and kind words set aside and „(Pudełko)” ignored; numbers count; ≥2 shared; the covering item wins | No wrong pick in 29 recorded checks; „SPF 50” can't pass for „SPF 30”.                   | Plan     |
| Super-Pharm's size        | The size its name ends with when the field is empty, sets excluded                                                                                                          | 14 of 47 names end with a size; Head & Shoulders 400 ml becomes automatic.               | Plan     |
| Choice order              | Best name fit first, in the first choice and in Super-Pharm's re-pin                                                                                                        | In Super-Pharm's order the right shade was 4th to 6th, outside the 3 shown.              | Plan     |
| Recording "by name"       | Derived on display: no EAN in common with the product                                                                                                                       | Exact under the rule's order; no migration.                                              | Plan     |
| Tap-only mode             | Retired; each adapter says whether it can search by EAN                                                                                                                     | No shop needs it any more, and Rossmann will need the same fact.                         | Plan     |
| Stored „nie znaleziono”   | Left as stored, with „Szukaj ponownie”                                                                                                                                      | Production had no Super-Pharm decision; the same search would likely find nothing again. | Plan     |

## Scope

**In scope:**

- the name check and its choice order, Super-Pharm's sizes from its names, its lookup on view, and the derived note;
- unit tests on the recordings, the e2e updates and the dev sample pages;
- the PRD, test plan, CLAUDE.md, research note, roadmap and deploy-plan updates.

**Out of scope:**

- the name check for Natura's and Hebe's EAN-bearing items or as a veto on an EAN match, and any stored match reason or migration;
- EANs from Super-Pharm's product pages, the caption in the query, and re-asking a stored „nie znaleziono”;
- the four-shop search (add-from-other-shops).

## Architecture / Approach

`pickMatch` keeps its EAN rule first. When no candidate qualifies by EAN, it runs the name check on the size-and-brand look-alikes that have no EAN, or on all of them when the product has none:

- an item passes when none of its words is missing from the product's name and caption and they share at least 2;
- the passing item whose shared words cover every other's is accepted;
- otherwise the choice is ordered by fit.

The card derives "by name" from the stored EANs. Super-Pharm's adapter declares that it can't search by EAN, which replaces `MATCH_MODES`, so the step looks it up on view like the others.

## Phases at a Glance

| Phase                                 | What it delivers                                                                 | Key risk                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Super-Pharm reads sizes from names | Sizes for items without the field; the 7 recordings as fixtures                  | A name that ends with another item's size without looking like a set |
| 2. The name check                     | The rule, the fit order, the „po nazwie” note; 15 recorded cases pinned          | The word lists are fitted on few product lines                       |
| 3. Super-Pharm looked up on view      | `searchesByEan`, `MATCH_MODES` retired, re-pin order; `phone-four-shops` updated | A view now spends 1 Super-Pharm request while undecided              |
| 4. Dev sample pages, note end to end  | True sample states; e2e check of the note                                        | Sample texts that still assume a tap                                 |
| 5. Docs and rollout                   | PRD, test plan, CLAUDE.md and notes updated; owner's check after deploy          | Documents left contradicting the code                                |

**Prerequisites:** branch `feat/match-by-name` on the latest `main`; the 10 recordings in `recordings/` and the 4 in `add-from-other-shops/recordings/`; Docker and a local Supabase for e2e.
**Estimated effort:** about 3-4 sessions across 5 phases, no migration.

## Open Risks & Assumptions

- **The evidence is small:** 15 Super-Pharm cases from 4 product lines. The kind-word list (mascara, maskara, tusz, rzęs, deo) and the packaging list („pudełko”) will need additions as products show them. A miss costs a tap, not a wrong price.
- **A short, generic Super-Pharm name of the product's size and brand could pass** if all its words are in the product's text. The 2-word minimum is the guard, and the card names the item, with „Zmień” as the remedy.
- **The right item is judged on naming alone in 5 mascara cases:** Super-Pharm's „Lash Sensational” is taken as the Full Fan Effect line (3 cases), and „Burgundy Haze” and „Tinted Primer” as Rossmann's „Burgundy” and „baza”.
- **An undecided Super-Pharm asks again on every view** until the user picks or declines, as Natura and Hebe do.

## Success Criteria (Summary)

- A product with no Super-Pharm decision opens with Super-Pharm matched by name, or with the right item first in its choice, and no tap is needed when one item clearly fits.
- No recorded case accepts a wrong item, and Natura and Hebe match as before.
- The PRD, the test plan and CLAUDE.md describe the app as it behaves.
