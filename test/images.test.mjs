import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { downloadIssueImages } from "../lib/images.mjs";

test("downloadIssueImages: empty / missing manifest is a no-op", async () => {
  assert.equal(await downloadIssueImages(undefined), 0);
  assert.equal(await downloadIssueImages(""), 0);
  assert.equal(await downloadIssueImages("[]"), 0);
});

test("downloadIssueImages: malformed JSON is non-fatal and downloads nothing", async () => {
  assert.equal(await downloadIssueImages("{not json"), 0);
});

test("downloadIssueImages: a failed fetch skips the image without throwing", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  try {
    const saved = await downloadIssueImages(
      JSON.stringify([{ url: "https://odin.example/api/issue-image?x", path: ".odin/images/a.png" }]),
    );
    assert.equal(saved, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("downloadIssueImages: writes fetched bytes to the manifest path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "odin-img-"));
  const path = join(dir, "nested", "linear-image-0.png");
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode("PNGDATA").buffer,
  });
  try {
    const saved = await downloadIssueImages(
      JSON.stringify([{ url: "https://odin.example/api/issue-image?x", path }]),
    );
    assert.equal(saved, 1);
    assert.equal(await readFile(path, "utf8"), "PNGDATA");
  } finally {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  }
});
