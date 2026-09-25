# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Drogeria Radar: a private, invite-only web app for a handful of users that shows which of five Polish drugstore chains (Rossmann, Hebe, Super-Pharm, dm, Drogerie Natura) sells a repeat-purchase product cheapest today, with regular and promo price, the Omnibus 30-day low and the age of every price. Astro 7 SSR, React 19 islands, Tailwind 4 and Supabase (Postgres, auth, RLS) on Cloudflare Workers, bootstrapped from `10x-astro-starter` on 2026-09-20. The starter's demo pages (`src/pages/index.astro`, `src/pages/dashboard.astro`) and welcome components are placeholders, not product code.

Canonical documents (read them; do not restate them here):

- @context/foundation/prd.md — requirements FR-001…FR-015, guardrails, access model, open questions. FR ids are the shared vocabulary for features.
- @docs/research/polish-drugstore-price-apis.md — verified shop endpoints, response shapes, quirks, blocked shops and dead ends (Appendix C). Consult it before writing or changing a shop adapter; do not re-probe what it rules out.
- @context/foundation/tech-stack.md — why this stack. @README.md — starter setup and deployment details.

## Non-negotiables

- Sign-up is invite-only with no open registration (PRD FR-001). The starter's `/auth/signup` page and `enable_signup = true` in `supabase/config.toml` are inherited defaults, not the product's registration path. The production Supabase project has "Allow new users to sign up" off; never run `supabase config push` against it, because that pushes `enable_signup = true`.
- Watchlists are private per user; price observations are shared by everyone (FR-005). Enforce this with RLS policies, not only with query filters. Removing a watchlist entry hides it and never deletes observations.
- Every displayed price shows its source and fetch time (FR-010, FR-011). A failed fetch shows the last known price with its age or a visible gap, never a blank, a zero or a silently stale value. Online prices are labelled as online; never claim shelf prices.
- Shop fetches run server-side and on demand (FR-008), under a per-shop request cap for the whole deployment, and stop for a shop that blocks or asks. Never circumvent bot protection; Sephora, Douglas and Notino are excluded for that reason. dm is out of the MVP for the same reason: its search refuses Cloudflare Workers traffic (research §9), so don't build a dm adapter or a proxy for it.
- The confirmed per-shop item is the anchor and EAN only a helper (FR-004, FR-006): Hebe returns wrong EANs and Super-Pharm's search index has none.
- Read `SUPABASE_URL` and `SUPABASE_KEY` only through `astro:env/server` (declared in `astro.config.mjs` as optional server secrets), never `import.meta.env`.
- The HTML-comment-delimited lesson block at the bottom of this file belongs to the 10x CLI and is replaced on every `npx @przeprogramowani/10x-cli get <lesson> --type rules`. Project rules live above it; never edit inside it.

## Commands

Prerequisite: copy `.env.example` to both `.env` (Node processes: build, check, smoke) and `.dev.vars` (the Cloudflare dev runtime) and fill in the two Supabase values. Without them the app still runs, but auth is disabled and every page shows an error banner.

- `npm run dev` — dev server on the Cloudflare workerd runtime at http://localhost:4321.
- `npm run build` / `npm run preview` — production build via `@astrojs/cloudflare`; preview serves `dist/` on workerd.
- `npm run lint` / `npm run lint:fix` / `npm run format` — ESLint (type-checked rules with the Astro and React plugins) and Prettier.
- `npx astro sync && npx astro check` — generate `.astro/types.d.ts`, then type-check `.astro` and TS files. CI runs both. On a fresh checkout run `astro sync` before `lint` or `check`; both depend on the generated types.
- `npm run smoke` — dependency-free auth-flow smoke test (`scripts/smoke.mjs`) against a running server, `BASE_URL` defaulting to localhost:4321. Needs a reachable Supabase with email confirmation off.
- Tests: no unit or e2e runner is installed, so there is no single-test command yet. When a runner is added, add its step to `.github/workflows/ci.yml`.
- `npx supabase start` / `npx supabase stop` — local Supabase via Docker (API on 54321, Studio on 54323, settings in `supabase/config.toml`).
- Production deploys by merging to `main`: Cloudflare Workers Builds runs `npm run build` and `npx wrangler deploy` for the Worker `drogeria-radar`. A manual `npx wrangler deploy` is for emergencies only, from a clean `main` after `npm run build`. Set secrets with `npx wrangler secret put SUPABASE_URL --name drogeria-radar` and the same for `SUPABASE_KEY`. What is live, and how to roll back: `context/deployment/deploy-plan.md`.

## Architecture

