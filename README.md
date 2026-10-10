# Drogeria Radar

Drogeria Radar shows which of four Polish drugstore chains (Rossmann, Hebe, Super-Pharm and Drogerie Natura) sells a repeat-purchase product cheapest today, with the regular and promo price, the Omnibus 30-day low and the age of every price. It is private and invite-only, for a handful of people with their own watchlists. Its prices are the shops' online prices, labelled as such, never shelf prices. dm and the perfumeries (Sephora, Douglas, Notino) are left out: their traffic protection blocks the app's requests, and the app never works around it.

## How it works

- **Search and add.** The list's search (`/watchlist`) asks all four shops at once and shows one entry per product. "Dodaj" adds the entry's item from one of those shops, and that item fixes the product's identity.
- **Match each shop once.** A product's page (`/watchlist/<id>`) looks it up in the other three shops. A single candidate with the same EAN and size and a brand that doesn't differ is accepted automatically. Where EANs can't decide, as for Super-Pharm's items, which carry none, a strict name check may accept one. The user decides the rest, and a match whose size or brand differs is flagged.
- **Fetch politely, on demand.** Prices are fetched server-side when the user presses "Odśwież ceny" or opens a product, for each shop checked more than 15 minutes ago. Every shop request goes through one shop gate (`src/lib/services/shop-gate.ts`), which allows each shop 30 requests in any 60 seconds by default for the whole deployment, follows no redirects and stops a shop that blocks until the owner switches it back on.
- **Show every price's age.** Each price shows its shop and age. One older than 24 hours is marked stale, and a failed fetch shows the last known price or a gap, never a zero. Only fresh prices orderable online can be named cheapest.
- **Keep lists private.** Row-level security keeps each watchlist private to its owner and shows a price observation only to the users who watch that shop item. Removing a product never deletes an observation.
- **Judge today's price.** The product page calls today's cheapest price "Dobra cena!" when it is below the cheapest shop's declared 30-day low and "Zwykła cena" otherwise. Once the product has been on the list for 30 days, with prices on 5 of the last 30, it is compared with the lower of that history's lowest price and the declared low.

