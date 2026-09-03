import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { render } from "ink-testing-library";
import { App } from "./App.js";

const CTRL_A = "\u0001";
const ESC = "\u001B";
const ENTER = "\r";
const SHIFT_D = "D";

const flush = () => new Promise((r) => setTimeout(r, 120));

async function withDataset(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "caption-tui-app-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content);
    }
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("editing the second of two images sharing a caption file saves", async () => {
  // image1.jpg and image1.png both point at image1.txt. Keying the state update
  // off a single captionPath match landed it on the first of the two, so the row
  // being edited kept its old text -- the editor then reset to that stale text
  // and reverted the file on its next save. Both rows follow the shared file now.
  await withDataset(
    {
      "image1.jpg": "",
      "image1.png": "",
      "image1.txt": "old caption",
      "zebra.png": "",
      "zebra.txt": "zebra caption",
    },
    async (dir) => {
      const { stdin, lastFrame } = render(
        <App datasetPath={dir} mode="natural" />,
      );
      await flush();

      stdin.write("j"); // select the second row (image1.png)
      await flush();
      stdin.write(ENTER); // open the editor
      await flush();
      stdin.write(CTRL_A); // cursor to start of line
      await flush();
      stdin.write("NEW ");
      await flush();
      stdin.write(ESC); // save and close
      await flush();

      assert.equal(
        await readFile(join(dir, "image1.txt"), "utf8"),
        "NEW old caption",
      );

      // Both rows read the same file, so both show the new text -- and crucially
      // the row that was edited is not left showing the old one.
      const frame = lastFrame() ?? "";
      const rows = frame.split("\n").filter((line) => line.includes("image1."));
      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.match(row, /NEW old caption/);
      }
      // The untouched image is unaffected.
      assert.match(frame, /zebra\s+\[\s*2\] zebra caption/);
    },
  );
});

test("saving one image never rewrites another image's caption", async () => {
  await withDataset(
    {
      "a.png": "",
      "a.txt": "caption a",
      "b.png": "",
      "b.txt": "caption b",
    },
    async (dir) => {
      const { stdin } = render(<App datasetPath={dir} mode="natural" />);
      await flush();

      stdin.write(ENTER); // edit a.png
      await flush();
      stdin.write(CTRL_A);
      await flush();
      stdin.write("NEW ");
      await flush();
      stdin.write(ESC);
      await flush();

      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "NEW caption a");
      assert.equal(await readFile(join(dir, "b.txt"), "utf8"), "caption b");
    },
  );
});

test("Shift-D asks before deleting, and Esc leaves the files alone", async () => {
  // Nothing in this suite confirms a delete: that would put files in the
  // developer's real trash. The confirmation keys are covered against the
  // DeleteConfirm component directly.
  await withDataset(
    { "a.png": "", "a.txt": "caption a", "b.png": "", "b.txt": "caption b" },
    async (dir) => {
      const { stdin, lastFrame } = render(<App datasetPath={dir} />);
      await flush();

      stdin.write(SHIFT_D);
      await flush();
      assert.match(lastFrame() ?? "", /Delete a\.png \+ a\.txt\?/);

      stdin.write(ESC);
      await flush();
      assert.doesNotMatch(lastFrame() ?? "", /Delete a\.png/);
      assert.equal(await readFile(join(dir, "a.png"), "utf8"), "");
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "caption a");
    },
  );
});

test("Shift-D at the end of a burst targets the row the burst landed on", async () => {
  await withDataset(
    {
      "a.png": "",
      "a.txt": "a",
      "b.png": "",
      "b.txt": "b",
      "c.png": "",
      "c.txt": "c",
    },
    async (dir) => {
      const { stdin, lastFrame } = render(<App datasetPath={dir} />);
      await flush();

      // "jjD" arrives as one event; the prompt must name c.png, not a.png.
      stdin.write("jjD");
      await flush();
      assert.match(lastFrame() ?? "", /Delete c\.png \+ c\.txt\?/);
    },
  );
});

test("a caption shared by two images is not offered up for deletion", async () => {
  await withDataset(
    {
      "shared.jpg": "",
      "shared.png": "",
      "shared.txt": "shared caption",
    },
    async (dir) => {
      const { stdin, lastFrame } = render(<App datasetPath={dir} />);
      await flush();

      stdin.write(SHIFT_D);
      await flush();
      const frame = lastFrame() ?? "";
      assert.match(frame, /Delete shared\.jpg\?/);
      assert.doesNotMatch(frame, /Delete shared\.jpg \+ shared\.txt/);
      assert.match(frame, /shared\.txt kept/);
    },
  );
});

test("q does not quit while the delete confirmation is open", async () => {
  await withDataset({ "a.png": "", "a.txt": "a" }, async (dir) => {
    const { stdin, lastFrame } = render(<App datasetPath={dir} />);
    await flush();

    stdin.write(SHIFT_D);
    await flush();
    stdin.write("q"); // cancels the prompt rather than exiting the app
    await flush();

    const frame = lastFrame() ?? "";
    assert.doesNotMatch(frame, /Delete a\.png/);
    assert.match(frame, /Images \(1\)/);
  });
});

test("the delete confirmation is visible when the list fills the terminal", async () => {
  // The list grows to fill the app box, so the bar rendered below it landed
  // past `overflow: hidden`: invisible, but still mounted and taking keys --
  // the delete worked with no dialog on screen. The list has to give up rows.
  const files: Record<string, string> = {};
  for (let i = 0; i < 60; i++) {
    const name = `img_${String(i).padStart(3, "0")}`;
    files[`${name}.png`] = "";
    files[`${name}.txt`] = "a caption";
  }

  await withDataset(files, async (dir) => {
    const { stdin, lastFrame } = render(<App datasetPath={dir} />);
    await flush();
    const heightBefore = (lastFrame() ?? "").split("\n").length;

    stdin.write(SHIFT_D);
    await flush();

    const frame = lastFrame() ?? "";
    assert.match(frame, /Delete img_000\.png \+ img_000\.txt\?/);
    assert.match(frame, /move to trash/);
    // Room was taken from the list, not added to the app: no overflow.
    assert.equal(frame.split("\n").length, heightBefore);
  });
});

test("the taller shared-caption confirmation also fits", async () => {
  // This variant carries an extra line, so it needs one more row than the plain
  // one -- reserving a fixed count would clip its last line.
  const files: Record<string, string> = {
    "shared.jpg": "",
    "shared.png": "",
    "shared.txt": "c",
  };
  for (let i = 0; i < 60; i++) {
    const name = `img_${String(i).padStart(3, "0")}`;
    files[`${name}.png`] = "";
    files[`${name}.txt`] = "a caption";
  }

  await withDataset(files, async (dir) => {
    const { stdin, lastFrame } = render(<App datasetPath={dir} />);
    await flush();
    const heightBefore = (lastFrame() ?? "").split("\n").length;

    stdin.write("G"); // jump to the shared pair at the end of the list
    await flush();
    stdin.write("k"); // shared.jpg
    await flush();
    stdin.write(SHIFT_D);
    await flush();

    const frame = lastFrame() ?? "";
    assert.match(frame, /Delete shared\.jpg\?/);
    assert.match(frame, /shared\.txt kept/);
    assert.match(frame, /move to trash/);
    assert.equal(frame.split("\n").length, heightBefore);
  });
});
