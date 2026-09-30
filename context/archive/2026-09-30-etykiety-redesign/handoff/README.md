# Handoff: Drogeria Radar — „Etykiety i naklejki” (2a desktop, 2b mobile)

## Overview
Redesign of the two shopping screens of Drogeria Radar: **Moja lista** (watchlist + search) and **Produkt** (price comparison + Natura match). Direction: prices styled like shop shelf labels (grosze raised and underlined), a starburst sticker judging today's price, a price track against the 30‑day low, pastel "physical" labels that stay light in dark mode. Light and dark themes, desktop (two‑pane) and mobile (two screens).

## About the design files
`Drogeria Radar Redesign.dc.html` is a **design reference built in HTML** — not production code. Open it in a browser (keep `support.js` next to it). Only sections **2a** (desktop) and **2b** (mobile) are in scope; section 1 and the "Obecny interfejs" section are superseded. Recreate the design in the existing codebase (Astro 7 + React 19 islands + Tailwind v4 + shadcn/ui tokens in `src/styles/global.css`), following its patterns: server-rendered pages, forms that work without JavaScript, `min-h-11` (44 px) tap targets, sr-only texts and `aria-live` announcements already present.

## Fidelity
**High fidelity.** Colors, type, spacing, radii and shadows below are final. Product names/prices in the mock are sample data; all copy comes from the existing code (Polish) unless listed as new.

## Breakpoints
- `< 1024px` (`lg`): mobile layout — list and product are separate routes (as today).
- `≥ 1024px`: two‑pane layout — header on top, list in a 420 px left column, product (or search results) in the right pane. `/watchlist/[id]` renders the list aside with that item selected; `/watchlist` renders search results or an empty prompt on the right.

---

## Design tokens

Map onto the existing shadcn token names so current components keep working; add the new ones. Replace the `:root` and `.dark` blocks in `src/styles/global.css` and expose new tokens in `@theme inline` (`--color-sun`, `--color-shadow-ink`, …).

| Token | Light (`:root`) | Dark (`.dark`) | Use |
|---|---|---|---|
| `--background` | `#FBF5E9` | `#17151F` | page ("paper") |
| `--background-dot` | `rgba(31,27,45,.075)` | `rgba(248,241,226,.06)` | dot grid |
| `--foreground` | `#1F1B2D` | `#F8F1E2` | text ("ink") |
| `--card` / `--popover` | `#FFFFFF` | `#221F2E` | cards |
| `--muted` / `--secondary` / `--accent` | `#F3ECDD` | `#2D2A3C` | raised fills, track bar |
| `--muted-foreground` | `#6A6478` | `#B9B1C7` | secondary text |
| `--border` | `#E9DFCB` | `#37324B` | hairlines (1.5 px) |
| `--input` | `#1F1B2D` | `#4A4560` | search field border (2 px) |
| `--primary` | `#1F1B2D` | `#FFD23F` | primary button bg |
| `--primary-foreground` | `#FFF8E7` | `#1F1B2D` | primary button text |
| `--primary-shadow` | `var(--sun)` | `#000000` | primary button hard shadow |
| `--ring` | `#1F1B2D` | `#FFD23F` | focus |
| `--link` | `#1F1B2D` | `#F8F1E2` | links (underline in `--sun`) |
| `--sun` | `#FFD23F` | `#FFD23F` | signature: hero, tags, count bubble, selection shadow, underlines |
| `--label-ink` | `#1F1B2D` | `#1F1B2D` | text + 2 px outlines on physical labels (always dark) |
| `--shadow-ink` | `#1F1B2D` | `#000000` | hard offset shadows |
| `--success` / `--success-foreground` | `#CFF3DD` / `#0F5E3A` | `#1F3D31` / `#8BE8B8` | promo pill, success alerts |
| `--warning` / `--warning-foreground` | `#FFD2BD` / `#8A3A17` | `#43281F` / `#FFB896` | warning alerts |
| `--tag-warn` | `#FFD2BD` | `#FFD2BD` | "Nieaktualna" tag, stale hero |
| `--tag-warn-border` | `#F4A07A` | `#F4A07A` | stale card border |
| `--tag-plain` | `#FBF5E9` | `#FBF5E9` | single-shop hero |
| `--shop-rossmann` | `#BCD6FF` | same | shop dot / track marker |
| `--shop-natura` | `#B5EDCB` | same | shop dot / track marker |
| `--thumbnail` | `#FFFFFF` | `#FFFFFF` | behind product photos |