The interface is in Polish. For depth, see `CLAUDE.md` (rules and architecture), `context/foundation/prd.md` (requirements) and `docs/research/polish-drugstore-price-apis.md` (the shops' endpoints).

## Tech stack

- [Astro](https://astro.build/) v7, rendering every page on the server
- [React](https://react.dev/) v19 islands
- [TypeScript](https://www.typescriptlang.org/) v6 and zod
- [Tailwind CSS](https://tailwindcss.com/) v4 and shadcn/ui
- [Supabase](https://supabase.com/): Postgres, Auth and row-level security
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Vitest](https://vitest.dev/) and [Playwright](https://playwright.dev/)

## Prerequisites

- Node.js v24.18.0 (as specified in `.nvmrc`) and npm
- [Docker](https://www.docker.com/), for the local Supabase

## Getting started

1. Clone the repository and install its dependencies:

   ```bash
   git clone https://github.com/yaroslavkhudchenko/10xcourseproject.git
   cd 10xcourseproject
   npm install
   ```

2. Start the local Supabase. Its first start applies every migration in `supabase/migrations/`:

   ```bash
   npx supabase start
   ```

3. Copy `.env.example` to `.env` and `.dev.vars`, and fill in the API URL and anon key that `npx supabase status -o env` prints as `API_URL` and `ANON_KEY`. Never use a secret key: the build copies `.dev.vars` into `dist/server/`.

   ```
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_KEY=<anon key>
   ```

4. The app has no sign-up page, so add a local user in Studio (`http://localhost:54323`): Authentication → Users → Add user, with Auto Confirm User.

5. Run `npm run dev` and open `http://localhost:4321`.

Apply a new migration with `npx supabase migration up --local`, which keeps local users; `npx supabase db reset --local` deletes them.

## Available scripts

- `npm run dev` - dev server on the Cloudflare workerd runtime
- `npm run build` - production build, then a check that it shipped its web fonts
- `npm run preview` - serve the build on workerd
- `npm run astro` - the Astro CLI
- `npm run lint` / `npm run lint:fix` - ESLint with type-checked rules, without or with fixes
- `npm run format` - Prettier
- `npm run test` / `npm run test:db` - unit tests / tests that need the local Supabase
- `npm run smoke` - auth-flow smoke test against a running server
- `npm run check:production` - signed-out, read-only check of a deployment
- `npm run deploy:checked` - the checked deploy (see [Deployment](#deployment))

On a fresh checkout, run `npx astro sync` before `npm run lint` or `npx astro check`.

## Auth routes

Nobody can register: there is no sign-up page, and the app sends no email. The owner creates each account in the Supabase dashboard, or hands out an invite or recovery link made with `scripts/owner-link.mjs` (`context/deployment/deploy-plan.md`, "Accounts and links (S-07)").

| Route                    | Description                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/`                      | Redirects a signed-in user to `/watchlist` and a visitor to `/auth/signin`                                                     |
| `/auth/signin`           | Polish email and password sign-in; after signing in, `?next=` returns to the list or a product, else to `/watchlist`           |
| `/auth/confirm`          | The page an invite or recovery link opens (`?token_hash=…&type=invite\|recovery`); only its "Ustaw hasło" button uses the link |
| `/auth/set-password`     | Sets the account's password, only for a session a link opened in the last 60 minutes; then the list with "Hasło zapisane."     |
| `POST /api/auth/signout` | Signs out this device only, then `/auth/signin` with "Wylogowano."                                                             |

`PROTECTED_ROUTES` in `src/middleware.ts` lists the paths that need sign-in.

## Testing

No test reaches a live shop: the unit tests replay recorded answers (`src/lib/services/shops/fixtures/`), and every other check refuses any Supabase but the local stack.

- `npm run test` - Vitest unit tests in Node, with no database.
- `npm run test:db` - the `src/**/*.db.test.ts` tests, with the local stack's URL and anon key in `SUPABASE_URL` and `SUPABASE_KEY`.
- `node scripts/check-*-db.mjs` - with the same two variables, the shop gate, watchlist, matches, prices and catalogue checks prove the RLS policies, grants and SQL functions. The shop gate, prices and catalogue checks also need Docker access to the database container.
- `npm run smoke` - the auth flow over HTTP against a running server (`BASE_URL`, `http://localhost:4321` by default).
- `node scripts/check-two-users.mjs` - with the same variables, Docker access and a running server, proves that a second user gets nothing of the first user's product.
- `npx playwright test` - the e2e suite in `tests/e2e/`, in Chromium at 390 × 844, against the production preview it builds and starts on port 4321. It needs Docker, and it switches the local stack's shops off while it runs.

## Deployment

Every merge to `main` deploys to Cloudflare Workers through Workers Builds, which runs `npm run build`, then `npm run deploy:checked` (`scripts/deploy-checked.mjs`). That command refuses code whose migration production lacks, runs `npx wrangler deploy`, then checks production signed out; any failure turns the build red, and nothing rolls back on its own. It needs three build secrets: `CHECK_APP_URL`, `CHECK_SUPABASE_URL` and `CHECK_SUPABASE_KEY` (the publishable key). The Worker itself needs `SUPABASE_URL` and `SUPABASE_KEY` as secrets (`npx wrangler secret put`). Migrations reach production only when the owner runs `npx supabase db push`. The runbook, with the emergency path, is in `context/deployment/deploy-plan.md` ("Checked deploys (rollout Phase 4)").

## CI

GitHub Actions runs three jobs on every push and PR to `main`, with no secrets:

- **ci** — lint, the design-token contrast check, `astro check`, the unit tests and the build.
- **smoke** — on a local Supabase, the database checks and tests and the deploy gate; then, on the production preview, the smoke test, the two-user check and the production check.
- **e2e** — the Playwright suite on the production preview, with its own local Supabase.

The ruleset on `main` requires all three. A separate `Deploy check` workflow fails when a commit's Workers Builds deploy is red, so GitHub emails whoever merged.

## Project documents

The project follows the 10xDevs AI Toolkit workflow, with `context/` as its record:

- `CLAUDE.md` - rules and architecture, read before any change (`AGENTS.md` points to it).
- `context/foundation/` - living documents edited in place (see its `README.md`): PRD, tech stack, roadmap, test plan, lessons.
- `context/changes/` - a folder per change in progress (research, plan, reviews); `context/archive/` - finished changes, read-only.
- `context/map/repo-map.md` - the repository mapped by business capability and risk.
- `context/domain/` - the domain map (`domain-distillation.md`) and its glossary (`glossary.md`).
- `context/deployment/deploy-plan.md` - deployment runbooks.

## License

MIT
