/**
 * Kitty graphics protocol via **Unicode placeholders**.
 *
 * Why this exists (and why we don't use ink-picture's KittyImage):
 *
 * ink-picture places kitty graphics with *direct placement* -- it saves the
 * cursor, walks it to an absolute screen position, emits `a=p,C=1`, then
 * restores. The resulting image is pinned to screen coordinates and is entirely
 * invisible to Ink's layout: it isn't clipped by `overflow: hidden`, it doesn't
 * move when the frame is rewritten, and any full-screen erase wipes it. That is
 * the root cause of the flashing/vanishing preview, and it cannot work at all
 * inside tmux, which does not implement the kitty graphics protocol.
 *
 * Unicode placeholders are kitty's documented answer to exactly this problem
 * (graphics-protocol.rst, "Unicode placeholders", added in kitty 0.28):
 *
 *   > [...] it allows using images inside any host application that supports
 *   > Unicode, foreground colors (tmux, vim, weechat, etc.) [...] Since this
 *   > character is just normal text, Unicode aware applications will move it
 *   > around as needed when they redraw their screens, thereby automatically
 *   > moving the displayed image as well, even though they know nothing about
 *   > the graphics protocol.
 *
 * The flow is:
 *   1. Transmit the PNG in quiet mode (`q=2`, so the terminal sends no reply
 *      that could desync Ink's stdin) and create a *virtual* placement with
 *      `U=1,c=<cols>,r=<rows>`. Virtual placements are invisible prototypes.
 *   2. Emit ordinary text: a `cols`x`rows` grid of U+10EEEE cells, each
 *      carrying combining diacritics that encode its (row, column), with the
 *      image ID in the foreground color.
 *
 * The image then *is* text as far as Ink and tmux are concerned, so Ink's
 * diffing, clipping and scrolling all work with no cursor gymnastics.
 */

/**
 * Combining characters that encode row/column indices, in order: index `n` in
 * this array is the diacritic for the number `n`.
 *
 * Verbatim from kitty's `rowcolumn-diacritics.txt` (shipped in kitty's docs as
 * `_downloads/.../rowcolumn-diacritics.txt`). It is derived from Unicode 6.0.0
 * `UnicodeData.txt` by taking combining class 230 marks without decomposition
 * mappings, minus those that can fuse under normalization. 297 entries, so a
 * single placeholder grid tops out at 297 rows and 297 columns.
 */
export const ROWCOLUMN_DIACRITICS: readonly number[] = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346,
  0x034a, 0x034b, 0x034c, 0x0350, 0x0351, 0x0352, 0x0357, 0x035b, 0x0363,
  0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369, 0x036a, 0x036b, 0x036c,
  0x036d, 0x036e, 0x036f, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
  0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059c, 0x059d, 0x059e,
  0x059f, 0x05a0, 0x05a1, 0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4,
  0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615, 0x0616, 0x0617, 0x0657,
  0x0658, 0x0659, 0x065a, 0x065b, 0x065d, 0x065e, 0x06d6, 0x06d7, 0x06d8,
  0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e0, 0x06e1, 0x06e2, 0x06e4,
  0x06e7, 0x06e8, 0x06eb, 0x06ec, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736,
  0x073a, 0x073d, 0x073f, 0x0740, 0x0741, 0x0743, 0x0745, 0x0747, 0x0749,
  0x074a, 0x07eb, 0x07ec, 0x07ed, 0x07ee, 0x07ef, 0x07f0, 0x07f1, 0x07f3,
  0x0816, 0x0817, 0x0818, 0x0819, 0x081b, 0x081c, 0x081d, 0x081e, 0x081f,
  0x0820, 0x0821, 0x0822, 0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082a,
  0x082b, 0x082c, 0x082d, 0x0951, 0x0953, 0x0954, 0x0f82, 0x0f83, 0x0f86,
  0x0f87, 0x135d, 0x135e, 0x135f, 0x17dd, 0x193a, 0x1a17, 0x1a75, 0x1a76,
  0x1a77, 0x1a78, 0x1a79, 0x1a7a, 0x1a7b, 0x1a7c, 0x1b6b, 0x1b6d, 0x1b6e,
  0x1b6f, 0x1b70, 0x1b71, 0x1b72, 0x1b73, 0x1cd0, 0x1cd1, 0x1cd2, 0x1cda,
  0x1cdb, 0x1ce0, 0x1dc0, 0x1dc1, 0x1dc3, 0x1dc4, 0x1dc5, 0x1dc6, 0x1dc7,
  0x1dc8, 0x1dc9, 0x1dcb, 0x1dcc, 0x1dd1, 0x1dd2, 0x1dd3, 0x1dd4, 0x1dd5,
  0x1dd6, 0x1dd7, 0x1dd8, 0x1dd9, 0x1dda, 0x1ddb, 0x1ddc, 0x1ddd, 0x1dde,
  0x1ddf, 0x1de0, 0x1de1, 0x1de2, 0x1de3, 0x1de4, 0x1de5, 0x1de6, 0x1dfe,
  0x20d0, 0x20d1, 0x20d4, 0x20d5, 0x20d6, 0x20d7, 0x20db, 0x20dc, 0x20e1,
  0x20e7, 0x20e9, 0x20f0, 0x2cef, 0x2cf0, 0x2cf1, 0x2de0, 0x2de1, 0x2de2,
  0x2de3, 0x2de4, 0x2de5, 0x2de6, 0x2de7, 0x2de8, 0x2de9, 0x2dea, 0x2deb,
  0x2dec, 0x2ded, 0x2dee, 0x2def, 0x2df0, 0x2df1, 0x2df2, 0x2df3, 0x2df4,
  0x2df5, 0x2df6, 0x2df7, 0x2df8, 0x2df9, 0x2dfa, 0x2dfb, 0x2dfc, 0x2dfd,
  0x2dfe, 0x2dff, 0xa66f, 0xa67c, 0xa67d, 0xa6f0, 0xa6f1, 0xa8e0, 0xa8e1,
  0xa8e2, 0xa8e3, 0xa8e4, 0xa8e5, 0xa8e6, 0xa8e7, 0xa8e8, 0xa8e9, 0xa8ea,
  0xa8eb, 0xa8ec, 0xa8ed, 0xa8ee, 0xa8ef, 0xa8f0, 0xa8f1, 0xaab0, 0xaab2,
  0xaab3, 0xaab7, 0xaab8, 0xaabe, 0xaabf, 0xaac1, 0xfe20, 0xfe21, 0xfe22,
  0xfe23, 0xfe24, 0xfe25, 0xfe26, 0x10a0f, 0x10a38, 0x1d185, 0x1d186, 0x1d187,
  0x1d188, 0x1d189, 0x1d1aa, 0x1d1ab, 0x1d1ac, 0x1d1ad, 0x1d242, 0x1d243,
  0x1d244,
];

