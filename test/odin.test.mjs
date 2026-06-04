import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import {
  buildCallbackPayload,
  failureSummary,
  sanitizeBranchName,
  signBody,
} from "../lib/odin.mjs";

test("failureSummary: names the failed stage", () => {
  assert.match(failureSummary({ PREPARE_OUTCOME: "failure" }), /Setup failed/);
  assert.match(
    failureSummary({ PREPARE_OUTCOME: "success", CLAUDE_OUTCOME: "failure" }),
    /coding agent hit an error/,
  );
  assert.match(
    failureSummary({
      PREPARE_OUTCOME: "success",
      CLAUDE_OUTCOME: "success",
      FINALIZE_OUTCOME: "failure",
    }),
    /branch push/,
  );
  assert.match(failureSummary({}), /The run failed before finishing/);
});

test("buildCallbackPayload: carries runUrl from RUN_URL", () => {
  const payload = buildCallbackPayload({
    GITHUB_REPOSITORY: "acme/widgets",
    RUN_URL: "https://github.com/acme/widgets/actions/runs/42",
  });
  assert.equal(payload.runUrl, "https://github.com/acme/widgets/actions/runs/42");
});

test("buildCallbackPayload: transport fields override what the agent wrote", () => {
  const env = {
    GITHUB_REPOSITORY: "acme/widgets",
    MODE: "implement",
    STATUS: "completed",
    PR_URL: "https://github.com/acme/widgets/pull/7",
    JOB_ID: "job-1",
    LINEAR_ISSUE_ID: "OPS-12",
    RUN_ID: "99",
    RUN_ATTEMPT: "1",
  };
  const result = { status: "needs_clarification", summary: "agent text", answer: "hi" };
  const payload = buildCallbackPayload(env, result);

  assert.equal(payload.status, "completed"); // env wins over result
  assert.equal(payload.pullRequestUrl, "https://github.com/acme/widgets/pull/7");
  assert.deepEqual(payload.repository, { owner: "acme", repo: "widgets" });
  assert.equal(payload.jobId, "job-1");
  assert.equal(payload.linearIssueId, "OPS-12");
  assert.deepEqual(payload.workflowRun, { id: "99", attempt: "1" });
  assert.equal(payload.answer, "hi"); // agent fields still forwarded
});

test("buildCallbackPayload: read-only result falls back to the agent's status", () => {
  const env = { GITHUB_REPOSITORY: "a/b", MODE: "verify" };
  const payload = buildCallbackPayload(env, { status: "completed", findings: [{ note: "x" }] });
  assert.equal(payload.status, "completed");
  assert.equal(payload.mode, "verify");
  assert.equal(payload.findings.length, 1);
});

test("buildCallbackPayload: QUESTIONS env parses to an array when result has none", () => {
  const env = { GITHUB_REPOSITORY: "a/b", QUESTIONS: '["why?","where?"]' };
  const payload = buildCallbackPayload(env, {});
  assert.deepEqual(payload.questions, ["why?", "where?"]);
});

test("signBody: matches a known HMAC-SHA256 and is prefixed", () => {
  const expected = `sha256=${createHmac("sha256", "secret").update("body").digest("hex")}`;
  assert.equal(signBody("body", "secret"), expected);
  assert.match(signBody("body", "secret"), /^sha256=[0-9a-f]{64}$/);
});

test("signBody: different secrets produce different signatures", () => {
  assert.notEqual(signBody("body", "s1"), signBody("body", "s2"));
});


test("sanitizeBranchName: lowercases, collapses, and trims (fallback only)", () => {
  assert.equal(sanitizeBranchName("OPS-12", "99", "1"), "odin/ops-12-99-1");
  assert.equal(sanitizeBranchName("Feat/AB 3!!", "7", "2"), "odin/feat-ab-3-7-2");
  assert.equal(sanitizeBranchName("--X--", "1", "1"), "odin/x-1-1");
});

test("buildCallbackPayload: extra (branch/base) is merged into the payload", () => {
  const p = buildCallbackPayload({ GITHUB_REPOSITORY: "a/b", MODE: "implement" }, {}, { branch: "odin/x", base: "main" });
  assert.equal(p.branch, "odin/x");
  assert.equal(p.base, "main");
});
