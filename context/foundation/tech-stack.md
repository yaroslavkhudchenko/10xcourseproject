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

## Why this stack

A solo front-end developer is shipping Drogeria Radar, a small private drugstore price comparison, as a three-week after-hours MVP with a hard deadline of 2026-11-04. The PRD forces email-and-password sign-in with invite-only accounts, private per-user watchlists over shared price observations, and server-side fetching from five shop search endpoints under a per-shop request cap. 10x Astro Starter is the recommended default for a web app in JavaScript/TypeScript and clears all four agent-friendly gates: Supabase gives Postgres, auth and row-level security for the watchlist privacy guardrail, Astro API routes on Cloudflare Workers give the outbound fetches and progressive per-shop results, and TypeScript with Zod schemas keeps adapter contracts explicit. Standard path taken, so team size defaults to solo. Bootstrapper confidence is first-class, so expect mostly-smooth scaffolding with occasional manual steps. Deployment is cloudflare-pages, the starter default; verify egress to the five shops early, and build the per-shop rate limiter as shared state. Realtime, payments, AI and background jobs are off for the MVP; the daily refresh (FR-015) is post-MVP and fits a Cloudflare cron trigger later. CI runs on GitHub Actions with auto-deploy on merge.
