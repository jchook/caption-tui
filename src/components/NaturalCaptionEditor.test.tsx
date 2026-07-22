import { expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { ImageEntry } from "../utils/dataset.js";
import { NaturalCaptionEditor } from "./NaturalCaptionEditor.js";

const entry: ImageEntry = {
  name: "img_003",
  imagePath: "/tmp/img_003.png",
  captionPath: "/tmp/img_003.txt",
  tags: [],
  caption: "",
};

const flush = () => new Promise((r) => setTimeout(r, 15));

test("typed characters accumulate into prose and save on Esc", async () => {
  const captured: { saved: string | null } = { saved: null };

  const { stdin } = render(
    <NaturalCaptionEditor
      entry={entry}
      vocabulary={new Set()}
      onSave={(caption) => {
        captured.saved = caption;
      }}
      onNext={() => {}}
      onPrev={() => {}}
      onClose={() => {}}
    />,
  );

  await flush();
  for (const ch of "a red car") {
    stdin.write(ch);
    await flush();
  }
  stdin.write("\x1b"); // Esc -> save & close
  await flush();

  expect(captured.saved).toBe("a red car");
});

test("Tab completes the current word from the vocabulary", async () => {
  const captured: { saved: string | null } = { saved: null };

  const { stdin } = render(
    <NaturalCaptionEditor
      entry={entry}
      vocabulary={new Set(["beautiful", "beach"])}
      onSave={(caption) => {
        captured.saved = caption;
      }}
      onNext={() => {}}
      onPrev={() => {}}
      onClose={() => {}}
    />,
  );

  await flush();
  for (const ch of "beau") {
    stdin.write(ch);
    await flush();
  }
  stdin.write("\t"); // Tab -> accept "beautiful" (adds a trailing space)
  await flush();
  stdin.write("\x1b");
  await flush();

  // The editor keeps the trailing space so prose keeps flowing; the app
  // trims it when persisting to disk (saveCaption).
  expect(captured.saved).toBe("beautiful ");
});

test("Enter saves the current caption and advances", async () => {
  const captured: { saved: string | null; nexts: number } = {
    saved: null,
    nexts: 0,
  };

  const { stdin } = render(
    <NaturalCaptionEditor
      entry={entry}
      vocabulary={new Set()}
      onSave={(caption) => {
        captured.saved = caption;
      }}
      onNext={() => {
        captured.nexts++;
      }}
      onPrev={() => {}}
      onClose={() => {}}
    />,
  );

  await flush();
  for (const ch of "hello") {
    stdin.write(ch);
    await flush();
  }
  stdin.write("\r"); // Enter -> save & next
  await flush();

  expect(captured.saved).toBe("hello");
  expect(captured.nexts).toBe(1);
});
