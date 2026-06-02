// Pre-Claude step: validate the prompt, check out the continuation branch, and
// install dependencies. Runs before claude-code-action. Any failure here exits
// non-zero, so the action's `if: failure()` step reports "failed" to Odin.
import { runShell } from "./lib/exec.mjs";
import { continuationCheckout } from "./lib/git.mjs";
import { downloadIssueImages } from "./lib/images.mjs";

const env = process.env;

async function main() {
  // The prompt is required — fail fast (cheapest check first).
  if (!env.AGENT_PROMPT || !env.AGENT_PROMPT.trim()) {
    throw new Error("Missing agent_prompt. Trigger this workflow through Odin.");
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

  // Install dependencies (the repo's command from its Odin route project memory).
  // Skipped when unset — some repos need no install.
  if (env.INSTALL_CMD && env.INSTALL_CMD.trim()) {
    console.log(`Installing dependencies: ${env.INSTALL_CMD}`);
    await runShell(env.INSTALL_CMD);
  } else {
    console.log("No install command configured; skipping.");
  }
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
