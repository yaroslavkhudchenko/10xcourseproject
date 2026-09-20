---
bootstrapped_at: 2026-09-20T14:51:48Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: drogeria-radar
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md` as read at run time.

```yaml
---
starter_id: 10x-astro-starter
package_manager: npm
project_name: drogeria-radar
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---
```

### Why this stack (from the hand-off)

A solo front-end developer is shipping Drogeria Radar, a small private drugstore price comparison, as a three-week after-hours MVP with a hard deadline of 2026-11-04. The PRD forces email-and-password sign-in with invite-only accounts, private per-user watchlists over shared price observations, and server-side fetching from five shop search endpoints under a per-shop request cap. 10x Astro Starter is the recommended default for a web app in JavaScript/TypeScript and clears all four agent-friendly gates: Supabase gives Postgres, auth and row-level security for the watchlist privacy guardrail, Astro API routes on Cloudflare Workers give the outbound fetches and progressive per-shop results, and TypeScript with Zod schemas keeps adapter contracts explicit. Standard path taken, so team size defaults to solo. Bootstrapper confidence is first-class, so expect mostly-smooth scaffolding with occasional manual steps. Deployment is cloudflare-pages, the starter default; verify egress to the five shops early, and build the per-shop rate limiter as shared state. Realtime, payments, AI and background jobs are off for the MVP; the daily refresh (FR-015) is post-MVP and fits a Cloudflare cron trigger later. CI runs on GitHub Actions with auto-deploy on merge.

## Pre-scaffold verification

| Signal      | Value                                                               | Severity | Notes                                                                                            |
| ----------- | ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| npm package | not run                                                             | —        | `cmd_template` starts with `git clone`; no `create-*` npm CLI to check                           |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-09-12T21:16:08Z | fresh    | from card `docs_url`; `gh` CLI not installed, read via the public GitHub REST API (curl) instead |

Local toolchain at run time: node v24.12.0, npm 11.6.2, git 2.55.0.windows.3 (Windows 11). The starter's `.nvmrc` pins Node 22.14.0.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 30784 (50 project files + 30734 under `node_modules/`)
**Conflicts (.scaffold siblings)**: CLAUDE.md
**.gitignore handling**: moved silently (absent in cwd)
**.bootstrap-scaffold cleanup**: deleted
**Cloned `.git/`**: removed before move-up (upstream history not carried over; cwd is not a git repository yet)
**`context/` drops**: none (the starter ships no `context/` directory)

Install output (stdout): `added 651 packages, and audited 652 packages in 37s`, `found 0 vulnerabilities`.

Install warnings (stderr, non-fatal):

- `npm warn EBADENGINE` for `astro-eslint-parser@3.1.0` and `eslint-plugin-astro@3.1.0`: required `node ^22.22.3 || ^24.16.0 || >=26.3.0`, current `v24.12.0`. Lint tooling may misbehave until Node is moved to 22.22+ or 24.16+. Note that the starter's own `.nvmrc` (22.14.0) is also below this range.
- `npm warn ERESOLVE overriding peer dependency` (from the `overrides` block in package.json pinning `eslint` for two plugins).

File-by-file move log:

```
MOVE     .env.example
MOVE     .github/ (1 files)
MOVE     .gitignore
MOVE     .husky/ (1 files)
MOVE     .nvmrc
MOVE     .prettierrc.json
MOVE     .vscode/ (3 files)
MOVE     AGENTS.md
MOVE     astro.config.mjs
CONFLICT CLAUDE.md -> CLAUDE.md.scaffold
MOVE     components.json
MOVE     eslint.config.js
MOVE     node_modules/ (30734 files)
MOVE     package-lock.json
MOVE     package.json
MOVE     public/ (3 files)
MOVE     README.md
MOVE     scripts/ (1 files)
MOVE     src/ (26 files)
MOVE     supabase/ (2 files)
MOVE     tsconfig.json
MOVE     wrangler.jsonc
```

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW (0 INFO)
**Direct vs transitive**: 0/0/0/0 direct of total 0/0/0/0. npm 11 reports dependency counts by kind rather than a direct count: 802 total (360 prod, 269 dev, 165 optional, 25 peer).
**Audit exit code**: 0 (auditReportVersion 2)

#### CRITICAL findings

none

#### HIGH findings

none

#### MODERATE findings

none

#### LOW / INFO findings

none

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

`project_name` (drogeria-radar) is metadata only in v1: the scaffold kept the starter's own `name` in `package.json` and `wrangler.jsonc` (`10x-astro-starter`); rename both by hand.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.

Starter-specific notes from this run:

- `CLAUDE.md.scaffold` holds the starter's own agent rules (commands, architecture, conventions such as RLS on every table and zod validation in API routes). Your `CLAUDE.md` is the 10x-cli managed lesson block; merge or reference the starter rules when agent context is set up.
- Environment: copy `.env.example` to `.env` (Node) and `.dev.vars` (Cloudflare local dev) and fill `SUPABASE_URL` / `SUPABASE_KEY`. Local Supabase needs Docker (`npx supabase start`).
- Pre-commit hook: `.husky/pre-commit` runs `lint-staged`; there is no `prepare` script, so after `git init` run `npx husky` once to activate it.
- CI: `.github/workflows/ci.yml` triggers on `master` and needs `SUPABASE_URL` / `SUPABASE_KEY` repository secrets for the build job; the smoke job spins up a local Supabase.
- Node: `.nvmrc` says 22.14.0, but two lint packages require 22.22.3+ or 24.16+; pick one of those to clear the engine warnings.
- `README.md` is the starter's README; rewrite it for Drogeria Radar when convenient.
