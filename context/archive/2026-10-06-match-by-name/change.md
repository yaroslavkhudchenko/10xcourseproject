---
change_id: match-by-name
title: Automatic matches by name where EANs can't decide, Super-Pharm first
status: archived
created: 2026-10-06
updated: 2026-10-07
archived_at: 2026-10-07T10:10:28Z
---

## Notes

Match a shop's item automatically by size, brand and a name check where EANs can't decide, starting with Super-Pharm: looked up when the product first opens, its best fit accepted and shown as „Dopasowano automatycznie po nazwie” with „Zmień” (the owner's calls, 2026-10-06); add-from-other-shops reuses the rule afterwards.

2026-10-06, where it came from:

- During add-from-other-shops the owner added the AA LAAB face wash (Rossmann 419343, 150 ml) from a desktop browser. Its Super-Pharm card offered „Dopasuj w Super-Pharmie”, and the tap's choice listed the right item first. The owner: "I want it to be done automatically, its basically same product … propose it as like best fit in Super-Pharm so user dont need any action and have the result by default which can be changed".
- Today an undecided Super-Pharm is looked up only from that button, by name, and none of its candidates is accepted on its own, since its index has no EAN (PRD FR-006, update 2026-10-05; `MATCH_MODES` in `src/lib/services/price-comparison.ts`). Natura and Hebe accept only a candidate that shares an EAN and the size and whose brand doesn't differ (`pickMatch` in `src/lib/services/matching.ts`).

The owner's calls (2026-10-06), each the option recommended to them:

- **Rule:** among a shop's candidates of the product's size whose brand doesn't differ, the one whose name shares the most words with the product's is accepted automatically when it's clearly ahead of the next; otherwise the user picks, as today. Size and brand alone aren't enough: by them the AA LAAB face wash also fits a 150 ml make-up removal balm of the same line (`context/changes/add-from-other-shops/research.md`, „Live evidence”, finding 3).
- **When:** from the owner's ask that the user needn't do anything, Super-Pharm is looked up by name when the product first opens, with no tap: 1 Super-Pharm request on a product's first view, as Natura and Hebe already spend. Products already on the list get their Super-Pharm match on their next view; the user's own picks and declines stay. This reverses S-06's tap-only lookup.
- **Card:** an automatic match by name shows like any match: the card names the item, says „Dopasowano automatycznie po nazwie” and offers „Zmień”, and the product leaves „Do sprawdzenia”.
- **Wider use:** the rule applies wherever EANs can't decide, so also in the other shops for a product without an EAN, such as one added from Super-Pharm once add-from-other-shops lands. add-from-other-shops also joins Super-Pharm's items into the search's entries by it, which reverses that change's "keep Super-Pharm apart" call.
- **Order:** its own change, before add-from-other-shops, which reuses the rule.

Open for research and the plan:

- What "EANs can't decide" covers: a product or a candidate without any EAN, or also two EAN lists that don't overlap.
- How names are compared and what "clearly ahead" means, tuned on recorded answers (live recordings need the owner's OK), with a wrong scent or shade of the same size and brand as the case to beat.
- How a stored match records that it was accepted by name, since today's card says „Dopasowano automatycznie: ten sam EAN i rozmiar.” for every automatic match (`src/lib/services/match-view.ts`).
- What the Super-Pharm button, `on-request` mode and its tests become, and the PRD's FR-006 and FR-007 updates.

2026-10-06, the owner's calls while planning (each the option recommended to them):

- **Strictness:** an item is accepted only when every word of its name is in the product's name or caption. Brand words, sizes, small words and kind words such as „mascara” are set aside, and the packaging word „(Pudełko)” is ignored. It must also share at least 2 words, and its shared words must include every other passing item's, so Cosmic Black beats Black. Planning found that numbers stay words: ignoring short numbers would let „SPF 50” pass for „SPF 30”.
- **Scope:** the name check runs only for an item or a product without any EAN. Natura and Hebe keep accepting only by a shared EAN.
- **Sizes:** when Super-Pharm's size field is missing, its size is the one its name ends with, unless the name is a set („Zestaw” or „+”).
- **Choice order:** when nothing is accepted, items of the product's size and brand whose names fit best come first, then the rest as today.
- **Stored „nie znaleziono”:** left as stored, with „Szukaj ponownie”. Production held no Super-Pharm decision on the morning of 2026-10-06, and the owner didn't object to dropping the question.