Sticker fills (always light): good `#B5EDCB`, neutral `#FFFFFF`, info `#D4E5FF`, stale `#FFFFFF`. Avatar fill `#E7DCFF`. Placeholder product tiles (no photo): `#DCE6FF`, `#FFE1CC`, `#E3F2D3`, `#F1DDF7`, with the brand initial.

Keep `--destructive` as today. Page background: `background-color: var(--background); background-image: radial-gradient(var(--background-dot) 1px, transparent 1.4px); background-size: 18px 18px;` (replaces `bg-cosmic`).

**Typography**
- UI: **Bricolage Grotesque** (Google Fonts, `opsz 12..96`, weights 400–800, latin-ext). All headings, body, prices.
- Meta: **DM Mono** 400/500 — eyebrows, sites, ages, fine print, counts. Usually 10–12 px, uppercase, letter-spacing .04–.1em.
- Scale (desktop / mobile):
  - Product title 40 / 25 px, 800, lh 1.02–1.08, ls −0.04em, `text-wrap: balance`
  - "Moja lista" 34 / 38 px, 800, ls −0.035em
  - Hero price: złote 124 / 84 px 800 ls −0.055em lh .8 · grosze 52 / 36 px 800 with 5 / 4 px bottom border · "zł" 24 / 18 px 700
  - Hero shop ("w Naturze") 36 / 22 px 800
  - Shop card price: 56 / 46 · 24 / 20 (3 px underline) · 14 / 12
  - Shop name in card 20 / 18 px 800; list row name 15 px 600 lh 1.25
  - Body 14–15 px; hero sub 15 / 14 px 500

**Radii**: tag 9 · small buttons 10–12 · thumbs & buttons 14 · search 16 · list rows 18 · cards 20–22 · hero 26 (desktop) / 22 (mobile) · pills 999.

**Shadows (hard, no blur)**: hero `6px 6px 0 var(--shadow-ink)` (mobile 5px) · selected list row `4px 4px 0 var(--sun)` · primary button `3px 3px 0 var(--primary-shadow)`; `:active` → `translate(2px,2px)` and no shadow.

**Tilt**: hanging tags `rotate(-3deg)`, count bubble & product thumb `rotate(-6deg)`, sticker `rotate(12deg)`.

---

## Screens

### A. Header (desktop, 78 px, padding 0 32, gap 28, bottom border 1.5 px `--border`)
1. **Logo mark** 38 px circle: bg `--sun` + `conic-gradient(from 20deg, rgba(31,27,45,.28) 0deg 62deg, transparent 62deg)`, 2 px `--label-ink` border; inner ring 18 px (2 px border), centre dot 5 px. Mobile 32 / 15 / 4 px.
2. **Wordmark** "Drogeria Radar" 22 px 800 ls −0.03em; "Radar" underlined: `text-decoration-color: var(--sun)`, thickness 5 px, offset 5 px. Left block is 356 px wide so the search lines up with the right pane.
3. **Search** (existing GET form, `name="q"`, same validation): max‑width 560, height 52, radius 16, 2 px `--input`, bg `--card`; search icon 18 px; placeholder "Szukaj produktu, np. nivea soft 300 ml" (mobile: "np. nivea soft 300 ml"); desktop `kbd` hint "/" (DM Mono 12, 1.5 px border) — pressing `/` focuses the field; inner submit "Szukaj" 38 px, radius 11, primary.
4. **Theme toggle** 42 px circle, 1.5 px border, bg `--card`; moon icon in light, sun icon in dark.
5. **Account**: avatar 38 px circle `#E7DCFF`, 2 px ink border, first letter of the email; email DM Mono 12 muted; "Wyloguj" (existing sign-out form) outline button 38 px, radius 10, 1.5 px border, 13 px 700.

