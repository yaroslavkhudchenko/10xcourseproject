# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Drogeria Radar: a private, invite-only web app for a handful of users that shows which of five Polish drugstore chains (Rossmann, Hebe, Super-Pharm, dm, Drogerie Natura) sells a repeat-purchase product cheapest today, with regular and promo price, the Omnibus 30-day low and the age of every price. Astro 7 SSR, React 19 islands, Tailwind 4 and Supabase (Postgres, auth, RLS) on Cloudflare Workers, bootstrapped from `10x-astro-starter` on 2026-09-20. The starter's demo pages (`src/pages/index.astro`, `src/pages/dashboard.astro`) and welcome components are placeholders, not product code.

Canonical documents (read them; do not restate them here):

- @context/foundation/prd.md — requirements FR-001…FR-015, guardrails, access model, open questions. FR ids are the shared vocabulary for features.
- @docs/research/polish-drugstore-price-apis.md — verified shop endpoints, response shapes, quirks, blocked shops and dead ends (Appendix C). Consult it before writing or changing a shop adapter; do not re-probe what it rules out.
- @context/foundation/tech-stack.md — why this stack. @README.md — starter setup and deployment details.

## Non-negotiables

- Sign-up is invite-only with no open registration (PRD FR-001). The starter's `/auth/signup` page and `enable_signup = true` in `supabase/config.toml` are inherited defaults, not the product's registration path.
- Watchlists are private per user; price observations are shared by everyone (FR-005). Enforce this with RLS policies, not only with query filters. Removing a watchlist entry hides it and never deletes observations.
- Every displayed price shows its source and fetch time (FR-010, FR-011). A failed fetch shows the last known price with its age or a visible gap, never a blank, a zero or a silently stale value. Online prices are labelled as online; never claim shelf prices.
- Shop fetches run server-side and on demand (FR-008), under a per-shop request cap for the whole deployment, and stop for a shop that blocks or asks. Never circumvent bot protection; Sephora, Douglas and Notino are excluded for that reason.
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
- `npx wrangler deploy` — deploy to Cloudflare Workers; set secrets with `npx wrangler secret put SUPABASE_URL` and the same for `SUPABASE_KEY`.

## Architecture

- **Request lifecycle**: `output: "server"`, so every page and API route renders on demand. `src/middleware.ts` runs on each request: it builds a per-request Supabase client, stores the user in `Astro.locals.user` (typed in `src/env.d.ts`) and redirects unauthenticated requests whose path starts with an entry of `PROTECTED_ROUTES`. Gate new pages by adding them there.
- **Null-client contract**: `createClient()` in `src/lib/supabase.ts` returns `null` when the env is missing; the middleware, the auth API routes and `src/lib/config-status.ts` (rendered as a banner by `src/layouts/Layout.astro`) all tolerate that. New Supabase code keeps this contract unless the contract is removed deliberately everywhere.
- **API routes**: `src/pages/api/**` export uppercase handlers (`export const POST: APIRoute`). The auth routes take HTML form posts and redirect back with an `?error=` query param that the page reads; the React islands (`client:load`) add only client-side validation and the password toggle. Reuse this shape for new forms. Validate input with zod via `import { z } from "astro/zod"` (no extra dependency); the auth routes predate that rule and cast form fields.
- **Workers constraints**: requests are short-lived and the runtime is workerd with `nodejs_compat`, not full Node. The post-MVP daily refresh (FR-015) needs a Cron Trigger or a queue, not a request handler.
- **UI**: Astro components for static markup, React only where interactivity is needed. Tailwind 4 through the Vite plugin with no `tailwind.config`; theme tokens are CSS variables in `src/styles/global.css` (shadcn "new-york", oklch, `.dark` variant). shadcn components live in `src/components/ui/` (`npx shadcn@latest add <name>`); merge classes with `cn()` from `@/lib/utils`. Path alias `@/*` maps to `src/*`.
- **Data**: migrations go in `supabase/migrations/` named `YYYYMMDDHHmmss_short_description.sql`, with RLS enabled on every table and per-operation, per-role policies. Shared types (entities, DTOs) belong in `src/types.ts` and business logic in `src/lib/services/`; neither exists yet.

