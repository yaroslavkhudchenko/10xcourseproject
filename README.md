# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v24.18.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth flow against a running server bound to the local Supabase (`SUPABASE_URL` and `SUPABASE_KEY` from `.env`; `BASE_URL`, defaults to `http://localhost:4321`)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

No database tables or migrations are required — this project uses Supabase Auth's built-in `auth.users` table only.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

Nobody can register: there is no sign-up page, and the app sends no email. The owner creates each account in the Supabase dashboard, or hands out an invite or recovery link made with `scripts/owner-link.mjs` (see `context/deployment/deploy-plan.md`, "Accounts and links (S-07)").

| Route                    | Description                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/`                      | Redirects a signed-in user to `/watchlist` and a visitor to `/auth/signin`                                                     |
| `/auth/signin`           | Polish email and password sign-in; after signing in, `?next=` returns to the list or a product, else to `/watchlist`           |
| `/auth/confirm`          | The page an invite or recovery link opens (`?token_hash=…&type=invite\|recovery`); only its "Ustaw hasło" button uses the link |
| `/auth/set-password`     | Sets the account's password, only for a session a link opened in the last 60 minutes; then the list with "Hasło zapisane."     |
| `POST /api/auth/signout` | Signs out this device only, then `/auth/signin` with "Wylogowano."                                                             |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication. A signed-out request to the list or a product goes to `/auth/signin` with itself as `?next=`; any other protected path goes to the plain `/auth/signin`.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/) through Cloudflare Workers Builds: every merge to `main` runs `npm run build`, then `npm run deploy:checked` (`scripts/deploy-checked.mjs`). That deploy command refuses code whose database migration production lacks, runs `npx wrangler deploy`, then checks production signed out, and any failure turns the build red. It needs three build secrets in Cloudflare, `CHECK_APP_URL`, `CHECK_SUPABASE_URL` and `CHECK_SUPABASE_KEY` (the publishable key). The runbook, with what a red build means, is in `context/deployment/deploy-plan.md` ("Checked deploys (rollout Phase 4)").

In an emergency, deploy by hand from a clean, up-to-date `main`. This skips both checks, so run them by hand around it:

```bash
npm run build
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that walks the auth flow over HTTP: the redirects of `/` and the protected pages and routes, sign-in with its return path and error codes, the link pages' contracts, sign-out, and the 404s of the removed sign-up and demo pages. The app lets no one register, so the script signs its own throwaway user up through Supabase Auth's `/auth/v1/signup`. Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 npm run smoke
```

`npm run smoke` reads `SUPABASE_URL` and `SUPABASE_KEY` from `.env` (`node --env-file-if-exists=.env`). They must name the local stack the server uses, with sign-up on and email confirmation off, as `supabase/config.toml` sets them: the script refuses any other `SUPABASE_URL`, so it never runs against a hosted project. `BASE_URL` defaults to `http://localhost:4321`.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## CI

GitHub Actions runs three jobs on every push and PR to `main`, with no secrets:

- **ci** — lint, the design-token contrast check, `astro check`, the unit tests and the build.
- **smoke** — starts a local Supabase with the Supabase CLI and runs the database contract checks and the deploy gate (`scripts/check-migrations-applied.mjs`) against it. Then it builds, serves the production preview on the Cloudflare runtime, and runs `npm run smoke` and the production check (`scripts/check-production.mjs`) against it.
- **e2e** — the Playwright suite in `tests/e2e/`, on the production preview against a local Supabase of its own.

The ruleset on `main` requires all three. A separate `Deploy check` workflow runs on each push to `main`: it waits for the commit's Workers Builds check and fails when the deploy is red, so GitHub emails whoever merged.

## License

MIT
