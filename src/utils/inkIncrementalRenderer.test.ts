import assert from "node:assert/strict";
import { test } from "node:test";
// Reaching into Ink's build output on purpose: this is a guard on a dependency
// contract, not on our own code.
import logUpdate from "../../node_modules/ink/build/log-update.js";

/**
 * Ink's incremental renderer rewrites only the lines that changed. To do that it
 * walks the cursor from the bottom of the previous frame back to the top and
 * steps down through the block, so the *whole frame* lands wherever that walk
 * starts. Get the walk wrong by one and every line is written one row off: the
 * top row keeps stale content forever while everything below it shifts down.
 *
 * Our frames end with a newline. App renders one row short of the terminal (to
 * stay off Ink's fullscreen path, which repaints via clearTerminal every frame),
 * and Ink appends "\n" to any output that isn't fullscreen -- which leaves the
 * cursor one row BELOW the last line rather than on it.
 *
 * ink 6.8.0 did not account for that newline and moved up one row too few. The
 * symptom, on every single keypress: the highlighted first row of the list stuck
 * at the top under a duplicate of itself. Fixed in ink 7 by measuring the walk
 * from the raw line count instead of the visible one, so this asserts the
 * behaviour rather than the version.
 */

interface Write {
  text: string;
  row: number;
}

/**
 * Track which screen row each piece of text lands on, given a cursor that starts
 * just past the bottom of a `visibleLines`-tall block. Rows are 0-based, so line
 * `i` of the block belongs on row `i`. Only the escape codes Ink's incremental
 * renderer actually emits are interpreted.
 */
function replay(sequence: string, visibleLines: number): Write[] {
  let row = visibleLines; // one past the last line, because of the trailing \n
  const writes: Write[] = [];
  // A CSI sequence, a newline, or a run of plain text.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: parsing escape sequences
  const pattern = /\u001B\[(\d*)([A-Za-z])|\n|[^\u001B\n]+/g;

  for (const [match, count, command] of sequence.matchAll(pattern)) {
    const n = Number(count || "1");
    if (match === "\n") {
      row++;
    } else if (command === "A") {
      row -= n;
    } else if (command === "B" || command === "E") {
      row += n;
    } else if (command === undefined) {
      writes.push({ text: match, row });
    }
    // Anything else (cursorTo, eraseEndLine, cursor hide) stays on this row.
  }

  return writes;
}

function renderTwice(first: string[], second: string[]): Write[] {
  const chunks: string[] = [];
  const stream = {
    isTTY: true,
    columns: 80,
    rows: 24,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: reaching into Ink's build output
  const log = (logUpdate as any).create(stream, { incremental: true });

  log(`${first.join("\n")}\n`);
  chunks.length = 0;
  log(`${second.join("\n")}\n`);

  return replay(chunks.join(""), second.length);
}

test("an incremental repaint lands on the row it rewrote", () => {
  const before = ["header", "", "> row one", "  row two", "  row three"];
  const after = ["header", "", "  row one", "> row two", "  row three"];

  const writes = renderTwice(before, after);
  const byText = new Map(writes.map((write) => [write.text, write.row]));

  assert.equal(byText.get("  row one"), 2, "rewrote row one on the wrong row");
  assert.equal(byText.get("> row two"), 3, "rewrote row two on the wrong row");
  assert.equal(
    writes.some((write) => write.text === "header"),
    false,
    "rewrote a line that had not changed",
  );
});

test("an incremental repaint of the first line lands on the first row", () => {
  // The case that actually bit: only the top of the block changes, so a walk
  // that starts one row low leaves the old first row on screen untouched.
  const writes = renderTwice(["one", "two", "three"], ["ONE", "two", "three"]);

  assert.deepEqual(
    writes.map((write) => [write.text, write.row]),
    [["ONE", 0]],
  );
});