/** The maximum grid dimension a placeholder can address (one diacritic each). */
export const MAX_PLACEHOLDER_CELLS = ROWCOLUMN_DIACRITICS.length;

/** `U+10EEEE`, the Private Use character kitty treats as an image placeholder. */
export const PLACEHOLDER_CHAR = "\u{10EEEE}";

/**
 * Image IDs are capped at 255 and encoded with a 256-color SGR
 * (`ESC [ 38;5;<id> m`), matching kitty's own documented example.
 *
 * We deliberately avoid 24-bit IDs: inside tmux with `TERM=screen-256color`,
 * truecolor SGR is downgraded to the nearest palette entry unless the terminal
 * advertises `RGB`/`Tc`, which would silently rewrite the image ID and leave
 * the placeholder pointing at nothing. 256-color indices survive tmux intact.
 * The app only ever shows one preview at a time, so 255 IDs is ample.
 */
export const MAX_IMAGE_ID = 255;

const ESC = "\x1b";

/**
 * Wrap a raw escape sequence for tmux's passthrough (`allow-passthrough`).
 * tmux forwards the payload to the outer terminal verbatim, but every ESC in
 * the payload must be doubled so tmux's own DCS parser doesn't terminate early.
 */
export function wrapForTmux(sequence: string): string {
  return `${ESC}Ptmux;${sequence.replaceAll(ESC, ESC + ESC)}${ESC}\\`;
}

/** True when this process is running under a tmux client. */
export function isInsideTmux(): boolean {
  return process.env.TMUX !== undefined && process.env.TMUX !== "";
}

/**
 * Build the diacritic pair for one cell. Both row and column are always
 * emitted, never relying on kitty's left-to-right inheritance rules: Ink
 * rewrites arbitrary line fragments between frames, so a cell can very well be
 * redrawn without the cell to its left being present in the same write.
 */
function cellDiacritics(row: number, column: number): string {
  const r = ROWCOLUMN_DIACRITICS[row];
  const c = ROWCOLUMN_DIACRITICS[column];
  if (r === undefined || c === undefined) {
    throw new RangeError(
      `placeholder cell (${row}, ${column}) exceeds the ${MAX_PLACEHOLDER_CELLS}-cell diacritic table`,
    );
  }
  return String.fromCodePoint(r) + String.fromCodePoint(c);
}

const DEFAULT_CHUNK_SIZE = 4096;

/**
 * Transmit a PNG and create a virtual placement for it in one go.
 *
 * `a=T` transmits + places, `U=1` makes the placement virtual (an invisible
 * prototype for the placeholder cells), `q=2` suppresses the terminal's
 * acknowledgement -- important, because any reply would land in Ink's stdin and
 * be interpreted as keystrokes. Payload is chunked with `m=1`/`m=0` because the
 * protocol caps a single escape code's payload at 4096 bytes.
 *
 * kitty fits the image to the `cols`x`rows` rectangle preserving aspect ratio,
 * so the PNG does not need to be pre-scaled to exact pixel dimensions.
 */
