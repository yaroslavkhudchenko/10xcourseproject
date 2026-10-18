---
change_id: ci-cd-code-review
title: An AI code review on every pull request, as a merge gate's verdict
status: plan_reviewed
created: 2026-10-16
updated: 2026-10-18
archived_at: null
---

## Notes

An AI code review on every pull request to `main`, as Module 5's lessons 2 and 3 teach. It's the course material for the optional 10xChampion badge, whose first deadline is 2026-11-04.

- **The reviewer:** an agent that reads a pull request's title, description and diff. It returns six criteria scored 1–10, a binding `pass`/`fail` verdict and a Markdown summary. The lesson's template `.claude/config-templates/m5l2-review-schema.ts.template` is the contract.
- **The CI side:** GitHub Actions runs the reviewer through a composite action. It comments the summary on the pull request, labels it `ai-cr:passed` or `ai-cr:failed`, and reviews it again when the `ai-cr:review` label is added. The templates are `m5l3-review.yml.template` and `m5l3-action.yml.template`.
- **Evals:** prompt or model changes are evaluated with promptfoo first (`m5l3-promptfooconfig.yaml.template`, the `m5l3-promptfoo` prompt).
- **Requirements:** the course's requirements are saved in `requirements.md`, from the `m5l3-requirements` prompt.

2026-10-16, the owner's call: after PR #57 fetched Module 5, they chose "Hooks first, then AI review" (the hooks fix is PR #58), with this change run as a full 10x change. It needs an API key from the owner as a GitHub secret. Today CI "never deploys and needs no repository secrets" (CLAUDE.md), so that rule changes with this change.

This branch starts from PR #57 (`chore/10x-module-5`), whose `.claude/config-templates/` and `m5l3-*` prompts aren't on `main` yet.
