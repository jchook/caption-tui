import { basename } from "node:path";
import { Box, Text, useInput } from "ink";
import type { ImageEntry } from "../utils/dataset.js";

/**
 * Rows the bar occupies, border included.
 *
 * App reserves exactly this much room from the list before rendering the bar:
 * the list otherwise grows to fill the whole app box, pushing the bar past its
 * `overflow: hidden` so it is invisible even though it is mounted and taking
 * input. Both sides call this, so the reservation cannot drift from what the
 * component actually draws.
 */
export function deleteConfirmRows(options: {
  trashError: boolean;
  /** True when a shared caption is being kept, which costs an extra line. */
  keepsCaption: boolean;
}): number {
  const border = 2;
  const lines = options.trashError ? 3 : 2 + (options.keepsCaption ? 1 : 0);
  return border + lines;
}

interface DeleteConfirmProps {
  entry: ImageEntry;
  /** Files this delete will remove, from `filesToRemove`. */
  files: readonly string[];
  /** Set once trashing has failed; offers the permanent delete instead. */
  trashError: string | null;
  busy: boolean;
  onConfirm: (mode: "trash" | "permanent") => void;
  onCancel: () => void;
}

export function DeleteConfirm({
  entry,
  files,
  trashError,
  busy,
  onConfirm,
  onCancel,
}: DeleteConfirmProps) {
  useInput((input, key) => {
    if (busy) return;
    if (key.escape) return onCancel();

    // `input` can be a whole run of characters, so test for the key rather than
    // comparing the run to it. Trashing takes `t` (or the instinctive `y`);
    // permanently deleting takes a deliberate capital `D` and is only offered
    // once trashing has actually failed -- nothing here should ever rm a file
    // the user agreed to *trash*.
    if (trashError) {
      if (input.includes("D")) return onConfirm("permanent");
      if (input.includes("n") || input.includes("q")) return onCancel();
      return;
    }
    if (input.includes("t") || input.includes("y")) return onConfirm("trash");
    if (input.includes("n") || input.includes("q")) return onCancel();
  });

  const keptCaption = files.includes(entry.captionPath)
    ? null
    : basename(entry.captionPath);
  const height = deleteConfirmRows({
    trashError: trashError !== null,
    keepsCaption: keptCaption !== null,
  });
  const label = entry.name;
  const names = files.map((file) => basename(file)).join(" + ");

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      height={height}
      borderStyle="single"
      borderColor={trashError ? "red" : "yellow"}
      paddingX={1}
    >
      {trashError ? (
        <>
          <Text color="red">Trash failed: {trashError}</Text>
          <Text bold>Permanently delete {names}? This cannot be undone.</Text>
          <Text dimColor>[D] permanently delete [Esc] cancel</Text>
        </>
      ) : (
        <>
          <Text bold color="yellow">
            Delete {names}?
          </Text>
          {keptCaption && (
            <Text dimColor>
              {keptCaption} kept - still used by another image sharing it
            </Text>
          )}
          <Text dimColor>
            {busy ? `Removing ${label}...` : "[t] move to trash [Esc] cancel"}
          </Text>
        </>
      )}
    </Box>
  );
}
