import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// The agent writes its outcome to .odin/result.json (status, answer, findings,
// checks, questions...). Best-effort read — returns {} when absent/invalid.
export function readResult(cwd = process.cwd()) {
  try {
    return JSON.parse(readFileSync(path.join(cwd, ".odin", "result.json"), "utf8"));
  } catch {
    return {};
  }
}

// Build the body Odin's /api/agent-result expects. PURE: (env, result, extra) ->
// object. The agent's fields are forwarded, then the transport-known fields
// (status, PR, job, issue) override them; `extra` (e.g. branch/base for the
// server to open the PR) is merged last.
export function buildCallbackPayload(env, result = {}, extra = {}) {
  const [owner, repo] = (env.GITHUB_REPOSITORY || "/").split("/");
  const questions = result.questions
    ? result.questions
    : env.QUESTIONS
      ? JSON.parse(env.QUESTIONS)
      : undefined;
  return {
    ...result,
    mode: env.MODE || result.mode,
    status: env.STATUS || result.status || "completed",
    summary: env.SUMMARY || result.summary,
    questions,
    pullRequestUrl: env.PR_URL || result.pullRequestUrl,
    jobId: env.JOB_ID || undefined,
    linearIssueId: env.LINEAR_ISSUE_ID || undefined,
    repository: { owner, repo },
    workflowRun: { id: env.RUN_ID, attempt: env.RUN_ATTEMPT },
    runUrl: env.RUN_URL || result.runUrl,
    ...extra,
  };
}

// Turn the failed step's outcome into a human summary that names the STAGE, so
// Odin posts "the checks failed" / "the agent errored" instead of a generic "the
// run failed". PURE: reads the *_OUTCOME envs the action.yml failure step passes.
export function failureSummary(env = {}) {
  if (env.PREPARE_OUTCOME === "failure") {
    return "Setup failed before the agent ran — dependency install, branch checkout, or image download. Check the run logs.";
  }
  if (env.CLAUDE_OUTCOME === "failure") {
    return "The coding agent hit an error before it could finish. Check the run logs.";
  }
  if (env.FINALIZE_OUTCOME === "failure") {
    return "The change was made, but the pre-PR checks (build / lint / test) or the branch push failed. Check the run logs.";
  }
  return env.SUMMARY || "The run failed before finishing. Check the run logs.";
}

// HMAC-SHA256 over the exact body bytes, in the `sha256=<hex>` form Odin verifies.
export function signBody(body, secret) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// Sign and POST the result to Odin. Throws on missing config or a non-2xx reply.
export async function sendCallback(env, result = {}, extra = {}) {
  const url = env.CALLBACK_URL;
  const secret = env.CALLBACK_SECRET;
  if (!url || !secret) {
    throw new Error("CALLBACK_URL and CALLBACK_SECRET are required.");
  }
  const body = JSON.stringify(buildCallbackPayload(env, result, extra));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-odin-signature": signBody(body, secret),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Odin callback failed: ${res.status} ${await res.text()}`);
  }
  const status = JSON.parse(body).status;
  console.log(`Reported ${status} to Odin.`);
  return status;
}

// Which checks to actually run — skip any command that is unset/blank. PURE.
export function selectChecks(commands = {}) {
  return [
    { name: "lint", cmd: commands.lint },
    { name: "build", cmd: commands.build },
    { name: "test", cmd: commands.test },
  ].filter((check) => Boolean(check.cmd && String(check.cmd).trim()));
}

// Fallback branch name for a fresh run when Linear's own branch name is absent
// (e.g. a manual workflow_dispatch). PURE: lowercase the issue id, collapse non
// [a-z0-9._-] runs to '-', trim dashes, e.g. ("OPS-12", "99", "1") -> "odin/ops-12-99-1".
export function sanitizeBranchName(issueId, runId, runAttempt) {
  const safe = String(issueId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `odin/${safe}-${runId}-${runAttempt}`;
}
