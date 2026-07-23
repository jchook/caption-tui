import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "ink-testing-library";
import type { ImageEntry } from "../utils/dataset.js";
import { CaptionEditor } from "./CaptionEditor.js";

const entry: ImageEntry = {
  name: "img_003",
  imagePath: "/tmp/img_003.png",
  captionPath: "/tmp/img_003.txt",
  tags: ["person", "portrait", "outdoors"],
  caption: "person, portrait, outdoors",
};

const flush = () => new Promise((r) => setTimeout(r, 15));

test("typed characters accumulate and save (no dropped keys with onActivity)", async () => {
  const captured: { saved: string[] | null } = { saved: null };
  let activity = 0;

  const { stdin } = render(
    <CaptionEditor
      entry={entry}
      allTags={new Set(["person", "portrait", "outdoors"])}
      onSave={(tags) => {
        captured.saved = tags;
      }}
      onNext={() => {}}
      onPrev={() => {}}
      onClose={() => {}}
      onActivity={() => {
        activity++;
      }}
    />,
  );

  await flush();
  // Type a novel tag one key at a time (won't match any suggestion).
  for (const ch of "zzq") {
    stdin.write(ch);
    await flush();
  }
  stdin.write("\r"); // Enter -> add current tag
  await flush();
  stdin.write("\x1b"); // Esc -> save & close
  await flush();

  assert.notEqual(captured.saved, null);
  assert.deepEqual(captured.saved, ["person", "portrait", "outdoors", "zzq"]);
  // onActivity fires on every keypress (z, z, q, Enter, Esc = 5).
  assert.equal(activity, 5);
});

test("rapid typing (no render between keys) keeps every character", async () => {
  const captured: { saved: string[] | null } = { saved: null };
  const { stdin } = render(
    <CaptionEditor
      entry={{ ...entry, tags: [] }}
      allTags={new Set()}
      onSave={(tags) => {
        captured.saved = tags;
      }}
      onNext={() => {}}
      onPrev={() => {}}
      onClose={() => {}}
    />,
  );

  await flush();
  // Write each key back-to-back without awaiting a re-render between them.
  for (const ch of "sunset") stdin.write(ch);
  await flush();
  stdin.write("\x1b"); // Esc -> save pending tag
  await flush();

  assert.deepEqual(captured.saved, ["sunset"]);
});

test("comma commits a tag mid-stream", async () => {
  const captured: { saved: string[] | null } = { saved: null };
  const { stdin } = render(
    <CaptionEditor
      entry={{ ...entry, tags: [] }}
      allTags={new Set()}
      onSave={(tags) => {
        captured.saved = tags;
      }}
      onNext={() => {}}
      onPrev={() => {}}
      onClose={() => {}}
    />,
  );

  await flush();
  for (const ch of "sky") {
    stdin.write(ch);
    await flush();
  }
  stdin.write(","); // commit "sky"
  await flush();
  for (const ch of "sea") {
    stdin.write(ch);
    await flush();
  }
  stdin.write("\x1b"); // Esc saves "sky" + pending "sea"
  await flush();

  assert.deepEqual(captured.saved, ["sky", "sea"]);
});
