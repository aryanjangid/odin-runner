// Pre-Claude step: validate the prompt and check out the continuation branch.
// Any failure here exits non-zero, so the action's `if: failure()` step reports
// "failed" to Odin.
import { appendFileSync } from "node:fs";

import { continuationCheckout } from "./lib/git.mjs";
import { downloadIssueImages } from "./lib/images.mjs";
import {
  brokerUrlFromCallback,
  fetchRunnerConfig,
} from "./lib/runner-config.mjs";
import { hasResumableSession } from "./lib/session.mjs";

const env = process.env;

// Mask a secret in the logs, then expose it to later steps via $GITHUB_ENV.
function exportSecret(name, value) {
  console.log(`::add-mask::${value}`);
  if (env.GITHUB_ENV) {
    appendFileSync(env.GITHUB_ENV, `${name}=${value}\n`);
  }
}

// Resolve the Anthropic key + callback secret. If the repo set them itself, use
// those (bring-your-own-key). Otherwise borrow them from Odin's broker — which
// shares the Anthropic key only for admin-approved repos. Fails early with a clear
// message when a repo has neither its own key nor approval.
async function resolveCredentials() {
  const ownAnthropic = (env.ANTHROPIC_API_KEY_INPUT || "").trim();
  const ownCallback = (env.CALLBACK_SECRET_INPUT || "").trim();
  if (ownAnthropic && ownCallback) {
    return; // fully self-provisioned — nothing to borrow
  }

  let config;
  try {
    config = await fetchRunnerConfig(
      brokerUrlFromCallback(env.CALLBACK_URL),
      env.JOB_ID,
    );
  } catch (error) {
    throw new Error(`Could not reach Odin for run config: ${error.message}`);
  }

  if (!ownCallback) {
    if (!config.callbackSecret) {
      throw new Error("Odin did not return a callback secret.");
    }
    exportSecret("RESOLVED_CALLBACK_SECRET", config.callbackSecret);
  }

  if (!ownAnthropic) {
    if (config.approved && config.anthropicApiKey) {
      exportSecret("RESOLVED_ANTHROPIC_KEY", config.anthropicApiKey);
      console.log("Using Odin's shared Anthropic key (repo is approved).");
    } else {
      // Surface a friendly reason in the Linear failure comment, then fail.
      const message =
        `No Anthropic key available: ${config.reason || "this repo isn't approved for Odin's shared key"}. ` +
        "Add an ANTHROPIC_API_KEY secret to this repo, or ask the admin to approve it.";
      if (env.GITHUB_ENV) {
        appendFileSync(env.GITHUB_ENV, `SETUP_ERROR=${message}\n`);
      }
      throw new Error(message);
    }
  }
}

async function main() {
  // The prompt is required — fail fast (cheapest check first).
  if (!env.AGENT_PROMPT || !env.AGENT_PROMPT.trim()) {
    throw new Error("Missing agent_prompt. Trigger this workflow through Odin.");
  }

  // Resolve credentials (own secrets or Odin's shared key) before any real work.
  await resolveCredentials();

  // 1 Linear ticket = 1 Claude session. If the cache restored this ticket's prior
  // session, tell the Claude step to `--continue` it (set as a step env the
  // workflow appends to claude_args) so the agent keeps its understanding of the
  // repo instead of re-exploring. Opportunistic — no session means a fresh run.
  if (await hasResumableSession()) {
    if (env.GITHUB_ENV) {
      appendFileSync(env.GITHUB_ENV, "CLAUDE_RESUME_ARGS=--continue\n");
    }
    console.log("Found this ticket's Claude session — will --continue it.");
  } else {
    console.log("No prior Claude session for this ticket — starting fresh.");
  }

  // Pasted Linear images: download them to the local paths the prompt references
  // (Odin already rewrote the markdown to those paths) so Claude can Read them.
  const savedImages = await downloadIssueImages(env.IMAGES_JSON);
  if (savedImages > 0) {
    console.log(`Downloaded ${savedImages} Linear image(s) for the agent.`);
  }

  // Continuation: edit on top of the existing PR branch instead of the base.
  if (env.CONTINUATION_BRANCH) {
    console.log(`Checking out continuation branch ${env.CONTINUATION_BRANCH}.`);
    await continuationCheckout(env.CONTINUATION_BRANCH);
  }
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
