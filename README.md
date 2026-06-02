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
      issues: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }

      # Optional: add a setup-<toolchain> step here if ubuntu-latest lacks your runtime.

      - uses: <your-account>/odin-runner@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          callback_secret: ${{ secrets.ODIN_CALLBACK_SECRET }}
          callback_url: ${{ secrets.ODIN_CALLBACK_URL }}
```

### Setting this repo's commands

`install` runs before Claude; `lint` / `build` / `test` are the enforced gate
before the PR. There are two ways to set them, resolved in this order:

1. **Action inputs in your `odin.yml`** (most explicit) — add to the `with:` block:
   ```yaml
       with:
         anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
         callback_secret: ${{ secrets.ODIN_CALLBACK_SECRET }}
         install: npm ci
         lint: npm run lint
         build: npm run build
         test: npm test
   ```
2. **Odin route project memory** — set them centrally in Odin; the server sends
   them in the dispatch. Use this to avoid per-repo edits.

For each command: the input wins if set, else the dispatch value, else the step
is skipped. So you can leave them all out and nothing breaks — Claude is still
told to self-check in the prompt.

### Branch name

A fresh run's branch comes from **Linear's own branch name** (e.g.
`naman/god-1483-fix-…`), sent in the dispatch — so the PR auto-links to the issue.
If Linear's name is unavailable (e.g. a manual `workflow_dispatch`), it falls back
to `<branch_prefix><issue>-<run>-<attempt>`, where `branch_prefix` is an input
(default `odin/`, used as-is — `feature/` or `claude-` both work).

### Commit message, PR title, PR body

Resolved per-field in this order:

1. **Agent-authored** — Claude reads the repo's `CLAUDE.md`/`AGENTS.md` and writes
   `commitMessage` / `prTitle` / `prBody` into `.odin/result.json` (e.g. a
   Conventional Commit like `feat(hermes): add notification summary (GOD-1478)`,
   where the `feat`/scope depend on the change). This is the Odin prompt's job.
2. **Per-repo template input** — `commit_message` / `pr_title` with `{{issue_id}}`,
   `{{issue_title}}`, `{{job_id}}` placeholders:
   ```yaml
       with:
         commit_message: "{{issue_id}} {{issue_title}}"
         pr_title: "[{{issue_id}}] {{issue_title}}"
   ```
3. **Default** — `{{issue_id}}: {{issue_title}}`.

So convention-heavy repos get an agent-written message; everyone else gets a clean
default, with templates as a deterministic override in between.

## What it does

| Step | File | What |
| --- | --- | --- |
| Prepare | `pre.mjs` | validate prompt → continuation checkout → install deps |
| Run Claude | `anthropics/claude-code-action@v1` | the actual Claude run (stock upstream) |
| Finalize | `post.mjs` | read result → branch on mode → checks gate → commit/push/PR → report |
| Report failure | `lib/report-failure.mjs` | `if: failure()` catch-all → tell Odin "failed" |

Mode handling (from `client_payload.mode`):

- `needs_clarification` → report, no PR
- `inspect` / `review` / `check` (read-only) → report answer/findings/checks, no PR
- `implement` / `revise` (write) → enforced checks gate → commit/push → open or
  update a draft PR. A continuation that's already applied is a graceful no-op,
  not a failure.

## Design notes

- **Composite action + dependency-free Node ESM.** No build step, no `dist/` to
  commit, no external npm deps — the `.mjs` files run directly with the `node`
  that's already on every runner. Pure helpers in `lib/odin.mjs` are unit-tested
  (`npm test` → `node --test`); git/PR/exec are thin IO wrappers.
- **The upstream `claude-code-action` is unchanged** — we only own the
  orchestration around it.
- **The Odin server is the brain.** It builds the prompt, picks the model, and
  sends install/lint/build/test in the `odin_run` dispatch. This action is the
  dumb-but-tested transport on the runner.
- **Future upgrade:** port the `.mjs` to TypeScript with an `ncc` build if you
  want compile-time types — the module boundaries are already set up for it.

## Publishing

This folder is meant to live in its own repo named `odin-runner`. Push it, tag a
release (`git tag v1.0.0 && git tag -f v1 && git push --tags`), and reference it
as `<your-account>/odin-runner@v1`. Move the `v1` tag forward to ship fixes to
every repo at once.
