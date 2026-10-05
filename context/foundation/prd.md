---
project: "Drogeria Radar"
version: 1
status: draft
created: 2026-09-20
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: # TODO: target_scale.qps — see Open Questions
  data_volume: # TODO: target_scale.data_volume — see Open Questions
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-11-04
  after_hours_only: true
---

# Drogeria Radar

## Vision & Problem Statement

A shopper who buys the same drugstore products again and again does not know, at the moment of buying, which of their usual shops has the lowest current price for that exact product. Today they check two or three shop sites by hand before each purchase, and they repeat that check every time the product runs out.

Comparison sites skip these chains: Rossmann is absent from Ceneo entirely and coverage of the others is patchy, and general comparison sites are too chaotic for this purpose. What is missing is a view focused on the exact product and the exact shops the shopper buys from. The prices themselves are public: each of the five chains exposes its current, promotional and 30-day-low price through its own product search, so a focused comparison is feasible without any shop's cooperation. At a hundred times the intended scale the rule itself would stand, but the shops' own search could not carry the traffic and official data feeds would be needed; the intended scale is a handful of people on one private deployment, with fetches made on demand and bounded by the per-shop request cap.

## User & Persona

**Primary persona:** the product owner, a shopper who buys the same drugstore products repeatedly across several chains and currently checks two or three shop sites by hand before buying. They reach for the product at the moment they are about to buy one of those items and want to know which shop to buy it from.

### Secondary persona

A few people the owner knows, using the same deployment with their own private watchlists. They see the same shared price observations; the MVP serves the primary persona first.

## Success Criteria

### Primary

- A signed-in user adds a repeat-purchase product by name and size, confirms the matching item in each supported shop once, and from then on sees for that product which shop is cheapest today, with regular and promo price, the Omnibus 30-day low and the age of each price.
- Prices refresh when the user opens a product or asks for a refresh (a daily automatic refresh is planned after the MVP), and once a product has history the comparison says whether today's price is a good one.

### Secondary

- For most repeat purchases the owner actually buys at the shop the app names, instead of checking sites by hand.
- Fetching covers the supported shops well enough that manual price entry (FR-009, nice-to-have) is never missed.
- The owner marked some uncertainty about these two outcomes; refine them once the product is in use.

### Guardrails

- Stale or failed prices are visible, never silent: when a fetch fails or a shop changes its response, the user sees the age of the price or a clear gap, never a wrong number presented as current.
- Watchlists stay private: no user can see or infer another user's watchlist; only price observations are shared.
- Online prices are labelled as online prices and never presented as the shelf price in a physical store.

## User Stories

### US-01: User finds the cheapest shop for a repeat purchase

- **Given** a signed-in user whose watchlist holds a product with confirmed matches in at least two shops
- **When** they open that product
- **Then** they see the shops ordered by current price, with regular and promo price, the Omnibus 30-day low and the age of each price, and the cheapest shop is marked

#### Acceptance Criteria

- A shop with no current price shows the gap and the last known price with its age, never a blank or a zero
- Each price shows its source

### US-02: User pins the matching item in each shop once

- **Given** a signed-in user who has picked a product (EAN fixed) after searching by name and size
- **When** the app looks the product up in each supported shop
- **Then** for every shop the user sees the candidate item (name, size, price) and either confirms it or marks the shop as unmatched for this product, and the choice is remembered so it is never asked again unless the user re-pins

#### Acceptance Criteria

- A shop whose lookup returns nothing is shown as unmatched, not as an error; the user can retry later
- A candidate whose size differs from the chosen product is flagged before confirmation
- A refresh that returns nothing for a confirmed match marks the price stale; it never un-pins the match

## Functional Requirements

### Accounts

