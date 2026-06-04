// Post-Claude step: read the agent result, then branch on mode —
//   needs_clarification -> report, no PR
//   read-only (inspect/verify) -> report answer/findings, no PR
//   write (implement/revise) -> commit/push branch; Odin watches repo CI
// On any internal error this exits non-zero WITHOUT reporting, so the action's
// `if: failure()` step reports a single "failed" to Odin (no double callback).
import { rmSync } from "node:fs";

import {
  readResult,
  sendCallback,
  sanitizeBranchName,
} from "./lib/odin.mjs";
import {
  checkoutNewBranch,
  commitAll,
  configIdentity,
  hasChanges,
  pushBranch,
} from "./lib/git.mjs";

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

  // 2. Read-only modes — report the answer/findings the agent wrote.
  if (readOnly) {
    await sendCallback(env, result);
    return;
  }

  // 3. Write modes: commit + push. Odin's server opens
  // the draft PR with the GitHub App token (so PR creation never depends on the
  // repo's Actions "create and approve pull requests" permission).
  // Drop Odin's scratch dir so it never lands in the PR and doesn't mask the
  // no-change check below (target repos don't gitignore .odin/).
  rmSync(".odin", { recursive: true, force: true });

  const base = text(env.BASE_BRANCH) || "main";

  if (!(await hasChanges())) {
    // A follow-up already applied is a graceful no-op, not a failure — Odin keeps
    // the existing PR for the continuation branch.
    if (env.CONTINUATION_BRANCH) {
      console.log("Continuation already satisfied — no file changes needed.");
      await sendCallback({ ...env, STATUS: "completed" }, result, {
        branch: env.CONTINUATION_BRANCH,
        base,
      });
      return;
    }
    throw new Error("Claude finished without file changes.");
  }

  await configIdentity();

  // Branch: a follow-up reuses its branch; a fresh run prefers Linear's own branch
  // name (so the PR auto-links), else a generated fallback.
  let branch;
  if (env.CONTINUATION_BRANCH) {
    branch = env.CONTINUATION_BRANCH;
  } else {
    branch =
      env.LINEAR_BRANCH_NAME ||
      sanitizeBranchName(env.LINEAR_ISSUE_ID, env.RUN_ID, env.RUN_ATTEMPT);
    await checkoutNewBranch(branch);
  }

  // Commit message: Claude authors it in .odin/result.json after reading the
  // repo's conventions. The fallback is defensive only; repos may enforce this
  // in CI. The PR title/body ride along in `result` for Odin's server to apply.
  const commitMessage =
    text(result.commitMessage) || `${env.LINEAR_ISSUE_ID}: ${env.LINEAR_ISSUE_TITLE}`;

  await commitAll(commitMessage);
  await pushBranch(branch);

  // Report the pushed branch; Odin's server opens/updates the draft PR.
  await sendCallback({ ...env, STATUS: "completed" }, result, { branch, base });
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
