import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteWordBefore, wordLeftIndex, wordRightIndex } from "./textNav.js";

test("wordLeftIndex jumps to the start of the previous word", () => {
  const s = "big red car";
  assert.equal(wordLeftIndex(s, s.length), 8); // start of "car"
  assert.equal(wordLeftIndex(s, 8), 4); // start of "red"
  assert.equal(wordLeftIndex(s, 4), 0); // start of "big"
  assert.equal(wordLeftIndex(s, 0), 0); // clamp at start
});

test("wordLeftIndex skips trailing whitespace before the word", () => {
  const s = "big red   ";
  assert.equal(wordLeftIndex(s, s.length), 4); // skip spaces, land on "red"
});

test("wordRightIndex jumps to the end of the next word", () => {
  const s = "big red car";
  assert.equal(wordRightIndex(s, 0), 3); // end of "big"
  assert.equal(wordRightIndex(s, 3), 7); // end of "red"
  assert.equal(wordRightIndex(s, 7), 11); // end of "car"
  assert.equal(wordRightIndex(s, 11), 11); // clamp at end
});

test("deleteWordBefore removes the word left of the cursor", () => {
  assert.deepEqual(deleteWordBefore("big red car", 11), {
    text: "big red ",
    cursor: 8,
  });
  // Mid-string: delete the word, keep the tail.
  assert.deepEqual(deleteWordBefore("big red car", 7), {
    text: "big  car",
    cursor: 4,
  });
});
