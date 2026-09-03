import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDataset } from "./dataset.js";

async function withDataset(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "caption-tui-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content);
    }
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("images with the same basename share one caption file", async () => {
  // image1.jpg and image1.png both resolve to image1.txt.
  await withDataset(
    {
      "image1.jpg": "",
      "image1.png": "",
      "image1.txt": "a shared caption",
      "zebra.png": "",
      "zebra.txt": "its own caption",
    },
    async (dir) => {
      const entries = await loadDataset(dir);
      const shared = entries.filter((e) =>
        e.captionPath.endsWith("image1.txt"),
      );

      assert.equal(shared.length, 2);
      assert.equal(shared[0]?.captionPath, shared[1]?.captionPath);
      for (const entry of shared) {
        assert.equal(entry.caption, "a shared caption");
      }
    },
  );
});

test("colliding basenames are qualified with their extension", async () => {
  // Two rows both reading "image1" make the shared caption file invisible.
  await withDataset(
    {
      "image1.jpg": "",
      "image1.png": "",
      "image1.txt": "a shared caption",
      "zebra.png": "",
      "zebra.txt": "its own caption",
    },
    async (dir) => {
      const entries = await loadDataset(dir);
      assert.deepEqual(
        entries.map((e) => e.name),
        ["image1.jpg", "image1.png", "zebra"],
      );
    },
  );
});

test("a basename that doesn't collide keeps its bare name", async () => {
  await withDataset(
    { "solo.png": "", "solo.txt": "just the one" },
    async (dir) => {
      const entries = await loadDataset(dir);
      assert.deepEqual(
        entries.map((e) => e.name),
        ["solo"],
      );
    },
  );
});

test("a missing caption file loads as an empty caption", async () => {
  await withDataset({ "nocaption.png": "" }, async (dir) => {
    const entries = await loadDataset(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.caption, "");
    assert.deepEqual(entries[0]?.tags, []);
  });
});
