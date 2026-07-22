/**
 * Cursor/word helpers for the single-line caption editor. Word boundaries are
 * whitespace-delimited (emacs/readline style): a "word jump" skips any run of
 * whitespace, then the run of non-whitespace beside it.
 */

const isSpace = (ch: string | undefined): boolean =>
  ch !== undefined && /\s/.test(ch);

/** Index of the start of the word at/before the cursor (Ctrl-Left). */
export function wordLeftIndex(text: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && isSpace(text[i - 1])) i--;
  while (i > 0 && !isSpace(text[i - 1])) i--;
  return i;
}

/** Index of the end of the word at/after the cursor (Ctrl-Right). */
export function wordRightIndex(text: string, cursor: number): number {
  let i = cursor;
  while (i < text.length && isSpace(text[i])) i++;
  while (i < text.length && !isSpace(text[i])) i++;
  return i;
}

/**
 * Delete the word before the cursor (Ctrl-W). Returns the new text and the new
 * cursor position (the start of the deleted span).
 */
export function deleteWordBefore(
  text: string,
  cursor: number,
): { text: string; cursor: number } {
  const start = wordLeftIndex(text, cursor);
  return { text: text.slice(0, start) + text.slice(cursor), cursor: start };
}