### B. Moja lista (aside on desktop, full screen on mobile)
- Header: "Moja lista" + **count bubble** (30 px circle `--sun`, 2 px ink border, 14 px 800, rotated −6°) + "Odśwież ceny" outline button (38 px, radius 12, refresh icon 15 px; existing `/api/watchlist/refresh` form with `data-submit-once`). Mobile: title row, then search (52 px), then chips.
- **Filter chips** (new): "Wszystkie", "Promocje", "Do sprawdzenia", each with a count (DM Mono 11 at 70 % opacity). 34 px (mobile 38 px) pills, 1.5 px border. Active: bg `--foreground`, text `--background`. Inactive: transparent, border `--border`. Implement as links `?f=all|promo|check` (no JS). *Promocje* = an item whose current offer has `regularPrice` or `promoEndsOn`. *Do sprawdzenia* = stale/missing price, or Natura still to match. Mobile row scrolls horizontally.
- **List row** (links to `/watchlist/[id]`): bg `--card`, radius 18, padding 12, gap 12.
  - Thumb 50 px (mobile 48), radius 14: product photo on `--thumbnail`, or the pastel tile with the brand initial (20 px 800, `--label-ink`).
  - Middle: eyebrow "NIVEA · 300 ML" (DM Mono 11, uppercase, ls .06em, muted), name 15 px 600.
  - Right: **price tag**, min‑width 86 px (mobile 80), radius 12, padding 7 × 10, right-aligned: price (złote 22 px 800 + grosze 12 px 800 underlined) and a label (DM Mono 10 uppercase).
    - `summary.kind === "cheapest"` → bg `--sun`, text `--label-ink`, label = cheapest shop name.
    - Only one shop, fresh → bg `--muted`, text `--foreground`, label "Tylko Rossmann".
    - Stale / missing → bg `--tag-warn`, text `--label-ink`, label "Nieaktualna", price = last known.
  - Keep `listSummaryText(...)` as an sr-only line so screen readers get the full sentence.
  - Hover: `translate(-2px,-2px)`, transition 150 ms. **Selected** (desktop, current product): 2 px `--foreground` border + `4px 4px 0 var(--sun)` + `translate(-2px,-2px)`.
- Footer: "Ceny online z rossmann.pl i drogerienatura.pl" — DM Mono 11 uppercase muted, top border, padding 14 × 28.
- Desktop aside: 420 px, right border 1.5 px; header padding 28/28/16; list padding 6/28/18, gap 12; list scrolls independently.
- Search results: same row component; the right side holds "Dodaj" (primary, 44 px) or "Na liście" (success pill). Keep the spelling hint and "Wyniki z wyszukiwarki rossmann.pl".

### C. Produkt (right pane on desktop, own screen on mobile)
Desktop main: padding 30/44/40, vertical gap 26. Mobile scroll area: padding 8/18/24, gap 24, plus a sticky bottom bar.

1. **Title row** (desktop): thumb 80 px, radius 22, 2 px ink border, rotated −6° · eyebrow "NIVEA · 300 ML · DODANO 20.09" (DM Mono 12, ls .08em) · title 40 px · on the right, primary "Odśwież ceny" (46 px, radius 14, 2 px ink border, hard shadow, refresh icon 16) above "sprawdzono 5 min temu" (DM Mono 11). Mobile: back link "‹ Moja lista" (16 px 700, 44 px tall, chevron 22 px) with the brand · size eyebrow on the right; then thumb 56 px + title 25 px.
2. **Verdict hero**: radius 26 (mobile 22), padding 26 × 32 (mobile 20), 2 px `--label-ink` border, hard shadow; text always `--label-ink`.
   - Background by state: cheapest found → `--sun`; single shop → `--tag-plain`; stale → `--tag-warn`.
   - Left: eyebrow (DM Mono 12 uppercase ls .1em): "Najtaniej dziś" / "Jedyna znana cena" / "Ostatnia znana cena"; shop "w Naturze" (use `SHOP_LABELS[shop].in`); sub (15 px 500, max 360 px): "o 4,00 zł taniej niż Rossmann · sprawdzono 5 min temu" (the savings amount comes from `summary.savings`).
   - Right: the big price, with padding-right 104 px (desktop) to leave room for the sticker.
   - Mobile: eyebrow, then price + shop on one wrapping row, then the sub.
