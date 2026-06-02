import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Claude Code stores each conversation as ~/.claude/projects/<encoded-cwd>/<id>.jsonl.
// The action.yml cache step restores this dir per Linear ticket before the run, so
// a follow-up can `--continue` the SAME session instead of re-exploring the repo
// from scratch — the "1 Linear ticket = 1 Claude session" goal.
//
// This returns true only if a session file was actually restored. Resuming is
// OPPORTUNISTIC: if the cache missed (first run, or evicted after ~7 idle days) we
// start fresh and the full prompt still carries all the context — never starved.
export async function hasResumableSession(home = homedir()) {
  const projectsDir = join(home, ".claude", "projects");
  let projects;
  try {
    projects = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return false; // ~/.claude/projects doesn't exist — nothing to resume
  }
  for (const entry of projects) {
    if (!entry.isDirectory()) continue;
    try {
      const files = await readdir(join(projectsDir, entry.name));
      if (files.some((file) => file.endsWith(".jsonl"))) {
        return true;
      }
    } catch {
      // unreadable project dir — skip
    }
  }
  return false;
}
