#!/usr/bin/env node
/**
 * Standalone check that kitty Unicode-placeholder graphics actually reach the
 * terminal in *this* environment -- run it before trusting the TUI.
 *
 * It deliberately does not import Ink: it prints the placeholder grid with
 * plain `console.log` so a failure here is unambiguously a terminal/tmux
 * problem rather than an Ink layout problem.
 *
 *   pnpm tsx scripts/kitty-smoke-test.ts [image-path]
 *
 * Expected: a 40x20 image drawn inline, below the environment report.
 */

import { execFileSync } from "node:child_process";
import { Jimp } from "jimp";
import {
  buildDelete,
  buildPlaceholderRows,
  buildTransmitVirtual,
  isInsideTmux,
  wrapForTmux,
} from "../src/utils/kittyPlaceholder.js";

const COLUMNS = 40;
const ROWS = 20;
const IMAGE_ID = 31;

const inTmux = isInsideTmux();

console.log("--- environment ---");
console.log(`TERM             = ${process.env.TERM ?? "(unset)"}`);
console.log(`TERM_PROGRAM     = ${process.env.TERM_PROGRAM ?? "(unset)"}`);
console.log(`KITTY_WINDOW_ID  = ${process.env.KITTY_WINDOW_ID ?? "(unset)"}`);
console.log(`TMUX             = ${process.env.TMUX ?? "(unset)"}`);
console.log(`inside tmux      = ${inTmux}`);
console.log(`stdout is a TTY  = ${process.stdout.isTTY === true}`);

if (inTmux) {
  let passthrough = "(could not query tmux)";
  try {
    passthrough = execFileSync("tmux", ["show", "-gv", "allow-passthrough"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // tmux not on PATH, or no server -- fall through with the placeholder text.
  }
  console.log(`allow-passthrough= ${passthrough}`);
  console.log(
    "\nInside tmux the graphics escape codes are wrapped for passthrough, which\n" +
      "tmux only honours when allow-passthrough is on/all.",
  );
  if (passthrough !== "on" && passthrough !== "all") {
    console.log(
      "\n  >>> allow-passthrough is NOT enabled -- the image WILL NOT appear.\n" +
        "  >>> Enable it, then re-run this script:\n" +
        "  >>>     tmux set -g allow-passthrough on",
    );
  }
}

const source = process.argv[2];

/** A recognisable test pattern, so a wrong-looking image is obvious. */
async function makeTestImage() {
  const image = new Jimp({ width: 320, height: 160, color: 0x000000ff });
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 320; x++) {
      const checker = (Math.floor(x / 20) + Math.floor(y / 20)) % 2 === 0;
      const r = Math.round((x / 319) * 255);
      const g = Math.round((y / 159) * 255);
      const b = checker ? 220 : 40;
      // `>>> 0` on the whole expression: bitwise OR yields a *signed* int32, so
      // any red >= 128 would otherwise come out negative and Jimp rejects it.
      const rgba = ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
      image.setPixelColor(rgba, x, y);
    }
  }
  return image;
}

const image = source ? await Jimp.read(source) : await makeTestImage();
console.log(
  `\nimage            = ${source ?? "(generated gradient/checker test pattern)"}`,
);
console.log(`decoded size     = ${image.width}x${image.height}`);

const png = await image.getBuffer("image/png");
const pngBase64 = png.toString("base64");
console.log(`png payload      = ${pngBase64.length} base64 chars`);

function emit(sequence: string) {
  process.stdout.write(inTmux ? wrapForTmux(sequence) : sequence);
}

// Clear any leftover image from a previous run before re-transmitting.
emit(buildDelete(IMAGE_ID));

for (const chunk of buildTransmitVirtual({
  id: IMAGE_ID,
  pngBase64,
  columns: COLUMNS,
  rows: ROWS,
})) {
  emit(chunk);
}

console.log(
  `\n--- placeholder grid (${COLUMNS}x${ROWS}, image id ${IMAGE_ID}) ---`,
);
for (const line of buildPlaceholderRows({
  id: IMAGE_ID,
  columns: COLUMNS,
  rows: ROWS,
})) {
  console.log(line);
}
console.log("--- end of grid ---");
console.log(
  "\nIf you see the image above: Unicode placeholders work here.\n" +
    "If you see blank space or stray marks: they do not (details above).",
);