export function buildTransmitVirtual(options: {
  id: number;
  pngBase64: string;
  columns: number;
  rows: number;
  chunkSize?: number;
}): string[] {
  const {
    id,
    pngBase64,
    columns,
    rows,
    chunkSize = DEFAULT_CHUNK_SIZE,
  } = options;
  const control = `a=T,U=1,i=${id},c=${columns},r=${rows},f=100,t=d,q=2`;

  if (pngBase64.length <= chunkSize) {
    return [`${ESC}_G${control},m=0;${pngBase64}${ESC}\\`];
  }

  const chunks: string[] = [
    `${ESC}_G${control},m=1;${pngBase64.slice(0, chunkSize)}${ESC}\\`,
  ];
  let offset = chunkSize;
  while (offset + chunkSize < pngBase64.length) {
    chunks.push(
      `${ESC}_Gm=1,q=2;${pngBase64.slice(offset, offset + chunkSize)}${ESC}\\`,
    );
    offset += chunkSize;
  }
  chunks.push(`${ESC}_Gm=0,q=2;${pngBase64.slice(offset)}${ESC}\\`);
  return chunks;
}

/**
 * Delete an image and every placement of it. `d=I` also frees the stored image
 * data, which `d=i` alone does not; virtual placements are only removed by the
 * `i`/`I`/`r`/`R`/`n`/`N` delete keys.
 */
export function buildDelete(id: number): string {
  return `${ESC}_Ga=d,d=I,i=${id},q=2${ESC}\\`;
}

/**
 * Typical terminal cell size in pixels, used only when the real one is unknown.
 * Getting this wrong is cosmetic, not fatal: kitty preserves the image's aspect
 * ratio when fitting it to the placeholder rectangle, so a bad guess just means
 * the image is letterboxed inside its grid instead of filling it exactly.
 */
export const DEFAULT_CELL_WIDTH = 8;
export const DEFAULT_CELL_HEIGHT = 16;

/**
 * Pick the placeholder grid that best fits `imageWidth`x`imageHeight` inside a
 * `maxColumns`x`maxRows` box while preserving the image's aspect ratio.
 *
 * Cells are much taller than they are wide, so the image's "natural" size has
 * to be converted from pixels into cells before the aspect ratio means
 * anything -- comparing raw pixel dimensions against a cell budget is what
 * produces stretched previews.
 */
export function fitGrid(options: {
  imageWidth: number;
  imageHeight: number;
  maxColumns: number;
  maxRows: number;
  cellWidth?: number;
  cellHeight?: number;
}): { columns: number; rows: number } {
  const {
    imageWidth,
    imageHeight,
    maxColumns,
    maxRows,
    cellWidth = DEFAULT_CELL_WIDTH,
    cellHeight = DEFAULT_CELL_HEIGHT,
  } = options;

  const boundColumns = Math.min(Math.floor(maxColumns), MAX_PLACEHOLDER_CELLS);
  const boundRows = Math.min(Math.floor(maxRows), MAX_PLACEHOLDER_CELLS);

  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    cellWidth <= 0 ||
    cellHeight <= 0 ||
    boundColumns <= 0 ||
    boundRows <= 0
  ) {
    return { columns: 0, rows: 0 };
  }

  // The image's size expressed in cells, at 1:1 pixel scale.
  const naturalColumns = imageWidth / cellWidth;
  const naturalRows = imageHeight / cellHeight;
  const scale = Math.min(
    boundColumns / naturalColumns,
    boundRows / naturalRows,
  );

  return {
    columns: Math.max(
      1,
      Math.min(boundColumns, Math.floor(naturalColumns * scale)),
    ),
    rows: Math.max(1, Math.min(boundRows, Math.floor(naturalRows * scale))),
  };
}

/**
 * Render the placeholder grid as plain text lines -- one string per row, each
 * `columns` cells wide, wrapped in the SGR that carries the image ID.
 *
 * The SGR is re-emitted on every row (not once for the block) so each line is
 * self-contained: Ink writes lines independently and a color left dangling from
 * a previous line would be lost on a partial repaint.
 */
export function buildPlaceholderRows(options: {
  id: number;
  columns: number;
  rows: number;
}): string[] {
  const { id, columns, rows } = options;
  if (columns <= 0 || rows <= 0) return [];
  if (columns > MAX_PLACEHOLDER_CELLS || rows > MAX_PLACEHOLDER_CELLS) {
    throw new RangeError(
      `placeholder grid ${columns}x${rows} exceeds the ${MAX_PLACEHOLDER_CELLS}-cell diacritic table`,
    );
  }

  const setColor = `${ESC}[38;5;${id}m`;
  const resetColor = `${ESC}[39m`;

  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = setColor;
    for (let column = 0; column < columns; column++) {
      line += PLACEHOLDER_CHAR + cellDiacritics(row, column);
    }
    lines.push(line + resetColor);
  }
  return lines;
}
