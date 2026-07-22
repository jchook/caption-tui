import { expect, test } from "bun:test";
import { deleteWordBefore, wordLeftIndex, wordRightIndex } from "./textNav.js";

test("wordLeftIndex jumps to the start of the previous word", () => {
  const s = "big red car";
  expect(wordLeftIndex(s, s.length)).toBe(8); // start of "car"
  expect(wordLeftIndex(s, 8)).toBe(4); // start of "red"
  expect(wordLeftIndex(s, 4)).toBe(0); // start of "big"
  expect(wordLeftIndex(s, 0)).toBe(0); // clamp at start
});

test("wordLeftIndex skips trailing whitespace before the word", () => {
  const s = "big red   ";
  expect(wordLeftIndex(s, s.length)).toBe(4); // skip spaces, land on "red"
});

test("wordRightIndex jumps to the end of the next word", () => {
  const s = "big red car";
  expect(wordRightIndex(s, 0)).toBe(3); // end of "big"
  expect(wordRightIndex(s, 3)).toBe(7); // end of "red"
  expect(wordRightIndex(s, 7)).toBe(11); // end of "car"
  expect(wordRightIndex(s, 11)).toBe(11); // clamp at end
});

test("deleteWordBefore removes the word left of the cursor", () => {
  expect(deleteWordBefore("big red car", 11)).toEqual({
    text: "big red ",
    cursor: 8,
  });
  // Mid-string: delete the word, keep the tail.
  expect(deleteWordBefore("big red car", 7)).toEqual({
    text: "big  car",
    cursor: 4,
  });
});
