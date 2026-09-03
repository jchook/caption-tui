import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ImageEntry } from "./dataset.js";
import {
  describeError,
  filesToRemove,
  permanentlyDelete,
  removeEntryAt,
} from "./deleteEntry.js";

// Note: nothing here calls moveToTrash -- a test suite has no business putting
// files in the developer's real trash. The trash path is one `trash()` call in
// deleteEntry.ts; the surrounding logic is what these cover.

function entry(name: string, ext: string): ImageEntry {
  return {
    name: `${name}.${ext}`,
    imagePath: `/d/${name}.${ext}`,
    captionPath: `/d/${name}.txt`,
    tags: [],
    caption: "",
  };
}

test("removing an image takes its caption with it", () => {
  const solo = entry("solo", "png");
  assert.deepEqual(filesToRemove([solo], solo), ["/d/solo.png", "/d/solo.txt"]);
});

test("a caption shared with another image is left in place", () => {
  // solo.jpg and solo.png both point at solo.txt; the row that survives still
  // needs the caption.
  const jpg = entry("solo", "jpg");
  const png = entry("solo", "png");
  assert.deepEqual(filesToRemove([jpg, png], png), ["/d/solo.png"]);
  assert.deepEqual(filesToRemove([jpg, png], jpg), ["/d/solo.jpg"]);
});

test("removeEntryAt keeps the cursor on the same row", () => {
  const entries = [entry("a", "png"), entry("b", "png"), entry("c", "png")];

  const middle = removeEntryAt(entries, 1);
  assert.deepEqual(
    middle.entries.map((e) => e.name),
    ["a.png", "c.png"],
  );
  // Row 1 is now what used to be "c" -- deleting repeatedly works down the list.
  assert.equal(middle.selectedIndex, 1);
});

test("removeEntryAt falls back to the new last row when the tail goes", () => {
  const entries = [entry("a", "png"), entry("b", "png")];
  assert.equal(removeEntryAt(entries, 1).selectedIndex, 0);
});

test("removeEntryAt survives emptying the list", () => {
  const only = removeEntryAt([entry("a", "png")], 0);
  assert.deepEqual(only.entries, []);
  assert.equal(only.selectedIndex, 0);
});

test("permanentlyDelete unlinks the files and ignores missing ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "caption-tui-del-"));
  try {
    const image = join(dir, "gone.png");
    const caption = join(dir, "gone.txt");
    await writeFile(image, "");
    await writeFile(caption, "a caption");

    await permanentlyDelete([image, caption, join(dir, "never-existed.txt")]);

    assert.equal(existsSync(image), false);
    assert.equal(existsSync(caption), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("describeError prefers an Error's message", () => {
  assert.equal(describeError(new Error("no trash dir")), "no trash dir");
  assert.equal(describeError("plain string"), "plain string");
  assert.equal(describeError(new Error("")), "Error");
});
