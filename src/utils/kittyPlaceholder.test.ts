import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDelete,
  buildPlaceholderRows,
  buildTransmitVirtual,
  fitGrid,
  MAX_PLACEHOLDER_CELLS,
  PLACEHOLDER_CHAR,
  ROWCOLUMN_DIACRITICS,
  wrapForTmux,
} from "./kittyPlaceholder.js";

test("diacritic table matches kitty's rowcolumn-diacritics.txt", () => {
  // 297 combining marks, so grids are addressable up to 297x297.
  assert.equal(ROWCOLUMN_DIACRITICS.length, 297);
  assert.equal(MAX_PLACEHOLDER_CELLS, 297);
  // The first three encode 0, 1, 2 -- the values used in kitty's own examples.
  assert.deepEqual(ROWCOLUMN_DIACRITICS.slice(0, 3), [0x0305, 0x030d, 0x030e]);
  // Entries must be unique, or two grid positions would collide.
  assert.equal(new Set(ROWCOLUMN_DIACRITICS).size, ROWCOLUMN_DIACRITICS.length);
});

test("placeholder char is U+10EEEE", () => {
  assert.equal(PLACEHOLDER_CHAR.codePointAt(0), 0x10eeee);
});

test("2x2 grid reproduces the example from kitty's protocol docs", () => {
  // graphics-protocol.rst, "Unicode placeholders":
  //   printf "\e[38;5;42m\U10EEEE\U0305\U0305\U10EEEE\U0305\U030D\e[39m\n"
  //   printf "\e[38;5;42m\U10EEEE\U030D\U0305\U10EEEE\U030D\U030D\e[39m\n"
  const rows = buildPlaceholderRows({ id: 42, columns: 2, rows: 2 });
  assert.deepEqual(rows, [
    "\x1b[38;5;42m\u{10EEEE}̅̅\u{10EEEE}̅̍\x1b[39m",
    "\x1b[38;5;42m\u{10EEEE}̍̅\u{10EEEE}̍̍\x1b[39m",
  ]);
});

test("every cell carries explicit row and column diacritics", () => {
  // Kitty allows omitting diacritics and inheriting from the cell to the left,
  // but Ink repaints arbitrary line fragments, so we never rely on that.
  const [row] = buildPlaceholderRows({ id: 7, columns: 3, rows: 1 });
  assert.ok(row);
  const cells = row
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(PLACEHOLDER_CHAR)
    .slice(1);
  assert.equal(cells.length, 3);
  for (const [column, marks] of cells.entries()) {
    assert.equal(
      marks,
      String.fromCodePoint(ROWCOLUMN_DIACRITICS[0] as number) +
        String.fromCodePoint(ROWCOLUMN_DIACRITICS[column] as number),
    );
  }
});

test("placeholder rows are self-contained (color set and reset per line)", () => {
  const rows = buildPlaceholderRows({ id: 200, columns: 2, rows: 3 });
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(row.startsWith("\x1b[38;5;200m"));
    assert.ok(row.endsWith("\x1b[39m"));
  }
});

test("degenerate grids produce no rows, oversized grids throw", () => {
  assert.deepEqual(buildPlaceholderRows({ id: 1, columns: 0, rows: 5 }), []);
  assert.deepEqual(buildPlaceholderRows({ id: 1, columns: 5, rows: 0 }), []);
  assert.throws(
    () => buildPlaceholderRows({ id: 1, columns: 298, rows: 1 }),
    RangeError,
  );
  assert.throws(
    () => buildPlaceholderRows({ id: 1, columns: 1, rows: 298 }),
    RangeError,
  );
});

test("fitGrid preserves aspect ratio in cell space, not pixel space", () => {
  // A 2:1 landscape image in 10x20px cells is 2:1 in pixels but 4:1 in cells,
  // so a 40x40 cell box should yield 40 columns and 10 rows -- naively fitting
  // the pixel ratio would give 40x20 and stretch the image vertically.
  assert.deepEqual(
    fitGrid({
      imageWidth: 400,
      imageHeight: 200,
      maxColumns: 40,
      maxRows: 40,
      cellWidth: 10,
      cellHeight: 20,
    }),
    { columns: 40, rows: 10 },
  );
});

test("fitGrid is limited by whichever axis runs out first", () => {
  // Tall image: rows are the binding constraint.
  assert.deepEqual(
    fitGrid({
      imageWidth: 100,
      imageHeight: 800,
      maxColumns: 80,
      maxRows: 20,
      cellWidth: 10,
      cellHeight: 20,
    }),
    { columns: 5, rows: 20 },
  );
});

test("fitGrid never exceeds the box or the diacritic table", () => {
  const huge = fitGrid({
    imageWidth: 10_000,
    imageHeight: 10_000,
    maxColumns: 5000,
    maxRows: 5000,
    cellWidth: 1,
    cellHeight: 1,
  });
  assert.ok(huge.columns <= MAX_PLACEHOLDER_CELLS);
  assert.ok(huge.rows <= MAX_PLACEHOLDER_CELLS);
  // Whatever fitGrid returns must be renderable.
  assert.doesNotThrow(() => buildPlaceholderRows({ id: 1, ...huge }));
});

