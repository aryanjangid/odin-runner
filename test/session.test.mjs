import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { hasResumableSession } from "../lib/session.mjs";

test("hasResumableSession: false when ~/.claude/projects is absent", async () => {
  const home = await mkdtemp(join(tmpdir(), "odin-home-"));
  try {
    assert.equal(await hasResumableSession(home), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("hasResumableSession: false when a project dir has no .jsonl", async () => {
  const home = await mkdtemp(join(tmpdir(), "odin-home-"));
  try {
    await mkdir(join(home, ".claude", "projects", "repo-x"), { recursive: true });
    await writeFile(join(home, ".claude", "projects", "repo-x", "notes.txt"), "x");
    assert.equal(await hasResumableSession(home), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("hasResumableSession: true when a session .jsonl exists", async () => {
  const home = await mkdtemp(join(tmpdir(), "odin-home-"));
  try {
    const dir = join(home, ".claude", "projects", "-home-runner-work-repo-repo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "506699d7-b634.jsonl"), '{"type":"x"}\n');
    assert.equal(await hasResumableSession(home), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