- **Request lifecycle**: `output: "server"`, so every page and API route renders on demand. `src/middleware.ts` runs on each request: it builds a per-request Supabase client, stores the user in `Astro.locals.user` (typed in `src/env.d.ts`) and redirects unauthenticated requests whose path starts with an entry of `PROTECTED_ROUTES`. Gate new pages by adding them there.
- **Null-client contract**: `createClient()` in `src/lib/supabase.ts` returns `null` when the env is missing; the middleware, the auth API routes and `src/lib/config-status.ts` (rendered as a banner by `src/layouts/Layout.astro`) all tolerate that. New Supabase code keeps this contract unless the contract is removed deliberately everywhere.
- **API routes**: `src/pages/api/**` export uppercase handlers (`export const POST: APIRoute`). The auth routes take HTML form posts and redirect back with an `?error=` query param that the page reads; the React islands (`client:load`) add only client-side validation and the password toggle. Reuse this shape for new forms. Validate input with zod via `import { z } from "astro/zod"` (no extra dependency); the auth routes predate that rule and cast form fields.
- **Workers constraints**: requests are short-lived and the runtime is workerd with `nodejs_compat`, not full Node. The post-MVP daily refresh (FR-015) needs a Cron Trigger or a queue, not a request handler.
- **UI**: Astro components for static markup, React only where interactivity is needed. Tailwind 4 through the Vite plugin with no `tailwind.config`; theme tokens are CSS variables in `src/styles/global.css` (shadcn "new-york", oklch, `.dark` variant). shadcn components live in `src/components/ui/` (`npx shadcn@latest add <name>`); merge classes with `cn()` from `@/lib/utils`. Path alias `@/*` maps to `src/*`.
- **Data**: migrations go in `supabase/migrations/` named `YYYYMMDDHHmmss_short_description.sql`, with RLS enabled on every table and per-operation, per-role policies. The production project doesn't expose new tables to the Data API automatically, so every migration also grants table privileges explicitly: to `authenticated`, and to `anon` only where that's intended. It has automatic RLS on as a safety net. Shared types (entities, DTOs) belong in `src/types.ts` and business logic in `src/lib/services/`; neither exists yet.

## Tooling and repository conventions

- Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`; a lint error blocks the commit.
- Prettier uses 120 columns and sorts Tailwind classes; let it reorder them.
- `.nvmrc` pins Node 24.18.0 (npm 11.16.0), and both CI and Workers Builds read it. Change dependencies with that npm. npm 11.6.2 writes lockfiles without the `@emnapi/*` entries that `npm ci` in npm 10.9 and 11.16 requires, so CI fails at install. Local Node below 24.16 prints non-fatal `EBADENGINE` warnings from `eslint-plugin-astro` at install.
- CI (`.github/workflows/ci.yml`) runs on pushes and PRs to `main`: lint, `astro check`, build, and the smoke test against a local Supabase. It never deploys and needs no repository secrets; keep Cloudflare tokens and Supabase keys out of GitHub.
- `context/` is the 10x workflow surface: `foundation/` living docs are edited in place, `changes/<id>/` holds per-change artefacts created with `/10x-new`, and `archive/` is read-only (see @context/foundation/README.md).
- The 10x CLI (`npx @przeprogramowani/10x-cli@latest`) manages `.claude/`, `.10x-cli.json` and the course block at the bottom of this file, and tracks them by content hash. `.prettierignore` and `.gitattributes` (LF everywhere) keep them byte-identical, so never reformat them. Apply a lesson's course block with `get <lesson> --type rules`: in CLI 1.25.2 a plain `get` removes the block. `sync` updates lessons in parallel and fails on Windows with `EPERM` renaming the manifest; rerun it per lesson with `get <lesson> --no-course-rules`.
- `CLAUDE.md.scaffold` is the starter's original rules file left by the bootstrap merge and `context/changes/bootstrap-verification/verification.md` is its audit log; Claude Code loads neither.
- Changes reach `main` only through pull requests. The `preventFailedDeploy` ruleset requires green `ci` and `smoke` checks, and every merge deploys to production through Workers Builds, so open the PR and leave the merge to the owner.
- The default branch is `main` of a public GitHub repository: never commit account IDs, emails, the workers.dev subdomain or key values. There is no enforced commit convention yet.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 1

Move from sprint-zero setup to project orchestration with the **roadmap chain**:

```
(Module 1 foundation docs) -> /10x-roadmap -> backlog-ready roadmap items
```

`/10x-roadmap` is the lesson focus. `/10x-new` is intentionally introduced in Module 2, Lesson 2, when a selected roadmap item becomes an implementation change folder.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Roadmap (lesson focus)** | |
| `/10x-roadmap` | You have `context/foundation/prd.md` and a scaffolded project baseline, and you need a vertical-first MVP roadmap. The skill reads the PRD, inspects the code baseline, uses available foundation docs such as `tech-stack.md`, `infrastructure.md`, and `deploy-plan.md`, then writes `context/foundation/roadmap.md`. Use it BEFORE creating per-change folders or implementation plans. |
| **Re-run upstream if needed** | |
| `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-infra-research` | Bundled from Module 1 so foundation contracts can be fixed before roadmap sequencing. If roadmap generation exposes a PRD gap, repair the PRD before pretending the backlog is ready. |

### How the chain hands off

- `/10x-roadmap` bridges product and implementation. It does not choose frameworks, design schemas, or write a per-change implementation plan.
- The output is `context/foundation/roadmap.md`: ordered milestones, vertical slices, bounded foundations, dependencies, unknowns, risk, and backlog handoff fields.
- Roadmap items should receive stable human-readable identifiers in backlog tools. The actual `context/changes/<change-id>/` folder is created in Lesson 2 with `/10x-new`.

### Roadmap boundaries

- Default to vertical slices: user-visible outcomes that cross UI, data, business logic, and integrations.
- Horizontal work is allowed only as a bounded enabler that names the downstream vertical milestone it unlocks.
- Avoid orphan horizontal work such as "build the whole database", "build all API endpoints", or "design the whole UI" before the first user-visible flow.
- Roadmap is not a calendar estimate. Do not invent dates, story points, or sprint velocity unless the user explicitly asks for a separate planning artifact.

### Foundation paths used by this lesson

- `context/foundation/prd.md` - input
- `context/foundation/tech-stack.md` - optional input
- `context/foundation/infrastructure.md` - optional input
- `context/deployment/deploy-plan.md` - optional input
- `context/foundation/roadmap.md` - output
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