3. **Sticker** (starburst): 24-point polygon clip-path (outer radius 50 %, inner 41 %). A 2-layer build: an ink layer, and the fill layer inset 3 px. Rotated 12°. Label 800 weight at 17 % of the size, two lines.
   - Placement: desktop 128 px at `top:-28px; right:-34px` of the hero; mobile 86 px at `top:-28px; right:-8px`.
   - **Stamp** animation on mount / product change: 550 ms `cubic-bezier(.2,1.5,.4,1)`, from `scale(1.7)` at opacity 0 to `scale(1)`. Disable it under `prefers-reduced-motion`.
   - Labels: "Dobra / cena!" (fill `#B5EDCB`), "Zwykła / cena" (`#FFFFFF`), "Tylko / 1 sklep" (`#D4E5FF`), "Stara / cena" (`#FFFFFF`).
   - ⚠ The good/ordinary price judgement (FR-012) is **not implemented yet**. Render those two stickers only once the rule exists. Until then show only the "Tylko 1 sklep" / "Stara cena" states, or no sticker.
   - The sticker is decorative: `aria-hidden`, with the judgement repeated as text in the price track card.
4. **Price track** card: bg `--card`, radius 22, 1.5 px border, padding 22 × 28.
   - Title "Gdzie wypada dzisiejsza cena" (mobile "Gdzie wypada cena"), 19/17 px 800. Note on the right in DM Mono 11 uppercase ("RÓŻNICA 4,00 ZŁ" / "CENA SPRZED 2 DNI"). The judgement text (14 px muted) sits below.
   - Bar: 12 px (mobile 10), radius 6, bg `--muted`; margins 58/10/50 (mobile 54/8/48).
   - Band between the lowest and highest shop price: `--sun`.
   - One marker per priced shop: 26 px (mobile 24) circle in the shop colour, 2.5 px ink border. Label above it: shop name (DM Mono 10 uppercase) and price (17 px 800).
   - Cheapest shop's `lowestPrice30d`: a dashed 2 px `--foreground` tick (extends 12 px above and below), labelled underneath "NAJNIŻSZA Z 30 DNI" plus the value (14 px 800).
   - Position: take all shop prices plus the 30-day low; `span = max − min || 1`, `pad = 0.22·span`; `x% = 6 + (v − (min − pad)) / (span + 2·pad) · 88`.
   - With fewer than 2 values, hide the track and show the judgement text in a plain card (padding 18 × 24, radius 18).
5. **Shop cards**: 2 columns on desktop (gap 20), stacked on mobile. Each card: bg `--card`, radius 22 (mobile 20), padding 22 × 24 (mobile 18), gap 12.
   - Border: cheapest → 2 px `--foreground`; stale → 2 px `--tag-warn-border`; normal → 2 px `--border`; user-declined Natura → 2 px dashed `--border` with a transparent background.
   - **Hanging tag**: "Najtaniej" (`--sun`) or "Nieaktualna" (`--tag-warn`). Absolute `top:-16px; right:22px`, rotated −3°, 2 px ink border, radius 9, padding 5/12/5/8, 12 px 800, ls .08em, uppercase. A 9 px "hole" circle sits on its left (bg `--background`, 2 px ink border).
   - Header row: shop dot (14 px, shop colour, 2 px ink border), name 20 px 800, site on the right (DM Mono 11 muted).
   - Price in label style, with "zamiast ~~27,99 zł~~" (14 px muted) and the promo pill "promocja do 05.10" (`--success` / `--success-foreground`, 12 px 700) beside it.
   - Fine print (DM Mono 12 muted): "najniższa z 30 dni wg sklepu: 23,99 zł" and "cena online · 5 min temu".
   - "Zobacz w sklepie" + external icon: 15 px 700 `--link`, underline `--sun` 3 px, offset 5 px. Keep `target="_blank"`, the sr-only "(otwiera się w nowej karcie)" and `aria-describedby`.
   - While refetching: "ODŚWIEŻAM…" (DM Mono 11 muted) next to the name.
   - Existing notices (`priceMissingText`, `priceUnavailableText`) go below the fine print in `--warning-foreground`, 14 px.
