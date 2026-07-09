import { expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { ImageEntry } from "../utils/dataset.js";
import { CaptionEditor } from "./CaptionEditor.js";

const entry: ImageEntry = {
  name: "img_003",
  imagePath: "/tmp/img_003.png",
  captionPath: "/tmp/img_003.txt",
  tags: ["person", "portrait", "outdoors"],
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

  expect(captured.saved).not.toBeNull();
  expect(captured.saved).toEqual(["person", "portrait", "outdoors", "zzq"]);
  // onActivity fires on every keypress (z, z, q, Enter, Esc = 5).
  expect(activity).toBe(5);
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

  expect(captured.saved).toEqual(["sky", "sea"]);
});
