// Catch-all failure reporter: runs (via the action's `if: failure()` step) when a
// prior step — setup, Claude, or push — failed. Tells Odin the run
// failed so the session resolves instead of hanging.
import { failureSummary, readResult, sendCallback } from "./odin.mjs";

const env = process.env;

sendCallback(
  {
    ...env,
    STATUS: "failed",
    // Name the stage that failed (setup / agent / finalize) instead of a generic
    // "the run failed". The run URL rides along via RUN_URL for the comment.
    SUMMARY: failureSummary(env),
  },
  readResult(),
).catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
