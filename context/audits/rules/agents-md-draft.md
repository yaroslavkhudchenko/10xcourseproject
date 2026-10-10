# Repository Guidelines

Drogeria Radar, a private price comparison of four Polish drugstore chains, runs Astro 7 SSR, React 19 islands, Tailwind 4 and Supabase on Cloudflare Workers. @CLAUDE.md holds every rule in depth.

## Hard rules

- Invite-only: no sign-up page or route, no email.
- No secret key (`sb_secret_…`, `service_role`) in code, `.env`, `.dev.vars`, CI or tests; read `SUPABASE_URL` and `SUPABASE_KEY` only through `astro:env/server`.
- Enforce privacy with RLS policies, not query filters; every migration grants privileges explicitly.
- Every shop request goes through `gate.fetch` (`src/lib/services/shop-gate.ts`), with its host in `SHOP_HOSTS`.
- Never circumvent bot protection: no adapter or proxy for dm, Sephora, Douglas or Notino. Tests never call a live shop.
- Show each price's source and fetch time; after a failed fetch, the last price with its age or a gap, never blank or zero.
- Changes reach `main` only through pull requests the owner merges; every merge deploys. Only the owner runs `supabase db push`; never `config push` or `migration up --linked`.
- Never edit the HTML-comment-delimited 10x CLI block at the bottom of `CLAUDE.md`.
- The repository is public: commit no account id, email, workers.dev subdomain or key.

## Commands

- Setup: copy `.env.example` to `.env` and `.dev.vars`; run `npx astro sync`.
- CI's `ci` job: `npm run lint`, `node scripts/check-token-contrast.mjs`, `npx astro check`, `npm run test`, `npm run build`; one test: `npx vitest run <file> -t "<name>"`.
- Run `ASTRO_DEV_BACKGROUND=1 npx astro dev` in the background, and `npx astro check --noSync` beside it.
- `npm run test:db`, `scripts/check-*-db.mjs` and `npx playwright test` need Docker and `npx supabase start`.

## Structure

- Decision rules live, unit-tested, in `src/lib/services/` (adapters in `shops/`); pages and routes only call them.
- Gate a new page in `PROTECTED_ROUTES` (`src/middleware.ts`); reuse `src/components/ui/` and the tokens in `src/styles/global.css`.
- New tables, views and functions join the reviewed list in `scripts/check-catalog-db.mjs`; `context/archive/` is read-only.

## Conventions

- ESLint (@eslint.config.js, with its guards `serverFetchConfig`, `islandConfig` and `tokenConfig`) and Prettier (@.prettierrc.json) set the style.
- UI text is Polish; zod comes from `astro/zod`.
- Tests sit beside their source (`*.test.ts`; `*.db.test.ts` need the database); shop tests replay fixtures through `createReplayFetch` (@context/foundation/test-plan.md §6.4).

## Commits and PRs

- Commit subjects follow `type(<change-id>): summary` (`feat`, `fix`, `docs`, `chore`, `test`, `refactor`), a habit nothing enforces.
- Pull requests need green `ci`, `smoke` and `e2e` checks (@.github/workflows/ci.yml).

## Further Reading

@context/foundation/prd.md (FR ids), @docs/research/polish-drugstore-price-apis.md (shop APIs), @context/foundation/tech-stack.md, @README.md and @context/foundation/lessons.md.