## Tooling and repository conventions

- Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`; a lint error blocks the commit.
- Prettier uses 120 columns and sorts Tailwind classes; let it reorder them.
- `.nvmrc` pins Node 22.14, but `eslint-plugin-astro` 3.1 requires 22.22.3+ or 24.16+; older Node prints non-fatal `EBADENGINE` warnings at install.
- CI (`.github/workflows/ci.yml`) runs on pushes and PRs to `master` only and needs `SUPABASE_URL` and `SUPABASE_KEY` repository secrets for the build job.
- `context/` is the 10x workflow surface: `foundation/` living docs are edited in place, `changes/<id>/` holds per-change artefacts created with `/10x-new`, and `archive/` is read-only (see @context/foundation/README.md).
- `CLAUDE.md.scaffold` is the starter's original rules file left by the bootstrap merge and `context/changes/bootstrap-verification/verification.md` is its audit log; Claude Code loads neither.
- The repository has no commits yet, so there is no commit convention to follow; the branch is `master`.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit — Module 1, Lesson 5

Pick a deployment platform and ship to production with the **infra chain**:

```
(/10x-init  →  /10x-shape  →  /10x-prd  →  /10x-tech-stack-selector  →  /10x-bootstrapper  →  /10x-agents-md  →  /10x-rule-review  →  /10x-lesson)  →  /10x-infra-research  →  Plan Mode deploy
```

The full Module 1 chain ships from Lessons 1–4 (re-included so you can fix any earlier contract mid-flight). `/10x-infra-research` is the lesson's main topic; the deploy step itself uses the host's built-in **Plan Mode** rather than a dedicated skill — the artifact (`context/deployment/deploy-plan.md`) is what carries forward.

### Task Router — Where to start

| Skill                                                                                                                                                                                          | Use it when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Infrastructure (lesson focus)**                                                                                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/10x-infra-research [path-to-tech-stack-or-prd]`                                                                                                                                              | You have a `context/foundation/tech-stack.md` (and ideally a `prd.md`) and need to pick an MVP deployment platform. The skill loads the stack as a hard constraint, runs a 5-question developer interview (persistent connections, cost sensitivity, existing familiarity, global reach, co-location preference), spawns parallel subagent research across six candidate platforms, scores them Pass/Partial/Fail across the five agent-friendly criteria from `references/agent-friendly-criteria.md`, shortlists the top three, and runs a three-lens anti-bias cross-check on the leader (devil's advocate, pre-mortem, unknown unknowns) before writing `context/foundation/infrastructure.md`. Use AFTER `/10x-tech-stack-selector`, BEFORE `/10x-implement`. |
| **Deploy (host built-in, not a skill)**                                                                                                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Plan Mode deploy                                                                                                                                                                               | You have `infrastructure.md` + `tech-stack.md` and want a read-only plan reviewed before any mutation hits the platform. Activate the host's plan mode (Claude Code: `Shift+Tab` cycles default → auto-accept → plan; IDE: dedicated button) with the prompt "Wykonajmy pierwsze wdrożenie w oparciu o `@infrastructure.md`, zgodnie ze stackiem z `@tech-stack.md`". Read the plan, demand corrections, approve, then let the agent execute. The approved plan persists at `context/deployment/deploy-plan.md` so the next lesson's milestone planning can reference what's already deployed and which secrets are already wired.                                                                                                                                 |
| **Re-run upstream if needed**                                                                                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/10x-init` / `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-rule-review` / `/10x-lesson` / `/10x-stack-assess` / `/10x-health-check` | Bundled so you can patch any earlier contract mid-flight. If the anti-bias cross-check forces a platform swap that pushes a stack-shaped decision (e.g. "this DB doesn't fit any platform we'd accept"), re-run `/10x-tech-stack-selector` to keep `tech-stack.md` and `infrastructure.md` aligned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### How the chain hands off

- `/10x-infra-research` reads `context/foundation/tech-stack.md` (language, framework, runtime, database) as **hard constraints** — platforms that can't run the stack are dropped before scoring. It also reads `context/foundation/prd.md` (scale, latency, uptime expectations) as **soft weights** when scoring. Both inputs are optional but strongly recommended; without them the skill proceeds but warns.
- The skill writes `context/foundation/infrastructure.md` as the third foundation contract: frontmatter (`project`, `researched_at`, `recommended_platform`, `runner_up`, `context_type`, `tech_stack`) plus a body covering recommendation, full platform comparison with scoring matrix, anti-bias findings, operational story (preview / secrets / rollback / approval / logs), and a risk register tying every entry back to the lens that surfaced it. On collision the skill prompts: overwrite, save as `infrastructure-v2.md`, or abort.
- Plan Mode reads `infrastructure.md` and `tech-stack.md` together. The agent emits a step-by-step plan covering automated steps it owns, manual setup gates (account creation, secret configuration), exact deploy commands (Pages vs Workers commands are NOT interchangeable on Cloudflare — the plan must specify), and verification steps. The plan is rejected/edited until it's right; only then does Plan Mode exit and execution begin. The approved plan lands at `context/deployment/deploy-plan.md` and is consumed downstream by milestone-planning skills as ground truth for "what's already deployed".

### What the lesson's skills capture (and what they do NOT)

- **`/10x-infra-research` captures**: platform shortlist scored against five agent-friendly criteria (CLI quality, managed/serverless degree, agent-readable docs, stable/scriptable deploy API, MCP or first-class agent integration), three anti-bias outputs on the leader (numbered weaknesses, 150–200-word failure narrative, 3–5 unknown-unknowns), an operational story with one concrete answer per axis (not categories), and a risk register where every row names its source lens (`Devil's advocate` / `Pre-mortem` / `Unknown unknowns` / `Research finding`). Status of every non-GA feature is captured inline (`beta` / `preview` / `region-limited` / `deprecated`) with the date the status was checked.
- **`/10x-infra-research` does NOT** build Docker images or write Dockerfiles, configure CI/CD pipelines, or plan beyond MVP scope (multi-region HA is explicitly out of scope). It does NOT decide for you — the user accepts, swaps to runner-up, or aborts after the cross-check, and that decision is recorded in the output.
- **Plan Mode** captures: an explicit human gate between "agent has a plan" and "agent mutates production". The artifact (`deploy-plan.md`) is the audit trail for "what was supposed to happen" when the live run goes sideways. Plan Mode does NOT replace `/10x-infra-research` (the platform decision must already be made — Plan Mode plans the deploy, it doesn't pick where to deploy).

### The five agent-friendly criteria (and why they're load-bearing)

The criteria that make `/10x-infra-research`'s scoring matrix are not generic "good platform" axes — they're the specific traits that determine whether an agent can operate this platform from a session without you holding its hand:

1. **CLI-first** — every routine operation has a documented command; the agent doesn't need to click in a panel.
2. **Managed / serverless** — fewer moving pieces means fewer ways the agent (or you) breaks something the platform was supposed to handle.
3. **Agent-readable docs** — markdown / `llms.txt` / GitHub-hosted docs the agent can fetch and parse, not JS-rendered marketing pages.
4. **Stable, scriptable deploy API** — predictable exit codes, structured output, no interactive prompts mid-deploy.
5. **MCP server or first-class agent integration** — bonus, not required. CLI alone is fine for MVP; MCP earns its keep when the agent makes dozens of structured queries against live state.

Hard filters apply before scoring (persistent-connection requirement drops Netlify/Vercel serverless-only; tech-stack runtime mismatch drops the platform entirely). Interview answers reweight criteria after — cost sensitivity penalizes expensive base tiers, familiarity breaks ties, global-reach preference favours edge-native platforms, co-location preference favours integrated databases.

### Anti-bias as a decision discipline (not theatre)

Every research conversation with an LLM has a built-in tilt toward whatever the user already signalled. `/10x-infra-research` runs three structured lenses against the leader BEFORE the file is written, not after:

- **Devil's advocate** — _find the weaknesses, hidden costs, and failure modes specific to deploying `<this stack>` on `<this platform>`_. Output is a numbered list of 3–5 specifics, not categories.
- **Pre-mortem** — _six months later, this decision turned out to be a complete disaster; walk through the assumptions and underestimated risks that led there_. Output is a 150–200-word narrative; narratives surface concrete failure shapes that abstract risk lists hide.
- **Unknown unknowns** — _what's true about this combination that the marketing page and docs don't make obvious?_ Output is 3–5 non-obvious risks.

After the cross-check the user has three real options: **proceed with the leader and absorb the risks into the register**, **swap to runner-up** (and re-run the cross-check on the new leader), or **swap to third place**. The third option is rare; if it never happens across many runs, the cross-check has degraded into a ritual and should be rewritten.

Two additional techniques (no skill required, raw prompts) belong in the same toolbox: forcing the model to compare three alternatives in a markdown table (structure beats "the same answer in different words"), and role-rotation (the same decision through a frontend dev's, security person's, and cost owner's eyes — surface the cost each role pays and propose alternatives if any of them flinch).

### CLI vs MCP for live-infra operability

After deploy, the agent needs a way to talk to the running platform. Two paths, complementary not competing:

- **CLI** (`wrangler`, `flyctl`, `vercel`, `gh`) — explicit and auditable, output stays in the terminal, safer defaults for irreversible actions (e.g. `netlify deploy` is draft by default; `--prod` must be passed). Best for MVP: minimal setup, low context cost (no tool schemas pre-loaded), and the agent has to know the command (which is where a per-tool skill helps).
- **MCP** — a dedicated server exposing structured tools with schemas (`pages_deployments_list`, etc.). Each connected MCP server adds tool definitions to the context window, so cost compounds across servers. Earns its keep when the agent makes many discovery-style queries against live state (logs, deployment diffs) and structured JSON beats parsing CLI output.

Sensible default: start with CLI, add MCP when you notice a recurring pattern of `--help` traversal the agent has to do to answer a class of questions. Anthropic's own [building-agents-that-reach-production](https://claude.com/blog/building-agents-that-reach-production-systems-with-mcp) framing is "API, CLI, and MCP are three complementary paths" — pick by task, not by hype.

### Production-access boundary (minimal permissions, human-on-irreversibles)

Both CLI and MCP can give the agent direct access to production. The lesson sets a default posture:

- **Tokens are scoped, not master keys.** On Cloudflare: an API token limited to Pages or Workers for one project, no DNS, no Workers Secrets for unrelated projects, no billing. AWS / GCP equivalent: scoped IAM role with `console-only-user` or read-only on production, full access on staging.
- **Tokens live in env vars, not in `.mcp.json` committed to the repo.** The agent picks them up via the MCP server or CLI's env-discovery, not via plaintext in conversation.
- **Destructive actions are human-only.** Drop a database, rotate a primary secret, delete a project — those are panel-by-hand operations, even if the agent suggests them. Manual click costs 30 seconds; cleanup after an automated mistake costs hours.

This is the MVP posture. As the project matures, the natural evolution is staging gets full agent access, production becomes read-only — covered in later modules.

### Foundation paths used by this lesson

- `context/foundation/tech-stack.md` — input (Lesson 2 hand-off, hard constraints)
- `context/foundation/prd.md` — input (Lesson 1 hand-off, soft weights)
- `context/foundation/infrastructure.md` — output (the third foundation contract)
- `context/deployment/deploy-plan.md` — output of Plan Mode deploy (audit trail of "what was supposed to happen")
- `context/foundation/lessons.md` — recurring rules & pitfalls (use `/10x-lesson` from Lesson 4 if you spot a class of agent failure during research or deploy)
- `docs/reference/contract-surfaces.md` — load-bearing names registry

### Universal language

The shipped skill carries no 10xDevs / cohort / certification references. The candidate platform list (Cloudflare, Vercel, Netlify, Fly.io, Railway, Render) is the starting research lens, not a recommendation set — the scoring + interview + cross-check pipeline is what's load-bearing, and a platform absent from the default list can be added by extending the research step. The five agent-friendly criteria are the artifact's true core; `/10x-infra-research` re-reads them from `references/agent-friendly-criteria.md` so they evolve as platforms do.

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
