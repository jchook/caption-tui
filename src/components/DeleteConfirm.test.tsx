import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "ink-testing-library";
import type { ImageEntry } from "../utils/dataset.js";
import { DeleteConfirm } from "./DeleteConfirm.js";

const ESC = "\u001B";
const flush = () => new Promise((r) => setTimeout(r, 20));

const entry: ImageEntry = {
  name: "img_007.png",
  imagePath: "/d/img_007.png",
  captionPath: "/d/img_007.txt",
  tags: [],
  caption: "",
};

function mount(overrides: Partial<Parameters<typeof DeleteConfirm>[0]> = {}): {
  stdin: { write: (s: string) => void };
  confirmed: ("trash" | "permanent")[];
  cancels: number;
  frame: () => string;
} {
  const confirmed: ("trash" | "permanent")[] = [];
  let cancels = 0;
  const result = render(
    <DeleteConfirm
      entry={entry}
      files={[entry.imagePath, entry.captionPath]}
      trashError={null}
      busy={false}
      onConfirm={(mode) => confirmed.push(mode)}
      onCancel={() => {
        cancels++;
      }}
      {...overrides}
    />,
  );
  return {
    stdin: result.stdin,
    confirmed,
    get cancels() {
      return cancels;
    },
    frame: () => result.lastFrame() ?? "",
  };
}

test("t or y moves the files to the trash", async () => {
  for (const key of ["t", "y"]) {
    const ui = mount();
    await flush();
    ui.stdin.write(key);
    await flush();
    assert.deepEqual(ui.confirmed, ["trash"], `key ${key}`);
  }
});

test("Esc, n and q all cancel", async () => {
  for (const key of [ESC, "n", "q"]) {
    const ui = mount();
    await flush();
    ui.stdin.write(key);
    await flush();
    assert.equal(ui.cancels, 1, `key ${JSON.stringify(key)}`);
    assert.deepEqual(ui.confirmed, []);
  }
});

test("permanent delete is not reachable until trashing has failed", async () => {
  // The user agreed to trash the file. Shift-D must not quietly rm it instead.
  const ui = mount();
  await flush();
  ui.stdin.write("D");
  await flush();
  assert.deepEqual(ui.confirmed, []);
  assert.match(ui.frame(), /move to trash/);
});

test("once trashing has failed, the error shows and D rm's the files", async () => {
  const ui = mount({ trashError: "EACCES: no writable trash directory" });
  await flush();
  assert.match(ui.frame(), /Trash failed: EACCES: no writable trash directory/);
  assert.match(ui.frame(), /cannot be undone/);

  ui.stdin.write("t"); // the trash key is gone now
  await flush();
  assert.deepEqual(ui.confirmed, []);

  ui.stdin.write("D");
  await flush();
  assert.deepEqual(ui.confirmed, ["permanent"]);
});

test("a burst of confirm keys is still read as a confirmation", async () => {
  // Input arrives as a run of characters, so the run has to be searched rather
  // than compared (see the note in AGENTS.md).
  const ui = mount();
  await flush();
  ui.stdin.write("tt");
  await flush();
  assert.deepEqual(ui.confirmed, ["trash"]);
});

test("input is ignored while the delete is in flight", async () => {
  const ui = mount({ busy: true });
  await flush();
  ui.stdin.write("t");
  ui.stdin.write(ESC);
  await flush();
  assert.deepEqual(ui.confirmed, []);
  assert.equal(ui.cancels, 0);
});

test("a caption kept for a sibling image is called out", async () => {
  const ui = mount({ files: [entry.imagePath] });
  await flush();
  assert.match(ui.frame(), /Delete img_007\.png\?/);
  assert.match(ui.frame(), /img_007\.txt kept/);
});
