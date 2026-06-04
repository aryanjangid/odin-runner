# odin-runner

A GitHub Action that runs an **Odin-dispatched Claude Code job** inside a target
repo, then reports the result back to Odin. It replaces the ~300-line inline
`odin.yml` with a one-line `uses:` so the per-repo workflow stays tiny and the
logic lives in **one tested place**.

## Use it

In a target repo, `.github/workflows/odin.yml` is all you need:

```yaml
name: Odin Run
on:
  workflow_dispatch:
    inputs:
      agent_prompt: { type: string, required: false }
      linear_issue_id: { type: string, required: true }
      linear_issue_title: { type: string, required: true }
  repository_dispatch:
    types: [odin_run]

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: ${{ github.event.client_payload.agent.timeout_minutes || 30 }}
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }

      # Repo-specific setup goes here only if Claude needs it before editing.
      # Do not run build/lint/test here; normal PR CI is Odin's gate.

      - uses: <your-account>/odin-runner@v2
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          callback_secret: ${{ secrets.ODIN_CALLBACK_SECRET }}
          callback_url: ${{ secrets.ODIN_CALLBACK_URL }}
```

Do not configure build/lint/test here. Repo agents should put those in the
repo's normal PR CI workflows. Odin pushes the PR branch, then watches those
checks as the execution gate. If CI fails, Odin resumes Claude with the failed
check context and a bounded fix loop.

### Branch name, commit message, PR title

These aren't configured here:

- **Branch name** comes from **Linear** (e.g. `naman/god-1483-fix-…`), so the PR
  auto-links to the issue. Falls back to `odin/<issue>-<run>-<attempt>` only when
  Linear's name is unavailable (e.g. a manual `workflow_dispatch`).
- **Commit message / PR title / PR body** are chosen by **Claude** after it reads
  the repo's `CLAUDE.md`/`AGENTS.md`, recent commits, and PR title conventions.
  That is intentional: many repos enforce commit or PR title formats in CI. Odin
  only has a last-resort fallback if the metadata file is missing.

To change the commit/PR style, document it in the repo's `CLAUDE.md` — Claude
follows it. There are no naming inputs to set.

## What it does

| Step | File | What |
| --- | --- | --- |
| Prepare | `pre.mjs` | validate prompt → continuation checkout |
| Run Claude | `anthropics/claude-code-action@v1` | the actual Claude run (stock upstream) |
| Finalize | `post.mjs` | read result → branch on mode → commit/**push branch** → report to Odin |
| Report failure | `lib/report-failure.mjs` | `if: failure()` catch-all → tell Odin "failed" |

Mode handling (from `client_payload.mode`):

- `needs_clarification` → report, no PR
- `inspect` / `verify` (read-only) → report answer/findings, no PR
- `implement` / `revise` (write) → commit/**push the branch**. Odin watches the PR's GitHub CI after push.
  A continuation that's already applied is a graceful no-op, not a failure.

### Who opens the PR

The runner currently **only pushes the branch** (`contents: write`). The template
also grants `pull-requests: write` so future runner-side PR updates do not require
every target repo to edit this workflow again. **Odin's server opens/updates the draft
PR** with the GitHub App installation token, in the result callback. This is
deliberate: creating a PR via the **App** isn't subject to the repo's *"Allow
GitHub Actions to create and approve pull requests"* setting — so onboarding a new
repo/org needs only the App installed, no Actions permission to flip. The runner
reports the pushed `branch` + `base`; the agent's `prTitle`/`prBody` ride along in
the result.

## Design notes

- **Composite action + dependency-free Node ESM.** No build step, no `dist/` to
  commit, no external npm deps — the `.mjs` files run directly with the `node`
  that's already on every runner. Pure helpers in `lib/odin.mjs` are unit-tested
  (`npm test` → `node --test`); git/PR/exec are thin IO wrappers.
- **The upstream `claude-code-action` is unchanged** — we only own the
  orchestration around it.
- **The Odin server is the brain.** It builds the prompt, picks the model, opens
  the PR, and watches GitHub CI. This action is the dumb-but-tested transport on
  the runner.
- **Future upgrade:** port the `.mjs` to TypeScript with an `ncc` build if you
  want compile-time types — the module boundaries are already set up for it.

## Publishing

This folder is meant to live in its own repo named `odin-runner`. Push it, tag a
release (`git tag v2.0.0 && git tag -f v2 && git push --tags`), and reference it
as `<your-account>/odin-runner@v2`. Move the `v2` tag forward to ship fixes to
every repo using the stable major tag.
