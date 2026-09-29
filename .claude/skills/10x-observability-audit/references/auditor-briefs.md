# Subagent briefs

Fill the `{{…}}` slots and launch all auditors in one message so they run in
parallel. Subagents start with no context: the capture model and known
issues are what keep them from re-deriving the basics and from
re-reporting what is already tracked.

## Area auditor (one per flow, read-only)

```
You are auditing the **{{AREA_NAME}}** flow of {{PROJECT_ONE_LINER}}
(repo: {{REPO_PATH}}) for code logic that makes production errors hard to
monitor and diagnose. READ-ONLY: do not edit files, do not commit.

## Capture model (already established — do not re-derive; verify only if you doubt it)
{{CAPTURE_MODEL}}

## Known issues (don't re-report; say if your finding explains one)
{{KNOWN_ISSUES_OR_NONE}}

## Your scope
{{AREA_DESCRIPTION}} — full stack: UI/client code, API/handlers, services,
data access, external calls, background work triggered by this flow.
Entry points to start from: {{ENTRY_POINTS}}. Find the rest by searching and
following calls.

## What to hunt for
Use these categories: coverage-gap, swallowed, logged-not-captured,
flattened-response, missing-throw, identity-lost, missing-context, config,
noise. {{TAXONOMY_SUMMARY}}

Pay special attention to failures that don't look like failures:
redirects, 2xx with an error flag, errors inside streams, fallbacks/empty
states, "not found"/"no access" that could really be an outage.

## Rules
- Verify every claim by reading the code; cite file:line.
- Skip cases a comment clearly justifies, but note if the justification
  still leaves a monitoring gap.
- Signal over volume: ~10–25 findings, sorted by severity
  (critical = a real production failure in this flow would be invisible or
  undiagnosable).

## Output
For each finding: location, category, severity, what happens in production
(user-visible and responder-visible), one-line fix direction. End with 3–5
bullets on the systemic patterns in this flow.
```

## Plumbing auditor (one per run, read-only)

```
You are auditing the **cross-cutting observability plumbing** of
{{PROJECT_ONE_LINER}} (repo: {{REPO_PATH}}). READ-ONLY. Other agents cover
the feature flows ({{AREAS}}); you cover the shared infrastructure.

## Capture model so far
{{CAPTURE_MODEL}}

## Answer with evidence (file:line, and dependency source when behaviour depends on a library version)
1. Uncaught exceptions in request handlers/pages: do they reach the
   tracker as exceptions with stacks, or does the framework convert them
   into error responses first? Also streamed/SSR bodies.
2. Code before the tracker boundary (middleware order, filters, app
   bootstrap): captured anywhere?
3. Handlers outside the boundary: what happens when they throw, and when
   they return a 5xx without throwing?
4. Status-based fallbacks (e.g. "report every 5xx"): grouping, cardinality
   of route tags, double reporting.
5. Scrubbing/privacy hooks: do they strip or rewrite things needed for
   diagnosis (stack frames, file names, breadcrumbs, release, causes, error
   codes)? How does the logger serialize error objects?
6. Release/version, environment, source maps/symbols: set and uploaded
   for every deploy target? Are preview/staging events separable?
7. Client side: global handlers, error boundaries, framework hydration
   or chunk-load handling, is the tracker loaded on every page/layout?
8. Background work: jobs, queues, cron, post-response tasks, separate
   workers — tracker init and failure reporting.
9. Repo-wide sweep (exclude tests): counts of empty catches, catch-without-
   binding, promise catch-to-default, raw console/print error logging,
   error-level log calls, and errors thrown without cause. List the ~10
   most consequential examples *outside* {{AREAS}}.
10. Platform side: log retention/sampling, alerting, tail/log drains —
    would the platform catch what the app misses?

## Output
Answers 1–10 with evidence and a verdict each; then findings
(location, category, severity, production impact, fix direction); then
3–5 systemic root causes.
```

## Runtime prober (optional, isolated)

Launch with `isolation: "worktree"` (or instruct it to create a temp
clone). Give it `references/runtime-probes.md` content and the path to
`scripts/fake-ingest.mjs`.

```
You are running **runtime experiments** to see which production failures are
captured vs missed. Repo: your isolated copy of {{REPO_PATH}}. You MAY edit
files in this isolated copy to inject failures. Never touch the original
working tree, never commit, push or deploy, never send events to a real
error tracker, never use production databases or third-party accounts.

## Capture model
{{CAPTURE_MODEL}}

## Procedure
{{RUNTIME_PROBES_REFERENCE}}

## Probe catalog (at minimum; skip shapes that don't exist in this stack)
{{PROBE_CATALOG}}

## Output
Table: probe id | failure shape | response | platform console | tracker
(sent? exception vs message? stack? tags?) | verdict (good / poor /
missed). Mark each row observed vs inferred. List exact blockers for
anything not tested, every file changed, and the command that reruns the
suite.
```
