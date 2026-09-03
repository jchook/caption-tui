import { basename } from "node:path";
import { Box, Text, useInput } from "ink";
import type { ImageEntry } from "../utils/dataset.js";

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
  const label = entry.name;
  const names = files.map((file) => basename(file)).join(" + ");

  return (
    <Box
      flexDirection="column"
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
