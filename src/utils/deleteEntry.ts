import { unlink } from "node:fs/promises";
import trash from "trash";
import type { ImageEntry } from "./dataset.js";

/**
 * Files that removing `target` should take with it.
 *
 * The caption only goes if nothing else is using it: `image1.jpg` and
 * `image1.png` in one folder share a single `image1.txt`, so deleting one of
 * the pair must leave the caption for the row that remains.
 */
export function filesToRemove(
  entries: readonly ImageEntry[],
  target: ImageEntry,
): string[] {
  const captionIsShared = entries.some(
    (entry) =>
      entry.imagePath !== target.imagePath &&
      entry.captionPath === target.captionPath,
  );

  return captionIsShared
    ? [target.imagePath]
    : [target.imagePath, target.captionPath];
}

/**
 * Move `paths` to the system trash (Finder trash, Recycle Bin, or the XDG trash
 * directory). Rejects if the platform has nowhere to put them.
 */
export async function moveToTrash(paths: readonly string[]): Promise<void> {
  // `glob: true` is trash's default, which would read a dataset file named
  // `img[1].png` or `shot(2).jpg` as a pattern instead of a path.
  await trash([...paths], { glob: false });
}

/** Unlink `paths` outright. Missing files are not an error. */
export async function permanentlyDelete(
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/** Drop the entry at `index`, and the selection that should follow it. */
export function removeEntryAt(
  entries: readonly ImageEntry[],
  index: number,
): { entries: ImageEntry[]; selectedIndex: number } {
  const remaining = entries.filter((_, i) => i !== index);
  return {
    entries: remaining,
    // Stay on the same row so a run of deletions keeps working down the list,
    // falling back to the new last row when the tail is removed.
    selectedIndex: Math.max(0, Math.min(index, remaining.length - 1)),
  };
}

/** Human-readable reason a delete failed, for the confirmation bar. */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
