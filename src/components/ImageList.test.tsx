import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "ink-testing-library";
import { useState } from "react";
import type { ImageEntry } from "../utils/dataset.js";
import { ImageList } from "./ImageList.js";

const entries: ImageEntry[] = Array.from({ length: 100 }, (_, i) => ({
  name: `img_${String(i).padStart(3, "0")}`,
  imagePath: `/tmp/img_${i}.png`,
  captionPath: `/tmp/img_${i}.txt`,
  tags: ["person"],
  caption: "person",
}));

const PAGE_DOWN = "\u001B[6~";
const PAGE_UP = "\u001B[5~";
const CTRL_D = "\u0004";
const CTRL_U = "\u0015";
const CTRL_F = "\u0006";
const CTRL_B = "\u0002";

const flush = () => new Promise((r) => setTimeout(r, 20));

// Mirrors App: selection lives in the parent, ImageList drives it.
function Harness({ report }: { report: (i: number) => void }) {
  const [index, setIndex] = useState(0);
  report(index);
  return (
    <ImageList
      entries={entries}
      selectedIndex={index}
      onSelect={setIndex}
      onEdit={() => {}}
      maxVisible={20}
    />
  );
}

async function drive(chunks: string[]) {
  let index = 0;
  const { stdin, unmount } = render(
    <Harness
      report={(i) => {
        index = i;
      }}
    />,
  );
  await flush();
  for (const chunk of chunks) {
    stdin.write(chunk);
    await flush();
  }
  unmount();
  return index;
}

test("every keypress in one stdin chunk moves the selection", async () => {
  // The regression that made scrolling crawl over SSH: a blocking frame write
  // stalls the event loop, key repeats coalesce into a single chunk, and Ink
  // dispatches them all inside one React batch. Computing the next index from
  // the (stale) prop collapsed the whole burst into one row.
  assert.equal(await drive(["jjjjjjjjjj"]), 10);
});

test("burst movement matches the same keys delivered one at a time", async () => {
  const burst = await drive(["jjjjj"]);
  const singles = await drive(["j", "j", "j", "j", "j"]);
  assert.equal(burst, singles);
});

test("a mixed burst of down and up keys nets out correctly", async () => {
  assert.equal(await drive(["jjjjjkk"]), 3);
});

test("movement clamps at both ends of the list", async () => {
  assert.equal(await drive(["kkkkk"]), 0);
  assert.equal(await drive(["G", "jjjjj"]), 99);
});

test("PageDown/PageUp move a window at a time", async () => {
  assert.equal(await drive([PAGE_DOWN]), 19);
  assert.equal(await drive([PAGE_DOWN + PAGE_DOWN]), 38);
  assert.equal(await drive([PAGE_DOWN + PAGE_DOWN + PAGE_UP]), 19);
});

test("Ctrl-D/Ctrl-U move half a window, Ctrl-F/Ctrl-B a full one", async () => {
  assert.equal(await drive([CTRL_D]), 10);
  assert.equal(await drive([CTRL_D + CTRL_D + CTRL_U]), 10);
  assert.equal(await drive([CTRL_F]), 19);
  assert.equal(await drive([CTRL_F + CTRL_F + CTRL_B]), 19);
});

test("g and G jump to the ends of the list", async () => {
  assert.equal(await drive(["G"]), 99);
  assert.equal(await drive(["G", "g"]), 0);
});

test("Enter opens the image the last key in the chunk landed on", async () => {
  // "jjj\r" arriving together must edit index 3, not index 0.
  const opened: number[] = [];
  function EnterHarness() {
    const [index, setIndex] = useState(0);
    return (
      <ImageList
        entries={entries}
        selectedIndex={index}
        onSelect={setIndex}
        onEdit={(i) => opened.push(i)}
        maxVisible={20}
      />
    );
  }
  const { stdin, unmount } = render(<EnterHarness />);
  await flush();
  stdin.write("jjj\r");
  await flush();
  unmount();
  assert.deepEqual(opened, [3]);
});
