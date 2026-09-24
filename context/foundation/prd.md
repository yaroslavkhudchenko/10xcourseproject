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
- FR-005: User can add a product to their private watchlist and remove it from that list; shared price observations are never deleted by a removal. Priority: must-have
  > Socrates: Counter-argument accepted: removing should hide, not delete, because price observations are shared.
  > Resolution: reworded; removal affects only the user's own list.
- FR-006: User can confirm the matching item in each supported shop once; a candidate whose EAN and size match exactly is accepted automatically, and the user is asked only when the shop's result is ambiguous. Priority: must-have
  > Socrates: Counter-argument accepted: five confirmations per product is tedious.
  > Resolution: reworded; exact EAN-and-size hits are auto-accepted, the user decides only ambiguous cases.
- FR-007: User can re-pin or remove a shop match that turned out wrong, and the system flags a suspicious match (size or brand mismatch) so it does not go unnoticed. Priority: must-have
  > Socrates: Counter-argument accepted: wrong matches go unnoticed if the user has to spot them.
  > Resolution: reworded; suspicious matches are flagged by the system, re-pin stays.

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
- Unauthenticated visitors: behaviour on a gated page not yet decided (Open Questions 1).

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
2. **Which of the five shops does the owner actually buy from, and in which order should they be added?** — Owner: user. (dm is out of the MVP; see FR-013.)
3. **How are misspelled product names handled, and does search run live as you type or on submit?** Rossmann's search returns a spelling hint; its suggestion feature is untested. — Owner: user.
4. **How much history and which threshold define a good price (FR-012)?** — Owner: user.
5. **After how long is a displayed price marked stale?** — Owner: user.
6. **What is the request cap per shop per minute for the whole deployment?** — Owner: user.
7. **What request volume and data volume should the product be sized for (target_scale.qps, target_scale.data_volume)?** Not captured during shaping; the frontmatter carries TODO placeholders. — Owner: user.
8. **Which devices and browsers must the phone-usable requirement cover?** Not captured during shaping. — Owner: user.
