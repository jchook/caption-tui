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

test("typed characters accumulate and save (a render between every key)", async () => {
  const captured: { saved: string[] | null } = { saved: null };

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

test("a run carrying its own separators commits each tag", async () => {
  // "red,blue\r" used to arrive as one event and become the single bogus tag
  // "red,blue" -- the comma and the Enter were never given their meaning.
  const captured: { saved: string[] | null } = { saved: null };

  const { stdin } = render(
    <CaptionEditor
      entry={{ ...entry, tags: [] }}
      allTags={new Set<string>()}
      onSave={(tags) => {
        captured.saved = tags;
      }}
      onNext={() => {}}
      onPrev={() => {}}
      onClose={() => {}}
    />,
  );

  await flush();
  stdin.write("red,blue\r");
  await flush();
  stdin.write("\u001B"); // Esc -> save and close
  await flush();

  assert.deepEqual(captured.saved, ["red", "blue"]);
});

test("a run accepts suggestions against the text typed inside that same run", async () => {
  // The suggestion list this render computed predates the run's own text, so
  // the Enter has to be resolved against the live draft.
  const captured: { saved: string[] | null } = { saved: null };

  const { stdin } = render(
    <CaptionEditor
      entry={{ ...entry, tags: [] }}
      allTags={new Set(["sunset", "sunlight"])}
      onSave={(tags) => {
        captured.saved = tags;
      }}
      onNext={() => {}}
      onPrev={() => {}}
      onClose={() => {}}
    />,
  );

  await flush();
  stdin.write("suns\r");
  await flush();
  stdin.write("\u001B");
  await flush();

  assert.deepEqual(captured.saved, ["sunset"]);
});