6. **Natura inside its card** (replaces the separate `NaturaSection` block, except `choose`):
   - `matched` → a card footer with a 1.5 px dashed top border: the match note (DM Mono 11 muted), plus an outline button "Zmień" (34 px, 1.5 px `--foreground` border) that re-pins.
   - `prompt` / not matched yet → gap text "Produkt nie jest jeszcze dopasowany w Naturze." and a full-width primary button "Dopasuj w Naturze".
   - `unmatched` (user declined) → dashed ghost card "Brak w Naturze — Twój wybór." with the outline button "Dopasuj ponownie".
   - `not-found` → gap text and "Szukaj ponownie".
   - `choose` → keep it as its own section under the grid, reusing the list-row and card language ("To ten produkt" primary, "Żaden z nich" outline, flag pills as `--success` / `--warning` pills).
   - Notices and errors → restyled `Alert` (radius 14, 1.5 px border, tinted `--success` / `--warning`).
7. **Mobile bottom bar** (sticky): bg `--card`, top border 1.5 px, padding 12/18/24 (+ safe-area inset). Left: "SPRAWDZONO" and the age on two lines (DM Mono 11 uppercase). Right: primary "Odśwież ceny", 52 px, radius 16, 16 px 800, icon 18. Same form and `onRefresh` as today.

---

## Interactions and behaviour
- **Theme**: an inline script in `<head>` sets `html.dark` before first paint, from `localStorage.theme` or else `prefers-color-scheme`. The toggle flips the class and stores the choice. `Layout.astro` currently hardcodes `class="dark"`; remove that.
- Motion: the stamp animation (sticker), row hover lift (150 ms), button press (translate 2 px). Nothing else. Respect `prefers-reduced-motion`.
- All forms keep working without JS (search, refresh, match decisions, filters as links, sign-out). Keep `SubmitOnce`, the notice-code URL cleanup script and the island's per-shop progress.
- Loading: a card whose shop is pending shows "ODŚWIEŻAM…" and a 60 % opacity price. Results appear per shop, as today.
- Focus: 2 px outline `--ring` with 2 px offset on every interactive element.
- `/` focuses the search on desktop, ignored while typing in an input.

## State
No new server state. Derive the filter from `?f=`. Derive the hero, sticker and track from the existing `compareShops` / `ComparedRow` output plus `offer.lowestPrice30d`. The selected product on desktop is the route param.

## Assets
- Icons are Lucide (`lucide-react` / inline): `Search`, `RefreshCw`, `ExternalLink`, `ChevronLeft`, `Sun`, `Moon`.
- Product photos come from `imageUrl` as today. The pastel initial tiles are only the no-photo fallback.
- Fonts come from Google Fonts: Bricolage Grotesque, DM Mono.

## Files
- `Drogeria Radar Redesign.dc.html`: the design reference (sections **2a** and **2b**). Open it with `support.js` beside it. Click list rows and filter chips to see the states: Nivea (cheapest + promo), Isana (ordinary price), Ziaja (single shop, Natura to match), Colgate (stale, Natura declined).
- `PROMPTS.md`: step-by-step prompts for Claude Code.
