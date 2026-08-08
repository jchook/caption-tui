import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { render } from "ink-testing-library";
import { Jimp } from "jimp";
import { PLACEHOLDER_CHAR } from "../utils/kittyPlaceholder.js";
import { KittyPlaceholderImage } from "./KittyPlaceholderImage.js";

const flush = () => new Promise((r) => setTimeout(r, 120));

const dir = mkdtempSync(join(tmpdir(), "caption-tui-kitty-"));

async function makeImage(name: string, width: number, height: number) {
  const path = join(dir, name);
  const image = new Jimp({ width, height, color: 0xff0000ff });
  writeFileSync(path, await image.getBuffer("image/png"));
  return path;
}

/**
 * ink-testing-library's fake stdout records every write, so the component's
 * graphics escape codes land in `frames` alongside Ink's rendered output.
 * Ours are the ones carrying an APC graphics introducer.
 */
const graphicsWrites = (frames: string[]) =>
  frames.filter((frame) => frame.includes("\x1b_G")).join("");

/** The most recent frame Ink actually rendered (as opposed to our raw writes). */
const lastRenderedFrame = (frames: string[]) =>
  [...frames].reverse().find((frame) => !frame.includes("\x1b_G")) ?? "";

test("transmits a virtual placement and renders placeholder cells", async () => {
  const src = await makeImage("landscape.png", 400, 200);

  const { frames, unmount } = render(
    <KittyPlaceholderImage
      src={src}
      maxColumns={40}
      maxRows={20}
      cellWidth={10}
      cellHeight={20}
    />,
  );

  await flush();
  const graphics = graphicsWrites(frames);

  // A virtual placement (U=1) in quiet mode.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences
  assert.match(graphics, /\x1b_Ga=T,U=1,i=\d+,c=\d+,r=\d+,f=100,t=d,q=2/);
  // Never a real placement: that is the direct-placement behaviour being
  // replaced, and it is what Ink's repaints used to erase.
  assert.ok(!graphics.includes("a=p,"), "emitted a direct placement");
  // Nothing may save/restore or move the cursor -- that is what made the old
  // renderer paint over the text below the preview.
  assert.ok(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences
    !/\x1b7|\x1b8|\x1b\[\d*[ABCD]/.test(graphics),
    "graphics output moved the cursor",
  );

  // The visible frame is placeholder text laid out by Ink.
  const frame = lastRenderedFrame(frames);
  const cells = (frame.match(/\u{10EEEE}/gu) ?? []).length;
  // 400x200 image in 10x20px cells is 4:1 in cell space -> 40 cols x 10 rows.
  assert.equal(cells, 40 * 10);

  unmount();
});

test("frees the image from the terminal on unmount", async () => {
  const src = await makeImage("cleanup.png", 100, 100);

  const { frames, unmount } = render(
    <KittyPlaceholderImage src={src} maxColumns={20} maxRows={10} />,
  );
  await flush();

  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences
  const id = graphicsWrites(frames).match(/\x1b_Ga=T,U=1,i=(\d+)/)?.[1];
  assert.ok(id, "no transmit captured");

  unmount();
  await flush();

  // d=I frees the stored image data, not just the placement; d=i alone would
  // leak the pixels inside the terminal for the rest of its life.
  assert.ok(
    graphicsWrites(frames).includes(`\x1b_Ga=d,d=I,i=${id},q=2`),
    "image was not deleted on unmount",
  );
});

test("swapping the image retires the previous one", async () => {
  const first = await makeImage("first.png", 100, 100);
  const second = await makeImage("second.png", 100, 100);

  const { frames, rerender, unmount } = render(
    <KittyPlaceholderImage src={first} maxColumns={20} maxRows={10} />,
  );
  await flush();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences
  const firstId = graphicsWrites(frames).match(/\x1b_Ga=T,U=1,i=(\d+)/)?.[1];
  assert.ok(firstId);

  rerender(<KittyPlaceholderImage src={second} maxColumns={20} maxRows={10} />);
  await flush();

  const graphics = graphicsWrites(frames);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences
  const ids = [...graphics.matchAll(/\x1b_Ga=T,U=1,i=(\d+)/g)].map((m) => m[1]);
  assert.equal(ids.length, 2, "second image was not transmitted");
  assert.notEqual(ids[0], ids[1], "reused an image id");
  // The old image is released, but only after its replacement was sent, so the
  // pane never blinks through empty.
  const deleteIndex = graphics.indexOf(`\x1b_Ga=d,d=I,i=${firstId},q=2`);
  const secondTransmitIndex = graphics.indexOf(`\x1b_Ga=T,U=1,i=${ids[1]}`);
  assert.ok(deleteIndex > -1, "previous image was never deleted");
  assert.ok(
    deleteIndex > secondTransmitIndex,
    "deleted the old image before transmitting the new one",
  );

  unmount();
});

test("wraps graphics escape codes for tmux passthrough", async () => {
  const src = await makeImage("tmux.png", 100, 100);

  const { frames, unmount } = render(
    <KittyPlaceholderImage src={src} maxColumns={20} maxRows={10} insideTmux />,
  );
  await flush();

  const graphics = graphicsWrites(frames);
  assert.ok(
    graphics.includes("\x1bPtmux;"),
    "missing tmux passthrough wrapper",
  );
  // Every ESC inside the wrapper must be doubled or tmux's DCS parser ends the
  // passthrough early and the rest of the payload is printed as garbage.
  assert.ok(
    graphics.includes("\x1b\x1b_Ga=T,U=1,"),
    "escape codes were not doubled for tmux",
  );

  unmount();
});

test("reports a failure instead of hanging on an unreadable image", async () => {
  const { frames, unmount } = render(
    <KittyPlaceholderImage
      src={join(dir, "does-not-exist.png")}
      maxColumns={20}
      maxRows={10}
    />,
  );

  await flush();
  const frame = lastRenderedFrame(frames);
  assert.match(frame, /Unable to load image/);
  assert.ok(!frame.includes(PLACEHOLDER_CHAR));
  assert.equal(
    graphicsWrites(frames),
    "",
    "transmitted despite a decode error",
  );

  unmount();
});
