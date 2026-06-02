import { writeFileSync } from "node:fs";
import path from "node:path";

import { capture } from "./exec.mjs";

// The open PR URL for a branch, or "" if none. Never throws (matches `|| true`).
export async function findOpenPr(branch) {
  try {
    return await capture("gh", [
      "pr", "list", "--head", branch, "--state", "open", "--json", "url", "--jq", ".[0].url",
    ]);
  } catch {
    return "";
  }
}

// Open a draft PR and return its URL.
export async function createDraftPr({ base, head, title, body, tmpDir }) {
  const bodyFile = path.join(tmpDir, "odin-pr-body.md");
  writeFileSync(bodyFile, body);
  return capture("gh", [
    "pr", "create", "--draft",
    "--base", base, "--head", head,
    "--title", title, "--body-file", bodyFile,
  ]);
}
