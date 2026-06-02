import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Download pasted Linear images that Odin rewrote into the prompt. Each manifest
// entry maps a signed, auth-free Odin proxy URL to the local path the prompt
// references (under .odin/, which post.mjs wipes before committing), so Claude can
// `Read` the file. Failures are NON-FATAL — the run proceeds with less visual
// context rather than dying over one missing image.
export async function downloadIssueImages(imagesJson) {
  let images;
  try {
    images = JSON.parse(imagesJson || "[]");
  } catch {
    console.warn("::warning::Could not parse images manifest; skipping image download.");
    return 0;
  }
  if (!Array.isArray(images) || images.length === 0) {
    return 0;
  }

  let saved = 0;
  for (const entry of images) {
    const url = entry?.url;
    const path = entry?.path;
    if (!url || !path) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`::warning::Image download failed (HTTP ${res.status}) for ${path}.`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buffer);
      console.log(`Saved Linear image -> ${path} (${buffer.length} bytes)`);
      saved += 1;
    } catch (error) {
      console.warn(`::warning::Image download error for ${path}: ${error.message}`);
    }
  }
  return saved;
}
