import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { render } from "ink-testing-library";
import { Jimp } from "jimp";
import { PLACEHOLDER_CHAR } from "../utils/kittyPlaceholder.js";
import {
  KittyPlaceholderImage,
  RETIRE_GRACE_MS,
  TRANSMIT_DEBOUNCE_MS,
} from "./KittyPlaceholderImage.js";

/** Long enough for the transmit debounce plus a PNG decode. */
const flush = () =>
  new Promise((r) => setTimeout(r, TRANSMIT_DEBOUNCE_MS + 150));
/** ...and for a replaced image's grace period to run out on top of that. */
const flushRetire = () =>
  new Promise((r) => setTimeout(r, RETIRE_GRACE_MS + 200));

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

test("the replaced image outlives the frame that still shows it", async () => {
  // The placeholder cells on screen keep pointing at the old image until Ink
  // paints the new ones. Freeing it as soon as the replacement is transmitted
  // blanked the pane on every single move -- worse inside tmux, where a
  // passthrough escape code reaches the terminal ahead of the pane's queued
  // redraw. It is only released once the new placement has had time to land.
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
  assert.ok(
    !graphics.includes(`\x1b_Ga=d,d=I,i=${firstId},q=2`),
    "freed the old image while its placeholders were still on screen",
  );

  await flushRetire();
  assert.ok(
    graphicsWrites(frames).includes(`\x1b_Ga=d,d=I,i=${firstId},q=2`),
    "the replaced image was never freed",
  );

  unmount();
});

test("nothing is decoded until the selection settles", async () => {
  // Holding the down arrow changes `src` far faster than a PNG can be decoded
  // and pushed to the terminal. Decoding each one in turn blocks the event loop
  // for images already scrolled past, which is what made a fast scroll crawl.
  // A wide debounce here so the window is unambiguous; the real one is short.
  const src = await makeImage("settle.png", 100, 100);
  const debounceMs = 400;

  const { frames, unmount } = render(
    <KittyPlaceholderImage
      src={src}
      maxColumns={20}
      maxRows={10}
      debounceMs={debounceMs}
    />,
  );

  await new Promise((r) => setTimeout(r, debounceMs / 2));
  assert.equal(
    graphicsWrites(frames),
    "",
    "decoded before the selection had settled",
  );

  await new Promise((r) => setTimeout(r, debounceMs));
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences
  assert.match(graphicsWrites(frames), /\x1b_Ga=T,U=1,/);

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
