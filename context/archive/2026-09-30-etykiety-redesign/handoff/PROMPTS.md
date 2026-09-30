# Claude Code prompts: „Etykiety i naklejki” redesign

Put this folder in the repo root as `design_handoff_etykiety/`, then run the prompts in order. Each one is a separate, reviewable step. Commit between steps.

---

## 0 · Orientation (no code)
```
Read design_handoff_etykiety/README.md. Then open design_handoff_etykiety/Drogeria Radar Redesign.dc.html; only sections 2a (desktop) and 2b (mobile) matter.
Map every component in the README to the files that render it today: src/styles/global.css, src/layouts/Layout.astro, src/pages/watchlist.astro, src/pages/watchlist/[id].astro, src/components/watchlist/*, src/components/ui/*.
Write the plan to context/changes/etykiety-redesign/plan.md, listing new components, changed files and risks (no-JS forms, a11y, token contrast script). Do not change code yet.
```

## 1 · Tokens, fonts, theme switching
```
Implement "Design tokens" from design_handoff_etykiety/README.md:
- In src/styles/global.css, replace the :root (light) and .dark values with the table. Add --background-dot, --primary-shadow, --sun, --label-ink, --shadow-ink, --tag-warn, --tag-warn-border, --tag-plain, --shop-rossmann, --shop-natura, and expose them in @theme inline as --color-*.
- Replace the bg-cosmic utility with a bg-paper utility: background-color var(--background) plus the 18px radial dot grid.
- Load Bricolage Grotesque (opsz 12..96, 400–800) and DM Mono (400, 500) from Google Fonts in Layout.astro. Set Bricolage as the default sans and DM Mono as font-mono in @theme.
- Layout.astro: drop the hardcoded class="dark". Add an inline head script that sets html.dark from localStorage.theme, falling back to prefers-color-scheme, before first paint.
- Update scripts/check-token-contrast.mjs so it checks the pairs in both :root and .dark, and make it pass.
Run lint, astro check and the tests.
```

## 2 · Primitives
```
Using the README's "Screens" spec, build the shared pieces with Tailwind classes and existing cva patterns:
1. src/components/ui/button.tsx: restyle "default" (primary: 2px label-ink border, radius 14, hard shadow 3px 3px 0 var(--primary-shadow), active translate 2px and no shadow) and "outline" (1.5px border, radius 12). Restyle "underlined" (ink text, 3px var(--sun) underline, offset 5px). Keep size "touch" at 44px minimum.
2. src/components/ui/badge.tsx: add a "promo" pill (success tint). Add a "tag" variant: the hanging label with a hole, props tone="sun"|"warn", rotated -3deg.
3. A new Price component (React, plus an Astro twin if needed). It renders złote and grosze in shelf-label style with sizes "hero" | "card" | "tag", exactly the px values in the README. It formats with the existing formatPrice logic in src/lib/services/price-comparison.ts. Expose the full price as sr-only text, e.g. "22,99 zł".
4. A new Sticker component: 24-point starburst via clip-path, ink layer plus fill layer inset 3px, rotate(12deg), stamp keyframe 550ms cubic-bezier(.2,1.5,.4,1), prefers-reduced-motion off, aria-hidden. Props: label (two lines), fill, size.
5. A new LogoMark component (radar mark and wordmark).
Add each to the dev kitchen sink (src/dev/product-page.astro) in light and dark.
```

## 3 · App shell and two-pane layout
```
Build the header and layout from README sections A and "Breakpoints":
- A new src/components/AppHeader.astro: LogoMark, the search form (the same GET /watchlist form, validation and "/" shortcut), the theme toggle (small client script), avatar, email and the Wyloguj form.
- A new src/layouts/WatchlistShell.astro: below 1024px a single column. At 1024px and up, a grid of 420px aside and 1fr main; the aside and main scroll independently. Header height 78px.
- /watchlist/[id] renders the list in the aside, with the current product selected. /watchlist renders search results, or the prompt "Wybierz produkt z listy albo wyszukaj nowy", in the main pane.
- Replace bg-cosmic and all text-white / blue-100 / purple-* classes on these pages with tokens.
```

## 4 · Moja lista
```
Implement README section B in src/pages/watchlist.astro (and the aside):
- The list header with the count bubble and the Odśwież ceny form.
- Filter chips as links ?f=all|promo|check with counts. Compute them server-side from listPricedItems, compareShops and the match states.
- A new WatchlistRow.astro: thumb (photo, or a pastel initial tile), a mono eyebrow, the name, and the price tag. Its tone comes from summary.kind and the row states: sun = cheapest, muted = only one shop, warn = stale/missing. Keep listSummaryText as sr-only. Add the hover lift and the selected style.
- Search results reuse the row, with Dodaj / Na liście on the right. Keep the spelling hint, the error and notice alerts (restyled) and the source footers.
```

## 5 · Produkt
```
Implement README section C:
- src/pages/watchlist/[id].astro: the title row on desktop; the back link and compact title on mobile; the sticky mobile bottom bar holding the refresh form.
- PriceComparisonView.tsx:
  - The verdict hero, driven by comparisonOf(state): cheapest → sun, one shop → tag-plain, stale → tag-warn. It shows the Price "hero" and the Sticker. Only show "Tylko 1 sklep" / "Stara cena" until the FR-012 judgement exists.
  - The price track card, with the position formula from the README. Hide it with fewer than 2 values.
  - Shop cards in a 2-column grid on lg: hanging tags, borders by state, the promo pill, mono fine print, "Zobacz w sklepie", "ODŚWIEŻAM…" while pending, and the existing notices.
  - Keep the aria-live announcements region and the no-JS form fallback.
- Move the Natura states into the Natura shop card, as the README maps them. Keep the "choose" state as its own section below, restyled.
Update src/dev/fixtures.ts / product-page.astro so every state renders in the kitchen sink.
```

## 6 · QA pass
```
Compare every state against design_handoff_etykiety/Drogeria Radar Redesign.dc.html (2a, 2b) at 1280px and 390px, in light and dark.
Check: 44px tap targets, focus rings, contrast script passing, no text wrapping inside pills or buttons, the sticker not overlapping the price or the "sprawdzono" caption, everything working with JS disabled, and reduced motion.
Fix any drift. Then run lint, astro check, the tests and npm run smoke.
```
