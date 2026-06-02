// Post-Claude step: read the agent result, then branch on mode —
//   needs_clarification -> report, no PR
//   read-only (inspect/review/check) -> report answer/findings/checks, no PR
//   write (implement/revise) -> enforced checks gate, then commit/push/open-or-update PR
// On any internal error this exits non-zero WITHOUT reporting, so the action's
// `if: failure()` step reports a single "failed" to Odin (no double callback).
import { rmSync } from "node:fs";

import { runShell } from "./lib/exec.mjs";
import {
  buildPrBody,
  readResult,
  renderTemplate,
  sendCallback,
  selectChecks,
  sanitizeBranchName,
} from "./lib/odin.mjs";
import {
  checkoutNewBranch,
  commitAll,
  configIdentity,
  defaultBranch,
  hasChanges,
  pushBranch,
} from "./lib/git.mjs";
import { createDraftPr, findOpenPr } from "./lib/pr.mjs";

const env = process.env;
const readOnly = env.READ_ONLY === "true";

// A non-blank string, else "" — so `text(x) || fallback` falls through cleanly
// for missing/blank/non-string agent fields.
function text(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

async function main() {
  const result = readResult();
  const status = result.status || "completed";

  // 1. Clarification — report and stop, no PR.
  if (status === "needs_clarification") {
    await sendCallback({ ...env, STATUS: "needs_clarification" }, result);
    return;
  }

  // 2. Read-only modes — report the answer/findings/checks the agent wrote.
  if (readOnly) {
    await sendCallback(env, result);
    return;
  }

  // 3. Write modes: enforced quality gate before the PR.
  await runChecks();

  // Drop Odin's scratch dir so it never lands in the PR and doesn't mask the
  // no-change check below (target repos don't gitignore .odin/).
  rmSync(".odin", { recursive: true, force: true });

  if (!(await hasChanges())) {
    // A follow-up already applied is a graceful no-op, not a failure — reuse the PR.
    if (env.CONTINUATION_BRANCH) {
      const prUrl = await findOpenPr(env.CONTINUATION_BRANCH);
      console.log("Continuation already satisfied — no file changes needed.");
      await sendCallback({ ...env, STATUS: "completed", PR_URL: prUrl }, result);
      return;
    }
    throw new Error("Claude finished without file changes.");
  }

  await configIdentity();
  const base = await defaultBranch();

  const vars = {
    issue_id: env.LINEAR_ISSUE_ID,
    issue_title: env.LINEAR_ISSUE_TITLE,
    job_id: env.JOB_ID,
  };

  // Branch: a follow-up reuses its branch; a fresh run prefers Linear's own branch
  // name (so the PR auto-links), else the prefix + generated name.
  let branch;
  if (env.CONTINUATION_BRANCH) {
    branch = env.CONTINUATION_BRANCH;
  } else {
    branch =
      env.LINEAR_BRANCH_NAME ||
      sanitizeBranchName(env.LINEAR_ISSUE_ID, env.RUN_ID, env.RUN_ATTEMPT, env.BRANCH_PREFIX || "odin/");
    await checkoutNewBranch(branch);
  }

  // Commit / PR title / PR body: the agent's convention-aware values (from
  // .odin/result.json) win, else the per-repo input template, else the default.
  const commitMessage =
    text(result.commitMessage) ||
    renderTemplate(env.COMMIT_MESSAGE || "{{issue_id}}: {{issue_title}}", vars);
  const prTitle =
    text(result.prTitle) ||
    renderTemplate(env.PR_TITLE || "{{issue_id}}: {{issue_title}}", vars);
  const prBody = text(result.prBody) || buildPrBody(env.LINEAR_ISSUE_ID);

  await commitAll(commitMessage);
  await pushBranch(branch);

  // A continuation already has an open PR on its branch — reuse it; a fresh run
  // finds none, so it opens a draft PR.
  let prUrl = await findOpenPr(branch);
  if (!prUrl) {
    prUrl = await createDraftPr({
      base,
      head: branch,
      title: prTitle,
      body: prBody,
      tmpDir: env.RUNNER_TEMP || ".",
    });
  }

  await sendCallback({ ...env, STATUS: "completed", PR_URL: prUrl }, result);
}

// Enforced build/lint/test gate, mirroring the persistent worker. Runs every
// configured check so all failures are visible, then throws if any failed.
async function runChecks() {
  const checks = selectChecks({
    lint: env.LINT_CMD,
    build: env.BUILD_CMD,
    test: env.TEST_CMD,
  });
  if (!checks.length) {
    console.log("No repository checks configured; skipping gate.");
    return;
  }

  const failed = [];
  for (const { name, cmd } of checks) {
    console.log(`::group::${name}: ${cmd}`);
    try {
      await runShell(cmd);
    } catch {
      failed.push(name);
      console.log(`::error::${name} check failed: ${cmd}`);
    }
    console.log("::endgroup::");
  }
  if (failed.length) {
    throw new Error(`Repository checks failed: ${failed.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
