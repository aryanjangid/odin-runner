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

// Build the body Odin's /api/agent-result expects. PURE: (env, result) -> object.
// The agent's fields are forwarded, then the transport-known fields (status, PR,
// job, issue) override them so read-only results render but state stays correct.
export function buildCallbackPayload(env, result = {}) {
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
  };
}

// HMAC-SHA256 over the exact body bytes, in the `sha256=<hex>` form Odin verifies.
export function signBody(body, secret) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// Sign and POST the result to Odin. Throws on missing config or a non-2xx reply.
export async function sendCallback(env, result = {}) {
  const url = env.CALLBACK_URL;
  const secret = env.CALLBACK_SECRET;
  if (!url || !secret) {
    throw new Error("CALLBACK_URL and CALLBACK_SECRET are required.");
  }
  const body = JSON.stringify(buildCallbackPayload(env, result));
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

// Branch name for a fresh run. PURE + deterministic. The issue id is lowercased,
// non [a-z0-9._-] runs collapse to '-', and leading/trailing dashes are trimmed.
// `prefix` is used exactly as given, so both "odin/" and "claude-" styles work,
// e.g. ("OPS-12", "99", "1", "feature/") -> "feature/ops-12-99-1".
export function sanitizeBranchName(issueId, runId, runAttempt, prefix = "odin/") {
  const safe = String(issueId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}${safe}-${runId}-${runAttempt}`;
}

// Fill {{issue_id}} / {{issue_title}} / {{job_id}} (and any provided var) in a
// template string. Unknown placeholders are left as-is. PURE.
export function renderTemplate(template, vars = {}) {
  return String(template ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    vars[key] != null ? String(vars[key]) : match,
  );
}

// The draft PR body for a fresh run. PURE.
export function buildPrBody(issueId) {
  return [
    "## Linear",
    "",
    `- Issue: ${issueId}`,
    "",
    "## Summary",
    "",
    "Claude Code implemented the requested ticket. Review the diff before marking ready.",
  ].join("\n");
}
