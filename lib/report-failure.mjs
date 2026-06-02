// Catch-all failure reporter: runs (via the action's `if: failure()` step) when a
// prior step — install, Claude, checks, or push — failed. Tells Odin the run
// failed so the session resolves instead of hanging.
import { readResult, sendCallback } from "./odin.mjs";

const env = process.env;

sendCallback(
  {
    ...env,
    STATUS: "failed",
    SUMMARY:
      env.SUMMARY || "The GitHub Actions run failed. See the run logs for details.",
  },
  readResult(),
).catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
