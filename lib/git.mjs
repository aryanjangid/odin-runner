import { capture, run } from "./exec.mjs";

// Check out an existing PR branch so a follow-up edits on top of prior work.
export async function continuationCheckout(branch) {
  await run("git", ["fetch", "origin", branch]);
  await run("git", ["checkout", "-B", branch, `origin/${branch}`]);
}

export async function hasChanges() {
  const out = await capture("git", ["status", "--porcelain"]);
  return out.length > 0;
}

export async function configIdentity() {
  await run("git", ["config", "user.name", "odin[bot]"]);
  await run("git", ["config", "user.email", "odin[bot]@users.noreply.github.com"]);
}

// The repo's real default branch (main / master / develop / ...); falls back to main.
export async function defaultBranch() {
  try {
    return await capture("gh", [
      "repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name",
    ]);
  } catch {
    return "main";
  }
}

// -B (not -b) so a stable Linear branch name that already exists locally is reset
// to HEAD rather than failing — a fresh run always starts from the checked-out base.
export async function checkoutNewBranch(branch) {
  await run("git", ["checkout", "-B", branch]);
}

// Stage everything (-A includes Claude's deletions; .odin is removed beforehand).
export async function commitAll(message) {
  await run("git", ["add", "-A"]);
  await run("git", ["commit", "-m", message]);
}

export async function pushBranch(branch) {
  await run("git", ["push", "origin", `HEAD:${branch}`]);
}
