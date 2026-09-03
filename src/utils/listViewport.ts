// Scroll-window math for the image list.
//
// The list used to re-center the selection on every move, which meant a single
// arrow keypress rewrote every visible row. A sticky window with a scroll-off
// margin keeps the viewport still until the cursor nears an edge, so most moves
// change two lines instead of all of them -- and the list stops jittering under
// the cursor.

/** Clamp an index into `[0, total - 1]` (0 for an empty list). */
export function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(total - 1, index));
}

/**
 * Smallest scroll adjustment that keeps `selectedIndex` visible with at least
 * `scrollOff` rows of context above and below (shrunk automatically when the
 * window is too short to afford it, e.g. the 3-row compact list).
 */
export function nextScrollTop(
  prevTop: number,
  selectedIndex: number,
  total: number,
  maxVisible: number,
  scrollOff = 3,
): number {
  const windowSize = Math.max(1, maxVisible);
  const maxTop = Math.max(0, total - windowSize);
  const off = Math.min(
    scrollOff,
    Math.max(0, Math.floor((windowSize - 1) / 2)),
  );

  let top = Math.max(0, Math.min(prevTop, maxTop));
  if (selectedIndex < top + off) top = selectedIndex - off;
  if (selectedIndex > top + windowSize - 1 - off) {
    top = selectedIndex - windowSize + 1 + off;
  }
  return Math.max(0, Math.min(top, maxTop));
}

/** Window geometry the paging keys are measured against. */
export interface NavGeometry {
  total: number;
  /** Rows moved by PageUp/PageDown and Ctrl-F/Ctrl-B. */
  page: number;
  /** Rows moved by Ctrl-D/Ctrl-U. */
  halfPage: number;
}

// Ink delivers a run of ordinary characters -- and a run of raw control bytes --
// as a single input event with no per-key flags (the path it also uses for
// pastes). Holding a key on a laggy link produces exactly that, so navigation
// has to be resolvable one character at a time.
const CTRL_D = "\u0004";
const CTRL_U = "\u0015";
const CTRL_F = "\u0006";
const CTRL_B = "\u0002";

/**
 * Index after applying a single navigation character, or `null` if `ch` doesn't
 * navigate. Enter is not handled here -- the caller opens the editor once, on
 * whatever index the rest of the run selected.
 */
export function navStep(
  index: number,
  ch: string,
  { total, page, halfPage }: NavGeometry,
): number | null {
  switch (ch) {
    case "j":
      return clampIndex(index + 1, total);
    case "k":
      return clampIndex(index - 1, total);
    case "g":
      return 0;
    case "G":
      return clampIndex(total - 1, total);
    case CTRL_D:
      return clampIndex(index + halfPage, total);
    case CTRL_U:
      return clampIndex(index - halfPage, total);
    case CTRL_F:
      return clampIndex(index + page, total);
    case CTRL_B:
      return clampIndex(index - page, total);
    default:
      return null;
  }
}