- FR-001: Owner can create an account for a person or hand them an invite link; no email is sent by the app. Priority: must-have
  > Socrates: Counter-argument accepted: email sending is an integration before the first flow.
  > Resolution: reworded from email invites to owner-created accounts or invite links; email invites are out of the MVP.
  > Update 2026-10-05: S-07 (`invite-only-access`) delivers both ways, with no email (the owner's call, 2026-10-04). The owner creates an account in the Supabase dashboard, or runs a script on their own machine that makes a link: an invite link for a new person, who picks their own password, or a recovery link for someone who needs a new one. The script needs a secret key, which the owner makes for that use and deletes after it, and which never reaches the app. The owner hands the link over; it opens the app's own page, which uses it only when the person presses "Ustaw hasło", then asks for their password and opens their list. A link works once, for 24 hours, and a newer one of the same type for the same email replaces it. The app has no sign-up page, and a read-only check after each deploy shows that production still refuses sign-up (`context/deployment/deploy-plan.md`, "Accounts and links (S-07)"). There is no page to change a password while signed in: a recovery link sets a new one.
- FR-002: User can sign in with email and password. Priority: must-have
  > Socrates: Counter-arguments considered: passwords bring reset flows and hashing; prices could be readable without sign-in.
  > Resolution: stands as written; email and password kept.

### Watchlist and product matching

- FR-003: User can search a product by name and size. Priority: must-have
  > Socrates: The owner asked how a misspelled name is handled and whether search runs live as you type or on submit.
  > Resolution: left open; see Open Questions (3).
- FR-004: User can pick the right product from the results, which fixes the product's identity; the EAN is stored when available as a helper for shop lookups, and the confirmed per-shop item (FR-006) is the anchor. Priority: must-have
  > Socrates: Counter-argument accepted: EAN is not a reliable key everywhere (Hebe returned a wrong EAN, Super-Pharm has none in its index).
  > Resolution: reworded; the confirmed per-shop item is the anchor, EAN is a helper.
  > Update 2026-10-04: S-05 (`hebe-in-comparison`) corrects the Hebe example. Its EAN was right: Hebe's search answered the 300 ml product's EAN with the 300 ml item, as its legal name, description and link say, and only its size field (`Pojemność`) read 237 ml (`docs/research/polish-drugstore-price-apis.md` §2.2, re-checked 2026-10-02). The resolution stands on other evidence: Hebe's 5,5 ml lip balm carries the EAN Rossmann lists for its 4,8 g lip balm, so a shared EAN can come with another size, and Super-Pharm's index has no EAN. The app reads Hebe's size from the item's legal name and never accepts a candidate of another size on its own (FR-006).
- FR-005: User can add a product to their private watchlist and remove it from that list; shared price observations are never deleted by a removal. Priority: must-have
  > Socrates: Counter-argument accepted: removing should hide, not delete, because price observations are shared.
  > Resolution: reworded; removal affects only the user's own list.
  > Update 2026-10-01: S-08 (`fix-matches-and-watchlist`) makes removal a delete behind a confirm, with no undo. It deletes the user's own watchlist entry and, with it, their shop decisions for that product, and never a price observation, so the item's other watchers keep its prices. Adding the product again starts fresh: a new entry, matched in each shop again.
- FR-006: User can confirm the matching item in each supported shop once; a candidate whose EAN and size match exactly is accepted automatically, and the user is asked only when the shop's result is ambiguous. Priority: must-have
  > Socrates: Counter-argument accepted: five confirmations per product is tedious.
  > Resolution: reworded; exact EAN-and-size hits are auto-accepted, the user decides only ambiguous cases.
  > Update 2026-10-01: S-08 (`fix-matches-and-watchlist`) adds the brand to the exact match: a candidate whose brand differs from the product's is never accepted automatically, even with the same EAN and size, and the user decides it like an ambiguous result. Two brands agree when one starts with the other once both are normalised: accents dropped where Unicode decomposes them ("é" reads as "e", while "ł" stays), lower case by Polish rules, and only letters and digits kept. So "NIVEA" agrees with "nivea" and with "NIVEA MEN", and "L'Oréal Paris" with "LOREAL". A brand missing or blank on either side doesn't count against a match. Accepted cost: a brand written with a word in front, such as "Dr Irena Eris" against "IRENA ERIS", reads as another brand, so the user confirms that match once and its card keeps the warning.
  > Update 2026-10-04: S-05 (`hebe-in-comparison`) matches Hebe by the same rule as Drogerie Natura, with no stricter check (the owner's call, 2026-10-02): a Hebe candidate is accepted automatically only when it shares an EAN and the size with the product and its brand doesn't differ, and the user decides everything else. Hebe's size comes from the item's legal name, never from its `Pojemność` field (see the FR-004 update), and only items Hebe sells online are offered (see the FR-013 update). Accepted cost, as for Natura: the rule compares no names, so a wrong EAN on an item of the same size and brand would be accepted; the card names the matched item, and "Zmień" (FR-007) stays the remedy.
  > Update 2026-10-05: S-06 (`super-pharm-in-comparison`) matches Super-Pharm by the same rule, with no rule of its own. Its search index carries no EAN, so no Super-Pharm candidate shares one with the product, none is ever accepted automatically, and every Super-Pharm match is the user's pick. So that a view at the shelf never waits for Super-Pharm or spends its request cap, an undecided Super-Pharm is looked up only when the user taps "Dopasuj w Super-Pharmie" on its card, by name alone, since an EAN search there finds nothing. Until the user picks a candidate or declines them all, the product stays in "Do sprawdzenia" (FR-007). A first lookup's choice, in every shop, now puts the candidates of the product's size whose brand doesn't differ before the others, still three at most. The tap, "Do sprawdzenia" and the order are the owner's calls (2026-10-05).
- FR-007: User can re-pin or remove a shop match that turned out wrong, and the system flags a suspicious match (size or brand mismatch) so it does not go unnoticed. Priority: must-have
  > Socrates: Counter-argument accepted: wrong matches go unnoticed if the user has to spot them.
  > Resolution: reworded; suspicious matches are flagged by the system, re-pin stays.
  > Update 2026-10-01: S-08 (`fix-matches-and-watchlist`) delivers both parts for Drogerie Natura. A match is suspicious only on a definite difference: both sizes known and different, or both brands known and not agreeing (see the FR-006 update); a size or brand unknown on either side never counts. The match's card shows a warning for each ("Inny rozmiar", "Inna marka"), and the watchlist's "Do sprawdzenia" holds an automatic match that differs, with the reason on the row's screen-reader line. A match the user confirmed stays out of that count, since they saw its flags before confirming it, and keeps its warnings in the card. "Zmień" on a match and "Dopasuj ponownie" on a decline open a new choice from Natura's EAN and name searches, which marks the current item and is never accepted on its own; "Żaden z nich" removes a wrong match by declining Natura for the product, and the app offers no reset to undecided. The Rossmann product the user picked isn't re-pinned: a wrong one is removed and added again (FR-005).
  > Update 2026-10-04: S-05 (`hebe-in-comparison`) gives Hebe the same parts, shop by shop. Each matched shop's card shows its own warnings and its own "Zmień", "Dopasuj ponownie" or "Szukaj ponownie", which looks up that shop alone, and "Żaden z nich" declines only that shop. "Do sprawdzenia" holds a product while any matched shop is undecided, not found, unreadable, or automatically matched with a size or brand that differs, and the row's screen-reader line names each shop's state. A product added before Hebe joined has no Hebe decision, so it stays in "Do sprawdzenia" until it's matched in Hebe or the user declines Hebe for it (the owner's call, 2026-10-02).

### Prices

- FR-008: System can refresh the prices of a watched product on demand, when the user opens it or asks for a refresh, by stored shop id or EAN. Priority: must-have
  > Socrates: Counter-argument accepted: on demand is enough for a personal tool in the MVP; the owner expects a scheduled refresh to matter later.
  > Resolution: split; FR-008 becomes on-demand refresh (must-have), FR-015 holds the daily automatic refresh (nice-to-have).
- FR-009: User can record a price by hand for a product in a shop. Priority: nice-to-have
  > Socrates: Counter-argument accepted: if fetching works, nobody types prices; the feature may never be used.
  > Resolution: demoted to nice-to-have; fetched prices are the only source in the MVP.
- FR-010: System can record the source of every price observation (shop fetch or manual entry). Priority: must-have
  > Socrates: Counter-arguments considered: source is an implementation detail; recorded sources imply differential trust.
  > Resolution: stands as written.
- FR-011: User can see, for a watched product, the cheapest shop today, regular and promo price, the Omnibus 30-day low, and the age of each price. Priority: must-have
  > Socrates: Counter-argument accepted: price per unit is redundant when every shop shows the same EAN and the pin step keeps sizes equal.
  > Resolution: price per unit dropped from the MVP view; it returns only if different sizes are ever compared.
  > Update 2026-10-05: S-06 (`super-pharm-in-comparison`) shows Super-Pharm's prices as its record states them (the owner's call, 2026-10-05). The record carries a sale's regular price for some promotions only (`docs/research/polish-drugstore-price-apis.md` §2.3), so a Super-Pharm sale without it shows as a plain price with its 30-day low. No other field stands in for the regular price, so such a sale isn't shown as a promotion and isn't under "Promocje". A promotion's end counts only beside its regular price, as Super-Pharm's own site reads it, since the record keeps a sale's dates after the sale.
- FR-012: User can see whether today's price is a good one against the product's own history. Priority: must-have
  > Socrates: Counter-arguments considered: history starts empty; an untuned threshold is false confidence.
  > Resolution: stands as written; history length and threshold stay in Open Questions (4).
- FR-015: System can refresh the prices of every watched product daily without user action. Priority: nice-to-have
  > Socrates: Counter-arguments considered: scheduled fetching changes the footing with the shops; it may become must-have with a second user.
  > Resolution: stands as written, nice-to-have.

### Shops

- FR-013: User can compare prices across Rossmann, Hebe, Super-Pharm, dm and Drogerie Natura, added in stages. Priority: must-have
  > Socrates: Counter-arguments considered: two shops already deliver a comparison; the owner may not buy at all five.
  > Resolution: stands as written; the order of adding shops stays in Open Questions (2).
  > Update 2026-09-24: dm is dropped from the MVP. Its product search refuses traffic from Cloudflare Workers (`docs/research/polish-drugstore-price-apis.md` §9), and routing around that would conflict with the no-circumvention guardrail. The MVP compares Rossmann, Hebe, Super-Pharm and Drogerie Natura; dm returns only through an official route.
  > Update 2026-10-04: S-05 (`hebe-in-comparison`) adds Hebe as the third shop, before Super-Pharm (the owner's call, 2026-10-02). Its prices come through the shop gate from the same Luigi's Box search Drogerie Natura uses, under Hebe's own tracker and cap. The app offers only items Hebe sells online, since a refresh of a pinned item can't see one Hebe doesn't (`docs/research/polish-drugstore-price-apis.md` §2.2), and an item Hebe stops selling online after it was matched keeps its last price, marked out of date and never named cheapest (US-02). Rossmann, Drogerie Natura and Hebe are compared today; Super-Pharm follows in S-06.
  > Update 2026-10-05: S-06 (`super-pharm-in-comparison`) adds Super-Pharm as the fourth shop, after Hebe. Its prices come through the shop gate from Super-Pharm's Algolia search, under its own cap, with the public search key every superpharm.pl page carries, which the app keeps in its code (the owner's call, 2026-10-05). If Super-Pharm changes that key, Algolia refuses the old one with a 403, which the shop gate takes for a block, and the shop is stopped for everyone until the owner updates the key and switches the shop back on (`context/deployment/deploy-plan.md`, "Super-Pharm stopped with HTTP 403"). An item counts as orderable online when Super-Pharm has it in stock and doesn't sell it only in its shops. Rossmann, Drogerie Natura, Hebe and Super-Pharm, the MVP's four shops, are compared today; dm stays out (see the 2026-09-24 update).
- FR-014: User can see the health of each shop adapter on a separate status page, outside the shopping flow. Priority: nice-to-have
  > Socrates: Counter-argument accepted: shoppers do not care about adapters; health belongs in logs or a status page, not in the product a shopper opens.
  > Resolution: moved out of the shopping flow and demoted to nice-to-have. Stale or missing prices stay visible inline through FR-011. An owner-only page would need a role, which the flat model rules out.

## Non-Functional Requirements

- Usable on a phone in the shop: the comparison is readable and operable on a current mobile browser while the shopper stands at the shelf.
- Continuous feedback while prices load: opening a product shows progress per shop, and results appear as each shop answers rather than after a single long wait.
- Every price shows its age: no price is ever displayed without when it was fetched, and a price older than an agreed limit is marked stale. (Limit: Open Questions 5.)
- Polite to the shops: no shop receives more than a small, fixed number of requests per minute from the whole deployment, and fetching stops for a shop that blocks or asks. (Cap: Open Questions 6.)
- Watchlists are private: no user can observe or infer another user's watchlist; only price observations are shared.

# TODO: exact device and browser targets for the phone-usable requirement — see Open Questions

## Business Logic

For a product bought repeatedly, the app names which of the shopper's shops is cheapest right now and says whether that price is a good one against the product's own price history, or against the shop's declared 30-day low until that history exists.

The rule consumes the shopper's confirmed item in each supported shop, each shop's current regular and promotional price together with its declared 30-day low, fetched when the product is opened, and the prices previously observed for that product across shops.

Its output is the shops ordered by today's price with the cheapest marked, the age of every price, and one good-price judgement for the product: against the product's own history once enough exists, otherwise against the shop's 30-day low, labelled as such so the shopper knows which comparison was made. How much history counts as enough and which threshold separates a good price from an ordinary one are open (Open Questions 4).

The shopper meets the rule by opening a watched product: progress appears per shop as prices arrive, then the ordered comparison and the judgement. A shop whose price could not be fetched shows its last known price with its age, or a clear gap, never a wrong number presented as current.

## Access Control

- Sign-in: email and password.
- Sign-up: invite-only. The owner creates accounts or hands out invite links; there is no open registration.
- Roles: flat. Every signed-in user has the same capabilities: manage their own watchlist, confirm product matches, and see the shared price observations. Recording manual prices (FR-009) and viewing the status page (FR-014) are nice-to-have capabilities and follow the same flat model when they exist.
- Data separation: watchlists are private per user; price observations are shared by all users of the deployment.
  > Update 2026-09-28: S-03 (`cheapest-shop-today`) narrows the sharing to each shop item's watchers. A user reads and adds the observations of an item only while they watch it, either as their product's own item or through a confirmed match. The users watching the same item share its prices, and no one can list what others watch. Accepted risk: people watching the same item see each other's check times, which can show that someone else watches it.
- Unauthenticated visitors: behaviour on a gated page not yet decided (Open Questions 1).
  > Update 2026-10-05: S-07 (`invite-only-access`) decides it: a sign-in redirect that returns to the list or the product (Open Questions 1).

## Non-Goals

Functional non-goals (ruled out for this product, not just for the MVP):

- No open sign-up: the deployment stays private and invite-only. Rationale: keeps the tool personal, the load on the shops predictable and the footing with the shops defensible.
- No shared household watchlists: one watchlist per person. Rationale: the smallest access model that still works; sharing would add ownership rules before the core has proven itself.
- No shelf prices and no store-level data: online prices only, labelled as such. Rationale: the app must never claim to know what a physical shelf shows; store-specific prices are a separate data problem.

Out of the MVP, not ruled out for later (the owner declined to make these permanent non-goals):

- Perfumeries (Sephora, Douglas, Notino): blocked by bot protection today; if ever added, only through official routes such as an affiliate feed or a comparison site, never by circumventing the protection.
- Alerts, reminders and run-out prediction: the MVP shopper opens the app to look; nothing is pushed.
- Manual price entry (FR-009), a separate status page for shop health (FR-014) and the daily automatic refresh (FR-015) are nice-to-have and outside the MVP.

No non-functional non-goals were chosen.

## Open Questions

1. **What does an unauthenticated visitor see when opening a gated page?** — Owner: user.
   > Update 2026-10-05: answered by S-07 (`invite-only-access`, the owner's call, 2026-10-04): the Polish sign-in page. A visitor who opened the list or a product is sent back there after signing in, with the list's filter kept and nothing else, so a crafted link can't make the page ask a shop; from any other gated address they land on the list. `/` sends a visitor to sign-in and a signed-in user to the list, and there is no landing page.
2. **Which of the five shops does the owner actually buy from, and in which order should they be added?** — Owner: user. (dm is out of the MVP; see FR-013.)
3. **How are misspelled product names handled, and does search run live as you type or on submit?** Rossmann's search returns a spelling hint; its suggestion feature is untested. — Owner: user.
4. **How much history and which threshold define a good price (FR-012)?** — Owner: user.
5. **After how long is a displayed price marked stale?** — Owner: user.
6. **What is the request cap per shop per minute for the whole deployment?** — Owner: user.
7. **What request volume and data volume should the product be sized for (target_scale.qps, target_scale.data_volume)?** Not captured during shaping; the frontmatter carries TODO placeholders. — Owner: user.
8. **Which devices and browsers must the phone-usable requirement cover?** Not captured during shaping. — Owner: user.
