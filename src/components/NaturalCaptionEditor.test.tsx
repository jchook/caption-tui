import assert from "node:assert/strict";
import { test } from "node:test";
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

function mount(initial = "") {
  const captured: { saved: string | null; nexts: number; prevs: number } = {
    saved: null,
    nexts: 0,
    prevs: 0,
  };
  const { stdin } = render(
    <NaturalCaptionEditor
      entry={{ ...entry, caption: initial }}
      onSave={(caption) => {
        captured.saved = caption;
      }}
      onNext={() => {
        captured.nexts++;
      }}
      onPrev={() => {
        captured.prevs++;
      }}
      onClose={() => {}}
    />,
  );
  return { stdin, captured };
}

async function type(stdin: { write: (s: string) => void }, s: string) {
  for (const ch of s) {
    stdin.write(ch);
    await flush();
  }
}

test("typed characters accumulate into prose and save on Esc", async () => {
  const { stdin, captured } = mount();
  await flush();
  await type(stdin, "a red car");
  stdin.write("\x1b"); // Esc -> save & close
  await flush();
  assert.equal(captured.saved, "a red car");
});

test("rapid typing (no render between keys) keeps every character", async () => {
  const { stdin, captured } = mount();
  await flush();
  // Write each key back-to-back without awaiting a re-render between them, the
  // condition that made stale-closure state drop characters ("vew frm abov").
  for (const ch of "view from above") stdin.write(ch);
  await flush();
  stdin.write("\x1b");
  await flush();
  assert.equal(captured.saved, "view from above");
});

test("Enter saves the current caption and advances", async () => {
  const { stdin, captured } = mount();
  await flush();
  await type(stdin, "hello");
  stdin.write("\r"); // Enter -> save & next
  await flush();
  assert.equal(captured.saved, "hello");
  assert.equal(captured.nexts, 1);
});

test("Ctrl-A jumps to start; typing inserts there", async () => {
  const { stdin, captured } = mount();
  await flush();
  await type(stdin, "world");
  stdin.write("\x01"); // Ctrl-A -> home
  await flush();
  await type(stdin, "X");
  stdin.write("\x1b");
  await flush();
  assert.equal(captured.saved, "Xworld");
});

test("Ctrl-E jumps to end after Ctrl-A", async () => {
  const { stdin, captured } = mount();
  await flush();
  await type(stdin, "world");
  stdin.write("\x01"); // home
  await flush();
  stdin.write("\x05"); // Ctrl-E -> end
  await flush();
  await type(stdin, "!");
  stdin.write("\x1b");
  await flush();
  assert.equal(captured.saved, "world!");
});

test("Ctrl-W deletes the word before the cursor", async () => {
  const { stdin, captured } = mount();
  await flush();
  await type(stdin, "big red car");
  stdin.write("\x17"); // Ctrl-W -> delete "car" (leaves a trailing space)
  await flush();
  stdin.write("\x1b");
  await flush();
  // Editor keeps the trailing space; the app trims it on persist (saveCaption).
  assert.equal(captured.saved, "big red ");
});
