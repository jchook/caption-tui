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