test("fitGrid always yields at least one cell for a non-empty box", () => {
  // An extreme aspect ratio must not floor a dimension to zero.
  const sliver = fitGrid({
    imageWidth: 1000,
    imageHeight: 1,
    maxColumns: 20,
    maxRows: 20,
    cellWidth: 10,
    cellHeight: 20,
  });
  assert.ok(sliver.columns >= 1 && sliver.rows >= 1);
});

test("fitGrid returns an empty grid for degenerate inputs", () => {
  const empty = { columns: 0, rows: 0 };
  const base = {
    imageWidth: 100,
    imageHeight: 100,
    maxColumns: 10,
    maxRows: 10,
  };
  assert.deepEqual(fitGrid({ ...base, imageWidth: 0 }), empty);
  assert.deepEqual(fitGrid({ ...base, imageHeight: 0 }), empty);
  assert.deepEqual(fitGrid({ ...base, maxColumns: 0 }), empty);
  assert.deepEqual(fitGrid({ ...base, maxRows: 0 }), empty);
  assert.deepEqual(fitGrid({ ...base, cellWidth: 0 }), empty);
});

test("fitGrid falls back to a sane cell size when none is known", () => {
  // Default cells are 8x16, i.e. twice as tall as wide, so a square image
  // occupies twice as many columns as rows.
  const grid = fitGrid({
    imageWidth: 800,
    imageHeight: 800,
    maxColumns: 200,
    maxRows: 200,
  });
  assert.equal(grid.columns, 2 * grid.rows);
});

test("fitGrid scales up to fill the box, not just down", () => {
  // The preview pane should be filled by a small image rather than left mostly
  // empty; the component caps *pixel* upscaling separately, since kitty can
  // magnify on display for free.
  assert.deepEqual(
    fitGrid({
      imageWidth: 80,
      imageHeight: 80,
      maxColumns: 200,
      maxRows: 200,
      cellWidth: 8,
      cellHeight: 16,
    }),
    { columns: 200, rows: 100 },
  );
});

test("small payloads transmit as a single chunk", () => {
  const chunks = buildTransmitVirtual({
    id: 9,
    pngBase64: "AAAA",
    columns: 10,
    rows: 5,
  });
  assert.deepEqual(chunks, [
    "\x1b_Ga=T,U=1,i=9,c=10,r=5,f=100,t=d,q=2,m=0;AAAA\x1b\\",
  ]);
});

test("large payloads chunk with m=1 continuations and a final m=0", () => {
  const payload = "x".repeat(10_000);
  const chunks = buildTransmitVirtual({
    id: 9,
    pngBase64: payload,
    columns: 10,
    rows: 5,
    chunkSize: 4096,
  });

  // 10000 = 4096 + 4096 + 1808 -> three escape codes.
  assert.equal(chunks.length, 3);
  assert.ok(
    chunks[0]?.startsWith("\x1b_Ga=T,U=1,i=9,c=10,r=5,f=100,t=d,q=2,m=1;"),
  );
  assert.ok(chunks[1]?.startsWith("\x1b_Gm=1,q=2;"));
  assert.ok(chunks[2]?.startsWith("\x1b_Gm=0,q=2;"));

  // Every chunk must be a well-formed APC, and the payloads must reassemble
  // to exactly the original base64 -- a dropped or duplicated byte here would
  // make kitty decode garbage.
  const reassembled = chunks
    .map((chunk) => {
      assert.ok(chunk.startsWith("\x1b_G"));
      assert.ok(chunk.endsWith("\x1b\\"));
      return chunk.slice(chunk.indexOf(";") + 1, -2);
    })
    .join("");
  assert.equal(reassembled, payload);
});

test("payload exactly one chunk long stays a single escape code", () => {
  const payload = "y".repeat(4096);
  const chunks = buildTransmitVirtual({
    id: 3,
    pngBase64: payload,
    columns: 4,
    rows: 4,
    chunkSize: 4096,
  });
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0]?.includes(",m=0;"));
});

test("transmit always uses quiet mode so no reply reaches Ink's stdin", () => {
  for (const chunk of buildTransmitVirtual({
    id: 9,
    pngBase64: "z".repeat(9000),
    columns: 10,
    rows: 5,
  })) {
    assert.ok(
      chunk.includes("q=2"),
      `missing q=2 in: ${JSON.stringify(chunk)}`,
    );
  }
});

test("delete removes image data and virtual placements", () => {
  // d=I (capital) frees the stored image too; d=i alone would leak it.
  assert.equal(buildDelete(31), "\x1b_Ga=d,d=I,i=31,q=2\x1b\\");
});

test("tmux passthrough doubles every escape and brackets the payload", () => {
  assert.equal(
    wrapForTmux("\x1b_Gtest\x1b\\"),
    "\x1bPtmux;\x1b\x1b_Gtest\x1b\x1b\\\x1b\\",
  );
});

test("tmux passthrough leaves escape-free payloads alone apart from framing", () => {
  assert.equal(wrapForTmux("plain"), "\x1bPtmux;plain\x1b\\");
});
