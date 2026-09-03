import assert from "node:assert/strict";
import { test } from "node:test";
import { clampIndex, navStep, nextScrollTop } from "./listViewport.js";

test("clampIndex keeps an index inside the list", () => {
  assert.equal(clampIndex(-5, 10), 0);
  assert.equal(clampIndex(4, 10), 4);
  assert.equal(clampIndex(99, 10), 9);
  assert.equal(clampIndex(3, 0), 0);
});

test("viewport holds still while the cursor stays off the edges", () => {
  // 20 visible rows of 100, cursor walking down the middle: no scrolling, so a
  // move redraws two rows instead of the whole list.
  for (let i = 3; i <= 16; i++) {
    assert.equal(nextScrollTop(0, i, 100, 20), 0, `selected ${i}`);
  }
});

test("viewport scrolls minimally once the cursor reaches the scroll-off margin", () => {
  assert.equal(nextScrollTop(0, 17, 100, 20), 1);
  assert.equal(nextScrollTop(1, 18, 100, 20), 2);
  // Scrolling back up is symmetric.
  assert.equal(nextScrollTop(10, 12, 100, 20), 9);
});

test("viewport never scrolls past either end", () => {
  assert.equal(nextScrollTop(0, 0, 100, 20), 0);
  assert.equal(nextScrollTop(50, 99, 100, 20), 80);
  // A big jump (G) lands flush against the bottom, not three rows past it.
  assert.equal(nextScrollTop(0, 99, 100, 20), 80);
  assert.equal(nextScrollTop(80, 0, 100, 20), 0);
});

test("lists shorter than the window never scroll", () => {
  assert.equal(nextScrollTop(0, 4, 5, 20), 0);
  assert.equal(nextScrollTop(3, 0, 5, 20), 0);
});

test("scroll-off shrinks to fit a tiny window (the 3-row compact list)", () => {
  // With 3 rows a margin of 3 would be unsatisfiable; it degrades to 1.
  assert.equal(nextScrollTop(0, 0, 100, 3), 0);
  assert.equal(nextScrollTop(0, 2, 100, 3), 1);
  assert.equal(nextScrollTop(1, 3, 100, 3), 2);
  assert.equal(nextScrollTop(0, 99, 100, 3), 97);
});

test("a stale scrollTop is re-clamped when the window grows", () => {
  // Terminal resize: window jumps from 5 to 40 rows on a 50-item list.
  assert.equal(nextScrollTop(45, 46, 50, 40), 10);
});

const geometry = { total: 100, page: 19, halfPage: 10 };

test("navStep resolves one navigation character at a time", () => {
  assert.equal(navStep(5, "j", geometry), 6);
  assert.equal(navStep(5, "k", geometry), 4);
  assert.equal(navStep(5, "g", geometry), 0);
  assert.equal(navStep(5, "G", geometry), 99);
  assert.equal(navStep(5, "\u0004", geometry), 15); // Ctrl-D
  assert.equal(navStep(50, "\u0015", geometry), 40); // Ctrl-U
  assert.equal(navStep(5, "\u0006", geometry), 24); // Ctrl-F
  assert.equal(navStep(50, "\u0002", geometry), 31); // Ctrl-B
});

test("navStep ignores characters that do not navigate", () => {
  for (const ch of ["a", "1", " ", "\r", "\n", "\u001B"]) {
    assert.equal(navStep(5, ch, geometry), null, `char ${JSON.stringify(ch)}`);
  }
});

test("navStep clamps at both ends", () => {
  assert.equal(navStep(0, "k", geometry), 0);
  assert.equal(navStep(99, "j", geometry), 99);
  assert.equal(navStep(95, "\u0006", geometry), 99);
  assert.equal(navStep(3, "\u0015", geometry), 0);
});

test("navStep folds a held key into the right total", () => {
  // The burst path: each character applied in turn is the same as that many
  // separate presses.
  let index = 0;
  for (const ch of "jjjjjjjjjj") index = navStep(index, ch, geometry) ?? index;
  assert.equal(index, 10);
});
